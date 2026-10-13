import { describe, expect, it } from 'vitest';
import { ISLAND_BUILDINGS, LOOT_SPAWNS, RADIO, RESOURCE_NODES, SPAWN, VEHICLE_SPAWNS, ZOMBIE_SPAWNS, isBlocked, isOnIsland } from './island';

describe('Pinefall Island playability', () => {
  it('keeps spawn, mission crates, vehicles, radio and infected out of solid buildings and water', () => {
    for (const point of [SPAWN, RADIO, ...LOOT_SPAWNS, ...VEHICLE_SPAWNS, ...ZOMBIE_SPAWNS]) {
      expect(isOnIsland(point.x, point.z, 1), JSON.stringify(point)).toBe(true);
      expect(isBlocked(point.x, point.z, .4), JSON.stringify(point)).toBe(false);
    }
    expect(LOOT_SPAWNS.filter(item => item.kind === 'supply')).toHaveLength(3);
  });

  it('offers stone and salvage near camp and finite wood resources around the island', () => {
    for (const resource of ['stone', 'scrap', 'wood']) {
      expect(RESOURCE_NODES.some(node => node.resource === resource && Math.hypot(node.x - SPAWN.x, node.z - SPAWN.z) < 35), resource).toBe(true);
    }
    expect(new Set(RESOURCE_NODES.map(node => node.id)).size).toBe(RESOURCE_NODES.length);
  });

  it('defines land and solid building boundaries for both server and renderer', () => {
    expect(isOnIsland(170, 170)).toBe(false);
    for (const building of ISLAND_BUILDINGS) {
      expect(isBlocked(building.x, building.z)).toBe(true);
    }
  });
});
