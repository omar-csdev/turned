import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingKind, LootKind, WeaponId } from '@survive-the-night/game-shared/turned/protocol';

/** Original, deliberately simple toy-like models. All dimensions are in meters. */
export interface HumanoidModel {
  root: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

export interface VehicleModel { root: THREE.Group; wheels: THREE.Group[] }

type Material = THREE.MeshStandardMaterial;

function material(color: THREE.ColorRepresentation, options: THREE.MeshStandardMaterialParameters = {}): Material {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: .88, ...options });
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, surface: Material, x: number, y: number, z: number): THREE.Mesh {
  const part = new THREE.Mesh(geometry, surface);
  part.position.set(x, y, z);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function box(parent: THREE.Object3D, surface: Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(parent, new THREE.BoxGeometry(w, h, d), surface, x, y, z);
}

function pivot(parent: THREE.Object3D, name: string, x: number, y: number, z = 0): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

/** Merge only rigid siblings so wheel, limb, and effect pivots keep their animations. */
function batchRigid(root: THREE.Group): void {
  const batches = new Map<string, THREE.Mesh<THREE.BufferGeometry, Material>[]>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)
      || child.material.transparent || child.userData.blood || child.name) continue;
    const parts = batches.get(child.material.uuid) ?? [];
    parts.push(child);
    batches.set(child.material.uuid, parts);
  }
  for (const parts of batches.values()) {
    if (parts.length < 2) continue;
    const geometries = parts.map(part => {
      part.updateMatrix();
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      return geometry.applyMatrix4(part.matrix);
    });
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    mesh(root, merged, parts[0].material, 0, 0, 0);
    for (const part of parts) {
      root.remove(part);
      part.geometry.dispose();
    }
  }
}

function batchHumanoid(model: HumanoidModel): void {
  for (const group of [model.root, model.head, model.leftArm, model.rightArm, model.leftLeg, model.rightLeg]) batchRigid(group);
}

function humanoid(skin: Material, shirt: Material, trousers: Material, boots: Material): HumanoidModel {
  const root = new THREE.Group();
  const head = pivot(root, 'head', 0, 1.43);
  const leftArm = pivot(root, 'leftArm', -.405, 1.37);
  const rightArm = pivot(root, 'rightArm', .405, 1.37);
  const leftLeg = pivot(root, 'leftLeg', -.165, .8);
  const rightLeg = pivot(root, 'rightLeg', .165, .8);
  box(root, shirt, .61, .65, .34, 0, 1.115);
  box(head, skin, .42, .4, .4, 0, .215);
  for (const arm of [leftArm, rightArm]) {
    box(arm, shirt, .24, .35, .27, 0, -.145);
    box(arm, skin, .22, .3, .25, 0, -.455);
  }
  for (const leg of [leftLeg, rightLeg]) {
    box(leg, trousers, .265, .59, .3, 0, -.29);
    box(leg, boots, .28, .21, .39, 0, -.695, -.045);
  }
  return { root, head, leftArm, rightArm, leftLeg, rightLeg };
}

export function createSurvivor(color: string): HumanoidModel {
  const skin = material('#e8b78b');
  const clothing = material(color);
  const charcoal = material('#243d43');
  const straps = material('#ab8b52');
  const model = humanoid(skin, clothing, material('#405870'), material('#273034'));
  model.root.name = 'survivor';
  box(model.root, charcoal, .62, .075, .355, 0, .84);
  box(model.root, straps, .09, .64, .04, -.19, 1.15, -.19);
  box(model.root, straps, .09, .64, .04, .19, 1.15, -.19);
  box(model.root, material('#9e7948'), .48, .48, .22, 0, 1.12, .27);
  box(model.root, straps, .31, .22, .06, 0, 1.055, .4);
  box(model.root, material('#e5ca6e', { metalness: .3 }), .11, .07, .025, 0, .85, -.193);
  box(model.head, charcoal, .445, .105, .435, 0, .397, 0);
  box(model.head, charcoal, .44, .035, .2, 0, .36, -.23);
  for (const x of [-.094, .094]) box(model.head, charcoal, .052, .055, .014, x, .237, -.207);
  box(model.head, material('#aa7758'), .095, .035, .014, 0, .116, -.207);
  batchHumanoid(model);
  return model;
}

export function createZombie(kind: 'walker' | 'runner' | 'armored'): HumanoidModel {
  const skin = material(kind === 'runner' ? '#8aab64' : '#90a87b');
  const dark = material('#303a36');
  const clothing = material(kind === 'armored' ? '#485861' : kind === 'runner' ? '#bf7252' : '#6b798d');
  const model = humanoid(skin, clothing, material('#4d5558'), dark);
  model.root.name = `${kind}-infected`;
  const wound = material('#813b36');
  box(model.root, wound, .13, .19, .025, -.13, 1.19, -.18).userData.blood = true;
  box(model.root, wound, .075, .14, .025, .17, .93, -.18).userData.blood = true;
  box(model.head, wound, .065, .105, .016, -.14, .15, -.207).userData.blood = true;
  const eyes = material('#f5dc79', { emissive: '#e2bb45', emissiveIntensity: .3 });
  for (const x of [-.1, .1]) box(model.head, eyes, .072, .054, .017, x, .242, -.209);
  box(model.head, dark, .16, .055, .019, .018, .12, -.211);
  box(model.head, material('#d1caa5'), .07, .02, .022, -.004, .133, -.218);
  model.head.rotation.z = kind === 'runner' ? -.12 : .075;
  model.leftArm.rotation.x = .8;
  model.rightArm.rotation.x = .95;
  if (kind === 'armored') {
    box(model.root, dark, .66, .44, .12, 0, 1.14, -.21);
    box(model.root, material('#a0ac94'), .21, .13, .028, 0, 1.17, -.284);
    box(model.head, material('#596b59'), .49, .18, .46, 0, .395);
    box(model.head, dark, .53, .035, .49, 0, .32);
  } else {
    box(model.head, dark, .43, .095, .4, 0, .397, .025);
  }
  if (kind === 'runner') {
    box(model.root, material('#d3b183'), .12, .48, .023, .11, 1.11, -.185);
  }
  batchHumanoid(model);
  return model;
}

export function createWeapon(weapon: WeaponId, firstPerson = false): THREE.Group {
  const root = new THREE.Group();
  root.name = weapon;
  const metal = material('#34454b', { metalness: .52, roughness: .55 });
  const dark = material('#1f2c33', { metalness: .25 });
  const wood = material('#bc8351');
  const accent = material('#d6b95d');
  if (weapon === 'axe') {
    box(root, wood, .065, .76, .073, 0, .16);
    box(root, dark, .075, .21, .08, 0, -.14);
    box(root, metal, .3, .21, .075, -.085, .48);
    box(root, material('#c1d3d5', { metalness: .75 }), .07, .25, .082, -.26, .48).rotation.z = -.09;
    box(root, accent, .077, .03, .085, 0, .315);
  } else {
    const pistol = weapon === 'pistol';
    const shotgun = weapon === 'shotgun';
    box(root, dark, .1, .22, .13, 0, -.075, .025).rotation.x = -.17;
    box(root, metal, pistol ? .135 : .15, .145, pistol ? .31 : .44, 0, .09, pistol ? -.08 : -.18);
    box(root, dark, .07, .045, .045, 0, .178, -.07);
    const barrelLength = pistol ? .1 : shotgun ? .43 : .31;
    const muzzleZ = pistol ? -.3 : shotgun ? -.86 : -.77;
    const barrel = mesh(root, new THREE.CylinderGeometry(.029, .029, barrelLength, 8), metal, 0, .095, muzzleZ + barrelLength / 2);
    barrel.rotation.x = Math.PI / 2;
    box(root, dark, .07, .07, .04, 0, .095, muzzleZ + .004);
    box(root, accent, .07, .019, .026, 0, .154, muzzleZ + .05);
    if (pistol) {
      box(root, accent, .012, .04, .055, .073, .097, -.12);
    } else {
      box(root, shotgun ? wood : dark, .115, .16, .3, 0, .056, .19);
      box(root, dark, .14, .22, .06, 0, .02, .36);
      box(root, shotgun ? wood : material('#667c60'), .16, .14, .23, 0, .015, -.45);
      if (!shotgun) {
        box(root, dark, .11, .24, .15, 0, -.115, -.2).rotation.x = -.16;
        box(root, metal, .07, .045, .3, 0, .185, -.2);
      } else {
        const lowerBarrel = mesh(root, new THREE.CylinderGeometry(.026, .026, .4, 8), dark, 0, .031, -.59);
        lowerBarrel.rotation.x = Math.PI / 2;
      }
    }
    pivot(root, 'muzzle', 0, .095, muzzleZ - .025);
  }
  if (firstPerson) {
    const skin = material('#e8b78b');
    const sleeve = material('#4e807c');
    box(root, skin, .15, .145, .16, 0, -.09, .055);
    box(root, sleeve, .17, .18, .35, .055, -.19, .225).rotation.x = -.28;
    if (weapon === 'rifle' || weapon === 'shotgun') {
      box(root, skin, .175, .12, .15, -.01, -.076, -.43);
      const forearm = box(root, sleeve, .16, .15, .41, -.19, -.14, -.24);
      forearm.rotation.y = -.68;
      forearm.rotation.x = -.16;
    }
  }
  return root;
}

export function createVehicle(kind: 'jeep' | 'pickup', color: string): VehicleModel {
  const root = new THREE.Group();
  root.name = kind;
  const paint = material(color, { roughness: .6, metalness: .15 });
  const dark = material('#26343b');
  const trim = material('#b5c0b2', { metalness: .6, roughness: .5 });
  const rubber = material('#202c30');
  const seat = material('#74694b');
  const glass = material('#b7ebe4', { transparent: true, opacity: .3, depthWrite: false, roughness: .2, side: THREE.DoubleSide });
  const headlights = material('#fff1bc', { emissive: '#ffe5a0', emissiveIntensity: .65 });
  const rearLights = material('#d94c3d', { emissive: '#d94432', emissiveIntensity: .25 });
  const wheels: THREE.Group[] = [];
  box(root, dark, 1.63, .19, 3.8, 0, .53);
  box(root, paint, 1.76, .37, 3.72, 0, .79);
  box(root, paint, 1.7, .31, 1.05, 0, 1.095, -1.32);
  box(root, trim, 1.89, .15, .18, 0, .62, -1.99);
  box(root, trim, 1.89, .15, .18, 0, .62, 1.99);
  box(root, dark, .91, .26, .045, 0, 1.065, -1.876);
  for (let x = -.32; x <= .33; x += .16) box(root, trim, .045, .2, .052, x, 1.07, -1.907);
  for (const side of [-1, 1]) {
    box(root, headlights, .31, .19, .055, side * .65, 1.08, -1.88);
    box(root, rearLights, .19, .18, .045, side * .72, .9, 1.885);
    box(root, paint, .14, .37, 1.5, side * .87, 1.05, -.05);
    box(root, dark, .09, .07, .2, side * .956, 1.21, -.03);
    box(root, trim, .12, .08, .34, side * .995, 1.38, -.73);
    box(root, dark, .13, .19, .19, side * 1.055, 1.43, -.72);
    for (const z of [-1.24, 1.25]) {
      const wheel = pivot(root, 'wheel', side * .94, .44, z);
      const tire = mesh(wheel, new THREE.CylinderGeometry(.43, .43, .29, 10), rubber, 0, 0, 0);
      tire.rotation.z = Math.PI / 2;
      const rim = mesh(wheel, new THREE.CylinderGeometry(.215, .215, .306, 8), trim, 0, 0, 0);
      rim.rotation.z = Math.PI / 2;
      box(wheel, dark, .317, .08, .33);
      box(wheel, dark, .317, .33, .08);
      wheels.push(wheel);
      box(root, paint, .34, .11, 1.02, side * .875, .96, z);
    }
    box(root, seat, .6, .15, .55, side * .44, .99, -.32);
    box(root, seat, .6, .56, .14, side * .44, 1.24, -.055);
  }
  box(root, dark, 1.58, .23, .25, 0, 1.22, -.77);
  const steering = mesh(root, new THREE.TorusGeometry(.19, .035, 4, 8), dark, -.46, 1.36, -.53);
  steering.rotation.x = -.47;
  box(root, dark, .055, .05, .17, -.46, 1.35, -.65);
  for (const side of [-1, 1]) box(root, paint, .085, .69, .085, side * .805, 1.555, -.79).rotation.x = -.12;
  box(root, glass, 1.51, .57, .028, 0, 1.57, -.813).rotation.x = -.12;
  box(root, paint, 1.72, .085, .09, 0, 1.9, -.84);
  if (kind === 'pickup') {
    box(root, paint, 1.76, .1, 1.47, 0, 1.94, -.13);
    box(root, paint, 1.74, .5, .12, 0, 1.22, .58);
    box(root, glass, 1.5, .46, .028, 0, 1.66, .581);
    for (const side of [-1, 1]) {
      box(root, paint, .1, .63, .1, side * .815, 1.62, .57);
      box(root, glass, .028, .43, 1.13, side * .818, 1.61, -.105);
      box(root, paint, .145, .43, 1.27, side * .825, 1.105, 1.25);
    }
    box(root, dark, 1.48, .06, 1.23, 0, .995, 1.23);
    box(root, paint, 1.74, .44, .12, 0, 1.1, 1.83);
    box(root, trim, .25, .055, .02, 0, 1.21, 1.895);
  } else {
    for (const side of [-1, 1]) {
      box(root, dark, .08, .82, .085, side * .79, 1.5, .65);
      box(root, dark, .08, .08, 1.47, side * .79, 1.88, -.035);
      box(root, seat, .61, .16, .65, side * .4, 1.02, 1.18);
      box(root, seat, .61, .53, .14, side * .4, 1.27, 1.48);
    }
    box(root, dark, 1.65, .08, .08, 0, 1.9, .65);
    box(root, paint, 1.7, .3, .12, 0, 1.01, 1.84);
    const spare = mesh(root, new THREE.CylinderGeometry(.35, .35, .22, 10), rubber, 0, 1.23, 1.98);
    spare.rotation.x = Math.PI / 2;
    const spareRim = mesh(root, new THREE.CylinderGeometry(.17, .17, .23, 8), trim, 0, 1.23, 1.985);
    spareRim.rotation.x = Math.PI / 2;
  }
  batchRigid(root);
  for (const wheel of wheels) batchRigid(wheel);
  return { root, wheels };
}

export function createLoot(kind: LootKind): THREE.Group {
  const root = new THREE.Group();
  root.name = `${kind}-pickup`;
  const white = material('#f3e8cc');
  const dark = material('#415257');
  if (kind === 'supply') {
    const crate = material('#d49c3f');
    box(root, crate, .9, .67, .7, 0, .34);
    box(root, material('#efbf59'), .95, .1, .75, 0, .715);
    for (const x of [-.29, .29]) {
      box(root, dark, .09, .71, .715, x, .355);
      box(root, dark, .09, .035, .76, x, .777);
    }
    box(root, white, .32, .22, .015, 0, .41, -.36);
    box(root, crate, .085, .15, .018, 0, .415, -.374);
  } else if (kind === 'medkit') {
    box(root, material('#e26655'), .46, .33, .2, 0, .195);
    box(root, dark, .22, .06, .1, 0, .405);
    box(root, white, .085, .23, .021, 0, .21, -.11);
    box(root, white, .235, .075, .025, 0, .21, -.112);
  } else if (kind === 'fuel') {
    const red = material('#c8563e');
    box(root, red, .34, .44, .21, 0, .24);
    box(root, red, .26, .055, .11, 0, .51);
    for (const x of [-.1, .1]) box(root, red, .055, .1, .11, x, .465);
    box(root, dark, .075, .07, .075, .13, .488);
    box(root, material('#f4be6e'), .18, .16, .014, 0, .245, -.113);
  } else if (kind === 'water') {
    const blue = material('#59c2d4', { roughness: .4 });
    box(root, blue, .19, .32, .19, 0, .21);
    box(root, white, .12, .065, .12, 0, .403);
    box(root, white, .2, .09, .2, 0, .195);
  } else if (kind === 'food') {
    const can = mesh(root, new THREE.CylinderGeometry(.145, .145, .3, 8), material('#d3ac69'), 0, .185, 0);
    box(root, material('#8cba65'), .22, .13, .06, 0, .2, -.125);
    mesh(root, new THREE.CylinderGeometry(.148, .148, .025, 8), white, 0, .345, 0);
    can.name = 'food-tin';
  } else if (kind === 'ammo') {
    box(root, material('#71894f'), .42, .26, .27, 0, .15);
    box(root, dark, .44, .055, .29, 0, .309);
    const brass = material('#eac879', { metalness: .4 });
    for (const x of [-.105, 0, .105]) box(root, brass, .035, .13, .025, x, .16, -.149);
  } else if (kind === 'scrap') {
    const metal = material('#8caaaf', { metalness: .65 });
    box(root, metal, .45, .09, .3, 0, .095).rotation.y = .28;
    box(root, dark, .12, .12, .42, .04, .2, 0).rotation.y = -.4;
    box(root, metal, .28, .05, .19, -.035, .28, 0).rotation.z = .12;
  } else {
    box(root, material('#d8c3a1'), .4, .16, .29, 0, .12);
    box(root, white, .38, .085, .28, .02, .24);
    box(root, dark, .07, .28, .3, -.06, .17);
  }
  batchRigid(root);
  return root;
}

export function createStructure(kind: BuildingKind): THREE.Group {
  const root = new THREE.Group();
  root.name = kind;
  const wood = material('#a77b4b');
  const lightWood = material('#c3995e');
  const dark = material('#4f5147');
  if (kind === 'barricade') {
    for (const x of [-1.17, 1.17]) {
      box(root, wood, .18, 1.6, .2, x, .8);
      box(root, dark, .4, .1, .9, x, .05);
      box(root, lightWood, .12, .94, .13, x, .44, .31).rotation.x = .65;
    }
    for (const y of [.47, .95, 1.38]) {
      const plank = box(root, lightWood, 3, .3, .16, 0, y, -.14);
      plank.rotation.z = y === .95 ? -.05 : .025;
      for (const x of [-1.17, 1.17]) box(root, dark, .065, .065, .035, x, y, -.24);
    }
    box(root, wood, 2.56, .13, .11, 0, .88, .08).rotation.z = .39;
  } else if (kind === 'workbench') {
    for (const x of [-.73, .73]) for (const z of [-.32, .32]) box(root, wood, .12, .93, .12, x, .465, z);
    box(root, lightWood, 1.8, .16, .92, 0, 1.01);
    box(root, wood, 1.56, .09, .65, 0, .28);
    box(root, wood, 1.79, .12, .1, 0, .74, .38);
    box(root, material('#598081', { metalness: .4 }), .33, .14, .24, -.5, 1.16, -.19);
    box(root, dark, .08, .28, .31, -.49, 1.24, -.19);
    box(root, lightWood, .085, .065, .38, .41, 1.13, -.11).rotation.y = -.4;
    box(root, material('#9faeac', { metalness: .7 }), .29, .095, .1, .48, 1.15, -.25).rotation.y = -.4;
    box(root, material('#d9cf9a'), .38, .025, .28, .03, 1.108, .09).rotation.y = .18;
  } else {
    const rock = material('#868c83');
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      const stone = mesh(root, new THREE.DodecahedronGeometry(.19, 0), rock, Math.sin(angle) * .53, .12, Math.cos(angle) * .53);
      stone.scale.set(1.2, .7, 1);
      stone.rotation.y = angle;
    }
    for (const angle of [Math.PI / 4, -Math.PI / 4]) box(root, wood, .18, .16, .9, 0, .14).rotation.y = angle;
    const flame = material('#f4a93d', { emissive: '#ed741a', emissiveIntensity: .9 });
    const inner = material('#ffdf77', { emissive: '#ffd357', emissiveIntensity: 1 });
    const fire = pivot(root, 'flame', 0, .2);
    mesh(fire, new THREE.ConeGeometry(.31, .66, 5), flame, 0, .32, 0);
    mesh(fire, new THREE.ConeGeometry(.18, .45, 4), inner, -.02, .2, -.15);
    mesh(fire, new THREE.ConeGeometry(.17, .48, 4), flame, .2, .2, .09).rotation.z = -.25;
    batchRigid(fire);
  }
  batchRigid(root);
  return root;
}
