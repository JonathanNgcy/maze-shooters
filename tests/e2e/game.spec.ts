import { test, expect, type Page } from '@playwright/test';
import type { MatchState } from '../../src/shared/types';

interface Hook {
  state(): MatchState;
  paused(): boolean;
  advance(ticks: number): void;
  manual(value: boolean): void;
  diagnostics(): { droppedFrames: number; canvasCount: number };
}
type TestWindow = Window & { __MAZE_TEST__: Hook; __listenerCount?: () => number };
const state = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.state());
const advance = (page: Page, ticks = 1) => page.evaluate((n) => (window as unknown as TestWindow).__MAZE_TEST__.advance(n), ticks);
const paint = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function open(page: Page, fixture = '') {
  await page.goto(`/?test=1&manual=1${fixture ? `&fixture=${fixture}` : ''}`);
  await page.waitForFunction(() => Boolean((window as unknown as TestWindow).__MAZE_TEST__));
  await expect(page.getByRole('button', { name: /^Ready/ })).toBeVisible();
  await expect(page.locator('.error-screen')).toBeHidden();
}
async function ready(page: Page) {
  await page.getByRole('button', { name: /^Ready/ }).click();
  await advance(page);
  await expect(page.locator('.hud')).toHaveAttribute('data-phase', 'ready');
}
async function fire(page: Page) {
  await page.keyboard.press('Space');
  await advance(page);
  expect((await state(page)).projectile?.ageTicks).toBe(0);
}
async function resolveFlight(page: Page) {
  return page.evaluate(() => {
    const hook = (window as unknown as TestWindow).__MAZE_TEST__;
    for (let i = 0; i < 2160 && hook.state().phase === 'flight'; i++) hook.advance(1);
    return hook.state();
  });
}

test('B01/B02: opaque cold start and fixed ready view under actual mouse/WASD input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(page.getByRole('heading', { name: "Player 1, you're up." })).toBeVisible();
  const curtain = await page.locator('.handoff-screen').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(curtain).toBe('rgb(16, 33, 40)');
  expect(await page.locator('canvas').count()).toBe(1);
  await ready(page);
  await paint(page);
  await page.screenshot({path:'artifacts/ready.png'});
  const before = await page.locator('canvas').screenshot();
  await page.keyboard.down('w'); await page.keyboard.down('a');
  await page.mouse.move(1000, 300); await advance(page, 240);
  await page.keyboard.up('w'); await page.keyboard.up('a');
  await paint(page);
  expect(await page.locator('canvas').screenshot()).toEqual(before);
  expect((await state(page)).phase).toBe('ready');
  await expect(page.getByText('Hit yourself and you lose.', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Fire/ }).click();
  await advance(page);
  const launched = await state(page);
  expect(launched.projectile?.ageTicks).toBe(0);
  expect(launched.projectile?.position.x).toBeCloseTo(-6.85, 10);
  await expect(page.locator('.time-value')).toHaveText('18.0s');
  await paint(page);
  expect(await page.locator('canvas').screenshot()).not.toEqual(before);
  await page.screenshot({path:'artifacts/flight.png'});
  expect(errors).toEqual([]);
});

test('B02/B03/B09: launch clears pre-held keys, fresh keys thrust/yaw, release preserves drift', async ({ page }) => {
  await open(page, 'arena'); await ready(page);
  await page.keyboard.down('w'); await page.keyboard.down('d');
  await fire(page); await advance(page, 30);
  const coast = (await state(page)).projectile!;
  expect(coast.heading).toBeCloseTo(Math.PI / 2, 10);
  expect(Math.hypot(coast.velocity.x, coast.velocity.z)).toBeLessThan(5);
  // Repeated physical keydown cannot re-arm a key cleared at launch.
  await page.keyboard.down('w'); await page.keyboard.down('d');
  await advance(page, 10);
  expect((await state(page)).projectile!.heading).toBeCloseTo(Math.PI / 2, 10);
  await page.keyboard.up('w'); await page.keyboard.up('d');
  await page.keyboard.down('w'); await advance(page, 30); await page.keyboard.up('w');
  const thrust = (await state(page)).projectile!;
  expect(thrust.velocity.x).toBeGreaterThan(coast.velocity.x);
  await page.keyboard.down('d'); await advance(page, 30); await page.keyboard.up('d');
  const turned = (await state(page)).projectile!;
  expect(turned.heading).toBeGreaterThan(thrust.heading + .1);
  expect(Math.atan2(turned.velocity.x, -turned.velocity.z)).toBeCloseTo(Math.PI / 2, 10);
  expect(turned.position.x).toBeGreaterThan(thrust.position.x);
  await advance(page, 20);
  const released = (await state(page)).projectile!;
  expect(released.heading).toBeGreaterThan(turned.heading);
  expect(released.angularVelocity).toBeLessThan(turned.angularVelocity);
  await page.keyboard.down('s'); await advance(page, 10); await page.keyboard.up('s');
  expect((await state(page)).projectile!.velocity.z).toBeLessThan(0);
});

test('B04: actual wall miss freezes for ninety ticks then opaque untimed Player 2 handoff', async ({ page }) => {
  await open(page); await ready(page); await fire(page);
  const impact = await resolveFlight(page);
  expect(impact.phase).toBe('resolve'); expect(impact.result?.reason).toBe('wall');
  expect(impact.resolveTicksRemaining).toBe(90); expect(impact.projectile).toBeNull();
  await expect(page.getByText('Wall hit. Player 2 is next.', { exact: true }).first()).toBeVisible();
  await paint(page); const frozen = await page.locator('canvas').screenshot();
  await page.keyboard.down('w'); await page.keyboard.down('d'); await advance(page, 89);
  expect((await state(page)).phase).toBe('resolve');
  await paint(page); expect(await page.locator('canvas').screenshot()).toEqual(frozen);
  await advance(page); await page.keyboard.up('w'); await page.keyboard.up('d');
  expect((await state(page)).turnId).toBe(2);
  await expect(page.getByRole('heading', { name: "Player 2, you're up." })).toBeVisible();
  await advance(page, 500); expect((await state(page)).phase).toBe('handoff');
});

test('B04/B11: safe arena expires on step 2160 and the live timer never shows zero', async ({ page }) => {
  await open(page, 'arena'); await ready(page); await fire(page);
  await advance(page, 2159);
  expect((await state(page)).projectile?.ageTicks).toBe(2159);
  await expect(page.locator('.time-value')).toHaveText('0.1s');
  await advance(page);
  expect((await state(page)).result?.reason).toBe('timeout');
  await expect(page.getByText('Time up. Player 2 is next.', { exact: true }).first()).toBeVisible();
  await advance(page, 90); expect((await state(page)).phase).toBe('handoff');
});

test('B05/B06: real hit and ten rematches retain one canvas and one listener set', async ({ page }) => {
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const entries: { target: EventTarget; type: string; listener: unknown; capture: boolean }[] = [];
    const relevant = (target: EventTarget, type: string) => (target === window || target === document) && ['keydown', 'keyup', 'blur', 'visibilitychange', 'resize'].includes(type);
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      if (relevant(this, type) && !entries.some(e => e.target === this && e.type === type && e.listener === listener && e.capture === capture)) entries.push({ target: this, type, listener, capture });
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const index = entries.findIndex(e => e.target === this && e.type === type && e.listener === listener && e.capture === capture);
      if (index >= 0) entries.splice(index, 1);
      return remove.call(this, type, listener, options);
    };
    (window as unknown as TestWindow).__listenerCount = () => entries.length;
  });
  await open(page, 'duel');
  const canvas = await page.locator('canvas').elementHandle();
  const listeners = await page.evaluate(() => (window as unknown as TestWindow).__listenerCount!());
  for (let match = 1; match <= 10; match++) {
    const before = await state(page);
    expect(before.matchNumber).toBe(match); expect(before.activePlayer).toBe(match % 2 ? 'p1' : 'p2');
    await ready(page); await fire(page);
    const resolved = await resolveFlight(page);
    expect(resolved.result?.reason).toBe('hit');
    expect(resolved.winner).toBe(before.activePlayer);
    expect(resolved.result?.victim).toBe(before.activePlayer === 'p1' ? 'p2' : 'p1');
    await page.keyboard.press('Space'); await advance(page, 90);
    expect((await state(page)).phase).toBe('gameOver');
    await expect(page.getByRole('button', { name: /^Rematch/ })).toBeVisible();
    await page.getByRole('button', { name: /^Rematch/ }).click();
    const next = await state(page);
    expect(next.phase).toBe('handoff'); expect(next.tick).toBe(0); expect(next.nextShotId).toBe(1);
    expect(next.projectile).toBeNull(); expect(next.result).toBeNull(); expect(next.matchId).not.toBe(before.matchId);
    expect(await page.locator('canvas').count()).toBe(1);
    expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as TestWindow).__listenerCount!())).toBe(listeners);
  }
});

test('B05: sustained reverse thrust returns to shooter, announces self-hit and preserves winner', async ({ page }) => {
  await open(page, 'arena'); await ready(page); await fire(page);
  await page.keyboard.down('s');
  const resolved = await resolveFlight(page);
  await page.keyboard.up('s');
  expect(resolved.result?.reason).toBe('hit'); expect(resolved.result?.victim).toBe('p1'); expect(resolved.winner).toBe('p2');
  await expect(page.getByText('Player 1 hit themselves. Player 2 wins.', { exact: true }).first()).toBeVisible();
  await advance(page, 90);
  await expect(page.locator('.winner-title')).toHaveText('Player 2 wins.');
  await expect(page.locator('.winner-detail')).toHaveText('Player 1 hit themselves. Player 2 wins.');
  await page.screenshot({path:'artifacts/result.png'});
});

test('B07/B08: blur event pauses held controls until explicit resume and fresh keydown', async ({ page }) => {
  await open(page, 'arena'); await ready(page); await fire(page);
  await page.keyboard.down('w'); await page.keyboard.down('d'); await advance(page, 30);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const frozen = await state(page);
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await expect(page.locator('.pause-reason')).toContainText('window lost focus');
  await advance(page, 240); expect(await state(page)).toEqual(frozen);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.paused())).toBe(true);
  await page.getByRole('button', { name: /^Resume/ }).click();
  await page.keyboard.down('w'); await page.keyboard.down('d'); await advance(page, 20);
  const coast = (await state(page)).projectile!;
  expect(Math.hypot(coast.velocity.x, coast.velocity.z)).toBeLessThan(Math.hypot(frozen.projectile!.velocity.x, frozen.projectile!.velocity.z));
  expect(coast.angularVelocity).toBeLessThan(frozen.projectile!.angularVelocity);
  await page.keyboard.up('w'); await page.keyboard.up('d'); await page.keyboard.down('w');
  await advance(page, 20); await page.keyboard.up('w');
  expect(Math.hypot((await state(page)).projectile!.velocity.x, (await state(page)).projectile!.velocity.z)).toBeGreaterThan(Math.hypot(coast.velocity.x, coast.velocity.z));
});

test('B08: Escape freezes every live phase and resumes only on a fresh edge', async ({ page }) => {
  await open(page);
  for (const phase of ['handoff', 'ready', 'flight', 'resolve']) {
    expect((await state(page)).phase).toBe(phase);
    await page.keyboard.down('Escape');
    const frozen = await state(page);
    await advance(page, 120); expect(await state(page)).toEqual(frozen);
    await page.keyboard.down('Escape');
    expect(await page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.paused())).toBe(true);
    await page.keyboard.up('Escape'); await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.paused())).toBe(false);
    if (phase === 'handoff') await ready(page);
    else if (phase === 'ready') await fire(page);
    else if (phase === 'flight') await resolveFlight(page);
  }
});

test('B09: focused button activation is native and singular; held actions never cross phases', async ({ page }) => {
  await open(page, 'arena');
  const readyButton = page.getByRole('button', { name: /^Ready/ });
  await readyButton.focus(); await page.keyboard.down('Enter'); await advance(page);
  expect((await state(page)).phase).toBe('ready');
  await page.keyboard.down('Enter'); await page.keyboard.down('Space'); await advance(page);
  // Fresh Space is allowed in ready, but the held Enter never fires by itself.
  expect((await state(page)).phase).toBe('flight'); expect((await state(page)).nextShotId).toBe(2);
  await page.keyboard.down('Space'); await advance(page, 10);
  expect((await state(page)).nextShotId).toBe(2);
  await page.keyboard.up('Enter'); await page.keyboard.up('Space');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
  // Editable controls do not become steering surfaces.
  await page.evaluate(() => { const input = document.createElement('input'); input.setAttribute('aria-label', 'test editor'); document.querySelector('#app')!.append(input); input.focus(); });
  const old = (await state(page)).projectile!;
  await page.keyboard.down('w'); await page.keyboard.down('d'); await advance(page, 20);
  await page.keyboard.up('w'); await page.keyboard.up('d');
  const next = (await state(page)).projectile!;
  expect(next.heading).toBeCloseTo(old.heading, 10);
  expect(Math.hypot(next.velocity.x, next.velocity.z)).toBeLessThan(Math.hypot(old.velocity.x, old.velocity.z));
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`B11: HUD fits ${viewport.width}x${viewport.height} and resizing preserves the shot`, async ({ page }) => {
    await page.setViewportSize(viewport); await open(page, 'arena'); await ready(page); await fire(page); await advance(page, 20);
    const before = await state(page);
    await page.setViewportSize(viewport.width === 1280 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 });
    await paint(page);
    expect(await state(page)).toEqual(before);
    for (const selector of ['.topbar', '.telemetry', '.pilot-strip', '.control-bar']) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      const size = page.viewportSize()!;
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    }
  });
}

test('B12: production preview runs local inputs and excludes test mutation globals and fixtures', async ({ page }) => {
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url()); });
  await page.goto('http://127.0.0.1:4173/?test=1&manual=1&fixture=duel');
  await page.getByRole('button', { name: /^Ready/ }).click();
  await expect(page.getByRole('button', { name: /^Fire/ })).toBeVisible();
  expect(await page.evaluate(() => '__MAZE_TEST__' in window)).toBe(false);
  await page.keyboard.press('Space');
  await expect(page.locator('.hud')).toHaveAttribute('data-phase', 'flight');
  await page.keyboard.down('w'); await page.keyboard.down('d');
  await expect(page.locator('.speed-value')).not.toHaveText('5.0m/s');
  await page.keyboard.up('w'); await page.keyboard.up('d');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('B13: reduced motion removes decorative transitions; context loss stops flight with recovery copy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'arena'); await ready(page); await fire(page);
  expect(await page.locator('.primary').first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.keyboard.down('w'); await advance(page, 10);
  await page.locator('canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  const frozen = await state(page);
  await expect(page.getByText('The graphics context was lost. Reload the game to restore the maze.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Reload game/ })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.paused())).toBe(true);
  await advance(page, 120); expect(await state(page)).toEqual(frozen);
  await page.keyboard.up('w');
});

test('B13: unsupported WebGL produces a useful startup error', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === 'webgl2') return null;
      return getContext.apply(this, [type, ...args] as Parameters<typeof getContext>);
    } as typeof getContext;
  });
  await page.goto('/');
  await expect(page.getByText('WebGL 2 is unavailable. Use a desktop browser with hardware graphics enabled, then reload.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Reload game/ })).toBeVisible();
});

test('B10: actual camera wall sweep shortens the arm and uses safe nose view near corners', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/client/cameras.ts';
    const { createCameras } = await import(modulePath);
    const camera = createCameras({ mapId: 'camera-check', mapVersion: 1, walls: [{ id: 'wall:0:0', minX: 0, maxX: 2, minZ: 0, maxZ: 2 }], spawns: [] });
    const sample = { shotId: 1, owner: 'p1', position: { x: -.6, z: 1 }, velocity: { x: -3, z: 0 }, heading: -Math.PI / 2, angularVelocity: 0, ageTicks: 1 };
    const saved = JSON.stringify(sample);
    camera.flight(sample);
    const clamped = { position: camera.camera.position.toArray(), fallback: camera.noseView };
    camera.flight({ ...sample, position: { x: -.13, z: 1 } });
    return { clamped, nose: { position: camera.camera.position.toArray(), fallback: camera.noseView }, unchanged: JSON.stringify(sample) === saved };
  });
  expect(result.clamped.fallback).toBe(false);
  expect(result.clamped.position[0]).toBeLessThan(-.08);
  expect(result.clamped.position[0]).toBeGreaterThan(-.2);
  expect(result.nose.fallback).toBe(true);
  expect(result.nose.position[0]).toBeCloseTo(-.13, 10);
  expect(result.nose.position[1]).toBeCloseTo(1.1, 10);
  expect(result.unchanged).toBe(true);
});

test('B02/B09: surface Enter acknowledges once and native focused Fire Space launches once', async ({ page }) => {
  await open(page, 'arena');
  await page.locator('#app').focus();
  await page.keyboard.down('Enter'); await advance(page);
  expect((await state(page)).phase).toBe('ready');
  await page.keyboard.down('Enter'); await advance(page);
  expect((await state(page)).phase).toBe('ready');
  await page.keyboard.up('Enter');
  await page.getByRole('button', { name: /^Fire/ }).focus();
  await page.keyboard.press('Space'); await advance(page);
  expect((await state(page)).phase).toBe('flight');
  expect((await state(page)).projectile?.ageTicks).toBe(0);
  expect((await state(page)).nextShotId).toBe(2);
});

test('B07: a real foreground-tab change freezes the shot until explicit resume', async ({ page, context }) => {
  await open(page, 'arena'); await ready(page); await fire(page);
  await page.keyboard.down('w'); await page.keyboard.down('d'); await advance(page, 30);
  const other = await context.newPage();
  await other.goto('about:blank'); await other.bringToFront();
  const nativeState = await page.evaluate(() => ({ hidden: document.hidden, focused: document.hasFocus() }));
  test.skip(!nativeState.hidden && nativeState.focused, 'This Chromium environment keeps every tab visible and focused; native tab visibility requires the recorded manual browser check.');
  await expect.poll(() => page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.paused())).toBe(true);
  const frozen = await state(page);
  await advance(page, 240); expect(await state(page)).toEqual(frozen);
  await page.bringToFront();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__MAZE_TEST__.paused())).toBe(true);
  await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible();
  await page.keyboard.up('w'); await page.keyboard.up('d');
  await page.getByRole('button', { name: /^Resume/ }).click();
  await advance(page, 30);
  const resumed = (await state(page)).projectile!;
  expect(Math.hypot(resumed.velocity.x, resumed.velocity.z)).toBeLessThan(Math.hypot(frozen.projectile!.velocity.x, frozen.projectile!.velocity.z));
  expect(resumed.angularVelocity).toBeLessThan(frozen.projectile!.angularVelocity);
  await other.close();
});
