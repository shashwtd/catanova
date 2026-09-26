/**
 * Which game modes a host may pick. Classic is always open to everyone; each other mode is off, open to
 * testers, or open to everyone, and a tester's rooms may pick every mode open to testers.
 *
 * The admin console's Modes tab sets both, and a change applies at once, with no restart: the answer is read
 * from this server's database (mode_access and mode_testers) each time it is needed, and the console pushes
 * it to hosts waiting in a lobby. Two switches, read once at start-up, give the defaults for whatever the
 * console has not set:
 *
 *   CATANOVA_MODES          modes open to everyone, as ruleset ids separated by commas. Others: testers.
 *   CATANOVA_MODE_TESTERS   account ids that are testers, whatever the console says.
 *
 * An id this build does not know is logged and left out, and never stops the server: a rollback that leaves
 * a newer mode in production.env, or in the console's table, must still start. A room's host decides what the
 * room may pick; in local playtest mode nobody has an account, so only modes open to everyone can be picked.
 * See docs/GAME-MODES.md, "The staged rollout".
 */
import type { DatabaseSync } from 'node:sqlite';
import { CLASSIC, findRuleset, rulesets } from '../../../packages/rules/src/rulesets.js';

export type ModeSwitches = { open: readonly string[]; testers: ReadonlySet<string> };
export const CLASSIC_ONLY: ModeSwitches = { open: [CLASSIC.id], testers: new Set() };

export const MODE_STATES = ['off', 'testers', 'everyone'] as const;
export type ModeState = (typeof MODE_STATES)[number];

/** Where a mode's state comes from: the console, CATANOVA_MODES, neither (open to testers), or Classic's rule. */
export type ModeSource = 'console' | 'environment' | 'default' | 'always';
export type ModeSetting = {
  id: string;
  state: ModeState;
  source: ModeSource;
  changedAt: number | null;
  changedBy: string | null;
};
export type Tester = {
  userId: string;
  source: 'console' | 'environment';
  addedAt: number | null;
  addedBy: string | null;
};

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function readModeSwitches(
  env: Record<string, string | undefined> = process.env,
  log: (event: Record<string, unknown>) => void = (event) => console.warn(JSON.stringify(event)),
): ModeSwitches {
  const open = [CLASSIC.id];
  for (const id of list(env.CATANOVA_MODES))
    if (!findRuleset(id)) log({ event: 'mode_unavailable', variable: 'CATANOVA_MODES', mode: id });
    else if (!open.includes(id)) open.push(id);
  // Account ids are matched whatever their case, as they may be copied from wherever they were shown.
  return { open, testers: new Set(list(env.CATANOVA_MODE_TESTERS).map((id) => id.toLowerCase())) };
}

/** The registered modes a room may pick, Classic first, given each mode's state and whether its host tests. */
function pick(state: (id: string) => ModeState, tester: boolean): string[] {
  return rulesets()
    .filter((rules) => {
      if (rules.id === CLASSIC.id) return true;
      const now = state(rules.id);
      return now === 'everyone' || (now === 'testers' && tester);
    })
    .map((rules) => rules.id);
}

/**
 * The switches as they stand: the start-up defaults, overridden by what the console set. Nothing is cached,
 * so a change the console commits is the answer to the next question, and one it rolls back never was.
 */
export class ModeAccess {
  constructor(
    private readonly db: DatabaseSync,
    readonly defaults: ModeSwitches = CLASSIC_ONLY,
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mode_access (
        mode TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('off', 'testers', 'everyone')),
        changed_at INTEGER NOT NULL,
        changed_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mode_testers (
        user_id TEXT PRIMARY KEY CHECK(user_id = lower(user_id)),
        added_at INTEGER NOT NULL,
        added_by TEXT NOT NULL
      );
    `);
  }

  private chosen(): Map<string, { state: ModeState; changedAt: number; changedBy: string }> {
    const rows = this.db
      .prepare('SELECT mode, state, changed_at AS changedAt, changed_by AS changedBy FROM mode_access')
      .all() as { mode: string; state: ModeState; changedAt: number; changedBy: string }[];
    return new Map(rows.map(({ mode, ...row }) => [mode, row]));
  }

  /** Every mode this build contains, Classic first, with who may pick it and why. */
  settings(): ModeSetting[] {
    const chosen = this.chosen();
    return rulesets().map((rules): ModeSetting => {
      if (rules.id === CLASSIC.id)
        return { id: rules.id, state: 'everyone', source: 'always', changedAt: null, changedBy: null };
      const set = chosen.get(rules.id);
      if (set) return { id: rules.id, ...set, source: 'console' };
      const open = this.defaults.open.includes(rules.id);
      return {
        id: rules.id,
        state: open ? 'everyone' : 'testers',
        source: open ? 'environment' : 'default',
        changedAt: null,
        changedBy: null,
      };
    });
  }

  tester(account: string | null | undefined): Tester | null {
    if (!account) return null;
    const id = account.toLowerCase();
    if (this.defaults.testers.has(id))
      return { userId: id, source: 'environment', addedAt: null, addedBy: null };
    const row = this.db
      .prepare('SELECT added_at AS addedAt, added_by AS addedBy FROM mode_testers WHERE user_id = ?')
      .get(id) as { addedAt: number; addedBy: string } | undefined;
    return row ? { userId: id, source: 'console', ...row } : null;
  }

  /** Testers from production.env first, then the console's, the newest first. */
  testers(): Tester[] {
    const fromConsole = this.db
      .prepare(
        'SELECT user_id AS userId, added_at AS addedAt, added_by AS addedBy FROM mode_testers ORDER BY added_at DESC, user_id',
      )
      .all() as { userId: string; addedAt: number; addedBy: string }[];
    return [
      ...[...this.defaults.testers].map((userId): Tester => ({
        userId,
        source: 'environment',
        addedAt: null,
        addedBy: null,
      })),
      ...fromConsole
        .filter((row) => !this.defaults.testers.has(row.userId))
        .map((row): Tester => ({ ...row, source: 'console' })),
    ];
  }

  /** The modes a room whose host has this account may pick, Classic first. */
  modesFor(account: string | null | undefined): string[] {
    const settings = new Map(this.settings().map((setting) => [setting.id, setting.state]));
    return pick((id) => settings.get(id) ?? 'off', !!this.tester(account));
  }

  /** The console's choice for one mode; the caller audits it in the same transaction. */
  setState(mode: string, state: ModeState, actor: string, at: number): { from: ModeState; to: ModeState } {
    const from = this.settings().find((setting) => setting.id === mode)?.state;
    if (!from || mode === CLASSIC.id) throw new Error(`${mode} cannot be switched`);
    this.db
      .prepare(
        `INSERT INTO mode_access(mode, state, changed_at, changed_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(mode) DO UPDATE SET state = excluded.state, changed_at = excluded.changed_at,
           changed_by = excluded.changed_by`,
      )
      .run(mode, state, Math.round(at), actor);
    return { from, to: state };
  }

  /** Adds or removes a console tester; true when that changed anything. The caller audits it. */
  setTester(account: string, tester: boolean, actor: string, at: number): boolean {
    const id = account.toLowerCase();
    const result = tester
      ? this.db
          .prepare(
            'INSERT INTO mode_testers(user_id, added_at, added_by) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING',
          )
          .run(id, Math.round(at), actor)
      : this.db.prepare('DELETE FROM mode_testers WHERE user_id = ?').run(id);
    return result.changes > 0;
  }
}
