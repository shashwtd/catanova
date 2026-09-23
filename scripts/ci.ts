/**
 * Local CI: everything .github/workflows/ci.yml checked, run on this machine in one command.
 *
 *   npm run ci               lockfile, typecheck, tests, build, audit and deployment checks
 *   npm run ci -- --docker   also build and start the local container, probe it, then remove it
 *
 * GitHub Actions stopped running for this repository on 20 September 2026 (the account was
 * locked over billing), so this is the gate before merging and before every deploy. Unlike the
 * workflow it keeps the installed node_modules; it first proves they are exactly what `npm ci`
 * would install from package-lock.json, so a stale local install cannot hide a failure.
 *
 * Every step runs even after an earlier failure, then a summary lists each result and its time.
 * The exit status is 1 when any step failed. A skipped step (Docker unavailable) is reported as
 * skipped, never as passed.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Status = 'PASS' | 'FAIL' | 'SKIP';
export type StepResult = { name: string; status: Status; seconds: number; detail?: string };
type LockEntry = {
  version?: string;
  resolved?: string;
  link?: boolean;
  optional?: boolean;
  devOptional?: boolean;
};

/** Variables that change what the app builds or how tests behave. A clean GitHub runner had none. */
export const SCRUBBED_VARIABLES = [
  'ALLOW_LOCAL_PLAYTEST',
  'ALLOWED_ORIGINS',
  'CATANOVA_BOT_MODEL',
  'CATANOVA_DOMAIN',
  'CATANOVA_REVISION',
  'DATABASE_PATH',
  'GA_MEASUREMENT_ID',
  'HOST',
  'NODE_ENV',
  'PORT',
  'REQUIRE_AUTH',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_URL',
  'TRUSTED_PROXY_CIDRS',
  'TURNSTILE_SITE_KEY',
  'TYPESAFE_API_KEY',
  'TYPESAFE_BASE_URL',
];

/** The placeholder values .github/workflows/ci.yml used to validate the production Compose file. */
export function composeValidationEnvironment(revision: string): Record<string, string> {
  return {
    CATANOVA_DOMAIN: 'catanova.example',
    CATANOVA_REVISION: revision,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci_configuration_only',
    TURNSTILE_SITE_KEY: 'site_key_for_configuration_validation',
  };
}

/** Workspace folders named by package.json, supporting the literal and `dir/*` forms this repo uses. */
export function workspaceFolders(root: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: unknown };
  const patterns = Array.isArray(manifest.workspaces) ? (manifest.workspaces as unknown[]) : [];
  const folders: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.includes('**') || /\*.*\//.test(pattern))
      throw new Error(`Unsupported workspace pattern in package.json: ${String(pattern)}`);
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      for (const name of readdirSync(join(root, parent)).sort())
        if (existsSync(join(root, parent, name, 'package.json'))) folders.push(`${parent}/${name}`);
    } else if (existsSync(join(root, pattern, 'package.json'))) folders.push(pattern);
  }
  return folders;
}

/**
 * Package folders actually present under every node_modules directory: the root's and each
 * workspace's, including nested node_modules. Links are listed but not followed.
 */
function installedPackages(root: string, workspaces: string[]): string[] {
  const found: string[] = [];
  const visit = (modules: string) => {
    let names: string[];
    try {
      names = readdirSync(join(root, modules)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue; // .bin, .package-lock.json, tool caches
      const entries = name.startsWith('@')
        ? readdirSync(join(root, modules, name))
            .sort()
            .filter((child) => !child.startsWith('.'))
            .map((child) => `${modules}/${name}/${child}`)
        : [`${modules}/${name}`];
      for (const entry of entries) {
        found.push(entry);
        if (!lstatSync(join(root, entry)).isSymbolicLink()) visit(`${entry}/node_modules`);
      }
    }
  };
  visit('node_modules');
  for (const workspace of workspaces) visit(`${workspace}/node_modules`);
  return found;
}

/**
 * Differences between the installed tree and package-lock.json, as readable sentences.
 *
 * `npm ls` accepts any version inside a declared range and only labels extraneous packages,
 * so it cannot prove that tests ran against the locked dependencies. This compares exact
 * versions instead. Optional packages may be absent: npm skips them on other platforms.
 */
export function installedTreeProblems(root: string): string[] {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    lockfileVersion?: number;
    packages?: Record<string, LockEntry>;
  };
  if (!lock.packages || (lock.lockfileVersion ?? 0) < 2)
    return ['package-lock.json has no "packages" section; regenerate it with npm 7 or newer'];
  if (!existsSync(join(root, 'node_modules'))) return ['node_modules is missing; run npm ci'];
  const problems: string[] = [];
  const locked = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/') && !path.includes('/node_modules/')) continue;
    locked.add(path);
    const location = join(root, path);
    if (entry.link) {
      const expected = entry.resolved ? resolve(root, entry.resolved) : undefined;
      let target: string | undefined;
      try {
        target = realpathSync(location);
      } catch {
        problems.push(`${path} is missing; it should link to ${entry.resolved ?? 'a workspace'}`);
        continue;
      }
      if (!expected || !existsSync(expected) || target !== realpathSync(expected))
        problems.push(`${path} does not link to ${entry.resolved ?? 'its workspace'}`);
      continue;
    }
    let installed: string | undefined;
    try {
      installed = (JSON.parse(readFileSync(join(location, 'package.json'), 'utf8')) as { version?: string })
        .version;
    } catch {
      if (!entry.optional && !entry.devOptional)
        problems.push(`${path}@${entry.version ?? '?'} is locked but not installed`);
      continue;
    }
    if (installed !== entry.version)
      problems.push(
        `${path} is ${installed ?? 'unversioned'}; package-lock.json has ${entry.version ?? '?'}`,
      );
  }
  for (const path of installedPackages(root, workspaceFolders(root)))
    if (!locked.has(path))
      problems.push(`${path} is installed but not in package-lock.json (a clean npm ci would not have it)`);
  return problems;
}

/** Folders under deploy/single-vm holding `test_*.py` host-script tests, each run as its own suite. */
export function pythonTestDirectories(root: string): string[] {
  const base = 'deploy/single-vm';
  const found: string[] = [];
  const visit = (relative: string, depth: number) => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (entries.some((entry) => entry.isFile() && /^test_.*\.py$/.test(entry.name))) found.push(relative);
    if (depth < 3)
      for (const entry of entries)
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__')
          visit(`${relative}/${entry.name}`, depth + 1);
  };
  visit(base, 0);
  return found;
}

function gitRevision(root: string): { revision: string; label: string } {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const revision = head.status === 0 ? head.stdout.trim() : '';
  if (!/^[0-9a-f]{40}$/.test(revision)) return { revision: '0'.repeat(40), label: 'no Git commit' };
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const dirty = status.status !== 0 || status.stdout.trim() !== '';
  return {
    revision,
    label: `commit ${revision.slice(0, 12)}${dirty ? ' plus uncommitted changes (this run covers the working tree, not the commit)' : ''}`,
  };
}

function available(command: string, args: string[]): boolean {
  const probe = spawnSync(command, args, { stdio: 'ignore', timeout: 20_000 });
  return !probe.error && probe.status === 0;
}

const format = (seconds: number) => `${seconds.toFixed(1)}s`;
let interrupted = false;

/** Streams output live; a quiet step keeps its output and prints it only if the step fails. */
async function runCommand(
  name: string,
  command: string,
  args: string[],
  options: SpawnOptions = {},
  quiet = false,
): Promise<StepResult> {
  const started = performance.now();
  let output = '';
  const exit = await new Promise<{ code: number | null; error?: string }>((done) => {
    const child = spawn(command, args, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...options });
    const keep = (chunk: Buffer) => {
      if (output.length < 1_000_000) output += chunk.toString();
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.once('error', (error: NodeJS.ErrnoException) =>
      done({
        code: null,
        error: error.code === 'ENOENT' ? `${command} was not found on PATH` : error.message,
      }),
    );
    child.once('close', (code, signal) =>
      done({ code, ...(signal ? { error: `stopped by ${signal}` } : {}) }),
    );
  });
  const seconds = (performance.now() - started) / 1000;
  if (quiet && exit.code !== 0) console.log(output);
  if (exit.code === 0) return { name, status: 'PASS', seconds };
  return { name, status: 'FAIL', seconds, detail: exit.error ?? `exit status ${exit.code}` };
}

function runCheck(name: string, check: () => string[]): StepResult {
  const started = performance.now();
  let problems: string[];
  try {
    problems = check();
  } catch (error) {
    problems = [(error as Error).message];
  }
  const seconds = (performance.now() - started) / 1000;
  for (const problem of problems) console.error(`  ${problem}`);
  if (!problems.length) {
    console.log('  ok');
    return { name, status: 'PASS', seconds };
  }
  return { name, status: 'FAIL', seconds, detail: `${problems.length} problem(s); run npm ci` };
}

/** `npm ci --dry-run` in a scratch copy of the manifests: the check the workflow's `npm ci` made. */
export async function lockfileInSync(
  name: string,
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<StepResult> {
  const scratch = mkdtempSync(join(tmpdir(), 'catanova-ci-lockfile-'));
  try {
    for (const file of ['package.json', 'package-lock.json', '.npmrc'])
      if (existsSync(join(root, file))) copyFileSync(join(root, file), join(scratch, file));
    for (const workspace of workspaceFolders(root)) {
      mkdirSync(join(scratch, workspace), { recursive: true });
      copyFileSync(join(root, workspace, 'package.json'), join(scratch, workspace, 'package.json'));
    }
    // The copy has no node_modules, so no npm version can remove the developer's installed tree.
    const result = await runCommand(
      name,
      'npm',
      ['ci', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: scratch, env },
      true,
    );
    if (result.status === 'PASS')
      console.log('  package.json and every workspace manifest agree with package-lock.json');
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function main(argv: string[]): Promise<number> {
  const unknown = argv.filter((arg) => arg !== '--docker');
  if (argv.includes('--help') || unknown.length) {
    console.log('Usage: npm run ci [-- --docker]');
    return unknown.length && !argv.includes('--help') ? 2 : 0;
  }
  const withDocker = argv.includes('--docker');
  const root = process.cwd();
  if (!existsSync(join(root, 'package.json')) || !existsSync(join(root, 'deploy/single-vm/compose.yaml'))) {
    console.error('Run this from the repository root; npm run ci does that for you.');
    return 2;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
  for (const name of SCRUBBED_VARIABLES) delete env[name];
  const git = gitRevision(root);
  const results: StepResult[] = [];
  const steps: { name: string; run: () => Promise<StepResult> | StepResult }[] = [];
  const add = (name: string, run: () => Promise<StepResult> | StepResult) => steps.push({ name, run });
  const skip = (name: string, detail: string) => () => ({
    name,
    status: 'SKIP' as const,
    seconds: 0,
    detail,
  });
  const hasCompose = available('docker', ['compose', 'version']);

  add('Lockfile matches package.json (npm ci --dry-run)', () =>
    lockfileInSync('Lockfile matches package.json (npm ci --dry-run)', root, env),
  );
  add('Installed node_modules match package-lock.json exactly', () =>
    runCheck('Installed node_modules match package-lock.json exactly', () => installedTreeProblems(root)),
  );
  add('Typecheck', () => runCommand('Typecheck', 'npm', ['run', 'typecheck'], { env }));
  add('Tests', () => runCommand('Tests', 'npm', ['test'], { env }));
  add('Build', () => runCommand('Build', 'npm', ['run', 'build'], { env }));
  add('Production dependency audit (high and above)', () =>
    runCommand(
      'Production dependency audit (high and above)',
      'npm',
      ['audit', '--omit=dev', '--audit-level=high'],
      {
        env,
      },
    ),
  );
  add('Bootstrap script syntax', () =>
    runCommand('Bootstrap script syntax', 'bash', ['-n', 'deploy/single-vm/bootstrap.sh'], { env }),
  );
  // Every host-script suite, so a new one cannot be skipped the way the workflow only ran backup/.
  for (const directory of pythonTestDirectories(root)) {
    const name = `Python tests in ${directory}`;
    add(name, () =>
      runCommand(name, 'python3', ['-B', '-m', 'unittest', 'discover', '-s', directory, '-p', 'test_*.py'], {
        env,
      }),
    );
  }
  const composeName = 'Production Compose configuration (placeholder values)';
  add(
    composeName,
    hasCompose
      ? () =>
          runCommand(
            composeName,
            'docker',
            [
              'compose',
              '--env-file',
              'deploy/single-vm/.env.example',
              '-f',
              'deploy/single-vm/compose.yaml',
              'config',
              '--quiet',
            ],
            { env: { ...env, ...composeValidationEnvironment(git.revision) } },
          )
      : skip(composeName, 'docker compose is not installed; the deploy runbook validates it on the VM'),
  );
  if (withDocker) {
    // A dedicated project name keeps `down -v` away from a developer's own local volume.
    const project = ['compose', '-p', 'catanova-ci'];
    const dockerReady = hasCompose && available('docker', ['info']);
    const why = hasCompose ? 'the Docker daemon is not running' : 'docker compose is not installed';
    let started = false;
    add('Container builds and becomes healthy', () => {
      if (!dockerReady) return skip('Container builds and becomes healthy', why)();
      started = true;
      return runCommand(
        'Container builds and becomes healthy',
        'docker',
        [...project, 'up', '--build', '--wait', '--wait-timeout', '300'],
        { env },
      );
    });
    add('Connectivity probe against the container', () => {
      const up = results.find((result) => result.name === 'Container builds and becomes healthy');
      if (up?.status !== 'PASS')
        return skip(
          'Connectivity probe against the container',
          dockerReady ? 'the container did not start' : why,
        )();
      return runCommand('Connectivity probe against the container', 'npm', ['run', 'probe'], { env });
    });
    add('Remove the test container and its volume', () => {
      if (!started) return skip('Remove the test container and its volume', 'nothing was started')();
      return runCommand('Remove the test container and its volume', 'docker', [...project, 'down', '-v'], {
        env,
      });
    });
  }

  const onInterrupt = () => {
    interrupted = true;
  };
  process.on('SIGINT', onInterrupt);
  const began = performance.now();
  for (const [index, step] of steps.entries()) {
    const cleanup = step.name === 'Remove the test container and its volume';
    if (interrupted && !cleanup) {
      results.push({ name: step.name, status: 'SKIP', seconds: 0, detail: 'interrupted' });
      continue;
    }
    console.log(`\n==> [${index + 1}/${steps.length}] ${step.name}`);
    const result = await step.run();
    if (result.status === 'SKIP') console.log(`  skipped: ${result.detail}`);
    results.push(result);
  }
  process.off('SIGINT', onInterrupt);

  const failed = results.filter((result) => result.status === 'FAIL');
  const skipped = results.filter((result) => result.status === 'SKIP');
  console.log('\nLocal CI summary');
  for (const result of results)
    console.log(
      `  ${result.status}  ${(result.status === 'SKIP' ? '' : format(result.seconds)).padStart(7)}  ${result.name}${
        result.detail ? ` — ${result.detail}` : ''
      }`,
    );
  console.log(
    `${git.label}; Node ${process.version} (production images use Node 24; the workflow also tested 26); ${format(
      (performance.now() - began) / 1000,
    )} total`,
  );
  if (!withDocker)
    console.log('The container start and probe did not run; add -- --docker on a machine with Docker.');
  console.log(
    `RESULT: ${failed.length ? 'FAIL' : 'PASS'} (${results.length - failed.length - skipped.length} passed, ${
      failed.length
    } failed, ${skipped.length} skipped)`,
  );
  if (interrupted) return 130;
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
