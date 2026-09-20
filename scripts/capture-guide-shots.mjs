/**
 * Photograph the real game for the guide.
 *
 * The pictures on the player guide should be the game, not an impression of
 * it. This drives a real browser against a real server: it creates a room,
 * sits three bots down, plays far enough in that the island has roads,
 * settlements and cities on it, hides the chrome that means nothing to a
 * reader, and saves PNG masters into assets/source-art.
 *
 * It is deliberately a maintainer tool, like scripts/optimize-art.mjs, and is
 * never part of a build. Run a server first, then:
 *
 *   PUPPETEER_MODULE=/abs/path/to/puppeteer node scripts/capture-guide-shots.mjs --url http://127.0.0.1:3100
 *
 * Nothing here reads game state through a back door. It clicks what a player
 * clicks, so a shot can only show a position the rules allow.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};
const origin = arg('url', 'http://127.0.0.1:3100');
const outDir = resolve(arg('out', 'assets/source-art'));
const puppeteer = await import(
  process.env.PUPPETEER_MODULE ? pathToFileURL(resolve(process.env.PUPPETEER_MODULE)).href : 'puppeteer'
).then((m) => m.default ?? m);

/** Chrome a reader does not need: the tool rail, the menus, and the turn banner. */
const HIDE_LABELS = [
  'Fullscreen',
  'Move history',
  'Game menu',
  'Connection',
  'Dice statistics',
  'How to play',
  'Settings',
  'Leave game',
];

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
page.on('pageerror', (error) => console.error('page error:', error.message));

const idle = (ms) => new Promise((done) => setTimeout(done, ms));

await page.goto(origin, { waitUntil: 'networkidle2' });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.goto(origin, { waitUntil: 'networkidle2' });

/** Click by accessible name, the way a player would find the control. */
async function press(pattern, { optional = false } = {}) {
  const found = await page.evaluate((source) => {
    const re = new RegExp(source);
    const button = [...document.querySelectorAll('button')].find(
      (node) => !node.disabled && re.test((node.getAttribute('aria-label') || node.textContent || '').trim()),
    );
    if (button) button.click();
    return Boolean(button);
  }, pattern.source);
  if (!found && !optional) throw new Error(`No control matching ${pattern}`);
  await idle(found ? 500 : 0);
  return found;
}

console.info('Creating a room…');
await press(/^Create room/);
await idle(700);
// A cleared session has no name yet, and the form will not submit without one.
// Typed rather than assigned, so React sees it exactly as it sees a player.
const field = await page.waitForSelector('input:not([type=hidden])', { timeout: 15_000 });
await field.click({ clickCount: 3 });
await page.keyboard.type('Rowan', { delay: 25 });
await idle(400);
await press(/^Create room/);
await page.waitForFunction(() => /Lobby/i.test(document.title), { timeout: 30_000 }).catch(async () => {
  await page.screenshot({ path: '/tmp/capture-stuck.png' });
  throw new Error(`Never reached the lobby; last title was "${await page.title()}". See /tmp/capture-stuck.png`);
});
for (let seat = 0; seat < 3; seat += 1) {
  await press(/Add a bot/);
  await idle(500);
}
await press(/^Start game/);
await page.waitForFunction(() => !/Lobby/i.test(document.title), { timeout: 30_000 });

console.info('Playing far enough in to be worth a picture…');
await page.evaluate(() => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const named = (re) =>
    [...document.querySelectorAll('button')].find(
      (node) => !node.disabled && re.test((node.getAttribute('aria-label') || node.textContent || '').trim()),
    );
  const spot = (re) =>
    [...document.querySelectorAll('[aria-label]')].find((node) => re.test(node.getAttribute('aria-label')));
  const tap = (node) => {
    const box = node.getBoundingClientRect();
    const shared = {
      bubbles: true,
      cancelable: true,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      isPrimary: true,
      detail: 1,
    };
    node.dispatchEvent(new PointerEvent('pointerdown', { ...shared, buttons: 1 }));
    node.dispatchEvent(new PointerEvent('pointerup', shared));
    node.dispatchEvent(new MouseEvent('click', shared));
  };
  // One loop that only ever takes actions the interface is offering.
  window.__play = async (steps) => {
    for (let step = 0; step < steps; step += 1) {
      const move =
        named(/^Add \w+ to discard/) ||
        named(/^Discard \d/) ||
        named(/^Confirm /) ||
        named(/Steal 1 card/) ||
        named(/^Move here/) ||
        named(/^Roll/) ||
        spot(/Move robber here/) ||
        // Cities before settlements before roads: a board with cities on it
        // shows more of the game than one that has only just opened.
        spot(/^Build city /) ||
        spot(/^Build settlement /) ||
        spot(/^Build road /) ||
        named(/^Next turn/);
      if (!move) {
        await wait(700);
        continue;
      }
      tap(move);
      await wait(/^Roll/.test(move.getAttribute?.('aria-label') ?? '') ? 1100 : 400);
    }
  };
});
for (let round = 0; round < 22; round += 1) {
  await page.evaluate(() => window.__play(18));
  const board = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('g[aria-label]')]
      .map((node) => node.getAttribute('aria-label'))
      .filter((label) => /·/.test(label));
    return { pieces: labels.length, cities: labels.filter((label) => /city/i.test(label)).length };
  });
  console.info(`  ${board.pieces} pieces, ${board.cities} cities`);
  if (board.pieces >= 28 && board.cities >= 1) break;
}

// A picture of a game should not be a picture of a dialog. Settle into a
// position where nothing is waiting on the player and nothing is open.
console.info('Settling…');
await page.evaluate(async () => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const named = (re) =>
    [...document.querySelectorAll('button')].find(
      (node) => !node.disabled && re.test((node.getAttribute('aria-label') || node.textContent || '').trim()),
    );
  for (let step = 0; step < 60; step += 1) {
    const open = document.querySelector('[role="dialog"], .game-dialog');
    if (!open && !named(/^Next turn/) && !named(/^Roll/)) return;
    const move = named(/^Move here/) || named(/Steal 1 card/) || named(/^Confirm /) || named(/^Next turn/);
    if (move) move.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(450);
  }
});
await idle(1200);

console.info('Tidying the frame…');
await page.evaluate((labels) => {
  for (const label of labels)
    for (const node of document.querySelectorAll(`[aria-label="${label}"]`))
      (node.closest('button') ?? node).style.setProperty('display', 'none', 'important');
  // The prompt banner and the toolbar edges name a moment, not the game.
  const style = document.createElement('style');
  style.textContent = `
    /* Anything narrating this exact moment: whose turn it is, who is stealing
       from whom. A picture of a game should not be a picture of a caption. */
    [role='status'], [role='dialog'], .action-prompt, .side-controls, .reaction-tray {
      display: none !important;
    }
    .board-viewport { cursor: default !important; }
    .board-viewport:focus-visible, .board-viewport:focus { outline: none !important; }
    *, *::before, *::after { animation-play-state: paused !important; transition: none !important; }
  `;
  document.head.append(style);
}, HIDE_LABELS);
await idle(700);

// Fill the frame. The camera opens fitted to the window, which leaves a lot of
// bare table around the island on a wide screen; a picture wants the island.
await page.focus('.board-viewport');
for (let step = 0; step < 7; step += 1) {
  await page.keyboard.press('Equal');
  await idle(90);
}
// Give the focus ring back before the shutter: it belongs to a keyboard user
// in the middle of a game, not to a picture of one.
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await idle(800);

await mkdir(outDir, { recursive: true });
const shots = [
  { name: 'guide-game', clip: null },
  { name: 'guide-players', selector: '.player-rail' },
];
for (const shot of shots) {
  const target = shot.selector ? await page.$(shot.selector) : page;
  if (!target) throw new Error(`Nothing matched ${shot.selector}`);
  const buffer = await target.screenshot({ type: 'png', captureBeyondViewport: false });
  await writeFile(resolve(outDir, `${shot.name}.png`), buffer);
  console.info(`Wrote ${shot.name}.png (${Math.round(buffer.length / 1024)}KB)`);
}
await browser.close();
