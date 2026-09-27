import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  composeValidationEnvironment,
  installedTreeProblems,
  pythonTestDirectories,
  SCRUBBED_VARIABLES,
  workspaceFolders,
} from '../scripts/ci.js';

function tree(files: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'catanova-ci-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
function link(root: string, target: string, path: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  symlinkSync(target, join(root, path));
}

const lock = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'demo', workspaces: ['packages/*'] },
    'packages/rules': { name: '@demo/rules', version: '0.1.0' },
    'node_modules/@demo/rules': { resolved: 'packages/rules', link: true },
    'node_modules/exact': { version: '1.2.3', dev: true },
    'node_modules/@scope/pinned': { version: '2.0.0' },
    'node_modules/@esbuild/other-platform': { version: '0.1.0', optional: true },
    'node_modules/exact/node_modules/nested': { version: '4.0.0' },
  },
};

test('local CI accepts an installed tree that is exactly the lockfile, allowing absent optional platform packages', (t) => {
  const root = tree({
    'package.json': { name: 'demo', workspaces: ['packages/*'] },
    'package-lock.json': lock,
    'packages/rules/package.json': { name: '@demo/rules', version: '0.1.0' },
    'node_modules/exact/package.json': { version: '1.2.3' },
    'node_modules/exact/node_modules/nested/package.json': { version: '4.0.0' },
    'node_modules/@scope/pinned/package.json': { version: '2.0.0' },
    'node_modules/.package-lock.json': {},
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  link(root, '../../packages/rules', 'node_modules/@demo/rules');
  assert.deepEqual(workspaceFolders(root), ['packages/rules']);
  assert.deepEqual(installedTreeProblems(root), []);
});

test('local CI rejects in-range drift, missing, extraneous and mislinked packages that npm ls would accept', (t) => {
  const root = tree({
    'package.json': { name: 'demo', workspaces: ['packages/*'] },
    'package-lock.json': lock,
    'packages/rules/package.json': { name: '@demo/rules', version: '0.1.0' },
    'packages/other/package.json': { name: '@demo/other', version: '0.1.0' },
    // Satisfies a caret range, but it is not what `npm ci` would install.
    'node_modules/exact/package.json': { version: '1.2.9' },
    'node_modules/@scope/pinned/package.json': { version: '2.0.0' },
    'node_modules/left-pad/package.json': { version: '1.3.0' },
    'packages/rules/node_modules/stray/package.json': { version: '0.0.1' },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  link(root, '../../packages/other', 'node_modules/@demo/rules');
  assert.deepEqual(installedTreeProblems(root), [
    'node_modules/@demo/rules does not link to packages/rules',
    'node_modules/exact is 1.2.9; package-lock.json has 1.2.3',
    'node_modules/exact/node_modules/nested@4.0.0 is locked but not installed',
    'node_modules/left-pad is installed but not in package-lock.json (a clean npm ci would not have it)',
    'packages/rules/node_modules/stray is installed but not in package-lock.json (a clean npm ci would not have it)',
  ]);
});

test('local CI refuses to guess about a missing install or an old lockfile format', (t) => {
  const missing = tree({ 'package.json': { name: 'demo' }, 'package-lock.json': lock });
  const old = tree({ 'package.json': { name: 'demo' }, 'package-lock.json': { lockfileVersion: 1 } });
  t.after(() => {
    rmSync(missing, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
  });
  assert.deepEqual(installedTreeProblems(missing), ['node_modules is missing; run npm ci']);
  assert.match(installedTreeProblems(old)[0]!, /no "packages" section/);
  const nested = tree({ 'package.json': { name: 'demo', workspaces: ['apps/*/src'] } });
  t.after(() => rmSync(nested, { recursive: true, force: true }));
  assert.throws(() => workspaceFolders(nested), /Unsupported workspace pattern/);
});

test('local CI validates Compose with the workflow placeholders and a clean environment', () => {
  const revision = 'a'.repeat(40);
  assert.deepEqual(composeValidationEnvironment(revision), {
    CATANOVA_DOMAIN: 'catanova.example',
    CATANOVA_REVISION: revision,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci_configuration_only',
    TURNSTILE_SITE_KEY: 'site_key_for_configuration_validation',
    TUNNEL_TOKEN: 'tunnel_token_for_configuration_validation',
    ADMIN_ACCESS_TEAM_DOMAIN: 'catanova-ci.cloudflareaccess.com',
    ADMIN_ACCESS_AUD: '0'.repeat(64),
    ADMIN_EMAILS: 'owner@example.com',
  });
  // Values that alter the build, the bots or the admin listener must not leak from a developer
  // shell into the gate.
  for (const name of [
    'GA_MEASUREMENT_ID',
    'TYPESAFE_API_KEY',
    'SUPABASE_URL',
    'NODE_ENV',
    'ADMIN_PORT',
    // Which game modes the server opens, which would change what the tests see.
    'CATANOVA_MODES',
    'CATANOVA_MODE_TESTERS',
  ])
    assert.ok(SCRUBBED_VARIABLES.includes(name), name);
});

test('local CI runs every Python host-script suite, not only the backup worker', (t) => {
  const root = tree({
    'deploy/single-vm/backup/test_backup.py': '',
    'deploy/single-vm/backup/backup.py': '',
    'deploy/single-vm/monitoring/test_watchdog.py': '',
    'deploy/single-vm/monitoring/__pycache__/test_watchdog.cpython-312.pyc': '',
    'deploy/single-vm/Caddyfile': '',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(pythonTestDirectories(root), ['deploy/single-vm/backup', 'deploy/single-vm/monitoring']);
  // The real repository still has the suite the workflow ran.
  assert.ok(pythonTestDirectories(process.cwd()).includes('deploy/single-vm/backup'));
});
