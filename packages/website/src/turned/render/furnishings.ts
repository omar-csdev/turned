import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface FurnishingSpec {
  kind: 'bed' | 'table' | 'chair' | 'sofa' | 'shelf' | 'counter' | 'crate' | 'barrel' | 'locker' | 'bench' | 'medical' | 'cabinet';
  width: number;
  depth: number;
  height: number;
}

/** Grounded original furniture with an exact collision-sized footprint; its front faces -Z. */
export function createFurnishing(prop: FurnishingSpec): THREE.Group {
  if (![prop.width, prop.height, prop.depth].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Furnishing dimensions must be finite and greater than zero.');
  }
  const root = new THREE.Group();
  root.name = `furnishing-${prop.kind}`;
  const surfaces = new Map<string, THREE.MeshStandardMaterial>();
  const palette = {
    timber: '#a5754d', oak: '#c59862', endgrain: '#e2b984', dark: '#3e5154', metal: '#91a49e',
    cream: '#f0e4c6', linen: '#d6ccb6', teal: '#588b83', tealLight: '#70a297', blue: '#667e95',
    red: '#c85a4b', orange: '#d9a653', olive: '#84946a', oliveDark: '#53634e',
  };
  const surface = (color: string): THREE.MeshStandardMaterial => {
    let result = surfaces.get(color);
    if (!result) {
      result = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: .86 });
      surfaces.set(color, result);
    }
    return result;
  };
  const part = (geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number): THREE.Mesh => {
    const object = new THREE.Mesh(geometry, surface(color));
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    root.add(object);
    return object;
  };
  const box = (color: string, width: number, height: number, depth: number, x: number, y: number, z: number): THREE.Mesh =>
    part(new THREE.BoxGeometry(width, height, depth), color, x, y, z);
  const cylinder = (color: string, radius: number, height: number, x: number, y: number, z: number): THREE.Mesh =>
    part(new THREE.CylinderGeometry(radius, radius, height, 8), color, x, y, z);
  const legs = (color: string, width: number, height: number, depth: number, x: number, z: number): void => {
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) box(color, width, height, depth, sideX * x, height / 2, sideZ * z);
  };

  switch (prop.kind) {
    case 'bed': {
      legs(palette.timber, .11, .3, .095, .395, .41);
      box(palette.timber, 1, .17, 1, 0, .3, 0);
      box(palette.linen, .94, .2, .87, 0, .485, -.015);
      box(palette.teal, .95, .14, .59, 0, .575, -.17);
      box(palette.tealLight, .952, .028, .105, 0, .657, .065);
      box(palette.cream, .61, .11, .22, 0, .641, .275);
      box(palette.timber, 1, .68, .075, 0, .66, .4625);
      box(palette.oak, .84, .1, .025, 0, .87, .4125);
      box(palette.timber, 1, .25, .075, 0, .48, -.4625);
      break;
    }
    case 'table': {
      legs(palette.timber, .105, .89, .105, .37, .35);
      box(palette.timber, .86, .15, .74, 0, .81, 0);
      box(palette.oak, 1, .09, 1, 0, .945, 0);
      // Recessed joins make a plank tabletop without protruding past its collision box.
      for (const x of [-.375, -.125, .125, .375]) box(palette.endgrain, .245, .01, 1, x, .995, 0);
      break;
    }
    case 'chair': {
      legs(palette.timber, .095, .51, .095, .38, .385);
      box(palette.oak, 1, .105, 1, 0, .53, 0);
      box(palette.teal, .85, .035, .8, 0, .6, -.045);
      for (const x of [-.425, .425]) box(palette.timber, .15, .52, .1, x, .74, .45);
      box(palette.oak, 1, .16, .1, 0, .92, .45);
      box(palette.oak, .75, .12, .075, 0, .715, .4525);
      break;
    }
    case 'sofa': {
      legs(palette.timber, .075, .13, .08, .39, .37);
      box(palette.teal, 1, .32, 1, 0, .28, 0);
      box(palette.teal, 1, .67, .23, 0, .665, .385);
      for (const x of [-.43, .43]) box(palette.teal, .14, .51, .89, x, .52, -.055);
      for (const x of [-.187, .187]) {
        box(palette.tealLight, .353, .16, .71, x, .505, -.12);
        box(palette.tealLight, .353, .38, .135, x, .769, .24);
      }
      box(palette.orange, .2, .26, .13, -.22, .715, .137);
      break;
    }
    case 'shelf': {
      box(palette.timber, 1, 1, .065, 0, .5, .4675);
      for (const x of [-.46, .46]) box(palette.timber, .08, 1, 1, x, .5, 0);
      for (const y of [.035, .34, .66, .965]) box(palette.oak, 1, .07, 1, 0, y, 0);
      const bookColors = [palette.red, palette.blue, palette.olive, palette.orange];
      for (let i = 0; i < 4; i++) {
        const bookHeight = .18 + (i % 2) * .035;
        box(bookColors[i], .105, bookHeight, .58, -.31 + i * .119, .375 + bookHeight / 2, -.08);
        box(palette.cream, .07, .012, .009, -.31 + i * .119, .425, -.376);
      }
      box(palette.linen, .29, .15, .63, -.22, .145, -.07);
      box(palette.cream, .27, .045, .61, -.22, .2425, -.07);
      cylinder(palette.olive, .085, .21, .22, .175, -.085);
      cylinder(palette.orange, .09, .14, -.23, .765, -.07);
      box(palette.blue, .27, .11, .61, .19, .75, -.025);
      break;
    }
    case 'counter': {
      box(palette.dark, .94, .09, .91, 0, .045, 0);
      box(palette.teal, .97, .78, .94, 0, .47, 0);
      box(palette.cream, 1, .13, 1, 0, .935, 0);
      for (const x of [-.24, .24]) {
        box(palette.tealLight, .455, .57, .025, x, .44, -.474);
        box(palette.dark, .028, .13, .018, x + (x < 0 ? .145 : -.145), .53, -.49);
      }
      box(palette.oak, .965, .035, .025, 0, .8025, -.474);
      break;
    }
    case 'crate': {
      box(palette.timber, .96, .96, .96, 0, .5, 0);
      for (const x of [-.35, -.175, 0, .175, .35]) {
        for (const z of [-.488, .488]) box(palette.oak, .165, .91, .024, x, .5, z);
      }
      for (const x of [-.488, .488]) box(palette.oak, .024, .91, .96, x, .5, 0);
      for (const y of [.035, .965]) box(palette.endgrain, 1, .07, 1, 0, y, 0);
      for (const x of [-.31, .31]) {
        box(palette.dark, .06, .04, 1, x, .98, 0);
        for (const z of [-.492, .492]) box(palette.dark, .06, .91, .016, x, .5, z);
      }
      box(palette.cream, .25, .18, .012, 0, .5, -.494);
      box(palette.timber, .04, .1, .008, 0, .5, -.496);
      break;
    }
    case 'barrel': {
      cylinder(palette.blue, .477, .93, 0, .5, 0);
      cylinder(palette.dark, .5, .055, 0, .0275, 0);
      part(new THREE.CylinderGeometry(.5, .5, .055, 8, 1, true), palette.dark, 0, .9725, 0);
      part(new THREE.RingGeometry(.463, .5, 8), palette.dark, 0, 1, 0).rotation.x = -Math.PI / 2;
      for (const y of [.25, .75]) cylinder(palette.dark, .493, .045, 0, y, 0);
      cylinder(palette.metal, .463, .024, 0, .98, 0);
      cylinder(palette.dark, .075, .018, .17, .991, -.08);
      box(palette.orange, .29, .21, .025, 0, .5, -.47);
      break;
    }
    case 'locker': {
      box(palette.dark, 1, 1, .94, 0, .5, .03);
      for (const x of [-.247, .247]) {
        box(palette.olive, .469, .947, .04, x, .499, -.475);
        for (const y of [.77, .81, .85]) box(palette.dark, .285, .012, .012, x, y, -.494);
        box(palette.metal, .048, .02, .014, x, .687, -.493);
        box(palette.dark, .04, .09, .016, x - .14, .49, -.492);
        box(palette.metal, .016, .07, .01, x - .14, .49, -.495);
      }
      break;
    }
    case 'bench': {
      for (const x of [-.36, .36]) {
        box(palette.dark, .1, .49, .68, x, .245, -.06);
        box(palette.dark, .1, .86, .11, x, .57, .39);
      }
      for (const z of [-.38, -.065, .25]) box(palette.oak, 1, .08, .24, 0, .49, z);
      for (const y of [.72, .94]) box(palette.oak, 1, .12, .1, 0, y, .45);
      break;
    }
    case 'medical': {
      legs(palette.metal, .07, .67, .07, .425, .425);
      box(palette.dark, .97, .09, .95, 0, .53, 0);
      box(palette.linen, .91, .15, .91, 0, .64, 0);
      box(palette.cream, .53, .1, .2, 0, .765, .26);
      box(palette.olive, .91, .025, .56, 0, .7275, -.16);
      box(palette.cream, .36, .009, .29, 0, .7445, -.12);
      box(palette.red, .065, .008, .19, 0, .753, -.12);
      box(palette.red, .23, .008, .055, 0, .753, -.12);
      for (const z of [-.465, .465]) {
        for (const x of [-.465, .465]) box(palette.metal, .07, .43, .07, x, .785, z);
        box(palette.metal, 1, .045, .07, 0, .9775, z);
      }
      break;
    }
    case 'cabinet': {
      box(palette.timber, .94, .13, .93, 0, .065, 0);
      box(palette.timber, 1, .83, .96, 0, .55, .01);
      box(palette.endgrain, 1, .07, 1, 0, .965, 0);
      for (const x of [-.243, .243]) {
        box(palette.oak, .465, .735, .033, x, .5475, -.475);
        box(palette.timber, .335, .49, .005, x, .535, -.494);
        box(palette.endgrain, .302, .456, .006, x, .535, -.497);
        box(palette.dark, .034, .105, .012, x + (x < 0 ? .15 : -.15), .55, -.494);
      }
      break;
    }
  }

  // Keep per-model ownership while reducing a furnishing to one draw per material.
  // Bake dimensions into the vertices so the returned group's transform is free for world placement.
  const dimensions = new THREE.Vector3(prop.width, prop.height, prop.depth);
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const children = batches.get(child.material) ?? [];
    children.push(child);
    batches.set(child.material, children);
  }
  for (const [material, children] of batches) {
    const geometries = children.map(child => {
      child.updateMatrix();
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      geometry.scale(dimensions.x, dimensions.y, dimensions.z);
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`Could not batch furnishing ${prop.kind}.`);
    const merged = new THREE.Mesh(geometry, material);
    merged.castShadow = true;
    merged.receiveShadow = true;
    for (const child of children) {
      root.remove(child);
      child.geometry.dispose();
    }
    for (const temporary of geometries) temporary.dispose();
    root.add(merged);
  }
  return root;
}
