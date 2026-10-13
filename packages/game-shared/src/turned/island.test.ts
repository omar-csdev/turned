import { describe, expect, it } from 'vitest';
import { BUILDING_WALLS, INTERIOR_PROPS, ISLAND_BUILDINGS, LOCATIONS, LOOT_SPAWNS, RADIO, RESOURCE_NODES, ROADS, SPAWN, VEHICLE_SPAWNS, ZOMBIE_SPAWNS, buildingDoorWidth, buildingEntrance, hasStaticLineOfSight, isBlocked, isInsideBuilding, isOnIsland } from './island';

const walkBlocked = (x: number, z: number, radius = .4) => isBlocked(x, z, radius) || RESOURCE_NODES.some(n => Math.hypot(x - n.x, z - n.z) < radius + (n.kind === 'tree' ? .35 : n.kind === 'rock' ? .75 : .6));

/** One-meter flood fill includes full body radius and resource collisions, as gameplay does. */
function reachableGround() {
  const visited = new Set<string>();
  const key = (x: number, z: number) => x + ',' + z;
  const queue = [{ x: SPAWN.x, z: SPAWN.z }];
  visited.add(key(SPAWN.x, SPAWN.z));
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx, z = p.z + dz;
      if (visited.has(key(x, z)) || walkBlocked(x, z) || walkBlocked(p.x + dx * .5, p.z + dz * .5)) continue;
      visited.add(key(x, z)); queue.push({ x, z });
    }
  }
  return { visited, queue };
}

describe('Pinefall Island playability', () => {
  it('keeps spawn, mission crates, vehicles, radio and infected on clear land', () => {
    for (const point of [SPAWN, RADIO, ...LOOT_SPAWNS.filter(l => !l.y), ...VEHICLE_SPAWNS, ...ZOMBIE_SPAWNS]) {
      expect(isOnIsland(point.x, point.z, 1), JSON.stringify(point)).toBe(true);
      expect(isBlocked(point.x, point.z, .4), JSON.stringify(point)).toBe(false);
    }
    expect(LOOT_SPAWNS.filter(item => item.kind === 'supply')).toHaveLength(3);
  });

  it('offers stone, salvage and finite wood near camp without growing trees inside rooms or entrances', () => {
    for (const resource of ['stone', 'scrap', 'wood']) {
      expect(RESOURCE_NODES.some(node => node.resource === resource && Math.hypot(node.x - SPAWN.x, node.z - SPAWN.z) < 35), resource).toBe(true);
    }
    expect(new Set(RESOURCE_NODES.map(node => node.id)).size).toBe(RESOURCE_NODES.length);
    for (const node of RESOURCE_NODES) expect(ISLAND_BUILDINGS.some(b => isInsideBuilding(node.x, node.z, b, .5)), node.id).toBe(false);
  });

  it('fills distinct settlements, farmland, military and airfield buildings with themed furniture and interior loot', () => {
    expect(LOCATIONS.filter(l => l.kind === 'town')).toHaveLength(3);
    expect(ISLAND_BUILDINGS.length).toBeGreaterThanOrEqual(28);
    for (const building of ISLAND_BUILDINGS.filter(b => b.enterable !== false)) {
      expect(INTERIOR_PROPS.filter(p => p.buildingId === building.id).length, building.id).toBeGreaterThanOrEqual(4);
      const loot = LOOT_SPAWNS.filter(l => l.buildingId === building.id);
      expect(loot.length, building.id).toBeGreaterThanOrEqual(3);
      for (const item of loot) expect(isInsideBuilding(item.x, item.z, building), item.id).toBe(true);
    }
    expect(new Set(INTERIOR_PROPS.map(p => p.kind)).size).toBeGreaterThanOrEqual(11);
  });

  it('shares genuine door/window apertures and solid walls between server and renderer', () => {
    expect(isOnIsland(170, 170)).toBe(false);
    for (const building of ISLAND_BUILDINGS.filter(b => b.enterable !== false)) {
      const front = buildingEntrance(building, 0);
      expect(isBlocked(front.x, front.z, .45), building.id + ' doorway').toBe(false);
      expect(buildingDoorWidth(building)).toBeGreaterThanOrEqual(2.8);
      expect(isBlocked(building.x, building.z - building.depth / 2, .4), building.id + ' back wall').toBe(true);
      expect(BUILDING_WALLS.some(w => w.buildingId === building.id && w.y === 2.55), building.id + ' window header').toBe(true);
      expect(walkBlocked(front.x, front.z + 2, .45), building.id + ' approach').toBe(false);
    }
  });

  it('connects every building entrance, interior loot and objective to survivor camp', () => {
    const { visited, queue } = reachableGround();
    expect(visited.size).toBeGreaterThan(40_000);
    for (const building of ISLAND_BUILDINGS.filter(b => b.enterable !== false)) {
      const inside = buildingEntrance(building, -1.4);
      expect(queue.some(p => Math.hypot(p.x - inside.x, p.z - inside.z) < 1), building.id + ' interior access').toBe(true);
    }
    const targets: { id?: string; x: number; z: number; y?: number }[] = [...LOOT_SPAWNS, RADIO, ...VEHICLE_SPAWNS];
    for (const target of targets) {
      // Raised pickups sit on supporting furniture; survivors reach them from a neighboring aisle.
      expect(queue.some(p => Math.hypot(p.x - target.x, p.z - target.z) < (target.y ? 2.8 : 1.1) && hasStaticLineOfSight(
        { ...p, y: 1.62 }, { ...target, y: (target.y ?? 0) + .3 },
      )), target.id ?? 'radio').toBe(true);
    }
  }, 20_000);

  it('keeps broad road centerlines traversable for cars', () => {
    for (const road of ROADS) {
      const vertical = road.depth > road.width;
      const length = Math.max(road.width, road.depth);
      for (let along = -length / 2 + 3; along < length / 2 - 3; along += 1) {
        const x = road.x + (vertical ? 0 : along), z = road.z + (vertical ? along : 0);
        for (const side of [-1.2, 0, 1.2]) expect(walkBlocked(x + (vertical ? side : 0), z + (vertical ? 0 : side), .25), JSON.stringify({ x, z })).toBe(false);
      }
    }
    for (const car of VEHICLE_SPAWNS) for (const x of [-.95, 0, .95]) for (const z of [-1.8, 0, 1.8]) {
      expect(walkBlocked(car.x + x * Math.cos(car.yaw) + z * Math.sin(car.yaw), car.z - x * Math.sin(car.yaw) + z * Math.cos(car.yaw), .25), car.id + ' wheel clearance').toBe(false);
    }
  });
});
