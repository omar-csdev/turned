import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createFurnishing, type FurnishingSpec } from './furnishings';

const kinds: FurnishingSpec['kind'][] = ['bed', 'table', 'chair', 'sofa', 'shelf', 'counter', 'crate', 'barrel', 'locker', 'bench', 'medical', 'cabinet'];

describe('furniture collision agreement', () => {
  it.each(kinds)('%s stays grounded inside its exact authoritative footprint at different sizes', kind => {
    for (const dimensions of [[.8, 2.3, 1.4], [2.2, 2.1, .65], [.55, .55, .95]]) {
      const [width, depth, height] = dimensions;
      const model = createFurnishing({ kind, width, depth, height });
      const bounds = new THREE.Box3().setFromObject(model, true), size = bounds.getSize(new THREE.Vector3());
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(bounds.min.x).toBeCloseTo(-width / 2, 5);
      expect(bounds.min.z).toBeCloseTo(-depth / 2, 5);
      expect(size.x).toBeCloseTo(width, 5);
      expect(size.y).toBeCloseTo(height, 5);
      expect(size.z).toBeCloseTo(depth, 5);
      const materials = new Set<THREE.Material>();
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        expect([...object.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      materials.forEach(material => material.dispose());
    }
  });
});
