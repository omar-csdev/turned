import { EMPTY_INPUT, MAX_PLAYERS, RECIPES, WEAPONS } from './protocol';
import type { BuildingKind, BuildingState, GameEvent, GameSnapshot, LootState, PlayerAction, PlayerInput, PlayerState, ResourceId, ResourceNodeState, Vec2, VehicleState, WeaponId, ZombieState } from './protocol';
import { ISLAND_BUILDINGS, LOOT_SPAWNS, RADIO, RESOURCE_NODES, SPAWN, VEHICLE_SPAWNS, ZOMBIE_SPAWNS, isBlocked } from './island';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const EYE_HEIGHT = 1.62;
const INPUT_TIMEOUT = .4;
const BUILD_SIZE: Record<BuildingKind, { width: number; depth: number; height: number; health: number }> = {
  barricade: { width: 3.6, depth: .65, height: 1.5, health: 240 },
  campfire: { width: 1.25, depth: 1.25, height: .65, health: 100 },
  workbench: { width: 2, depth: 1.2, height: 1.1, health: 180 },
};
type Controls = { input: PlayerInput; at: number; sequence: number; jumpHeld: boolean; velocityY: number; nextShot: number; nextAction: number; diedAt: number };
type ZombieBrain = { origin: Vec2; nextAttack: number; respawnAt: number; noise: Vec2 | null; noiseUntil: number };
type Ray = { x: number; y: number; z: number; dx: number; dy: number; dz: number };

/** A deterministic, server-authoritative cooperative world. Clients send intent only. */
export class GameSimulation {
  phase: GameSnapshot['phase'] = 'lobby';
  private tick = 0;
  private time = 0;
  private players = new Map<string, PlayerState>();
  private controls = new Map<string, Controls>();
  private zombies: ZombieState[] = [];
  private brains = new Map<string, ZombieBrain>();
  private vehicles: VehicleState[] = VEHICLE_SPAWNS.map(v => ({ ...v, speed: 0, fuel: 100, health: 250, seats: [null, null, null, null] }));
  private loot: LootState[] = LOOT_SPAWNS.map(l => ({ ...l, active: true }));
  private nodes: ResourceNodeState[] = RESOURCE_NODES.map(n => ({ id: n.id, health: n.kind === 'tree' ? 90 : 110, active: true }));
  private buildings: BuildingState[] = [];
  private pendingEvents: GameEvent[] = [];
  private events: GameEvent[] = [];
  private serial = 0;
  private supplies = 0;
  private extraction = 0;
  private extracting = false;

  constructor() {
    ZOMBIE_SPAWNS.forEach((z, i) => this.spawnZombie(`infected-${i}`, z, z.kind));
  }

  addPlayer(id: string, name: string, color: string): PlayerState {
    const existing = this.players.get(id);
    if (existing) return existing;
    if (this.players.size >= MAX_PLAYERS) throw new Error('This lobby is full.');
    const index = this.players.size;
    const player: PlayerState = {
      id, name: name.trim().slice(0, 24) || 'Survivor', color,
      x: SPAWN.x + (index % 4) * 1.5 - 2, z: SPAWN.z + Math.floor(index / 4) * 2,
      y: 0, yaw: 0, pitch: 0, health: 100, hunger: 100, thirst: 100, stamina: 100,
      weapon: 'pistol', ammo: { axe: 0, pistol: 12, rifle: 30, shotgun: 0 }, reserve: 72, reloading: 0,
      resources: { wood: 8, stone: 4, scrap: 4, cloth: 2 }, medkits: 2, food: 2, water: 2, fuel: 0,
      hasShotgun: false, kills: 0, dead: false, vehicleId: null, seat: -1, moving: false, firing: 0, connected: true,
    };
    this.players.set(id, player);
    this.controls.set(id, { input: { ...EMPTY_INPUT }, at: -Infinity, sequence: -1, jumpHeld: false, velocityY: 0, nextShot: 0, nextAction: 0, diedAt: -Infinity });
    return player;
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) this.leaveVehicle(player, true);
    this.players.delete(id);
    this.controls.delete(id);
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id), controls = this.controls.get(id);
    if (!p || !controls) return;
    p.connected = connected;
    p.moving = false;
    controls.input = { ...EMPTY_INPUT, yaw: p.yaw, pitch: p.pitch };
    controls.at = -Infinity;
    controls.sequence = -1;
    controls.jumpHeld = false;
  }

  start(): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'playing';
    this.emit({ type: 'notice', ...SPAWN, text: 'Find three supply crates, then activate the radio at Radio Ridge.' });
  }

  setInput(id: string, input: PlayerInput): void {
    const p = this.players.get(id), controls = this.controls.get(id);
    if (!p || !controls || !input || typeof input !== 'object' || !p.connected) return;
    if (![input.seq, input.moveX, input.moveZ, input.yaw, input.pitch].every(Number.isFinite) ||
      !Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq <= controls.sequence) return;
    const x = clamp(input.moveX, -1, 1), z = clamp(input.moveZ, -1, 1), magnitude = Math.max(1, Math.hypot(x, z));
    controls.input = {
      seq: input.seq, moveX: x / magnitude, moveZ: z / magnitude,
      yaw: ((input.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), pitch: clamp(input.pitch, -1.45, 1.45),
      sprint: input.sprint === true, jump: input.jump === true, fire: input.fire === true, aim: input.aim === true,
    };
    controls.sequence = input.seq;
    controls.at = this.time;
  }

  action(id: string, action: PlayerAction): void {
    const p = this.players.get(id), controls = this.controls.get(id);
    if (!p || !controls || !p.connected || this.phase !== 'playing' || !action || typeof action !== 'object') return;
    if (action.action === 'respawn') {
      if (p.dead && this.time - controls.diedAt >= 5) this.respawn(p, controls);
      return;
    }
    if (p.dead || this.time < controls.nextAction) return;
    controls.nextAction = this.time + .15;
    switch (action.action) {
      case 'weapon':
        if (!Object.prototype.hasOwnProperty.call(WEAPONS, action.weapon) || (action.weapon === 'shotgun' && !p.hasShotgun)) return;
        if (p.weapon !== action.weapon) { p.weapon = action.weapon; p.reloading = 0; }
        break;
      case 'reload': this.reload(p); break;
      case 'interact': this.interact(p); break;
      case 'heal':
        if (p.medkits > 0 && p.health < 100) { p.medkits--; p.health = Math.min(100, p.health + 45); this.notice(p, 'Bandaged: +45 health.'); }
        break;
      case 'eat':
        if (p.food > 0 && p.hunger < 100) { p.food--; p.hunger = Math.min(100, p.hunger + 45); }
        break;
      case 'drink':
        if (p.water > 0 && p.thirst < 100) { p.water--; p.thirst = Math.min(100, p.thirst + 55); }
        break;
      case 'craft': this.craft(p, action.recipe); break;
    }
  }

  /** A tick never simulates more than 100ms, preventing delayed or malformed input from tunneling. */
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, .1);
    this.events = [];
    this.tick++;
    if (this.phase === 'playing') {
      this.time += dt;
      for (const p of this.players.values()) this.stepPlayer(p, dt);
      for (const v of this.vehicles) this.stepVehicle(v, dt);
      this.stepZombies(dt);
      this.buildings = this.buildings.filter(b => b.health > 0);
      if (this.extracting && [...this.players.values()].some(p => p.connected && !p.dead && distance(p, RADIO) <= 13)) {
        this.extraction = Math.min(30, this.extraction + dt);
        if (this.extraction >= 30) {
          this.phase = 'won';
          this.emit({ type: 'win', ...RADIO, text: 'Rescue inbound. Your team survived Pinefall Island!' });
        }
      }
    }
    this.events = this.pendingEvents.splice(0);
  }

  snapshot(): GameSnapshot {
    return {
      tick: this.tick, time: this.time, dayTime: (8 + this.time / 100) % 24, phase: this.phase,
      players: [...this.players.values()].map(p => ({ ...p, ammo: { ...p.ammo }, resources: { ...p.resources } })),
      zombies: this.zombies.filter(z => z.health > 0).map(z => ({ ...z })),
      vehicles: this.vehicles.map(v => ({ ...v, seats: [...v.seats] })), loot: this.loot.map(l => ({ ...l })),
      nodes: this.nodes.map(n => ({ ...n })), buildings: this.buildings.map(b => ({ ...b })),
      events: [...this.events, ...this.pendingEvents].slice(-100).map(e => ({ ...e })),
      supplies: this.supplies, requiredSupplies: 3, extraction: this.extraction,
    };
  }

  private emit(event: Omit<GameEvent, 'id'>): void {
    this.pendingEvents.push({ ...event, id: ++this.serial });
    if (this.pendingEvents.length > 100) this.pendingEvents.shift();
  }
  private notice(p: PlayerState, text: string): void { this.emit({ type: 'notice', x: p.x, z: p.z, actorId: p.id, text }); }
  private input(p: PlayerState): PlayerInput {
    const control = this.controls.get(p.id)!;
    return p.connected && this.time - control.at <= INPUT_TIMEOUT ? control.input : { ...EMPTY_INPUT, yaw: p.yaw, pitch: p.pitch };
  }

  private stepPlayer(p: PlayerState, dt: number): void {
    const c = this.controls.get(p.id)!;
    p.firing = Math.max(0, p.firing - dt);
    p.moving = false;
    if (p.dead || !p.connected) return;
    const input = this.input(p);
    p.yaw = input.yaw; p.pitch = input.pitch;
    p.hunger = Math.max(0, p.hunger - dt * .035);
    p.thirst = Math.max(0, p.thirst - dt * .05);
    if (p.hunger <= 0 || p.thirst <= 0) this.damagePlayer(p, dt * 2);
    if (p.dead) return;
    if (p.reloading > 0) {
      p.reloading = Math.max(0, p.reloading - dt);
      if (p.reloading === 0) {
        const load = Math.min(WEAPONS[p.weapon].magazine - p.ammo[p.weapon], p.reserve);
        p.ammo[p.weapon] += load; p.reserve -= load;
      }
    }
    if (!p.vehicleId) {
      const moving = Math.hypot(input.moveX, input.moveZ) > .01;
      const sprint = input.sprint && moving && p.stamina > 1 && !input.aim;
      const speed = (sprint ? 7 : input.aim ? 2.5 : 4.4) * (p.hunger <= 0 ? .75 : 1);
      const dx = (Math.cos(p.yaw) * input.moveX - Math.sin(p.yaw) * input.moveZ) * speed * dt;
      const dz = (-Math.sin(p.yaw) * input.moveX - Math.cos(p.yaw) * input.moveZ) * speed * dt;
      const before = { x: p.x, z: p.z };
      this.moveBody(p, dx, dz, .38);
      p.moving = distance(before, p) > .001;
      p.stamina = clamp(p.stamina + (sprint ? -17 : 12) * dt, 0, 100);
      if (input.jump && !c.jumpHeld && p.y <= .001 && p.stamina >= 12) { c.velocityY = 5.8; p.stamina -= 12; }
      c.jumpHeld = input.jump;
      c.velocityY -= 16 * dt;
      p.y = Math.max(0, p.y + c.velocityY * dt);
      if (p.y === 0) c.velocityY = 0;
      if (this.buildings.some(b => b.kind === 'campfire' && b.health > 0 && distance(p, b) < 5)) p.health = Math.min(100, p.health + 2 * dt);
    } else {
      c.velocityY = 0; c.jumpHeld = input.jump;
      p.stamina = Math.min(100, p.stamina + 12 * dt);
    }
    if (input.fire && this.time >= c.nextShot && p.reloading <= 0) this.fire(p, c);
  }

  private reload(p: PlayerState): void {
    if (p.weapon !== 'axe' && p.reloading <= 0 && p.reserve > 0 && p.ammo[p.weapon] < WEAPONS[p.weapon].magazine) p.reloading = WEAPONS[p.weapon].reload;
  }

  private fire(p: PlayerState, control: Controls): void {
    const weapon = WEAPONS[p.weapon];
    control.nextShot = this.time + weapon.interval;
    if (p.weapon !== 'axe' && p.ammo[p.weapon] <= 0) { this.reload(p); return; }
    if (p.weapon !== 'axe') p.ammo[p.weapon]--;
    p.firing = p.weapon === 'axe' ? .3 : .12;
    this.emit({ type: 'shot', x: p.x, z: p.z, y: p.y + EYE_HEIGHT, actorId: p.id, weapon: p.weapon });
    const ray: Ray = {
      x: p.x, y: p.y + (p.weapon === 'axe' ? .9 : EYE_HEIGHT), z: p.z,
      dx: -Math.sin(p.yaw) * Math.cos(p.pitch), dy: Math.sin(p.pitch), dz: -Math.cos(p.yaw) * Math.cos(p.pitch),
    };
    let nearest = this.obstacleDistance(ray, weapon.range);
    let structure: BuildingState | undefined;
    if (p.weapon === 'axe') for (const b of this.buildings) {
      if (b.health <= 0) continue;
      const size = BUILD_SIZE[b.kind];
      const hit = rayBox(ray, b.x, b.z, size.width + .3, size.depth + .3, size.height + .5, b.yaw);
      if (hit >= 0 && hit <= nearest) { nearest = hit; structure = b; }
    }
    let target: ZombieState | undefined;
    for (const z of this.zombies) {
      if (z.health <= 0) continue;
      const spread = p.weapon === 'axe' ? .4 : p.weapon === 'shotgun' ? .2 : 0;
      const hit = rayBox(ray, z.x, z.z, .72 + spread, .72 + spread, 1.88, 0);
      if (hit >= 0 && hit < nearest) { nearest = hit; target = z; }
    }
    if (p.weapon === 'axe' && !target) {
      if (structure) {
        structure.health = Math.max(0, structure.health - 40);
        this.emit({ type: 'hit', x: structure.x, z: structure.z, y: .8, actorId: p.id, targetId: structure.id, weapon: 'axe' });
        if (structure.health === 0) this.notice(p, `${structure.kind === 'barricade' ? 'Barricade' : structure.kind === 'campfire' ? 'Campfire' : 'Workbench'} dismantled.`);
        return;
      }
      let harvested = -1;
      for (let i = 0; i < RESOURCE_NODES.length; i++) {
        const node = RESOURCE_NODES[i];
        if (!this.nodes[i].active) continue;
        // A hatchet sweep reaches rocks below the crosshair as well as tree trunks.
        const dx = node.x - p.x, dz = node.z - p.z;
        const along = dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw);
        const sideways = Math.abs(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw));
        if (along > 0 && along < Math.min(nearest, 3.2) && sideways < 1.25) { nearest = along; harvested = i; }
      }
      if (harvested >= 0) {
        const node = this.nodes[harvested], def = RESOURCE_NODES[harvested];
        node.health = Math.max(0, node.health - 38);
        const count = node.health === 0 ? 4 : 2;
        p.resources[def.resource] += count;
        node.active = node.health > 0;
        this.emit({ type: 'hit', ...def, y: .9, actorId: p.id, targetId: node.id, weapon: 'axe', text: `+${count} ${def.resource}` });
      }
    }
    if (target) {
      const hitY = ray.y + ray.dy * nearest;
      const headshot = p.weapon !== 'axe' && hitY >= 1.35;
      const falloff = p.weapon === 'shotgun' ? clamp(1 - nearest / 40, .4, 1) : 1;
      const armor = target.kind === 'armored' && !headshot ? .55 : 1;
      this.damageZombie(target, weapon.damage * (headshot ? 2 : 1) * falloff * armor, p, headshot, hitY);
    }
    if (p.weapon !== 'axe') for (const z of this.zombies) {
      if (z.health > 0 && distance(z, p) < 62) {
        const brain = this.brains.get(z.id)!;
        brain.noise = { x: p.x, z: p.z }; brain.noiseUntil = this.time + 7;
      }
    }
  }

  private obstacleDistance(ray: Ray, range: number): number {
    let nearest = range;
    for (const b of ISLAND_BUILDINGS) {
      const hit = rayBox(ray, b.x, b.z, b.width, b.depth, b.height, 0);
      if (hit >= 0) nearest = Math.min(nearest, hit);
    }
    for (const b of this.buildings) {
      if (b.health <= 0) continue;
      const shape = BUILD_SIZE[b.kind], hit = rayBox(ray, b.x, b.z, shape.width, shape.depth, shape.height, b.yaw);
      if (hit >= 0) nearest = Math.min(nearest, hit);
    }
    if (ray.dy < 0) nearest = Math.min(nearest, -ray.y / ray.dy);
    return nearest;
  }

  private interact(p: PlayerState): void {
    if (p.vehicleId) { this.leaveVehicle(p); return; }
    if (distance(p, RADIO) < 4) {
      if (this.supplies < 3) { this.notice(p, `Find ${3 - this.supplies} more supply crate${this.supplies === 2 ? '' : 's'} before calling rescue.`); return; }
      if (!this.extracting) {
        this.extracting = true;
        this.notice(p, 'Rescue signal sent. Stay within 13m of the radio for 30 seconds!');
        for (let i = 0; i < 8; i++) {
          const point = { x: RADIO.x + Math.cos(i * Math.PI / 4) * 22, z: RADIO.z + Math.sin(i * Math.PI / 4) * 22 };
          if (!isBlocked(point.x, point.z, .5)) {
            const z = this.spawnZombie(`rescue-${i}`, point, i % 3 === 0 ? 'runner' : 'walker');
            const brain = this.brains.get(z.id)!; brain.noise = RADIO; brain.noiseUntil = this.time + 60;
          }
        }
      }
      return;
    }
    const item = this.loot.filter(l => l.active && distance(l, p) < 3.2).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (item) {
      item.active = false;
      switch (item.kind) {
        case 'ammo': p.reserve += 36; break;
        case 'medkit': p.medkits++; break;
        case 'food': p.food++; break;
        case 'water': p.water++; break;
        case 'fuel': p.fuel++; break;
        case 'cloth': p.resources.cloth += 4; break;
        case 'scrap': p.resources.scrap += 6; break;
        case 'supply': this.supplies++; break;
      }
      this.emit({ type: 'pickup', x: item.x, z: item.z, actorId: p.id, targetId: item.id, text: item.kind === 'supply' ? `Supply crate recovered (${this.supplies}/3)` : `Picked up ${item.kind}` });
      return;
    }
    const vehicle = this.vehicles.filter(v => v.health > 0 && distance(v, p) < 4.5).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (vehicle) {
      if (p.fuel > 0 && vehicle.fuel < 80) { p.fuel--; vehicle.fuel = Math.min(100, vehicle.fuel + 50); this.notice(p, 'Vehicle refueled. Press E again to enter.'); return; }
      const seat = vehicle.seats.indexOf(null);
      if (seat < 0) { this.notice(p, 'This vehicle is full.'); return; }
      if (Math.abs(vehicle.speed) > 4) { this.notice(p, 'Wait for the vehicle to slow down.'); return; }
      vehicle.seats[seat] = p.id; p.vehicleId = vehicle.id; p.seat = seat; p.y = .8;
      this.placeOccupant(p, vehicle);
      this.notice(p, seat === 0 ? 'Driving: WASD, E to exit. Your friends can ride along.' : 'Passenger seat. E to exit.');
    }
  }

  private craft(p: PlayerState, recipeId: string): void {
    if (p.vehicleId) { this.notice(p, 'Exit the vehicle to craft.'); return; }
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe) return;
    if (recipe.id === 'shotgun' && p.hasShotgun) { this.notice(p, 'You already have a field shotgun.'); return; }
    if (recipe.workbench && !this.buildings.some(b => b.kind === 'workbench' && b.health > 0 && distance(p, b) <= 5)) { this.notice(p, 'Craft and stand within 5m of a workbench first.'); return; }
    for (const key of Object.keys(recipe.cost) as ResourceId[]) {
      if (p.resources[key] < recipe.cost[key]!) { this.notice(p, `Not enough ${key}. Harvest with your hatchet or scavenge supplies.`); return; }
    }
    const kind = recipe.id === 'barricade' || recipe.id === 'campfire' || recipe.id === 'workbench' ? recipe.id : null;
    const placement = { x: p.x - Math.sin(p.yaw) * 3, z: p.z - Math.cos(p.yaw) * 3 };
    if (kind && (this.buildings.length >= 80 || !this.canPlace(placement, p.yaw, kind))) { this.notice(p, 'No room to build here. Face an open patch of ground.'); return; }
    for (const key of Object.keys(recipe.cost) as ResourceId[]) p.resources[key] -= recipe.cost[key]!;
    if (kind) {
      const building: BuildingState = { id: `build-${++this.serial}`, ...placement, kind, yaw: p.yaw, health: BUILD_SIZE[kind].health, ownerId: p.id };
      this.buildings.push(building);
      this.emit({ type: 'build', ...placement, actorId: p.id, targetId: building.id, text: `${recipe.name} built` });
    } else if (recipe.id === 'bandage') { p.medkits++; this.notice(p, 'Crafted a field bandage. H to heal.'); }
    else if (recipe.id === 'ammo') { p.reserve += 24; this.notice(p, 'Crafted 24 spare rounds.'); }
    else if (recipe.id === 'shotgun') { p.hasShotgun = true; p.ammo.shotgun = 6; this.notice(p, 'Field shotgun crafted. Equip with 4.'); }
  }

  private canPlace(point: Vec2, yaw: number, kind: BuildingKind): boolean {
    const shape = BUILD_SIZE[kind];
    if (distance(point, RADIO) < 5) return false;
    // Sample the whole footprint; checking only the center permits half a wall inside a house.
    for (let x = -shape.width / 2 - .25; x <= shape.width / 2 + .26; x += .25) {
      for (let z = -shape.depth / 2 - .25; z <= shape.depth / 2 + .26; z += .25) {
        const wx = point.x + x * Math.cos(yaw) + z * Math.sin(yaw), wz = point.z - x * Math.sin(yaw) + z * Math.cos(yaw);
        if (this.blocked(wx, wz, .15) || this.vehicles.some(v => distance({ x: wx, z: wz }, v) < 2.6) ||
          [...this.players.values()].some(p => !p.dead && distance({ x: wx, z: wz }, p) < .7)) return false;
      }
    }
    return true;
  }

  private stepVehicle(v: VehicleState, dt: number): void {
    const driver = v.seats[0] ? this.players.get(v.seats[0]) : undefined;
    const input = driver && !driver.dead ? this.input(driver) : EMPTY_INPUT;
    const throttle = v.health > 0 && v.fuel > 0 && !input.jump ? input.moveZ : 0;
    if (input.jump) v.speed = Math.sign(v.speed) * Math.max(0, Math.abs(v.speed) - 26 * dt);
    else if (throttle) v.speed += throttle * (Math.sign(throttle) !== Math.sign(v.speed) && Math.abs(v.speed) > .5 ? 19 : 9) * dt;
    else v.speed *= Math.max(0, 1 - 2.8 * dt);
    v.speed = clamp(v.speed, -8, 19);
    if (Math.abs(v.speed) < .03) v.speed = 0;
    if (Math.abs(v.speed) > .1) v.yaw -= input.moveX * Math.sign(v.speed) * Math.min(Math.abs(v.speed) / 5, 1) * 1.65 * dt;
    const dx = -Math.sin(v.yaw) * v.speed * dt, dz = -Math.cos(v.yaw) * v.speed * dt;
    if (this.vehicleBlocked(v.x + dx, v.z + dz, v.yaw, v.id)) {
      if (Math.abs(v.speed) > 5) {
        v.health = Math.max(0, v.health - Math.abs(v.speed) * 2);
        for (const occupant of v.seats) { const p = occupant ? this.players.get(occupant) : undefined; if (p) this.damagePlayer(p, Math.abs(v.speed) * .7); }
      }
      v.speed = 0;
    } else { v.x += dx; v.z += dz; }
    v.fuel = Math.max(0, v.fuel - Math.abs(v.speed) * .014 * dt);
    for (const occupant of [...v.seats]) {
      const p = occupant ? this.players.get(occupant) : undefined;
      if (p) { this.placeOccupant(p, v); p.moving = Math.abs(v.speed) > .2; }
    }
    if (Math.abs(v.speed) > 3) for (const z of this.zombies) {
      if (z.health > 0 && distance(z, v) < 2.25) {
        this.damageZombie(z, Math.abs(v.speed) * 16, driver, false, .7);
        v.health = Math.max(0, v.health - 3); v.speed *= .88;
      }
    }
    if (v.health <= 0) {
      v.speed = 0;
      for (const occupant of [...v.seats]) { const p = occupant ? this.players.get(occupant) : undefined; if (p) this.leaveVehicle(p, true); }
    }
  }

  private vehicleBlocked(x: number, z: number, yaw: number, ownId: string): boolean {
    for (const sx of [-.95, 0, .95]) for (const sz of [-1.8, 0, 1.8]) {
      if (this.blocked(x + sx * Math.cos(yaw) + sz * Math.sin(yaw), z - sx * Math.sin(yaw) + sz * Math.cos(yaw), .25)) return true;
    }
    return this.vehicles.some(v => v.id !== ownId && Math.hypot(x - v.x, z - v.z) < 3.1);
  }

  private placeOccupant(p: PlayerState, v: VehicleState): void {
    const side = p.seat % 2 === 0 ? -.52 : .52, front = p.seat < 2 ? -.25 : .8;
    p.x = v.x + side * Math.cos(v.yaw) + front * Math.sin(v.yaw);
    p.z = v.z - side * Math.sin(v.yaw) + front * Math.cos(v.yaw);
    p.y = .8;
  }

  private leaveVehicle(p: PlayerState, force = false): boolean {
    const v = this.vehicles.find(v => v.id === p.vehicleId);
    if (!v) { p.vehicleId = null; p.seat = -1; p.y = 0; return true; }
    if (!force && Math.abs(v.speed) > 5) { this.notice(p, 'Slow down before exiting the vehicle.'); return false; }
    let exit: Vec2 | undefined;
    for (const radius of [3.2, 4.5, 6]) {
      for (let i = 0; i < 12; i++) {
        const angle = v.yaw + i * Math.PI / 6;
        const point = { x: v.x + Math.cos(angle) * radius, z: v.z - Math.sin(angle) * radius };
        if (!this.blocked(point.x, point.z, .45) && !this.vehicles.some(car => distance(point, car) < 2.8)) { exit = point; break; }
      }
      if (exit) break;
    }
    if (!exit && !force) { this.notice(p, 'The doors are blocked. Move the vehicle to an open area.'); return false; }
    v.seats = v.seats.map(id => id === p.id ? null : id);
    p.vehicleId = null; p.seat = -1; p.y = 0;
    p.x = exit?.x ?? SPAWN.x; p.z = exit?.z ?? SPAWN.z;
    return true;
  }

  private spawnZombie(id: string, point: Vec2, kind: ZombieState['kind']): ZombieState {
    const z: ZombieState = { id, ...point, y: 0, yaw: 0, health: kind === 'armored' ? 150 : kind === 'runner' ? 72 : 100, kind, attacking: false };
    this.zombies.push(z);
    this.brains.set(id, { origin: { ...point }, nextAttack: 0, respawnAt: 0, noise: null, noiseUntil: 0 });
    return z;
  }

  private stepZombies(dt: number): void {
    const survivors = [...this.players.values()].filter(p => !p.dead && p.connected);
    for (const z of this.zombies) {
      const brain = this.brains.get(z.id)!;
      z.attacking = false;
      if (z.health <= 0) {
        if (this.time >= brain.respawnAt && !z.id.startsWith('rescue-') && survivors.every(p => distance(p, brain.origin) > 28)) {
          z.x = brain.origin.x; z.z = brain.origin.z; z.health = z.kind === 'armored' ? 150 : z.kind === 'runner' ? 72 : 100;
        }
        continue;
      }
      let target: PlayerState | undefined, nearest = 32;
      for (const p of survivors) { const d = distance(p, z); if (d < nearest) { target = p; nearest = d; } }
      const destination = target ?? (brain.noise && this.time < brain.noiseUntil ? brain.noise : undefined);
      if (!destination) continue;
      const dx = destination.x - z.x, dz = destination.z - z.z, d = Math.hypot(dx, dz);
      z.yaw = Math.atan2(-dx, -dz);
      const reach = target?.vehicleId ? 2.35 : 1.25;
      const barrier = this.buildings.find(b => b.health > 0 && this.insideBuilding(z.x + dx / Math.max(d, .01) * .8, z.z + dz / Math.max(d, .01) * .8, b, .5));
      if (barrier) {
        z.attacking = true;
        if (this.time >= brain.nextAttack) { barrier.health = Math.max(0, barrier.health - (z.kind === 'armored' ? 24 : 14)); brain.nextAttack = this.time + .85; }
      } else if (target && nearest < reach && this.obstacleDistance({ x: z.x, y: .9, z: z.z, dx: dx / Math.max(d, .01), dy: 0, dz: dz / Math.max(d, .01) }, nearest) >= nearest - .1) {
        z.attacking = true;
        if (this.time >= brain.nextAttack) {
          if (target.vehicleId) {
            const v = this.vehicles.find(v => v.id === target.vehicleId);
            if (v) v.health = Math.max(0, v.health - 8);
          } else if (target.y < 1.1) this.damagePlayer(target, z.kind === 'armored' ? 16 : z.kind === 'runner' ? 8 : 11, z.id);
          brain.nextAttack = this.time + (z.kind === 'runner' ? .8 : 1.1);
        }
      } else if (d > .2) {
        const speed = (z.kind === 'runner' ? 3.3 : z.kind === 'armored' ? 1.4 : 2) * dt;
        const ux = dx / d, uz = dz / d;
        const before = { x: z.x, z: z.z };
        this.moveBody(z, ux * speed, uz * speed, .4);
        if (distance(before, z) < speed * .3) {
          const direction = z.id.length % 2 ? 1 : -1;
          for (const angle of [direction * .8, -direction * .8, direction * 1.55, -direction * 1.55]) {
            const sx = (ux * Math.cos(angle) - uz * Math.sin(angle)) * speed, sz = (ux * Math.sin(angle) + uz * Math.cos(angle)) * speed;
            if (!this.blocked(z.x + sx, z.z + sz, .4)) { z.x += sx; z.z += sz; break; }
          }
        }
      }
    }
  }

  private damageZombie(z: ZombieState, damage: number, player?: PlayerState, headshot = false, y = 1): void {
    if (z.health <= 0) return;
    z.health = Math.max(0, z.health - damage);
    this.emit({ type: 'hit', x: z.x, z: z.z, y, actorId: player?.id, targetId: z.id, weapon: player?.weapon, headshot });
    if (z.health <= 0) {
      if (player) player.kills++;
      this.brains.get(z.id)!.respawnAt = this.time + 100;
      this.emit({ type: 'kill', x: z.x, z: z.z, actorId: player?.id, targetId: z.id, headshot });
      if (this.loot.length < 160) this.loot.push({ id: `drop-${++this.serial}`, x: z.x, z: z.z, kind: this.serial % 3 === 0 ? 'ammo' : 'cloth', active: true });
    }
  }

  private damagePlayer(p: PlayerState, damage: number, actorId?: string): void {
    if (p.dead || damage <= 0) return;
    p.health = Math.max(0, p.health - damage);
    if (damage >= 1) this.emit({ type: 'hurt', x: p.x, z: p.z, actorId, targetId: p.id });
    if (p.health <= 0) {
      p.dead = true; p.moving = false; p.reloading = 0;
      this.controls.get(p.id)!.diedAt = this.time;
      this.leaveVehicle(p, true);
      this.notice(p, 'You were overrun. Respawn at survivor camp in 5 seconds.');
    }
  }

  private respawn(p: PlayerState, control: Controls): void {
    p.x = SPAWN.x; p.z = SPAWN.z; p.y = 0; p.health = 100; p.hunger = 70; p.thirst = 70; p.stamina = 100;
    p.dead = false; p.weapon = 'pistol'; p.reloading = 0; p.firing = 0;
    // Recovery supplies keep a depleted team playable; gathered materials are retained.
    p.ammo.pistol = Math.max(p.ammo.pistol, 12); p.reserve = Math.max(p.reserve, 12);
    control.input = { ...EMPTY_INPUT }; control.at = -Infinity; control.velocityY = 0; control.jumpHeld = false;
    this.notice(p, 'Back at survivor camp. Your team still has its supplies.');
  }

  private insideBuilding(x: number, z: number, b: BuildingState, radius: number): boolean {
    const dx = x - b.x, dz = z - b.z, shape = BUILD_SIZE[b.kind];
    return Math.abs(dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw)) < shape.width / 2 + radius &&
      Math.abs(dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)) < shape.depth / 2 + radius;
  }

  private blocked(x: number, z: number, radius: number): boolean {
    return !Number.isFinite(x) || !Number.isFinite(z) || isBlocked(x, z, radius) ||
      RESOURCE_NODES.some((node, i) => this.nodes[i].active && Math.hypot(x - node.x, z - node.z) < radius + (node.kind === 'tree' ? .35 : node.kind === 'rock' ? .75 : .6)) ||
      this.buildings.some(b => b.health > 0 && this.insideBuilding(x, z, b, radius));
  }

  private moveBody(body: Vec2, dx: number, dz: number, radius: number): void {
    const pieces = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .25));
    for (let i = 0; i < pieces; i++) {
      if (!this.blocked(body.x + dx / pieces, body.z, radius)) body.x += dx / pieces;
      if (!this.blocked(body.x, body.z + dz / pieces, radius)) body.z += dz / pieces;
    }
  }
}

/** Ray intersection with an oriented, ground-level box; -1 means a miss. */
function rayBox(ray: Ray, x: number, z: number, width: number, depth: number, height: number, yaw: number): number {
  const cosine = Math.cos(yaw), sine = Math.sin(yaw);
  const localX = (ray.x - x) * cosine - (ray.z - z) * sine;
  const localZ = (ray.x - x) * sine + (ray.z - z) * cosine;
  const dirX = ray.dx * cosine - ray.dz * sine, dirZ = ray.dx * sine + ray.dz * cosine;
  let near = 0, far = Infinity;
  for (const [origin, direction, min, max] of [[localX, dirX, -width / 2, width / 2], [ray.y, ray.dy, 0, height], [localZ, dirZ, -depth / 2, depth / 2]]) {
    if (Math.abs(direction) < 1e-8) { if (origin < min || origin > max) return -1; }
    else {
      const t1 = (min - origin) / direction, t2 = (max - origin) / direction;
      near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
      if (near > far) return -1;
    }
  }
  return far >= 0 ? near : -1;
}
