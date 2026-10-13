import { test, expect, type Page } from '@playwright/test';
import type { GameSnapshot, JoinSession, PlayerInput } from '../../packages/game-shared/src/turned/protocol';

// Observe the actual wire protocol; browser tests never inject position/inventory or bypass actions.
function watchGame(page: Page) {
  let snapshot: GameSnapshot | undefined;
  let input: PlayerInput | undefined;
  let playerId = '';
  let welcomes = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === 'welcome') { playerId = message.playerId; welcomes++; }
        if (message.snapshot) snapshot = message.snapshot;
      } catch { /* Other app transports are not the game protocol. */ }
    });
    socket.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === 'input') input = message.input;
      } catch { /* Other app transports are not the game protocol. */ }
    });
  });
  return { snapshot: () => snapshot, input: () => input, welcomes: () => welcomes,
    player: () => snapshot?.players.find(player => player.id === playerId), errors };
}

test('two friends can host, join, move, shoot, reload, craft, drive and reconnect', async ({ browser }, testInfo) => {
  // Two WebGL views plus a full renderer rebuild on refresh can be slow in software-rendered CI.
  test.setTimeout(180_000);
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const friendContext = await browser.newContext({ viewport: { width: 960, height: 720 } });
  const host = await hostContext.newPage(), friend = await friendContext.newPage();
  const a = watchGame(host), b = watchGame(friend);
  try {
    await host.bringToFront();
    await host.goto('/');
    await expect(host.getByRole('button', { name: 'Enter the island', exact: true })).toBeEnabled();
    await host.screenshot({ path: testInfo.outputPath('turned-home.png') });
    await host.getByRole('tab', { name: 'Host friends' }).click();
    await host.getByLabel('Your callsign').fill('Ranger');
    await host.getByLabel('Expedition name', { exact: true }).fill('Browser test expedition');
    const response = host.waitForResponse(r => r.url().endsWith('/turned-api/rooms') && r.request().method() === 'POST');
    await host.getByRole('button', { name: 'Create expedition' }).click();
    const session: JoinSession = await (await response).json();
    await expect(host.getByRole('button', { name: 'Start expedition' })).toBeVisible();
    await friend.bringToFront();
    await friend.goto(`/?join=${session.code}`);
    await expect(friend.getByRole('tab', { name: 'Join a friend' })).toHaveAttribute('aria-selected', 'true');
    await expect(friend.getByRole('button', { name: 'Join expedition', exact: true })).toBeEnabled();
    await friend.getByLabel('Your callsign').fill('Scout');
    await friend.getByRole('button', { name: 'Join expedition', exact: true }).click();
    await expect(host.locator('.turned-roster')).toContainText('Scout');
    await expect(friend.locator('.turned-waiting')).toBeVisible();
    await host.bringToFront();
    await host.getByRole('button', { name: 'Start expedition' }).click();
    await expect.poll(() => a.snapshot()?.phase).toBe('playing');
    await expect.poll(() => b.snapshot()?.phase).toBe('playing');
    const enter = host.getByRole('button', { name: 'Enter the island', exact: true });
    await enter.click();
    // Pointer capture is asynchronous. A key pressed before it completes is intentionally ignored.
    await expect(enter).toBeHidden();
    const initialZ = a.player()!.z;
    await host.keyboard.down('w');
    await expect.poll(() => a.input()?.moveZ).toBe(1);
    await expect.poll(() => a.player()?.z).toBeLessThan(initialZ - 1.5);
    await host.keyboard.up('w');
    await expect.poll(() => b.snapshot()?.players.find(p => p.name === 'Ranger')?.z).toBeLessThan(initialZ - 1.5);

    await host.keyboard.press('3');
    await expect.poll(() => a.player()?.weapon).toBe('rifle');
    await host.mouse.down();
    await expect.poll(() => a.player()?.ammo.rifle).toBeLessThan(30);
    await host.mouse.up();
    await host.keyboard.press('r');
    await expect.poll(() => a.player()?.reloading).toBeGreaterThan(0);
    await expect.poll(() => a.player()?.ammo.rifle).toBe(30);

    await host.keyboard.press('c');
    const crafting = host.getByRole('dialog', { name: 'Inventory and crafting' });
    await expect(crafting).toBeVisible();
    const still = { x: a.player()!.x, z: a.player()!.z };
    await host.keyboard.down('w');
    await host.waitForTimeout(400);
    await host.keyboard.up('w');
    expect(a.player()!.x).toBeCloseTo(still.x, 2);
    expect(a.player()!.z).toBeCloseTo(still.z, 2);
    await crafting.locator('.turned-recipe').filter({ has: host.getByRole('heading', { name: 'Campfire', exact: true }) }).getByRole('button').click();
    await expect.poll(() => a.snapshot()?.buildings.some(building => building.kind === 'campfire')).toBe(true);
    await expect.poll(() => b.snapshot()?.buildings.some(building => building.kind === 'campfire')).toBe(true);
    expect(a.player()!.resources.wood).toBe(2);
    expect(a.player()!.resources.stone).toBe(0);
    await expect(crafting).toBeHidden();
    await expect(enter).toBeHidden();
    await host.screenshot({ path: testInfo.outputPath('turned-game.png') });

    // At the initial north-facing camp, walk to the nearby jeep using ordinary controls.
    await host.keyboard.down('d');
    await expect.poll(() => a.player()?.x).toBeGreaterThan(6);
    await host.keyboard.up('d');
    await host.keyboard.down('w');
    await expect.poll(() => a.player()?.z).toBeLessThan(84);
    await host.keyboard.up('w');
    await host.keyboard.press('e');
    await expect.poll(() => a.player()?.vehicleId).toBe('camp-jeep');
    const carZ = a.snapshot()!.vehicles.find(v => v.id === 'camp-jeep')!.z;
    await host.keyboard.down('s');
    await expect.poll(() => a.snapshot()?.vehicles.find(v => v.id === 'camp-jeep')?.z).toBeGreaterThan(carZ + 1);
    await host.keyboard.up('s');
    await host.keyboard.down('Space');
    await expect.poll(() => Math.abs(a.snapshot()!.vehicles.find(v => v.id === 'camp-jeep')!.speed)).toBeLessThan(.1);
    await host.keyboard.up('Space');
    await host.keyboard.press('e');
    await expect.poll(() => a.player()?.vehicleId).toBe(null);

    const oldId = b.player()!.id;
    const oldWelcomes = b.welcomes();
    await host.keyboard.press('Escape');
    await friend.bringToFront();
    await friend.reload();
    await expect.poll(() => b.welcomes()).toBeGreaterThan(oldWelcomes);
    await expect.poll(() => b.player()?.connected).toBe(true);
    await expect.poll(() => b.player()?.id).toBe(oldId);
    await expect.poll(() => b.snapshot()?.phase).toBe('playing');
    await expect(friend.locator('.turned-hud')).toBeVisible();
    const hostTick = a.snapshot()!.tick;
    await expect.poll(() => a.snapshot()?.tick).toBeGreaterThan(hostTick);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } catch (error) {
    await testInfo.attach('friend-state', { contentType: 'application/json', body: JSON.stringify({
      phase: b.snapshot()?.phase, connected: b.player()?.connected, welcomes: b.welcomes(), errors: b.errors,
      pageText: await friend.locator('body').innerText({ timeout: 5000 }).catch(() => 'Browser did not respond.'),
    }, null, 2) });
    throw error;
  } finally {
    await hostContext.close();
    await friendContext.close();
  }
});

test('settings persist, narrow menus fit, and invalid invitations show a useful error', async ({ page }) => {
  const game = watchGame(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?join=ZZZZZZ');
  await expect(page.getByRole('button', { name: 'Join expedition', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Join expedition', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Lobby not found');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('checkbox').uncheck();
  await settings.getByLabel('Game audio volume').fill('0');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Join expedition', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByLabel('Game audio volume')).toHaveValue('0');
  expect(game.errors).toEqual([]);
});
