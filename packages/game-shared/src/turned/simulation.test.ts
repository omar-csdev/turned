import { describe, expect, it } from 'vitest';
import { GameSimulation } from './simulation';
import { EMPTY_INPUT, WEAPONS } from './protocol';
import type { PlayerInput, PlayerState } from './protocol';
import { ISLAND_BUILDINGS, RADIO, RESOURCE_NODES, SPAWN, isBlocked } from './island';

function setup() {
  const game = new GameSimulation();
  const player = game.addPlayer('alice', 'Alice', '#abcdef');
  game.start();
  let sequence = 0;
  const input = (changes: Partial<PlayerInput> = {}) => game.setInput(player.id, { ...EMPTY_INPUT, seq: ++sequence, yaw: player.yaw, pitch: player.pitch, ...changes });
  const advance = (seconds: number, changes?: Partial<PlayerInput>) => {
    for (let elapsed = 0; elapsed < seconds - .001; elapsed += .05) { if (changes) input(changes); game.step(.05); }
  };
  return { game, player, input, advance };
}

function aimAt(player: PlayerState, target: { x: number; z: number }, height = 1.62) {
  const dx = target.x - player.x, dz = target.z - player.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.atan2(height - 1.62 - player.y, Math.hypot(dx, dz));
}

describe('Turned cooperative simulation', () => {
  it('starts in a lobby and gives independent inventories to up to eight survivors', () => {
    const game = new GameSimulation();
    const a = game.addPlayer('a', '  Alice  ', '#fff');
    const b = game.addPlayer('b', 'Bob', '#000');
    a.resources.wood--;
    expect(b.resources.wood).toBe(8);
    expect(a.name).toBe('Alice');
    expect(game.phase).toBe('lobby');
    game.setInput('a', { ...EMPTY_INPUT, seq: 1, moveZ: 1 });
    const before = a.z;
    game.step(.1);
    expect(a.z).toBe(before);
    for (let i = 2; i < 8; i++) game.addPlayer(`${i}`, 'Friend', '#fff');
    expect(() => game.addPlayer('extra', 'Extra', '#fff')).toThrow(/full/);
    game.start();
    expect(game.phase).toBe('playing');
  });

  it('normalizes diagonal movement and clamps hostile inputs and elapsed time', () => {
    const { game, player } = setup();
    player.x = 0; player.z = 60;
    game.setInput(player.id, { ...EMPTY_INPUT, seq: 1, moveX: 1000, moveZ: 1000, pitch: 100 });
    game.step(1000);
    expect(Math.hypot(player.x, player.z - 60)).toBeCloseTo(.44, 5);
    expect(player.pitch).toBe(1.45);
    const position = { x: player.x, z: player.z };
    game.setInput(player.id, { ...EMPTY_INPUT, seq: 2, moveX: NaN });
    game.setInput(player.id, { ...EMPTY_INPUT, seq: 0, moveX: -1 });
    game.step(.05);
    expect(player.x).toBeGreaterThan(position.x);
    expect(Number.isFinite(player.z)).toBe(true);
    game.step(NaN);
    expect(Number.isFinite(game.snapshot().time)).toBe(true);
  });

  it('expires stale movement and firing and resets input sequence when reconnecting', () => {
    const { game, player, input, advance } = setup();
    player.x = 0; player.z = 60;
    input({ moveZ: 1, fire: true });
    advance(.5);
    const z = player.z, ammunition = player.ammo.pistol;
    advance(1);
    expect(player.z).toBe(z);
    expect(player.ammo.pistol).toBe(ammunition);
    game.setConnected(player.id, false);
    game.setConnected(player.id, true);
    game.setInput(player.id, { ...EMPTY_INPUT, seq: 0, moveZ: 1 });
    game.step(.05);
    expect(player.z).toBeLessThan(z);
    game.setConnected(player.id, false);
    const disconnectedZ = player.z;
    game.step(.05);
    expect(player.z).toBe(disconnectedZ);
  });

  it('blocks houses and the shoreline without preventing movement along a wall', () => {
    const { player, advance } = setup();
    const house = ISLAND_BUILDINGS[0];
    player.x = house.x; player.z = house.z + house.depth / 2 + .5;
    advance(1, { moveZ: 1 });
    expect(player.z).toBeGreaterThanOrEqual(house.z + house.depth / 2 + .38);
    const x = player.x;
    advance(.3, { moveX: 1, moveZ: 1 });
    expect(player.x).toBeGreaterThan(x);
    player.x = 0; player.z = 130; player.yaw = Math.PI;
    advance(10, { moveZ: 1 });
    expect(isBlocked(player.x, player.z, .38)).toBe(false);
    const shore = player.z;
    advance(1, { moveZ: 1 });
    expect(player.z).toBe(shore);
  });

  it('spends stamina to sprint and jump, and held jump does not produce automatic hopping', () => {
    const { player, advance } = setup();
    player.x = 0; player.z = 60;
    advance(.1, { jump: true, moveZ: 1, sprint: true });
    expect(player.y).toBeGreaterThan(0);
    expect(player.stamina).toBeLessThan(90);
    advance(1, { jump: true });
    expect(player.y).toBe(0);
    advance(.1, { jump: false });
    advance(.1, { jump: true });
    expect(player.y).toBeGreaterThan(0);
  });

  it('hits zombie heads, spends rounds, and never damages a teammate in the line of fire', () => {
    const { game, player, input } = setup();
    const target = game.snapshot().zombies.find(z => !isBlocked(z.x, z.z + 5, .5))!;
    player.x = target.x; player.z = target.z + 5;
    const friend = game.addPlayer('bob', 'Bob', '#fff');
    friend.x = target.x; friend.z = target.z + 2.5;
    aimAt(player, target);
    input({ fire: true });
    game.step(.05);
    const injured = game.snapshot().zombies.find(z => z.id === target.id);
    expect(injured?.health ?? 0).toBe(Math.max(0, target.health - WEAPONS.pistol.damage * 2));
    expect(player.ammo.pistol).toBe(11);
    expect(friend.health).toBe(100);
    expect(game.snapshot().events.some(e => e.type === 'hit' && e.headshot)).toBe(true);
  });

  it('does not shoot through map buildings and consumes ammunition even when a shot misses', () => {
    const { game, player, input } = setup();
    const target = game.snapshot().zombies.find(z => z.x < -70 && z.z < -70)!;
    expect(target).toBeDefined();
    // Shoot through the outpost hangar toward the infected beyond it.
    const hangar = ISLAND_BUILDINGS.find(b => b.id === 'outpost-a')!;
    const dx = target.x - hangar.x, dz = target.z - hangar.z;
    const length = Math.hypot(dx, dz);
    player.x = hangar.x - dx / length * 15; player.z = hangar.z - dz / length * 15;
    aimAt(player, target);
    input({ fire: true }); game.step(.05);
    expect(game.snapshot().zombies.find(z => z.id === target.id)?.health).toBe(target.health);
    expect(player.ammo.pistol).toBe(11);
  });

  it('reloads using only available reserve rounds and cannot equip an uncrafted shotgun', () => {
    const { game, player, advance } = setup();
    player.ammo.pistol = 2; player.reserve = 3;
    game.action(player.id, { action: 'reload' });
    expect(player.reloading).toBeGreaterThan(0);
    expect(player.ammo.pistol).toBe(2);
    advance(1.5);
    expect(player.ammo.pistol).toBe(5);
    expect(player.reserve).toBe(0);
    game.action(player.id, { action: 'weapon', weapon: 'shotgun' });
    expect(player.weapon).toBe('pistol');
  });

  it('harvests finite resources with an axe and ignores exhausted nodes', () => {
    const { game, player, advance } = setup();
    const resource = RESOURCE_NODES.find(n => n.id === 'rock-0')!;
    player.x = resource.x; player.z = resource.z + 2;
    player.yaw = 0;
    game.action(player.id, { action: 'weapon', weapon: 'axe' });
    const before = player.resources.stone;
    advance(1.3, { fire: true });
    expect(player.resources.stone).toBe(before + 8);
    expect(game.snapshot().nodes.find(n => n.id === resource.id)?.active).toBe(false);
    advance(1.2, { fire: true });
    expect(player.resources.stone).toBe(before + 8);
  });

  it('harvests wood from trees and removes their physical collision when felled', () => {
    const { game, player, advance } = setup();
    const tree = RESOURCE_NODES.find(n => n.kind === 'tree' && n.z > 65 && Math.abs(n.x) < 25 && !isBlocked(n.x, n.z + 2, .5))!;
    expect(tree).toBeDefined();
    player.x = tree.x; player.z = tree.z + 2; player.yaw = 0;
    advance(.5, { moveZ: 1 });
    expect(player.z).toBeGreaterThan(tree.z + .65);
    game.action(player.id, { action: 'weapon', weapon: 'axe' });
    const wood = player.resources.wood;
    advance(1.3, { fire: true });
    expect(player.resources.wood).toBe(wood + 8);
    expect(game.snapshot().nodes.find(n => n.id === tree.id)?.active).toBe(false);
    advance(.25, { moveZ: 1 });
    expect(player.z).toBeLessThan(tree.z);
  });

  it('crafts a workbench, ammunition, and shotgun with authoritative cost and proximity checks', () => {
    const { game, player, advance } = setup();
    player.x = 0; player.z = 60;
    player.resources = { wood: 30, stone: 4, scrap: 30, cloth: 2 };
    const initialReserve = player.reserve;
    game.action(player.id, { action: 'craft', recipe: 'ammo' });
    expect(player.reserve).toBe(initialReserve);
    expect(player.resources.scrap).toBe(30);
    advance(.2);
    game.action(player.id, { action: 'craft', recipe: 'workbench' });
    expect(game.snapshot().buildings[0]?.kind).toBe('workbench');
    expect(player.resources.wood).toBe(18);
    expect(player.resources.scrap).toBe(24);
    advance(.2);
    game.action(player.id, { action: 'craft', recipe: 'ammo' });
    expect(player.reserve).toBe(initialReserve + 24);
    expect(player.resources.scrap).toBe(21);
    advance(.2);
    game.action(player.id, { action: 'craft', recipe: 'shotgun' });
    expect(player.hasShotgun).toBe(true);
    expect(player.ammo.shotgun).toBe(6);
    expect(player.resources.scrap).toBe(11);
    advance(.2);
    const wood = player.resources.wood;
    game.action(player.id, { action: 'craft', recipe: 'shotgun' });
    expect(player.resources.wood).toBe(wood);
    player.z += 20;
    advance(.2);
    game.action(player.id, { action: 'craft', recipe: 'ammo' });
    expect(player.reserve).toBe(initialReserve + 24);
    expect(player.resources.scrap).toBe(11);
  });

  it('rejects colliding placements without consuming materials and barricades block walking', () => {
    const { game, player, advance } = setup();
    const house = ISLAND_BUILDINGS[0];
    player.x = house.x; player.z = house.z + house.depth / 2 + 2;
    game.action(player.id, { action: 'craft', recipe: 'barricade' });
    expect(game.snapshot().buildings).toHaveLength(0);
    expect(player.resources.wood).toBe(8);
    player.x = 0; player.z = 60;
    advance(.2);
    game.action(player.id, { action: 'craft', recipe: 'barricade' });
    expect(game.snapshot().buildings).toHaveLength(1);
    expect(player.resources.wood).toBe(0);
    advance(.2);
    player.yaw = Math.PI / 2;
    game.action(player.id, { action: 'craft', recipe: 'barricade' });
    expect(game.snapshot().buildings).toHaveLength(1);
    expect(player.resources.wood).toBe(0);
    player.yaw = 0;
    advance(1, { moveZ: 1 });
    expect(player.z).toBeGreaterThan(57.6);
  });

  it('crafts and consumes finite bandages, food, and water without wasting full-stat supplies', () => {
    const { game, player, advance } = setup();
    game.action(player.id, { action: 'heal' });
    expect(player.medkits).toBe(2);
    advance(.2);
    game.action(player.id, { action: 'craft', recipe: 'bandage' });
    expect(player.medkits).toBe(3);
    expect(player.resources.cloth).toBe(0);
    player.health = 20; player.hunger = 20; player.thirst = 20;
    advance(.2); game.action(player.id, { action: 'heal' });
    expect(player.health).toBe(65);
    expect(player.medkits).toBe(2);
    advance(.2); game.action(player.id, { action: 'eat' });
    expect(player.hunger).toBeCloseTo(65, 0);
    expect(player.food).toBe(1);
    advance(.2); game.action(player.id, { action: 'drink' });
    expect(player.thirst).toBeCloseTo(75, 0);
    expect(player.water).toBe(1);
  });

  it('allows a campfire to heal living players and preserves action events for the next broadcast', () => {
    const { game, player, advance } = setup();
    player.x = 0; player.z = 60; player.health = 50;
    game.action(player.id, { action: 'craft', recipe: 'campfire' });
    const built = game.snapshot().events.find(e => e.type === 'build');
    expect(built).toBeDefined();
    game.step(.05);
    expect(game.snapshot().events.filter(e => e.id === built!.id)).toHaveLength(1);
    game.step(.05);
    expect(game.snapshot().events.some(e => e.id === built!.id)).toBe(false);
    advance(1);
    expect(player.health).toBeGreaterThan(52);
  });

  it('shares loot once across the team and returns isolated snapshot objects', () => {
    const { game, player } = setup();
    const friend = game.addPlayer('bob', 'Bob', '#fff');
    player.x = friend.x = 3; player.z = friend.z = 89;
    game.action(player.id, { action: 'interact' });
    game.action(friend.id, { action: 'interact' });
    expect(player.reserve).toBe(108);
    expect(friend.reserve).toBe(72);
    expect(game.snapshot().loot.find(l => l.id === 'camp-ammo')?.active).toBe(false);
    const snapshot = game.snapshot();
    snapshot.players[0].resources.wood = 999;
    snapshot.vehicles[0].seats[0] = 'intruder';
    expect(player.resources.wood).toBe(8);
    expect(game.snapshot().vehicles[0].seats[0]).toBe(null);
  });

  it('seats friends in a vehicle, burns fuel while driving, stops stale controls, and exits safely', () => {
    const { game, player, advance } = setup();
    const friend = game.addPlayer('bob', 'Bob', '#fff');
    player.x = friend.x = 7; player.z = friend.z = 80;
    game.action(player.id, { action: 'interact' });
    game.action(friend.id, { action: 'interact' });
    expect(player.seat).toBe(0);
    expect(friend.seat).toBe(1);
    advance(2, { moveZ: 1 });
    let vehicle = game.snapshot().vehicles[0];
    expect(vehicle.z).toBeLessThan(75);
    expect(vehicle.fuel).toBeLessThan(100);
    expect(Math.hypot(player.x - friend.x, player.z - friend.z)).toBeLessThan(2);
    advance(3);
    vehicle = game.snapshot().vehicles[0];
    expect(Math.abs(vehicle.speed)).toBeLessThan(.1);
    game.action(player.id, { action: 'interact' });
    expect(player.vehicleId).toBe(null);
    expect(isBlocked(player.x, player.z, .38)).toBe(false);
    expect(game.snapshot().vehicles[0].seats[0]).toBe(null);
    game.removePlayer(friend.id);
    expect(game.snapshot().vehicles[0].seats[1]).toBe(null);
  });

  it('brakes when its driver disconnects and credits server-validated zombie ramming kills', () => {
    const { game, player, advance } = setup();
    const pickup = game.snapshot().vehicles.find(v => v.id === 'harbor-pickup')!;
    player.x = pickup.x; player.z = pickup.z;
    game.action(player.id, { action: 'interact' });
    advance(5, { moveZ: -1 });
    expect(player.kills).toBeGreaterThan(0);
    expect(game.snapshot().vehicles.find(v => v.id === pickup.id)!.health).toBeLessThan(250);
    game.setConnected(player.id, false);
    advance(3);
    expect(Math.abs(game.snapshot().vehicles.find(v => v.id === pickup.id)!.speed)).toBeLessThan(.1);
  });

  it('gives the handbrake priority over throttle and allows a safe stopped exit', () => {
    const { game, player, advance } = setup();
    player.x = 7; player.z = 80;
    game.action(player.id, { action: 'interact' });
    advance(1, { moveZ: 1 });
    expect(game.snapshot().vehicles[0].speed).toBeGreaterThan(5);
    game.action(player.id, { action: 'interact' });
    expect(player.vehicleId).toBe('camp-jeep');
    advance(.5, { moveZ: 1, jump: true });
    expect(game.snapshot().vehicles[0].speed).toBe(0);
    game.action(player.id, { action: 'interact' });
    expect(player.vehicleId).toBe(null);
  });

  it('lets infected attack and eventually destroy player-built cover, including campfires', () => {
    const { game, player, advance } = setup();
    const target = game.snapshot().zombies[0];
    player.x = target.x; player.z = target.z + 5; player.yaw = 0;
    game.action(player.id, { action: 'craft', recipe: 'campfire' });
    expect(game.snapshot().buildings).toHaveLength(1);
    advance(3);
    expect(game.snapshot().buildings[0]?.health ?? 0).toBeLessThan(100);
    advance(8);
    expect(game.snapshot().buildings).toHaveLength(0);
  });

  it('lets a survivor dismantle misplaced cover with a hatchet and walk through the cleared space', () => {
    const { game, player, advance } = setup();
    player.x = 0; player.z = 60;
    game.action(player.id, { action: 'craft', recipe: 'barricade' });
    advance(.2);
    game.action(player.id, { action: 'weapon', weapon: 'axe' });
    advance(.8, { moveZ: 1 });
    expect(player.z).toBeGreaterThan(57.6);
    advance(3.5, { fire: true });
    expect(game.snapshot().buildings).toHaveLength(0);
    advance(.4, { moveZ: 1 });
    expect(player.z).toBeLessThan(57);
  });

  it('kills players attacked by infected and enforces a five-second respawn delay', () => {
    const { game, player, advance } = setup();
    const zombie = game.snapshot().zombies[0];
    player.x = zombie.x; player.z = zombie.z + .8; player.health = 1;
    game.step(.05);
    expect(player.dead).toBe(true);
    const ammunition = player.reserve, cloth = player.resources.cloth;
    game.action(player.id, { action: 'craft', recipe: 'bandage' });
    game.action(player.id, { action: 'interact' });
    advance(.5, { fire: true, moveZ: 1 });
    expect(player.reserve).toBe(ammunition);
    expect(player.resources.cloth).toBe(cloth);
    game.action(player.id, { action: 'respawn' });
    expect(player.dead).toBe(true);
    advance(5.1);
    game.action(player.id, { action: 'respawn' });
    expect(player.dead).toBe(false);
    expect(player.health).toBe(100);
    expect(player.x).toBe(SPAWN.x);
    expect(player.z).toBe(SPAWN.z);
  });

  it('requires all three supply crates and presence at the radio to finish cooperative extraction', () => {
    const { game, player, advance } = setup();
    player.x = RADIO.x; player.z = RADIO.z;
    game.action(player.id, { action: 'interact' });
    advance(.2);
    expect(game.snapshot().extraction).toBe(0);
    for (const crate of game.snapshot().loot.filter(l => l.kind === 'supply')) {
      player.x = crate.x; player.z = crate.z;
      game.action(player.id, { action: 'interact' });
      advance(.2);
    }
    expect(game.snapshot().supplies).toBe(3);
    player.x = RADIO.x; player.z = RADIO.z;
    game.action(player.id, { action: 'interact' });
    advance(.5);
    expect(game.snapshot().extraction).toBeGreaterThan(0);
    player.x = SPAWN.x; player.z = SPAWN.z;
    const paused = game.snapshot().extraction;
    advance(1);
    expect(game.snapshot().extraction).toBe(paused);
    player.x = RADIO.x; player.z = RADIO.z;
    // Combat is covered separately; replenish fixture health while verifying the objective timer.
    for (let i = 0; i < 620; i++) { player.health = 100; game.step(.05); }
    expect(game.phase).toBe('won');
    expect(game.snapshot().extraction).toBe(30);
  });
});
