import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

function canonicalAddress(value: string): string | undefined {
  const plain = value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  const family = isIP(plain);
  if (family === 4) return plain;
  if (family === 6) return new URL(`http://[${plain}]/`).hostname.slice(1, -1);
  return undefined;
}

/** Forwarded values are considered only behind explicitly trusted, controlled proxy peers. */
export function roomClientAddress(trustedCidrs: string[] = []) {
  const trusted = new BlockList();
  if (trustedCidrs.length > 32) throw new Error('Too many trusted proxy CIDRs');
  for (const cidr of trustedCidrs) {
    const [address, bits, extra] = cidr.split('/');
    const family = isIP(address ?? '');
    const prefix = Number(bits);
    if (
      !family ||
      extra !== undefined ||
      !/^\d+$/.test(bits ?? '') ||
      prefix <= 0 ||
      prefix > (family === 4 ? 32 : 128)
    )
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IPv4/IPv6 network prefixes');
    trusted.addSubnet(address!, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return (request: Pick<IncomingMessage, 'headers' | 'socket'>): string => {
    const peer = canonicalAddress(request.socket.remoteAddress ?? '') ?? 'unknown';
    const family = isIP(peer);
    if (family && trusted.check(peer, family === 4 ? 'ipv4' : 'ipv6')) {
      const forwarded = request.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded.length <= 2048) {
        // Caddy appends the peer it actually observed; never take a spoofable leftmost value.
        const last = canonicalAddress(forwarded.split(',').at(-1)!.trim());
        if (last) return last;
      }
    }
    return peer;
  };
}

/** Fixed-size, short-lived admission/lookup buckets; established game commands are separate. */
export class RoomAccessLimit {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();
  private nextSweep = 0;
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60000,
    private readonly maxKeys = 4096,
  ) {}
  consume(address: string, now: number): { allowed: boolean; retryAfter: number } {
    if (now >= this.nextSweep) {
      for (const [key, bucket] of this.buckets) if (bucket.expiresAt <= now) this.buckets.delete(key);
      this.nextSweep = now + this.windowMs;
    }
    let bucket = this.buckets.get(address);
    if (bucket && bucket.expiresAt <= now) {
      this.buckets.delete(address);
      bucket = undefined;
    }
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys)
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((this.nextSweep - now) / 1000)) };
      bucket = { count: 0, expiresAt: now + this.windowMs };
      this.buckets.set(address, bucket);
    }
    if (bucket.count >= this.limit)
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)) };
    bucket.count++;
    return { allowed: true, retryAfter: 0 };
  }
}
