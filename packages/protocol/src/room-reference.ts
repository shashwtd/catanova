/** Human-friendly join aliases are separate from permanent game identities. */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode = /^[A-HJ-NP-Z2-9]{4}$/;
const legacyId = /^[A-Z2-9]{8}$/;
const permanentId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function normalizeRoomReference(value: string): string {
  const trimmed = value.trim();
  return permanentId.test(trimmed) ? trimmed.toLowerCase() : trimmed.toUpperCase();
}
/** Validate a canonical reference; call normalizeRoomReference first for user input. */
export function isRoomReference(value: unknown): value is string {
  return (
    typeof value === 'string' && (shortCode.test(value) || legacyId.test(value) || permanentId.test(value))
  );
}
export function isShortRoomCode(value: string): boolean {
  return shortCode.test(value);
}
