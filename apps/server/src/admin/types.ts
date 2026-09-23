/**
 * Response shapes of the admin API, shared with the admin interface in
 * apps/admin. Type-only: nothing here runs in the browser bundle.
 */
import type { AuditEntry } from './audit.js';

export type { AuditEntry };

export type AdminSession = {
  actor: string;
  mode: 'cloudflare-access' | 'local-dev';
  revision: string | null;
};

export type AuthRejection = { at: number; status: number; reason: string; ip: string | null; path: string };

export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null };
