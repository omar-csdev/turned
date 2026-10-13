import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ISLAND_BUILDINGS } from '@survive-the-night/game-shared/turned/island';
import { createIsland, type IslandScene } from './world';

describe('Pinefall building visuals', () => {
  let island: IslandScene;
  beforeAll(() => {
    // World construction needs labels, but collision geometry needs no GPU or browser.
    vi.stubGlobal('document', { createElement: () => ({ width: 512, height: 128, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }) }) });
    island = createIsland();
    island.root.updateMatrixWorld(true);
  });
  afterAll(() => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    island.root.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); });
    vi.unstubAllGlobals();
  });

  it('leaves the complete entrance passage visibly open for every enterable building', () => {
    for (const building of ISLAND_BUILDINGS.filter(b => b.enterable !== false)) {
      const width = building.kind === 'barn' ? 4.8 : building.kind === 'hangar' ? 6 : 2.8;
      for (const offset of [0, -width / 2 + .5, width / 2 - .5]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(building.x + offset, 1.62, building.z + building.depth / 2 + .55), new THREE.Vector3(0, 0, -1), 0, 1.05);
        expect(ray.intersectObject(island.root, true), `${building.id} entrance at x=${offset}`).toHaveLength(0);
      }
    }
  });

  it('shows actual open side windows instead of an opaque wall or glass plane', () => {
    for (const building of ISLAND_BUILDINGS.filter(b => b.enterable !== false)) {
      for (const side of [-1, 1]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(building.x + side * (building.width / 2 + .55), 1.8, building.z), new THREE.Vector3(-side, 0, 0), 0, .85);
        expect(ray.intersectObject(island.root, true), `${building.id} window side ${side}`).toHaveLength(0);
      }
    }
  });

  it('hides only the occupied building roof and restores every roof for the island preview', () => {
    const building = ISLAND_BUILDINGS.find(b => b.enterable !== false)!;
    island.setInteriorView(building.x, building.z);
    for (const candidate of ISLAND_BUILDINGS) expect(island.root.getObjectByName(`roof:${candidate.id}`)?.visible).toBe(candidate.id !== building.id);
    island.setInteriorView();
    for (const candidate of ISLAND_BUILDINGS) expect(island.root.getObjectByName(`roof:${candidate.id}`)?.visible).toBe(true);
  });
});
