import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLAND_BUILDINGS, LOCATIONS, RADIO, RESOURCE_NODES, ROADS, TREES, isOnIsland } from '@survive-the-night/game-shared/turned/island';

/** A small original island, assembled from low-poly geometry and batched by material. */
export interface IslandScene {
  root: THREE.Group;
  water: THREE.Mesh;
  clouds: THREE.Group;
  setNodeActive(id: string, active: boolean): void;
}

export function createIsland(): IslandScene {
  const root = new THREE.Group();
  const scenery = new THREE.Group();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const material = (color: string, emissive = false) => {
    const key = color + emissive;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .92, flatShading: true, ...(emissive ? { emissive: color, emissiveIntensity: .18 } : {}) }));
    return materials.get(key)!;
  };
  const box = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string, angle = 0) => {
    const mesh = new THREE.Mesh(boxGeometry, material(color));
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.rotation.y = angle;
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const cylinder = (parent: THREE.Object3D, x: number, y: number, z: number, radius: number, height: number, color: string, top = radius, sides = 8) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, height, sides), material(color));
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const sign = (parent: THREE.Object3D, text: string, x: number, y: number, z: number, w: number, h: number, bg = '#314e45') => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#dce4cd'; ctx.lineWidth = 5; ctx.strokeRect(9, 9, 494, 110);
    ctx.fillStyle = '#f6f3d9'; ctx.font = 'bold 35px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 65, 474);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
    mesh.position.set(x, y, z); parent.add(mesh);
  };

  // Use precisely the same shoreline equation as authoritative movement.
  const shore: THREE.Vector2[] = [];
  for (let i = 0; i < 128; i++) {
    const angle = i / 128 * Math.PI * 2;
    let low = 100, high = 180;
    for (let step = 0; step < 14; step++) {
      const r = (low + high) / 2;
      if (isOnIsland(Math.cos(angle) * r, Math.sin(angle) * r)) low = r; else high = r;
    }
    shore.push(new THREE.Vector2(Math.cos(angle) * low, Math.sin(angle) * low));
  }
  const terrain = (scale: number, y: number, color: string) => {
    const shape = new THREE.Shape(shore.map(p => new THREE.Vector2(p.x * scale, -p.y * scale)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(color));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.receiveShadow = true; scenery.add(mesh);
  };
  terrain(1.02, -.36, '#78c3b7');
  terrain(1, -.09, '#e4ce94');
  terrain(.957, 0, '#8fae55');
  terrain(.925, .003, '#93ad55');
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#4aafc1', roughness: .35, metalness: .12 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -.5; water.receiveShadow = true; root.add(water);
  // Shallow, stepped water rings give the coastline a readable turquoise edge.
  const foamPositions: number[] = [];
  for (let i = 0; i < shore.length; i++) {
    const p = shore[i], n = shore[(i + 1) % shore.length];
    if (i % 7 < 4) foamPositions.push(p.x * 1.024, -.35, p.y * 1.024, n.x * 1.024, -.35, n.y * 1.024);
  }
  const foamGeometry = new THREE.BufferGeometry(); foamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(foamPositions, 3));
  root.add(new THREE.LineSegments(foamGeometry, new THREE.LineBasicMaterial({ color: '#cbebe0', transparent: true, opacity: .7 })));

  for (const road of ROADS) {
    box(scenery, road.x, .011, road.z, road.width + 1, .018, road.depth, '#b6ad7e');
    box(scenery, road.x, .025, road.z, road.width, .024, road.depth, '#686e65');
    const vertical = road.depth > road.width, length = Math.max(road.width, road.depth);
    for (let i = -length / 2 + 4; i < length / 2; i += 10) {
      const x = road.x + (vertical ? 0 : i), z = road.z + (vertical ? i : 0);
      if ((vertical && Math.abs(z - 36) < 6) || (vertical && Math.abs(z + 66) < 6)) continue;
      box(scenery, x, .044, z, vertical ? .18 : 3.5, .008, vertical ? 3.5 : .18, '#dcd3aa');
    }
  }

  function roof(width: number, depth: number, height: number, color: string) {
    // Gabled prism; end faces remain genuinely flat, like hand-cut toy geometry.
    const w = width / 2, d = depth / 2;
    const points = [-w,0,-d, w,0,-d, 0,height,-d, -w,0,d, 0,height,d, w,0,d,
      -w,0,-d,0,height,-d,0,height,d, -w,0,-d,0,height,d,-w,0,d,
      w,0,-d,w,0,d,0,height,d, w,0,-d,0,height,d,0,height,-d];
    // Vertices above describe the inner prism; reverse each triangle for outside faces.
    for (let i = 0; i < points.length; i += 9) for (let j = 0; j < 3; j++) [points[i+3+j], points[i+6+j]] = [points[i+6+j], points[i+3+j]];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geo.computeVertexNormals(); geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(points.length / 3 * 2), 2));
    const mesh = new THREE.Mesh(geo, material(color)); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  }
  for (const building of ISLAND_BUILDINGS) {
    const g = new THREE.Group(); g.position.set(building.x, 0, building.z); scenery.add(g);
    const { width: w, depth: d, height: h } = building;
    box(g, 0, .18, 0, w + .2, .36, d + .2, '#8c8877');
    box(g, 0, h / 2, 0, w, h, d, building.color);
    box(g, 0, .65, 0, w + .1, .22, d + .1, '#e1d4b3');
    box(g, 0, h - .15, 0, w + .16, .3, d + .16, '#e7ddbd');
    const r = roof(w + .8, d + .8, building.kind === 'hangar' ? 1.6 : h * .36, building.roof); r.position.y = h; g.add(r);
    for (const x of [-w / 2 + .16, w / 2 - .16]) for (const z of [-d / 2 - .05, d / 2 + .05]) box(g, x, h / 2, z, .28, h, .18, '#ddd1b3');
    for (const side of [-1, 1]) {
      const z = side * (d / 2 + .022);
      const windowY = h > 6 ? 4.8 : 2.85;
      for (const x of [-w * .3, w * .3]) {
        box(g, x, windowY, z, 2.05, 1.7, .13, '#dedac3');
        box(g, x, windowY, z + side * .085, 1.7, 1.36, .03, '#497878');
        box(g, x, windowY, z + side * .11, .095, 1.5, .04, '#e1d9b9');
        box(g, x, windowY, z + side * .12, 1.8, .09, .04, '#e1d9b9');
        box(g, x, windowY - .88, z, 2.25, .15, .42, '#e0d6b6');
      }
    }
    const doorZ = d / 2 + .09;
    const doorWidth = building.kind === 'barn' ? 4.5 : building.kind === 'hangar' ? 5.5 : 1.7;
    box(g, 0, 1.55, doorZ, doorWidth + .24, 3.1, .2, '#e2d6b8');
    box(g, 0, 1.48, doorZ + .12, doorWidth, 2.9, .08, '#5c6b5d');
    if (building.kind === 'barn') {
      box(g, 0, 1.48, doorZ + .18, .16, 2.9, .05, '#e8dfc7');
      for (const side of [-1, 1]) {
        const plank = box(g, side * 1.1, 1.45, doorZ + .22, .14, 3.5, .06, '#e8dfc7'); plank.rotation.z = side * .63;
      }
    } else if (building.kind !== 'hangar') {
      const board = box(g, 0, 1.55, doorZ + .21, 1.9, .17, .12, '#9c794e'); board.rotation.z = .2;
      box(g, 0, 1, doorZ + .21, 1.9, .17, .12, '#9c794e');
    }
    if (building.kind === 'shop') {
      for (let i = 0; i < 10; i++) {
        const awning = box(g, (i - 4.5) * w / 10, 3.75, d / 2 + .9, w / 10, .12, 1.9, i % 2 ? '#efe6c6' : '#bc6e4d'); awning.rotation.x = .13;
      }
      sign(g, building.id === 'harbor-store' ? 'PINE & CO.  •  SUPPLIES' : 'PINEFALL AIR', 0, 4.65, d / 2 + .06, w * .75, .66);
    }
    if (building.kind === 'house') box(g, w * .28, h + 1.2, -d * .12, .8, 2.5, .85, '#a77858');
    if (building.kind === 'hangar') for (let i = -w/2+.8; i < w/2; i += 1.3) box(g, i, h*.52, -d/2-.025, .05, h*.85, .06, '#7b8878');
  }

  // Airfield and agricultural land are landmarks visible from every long sightline.
  box(scenery, 85, .015, -69, 14, .04, 67, '#697573');
  for (let z = -96; z < -40; z += 9) box(scenery, 85, .04, z, .55, .01, 4.4, '#e6e6d0');
  for (const z of [-98, -40]) for (let x = 81; x <= 89; x += 2) box(scenery, x, .04, z, .9, .01, 4, '#e6e6d0');
  box(scenery, 95, .35, -48, .1, .7, .1, '#e4dfc4');
  const sock = cylinder(scenery, 95, 3.2, -48, .27, 1.5, '#e99255', .42, 6); sock.rotation.z = 1.25;
  cylinder(scenery, 95, 1.5, -48, .08, 3, '#e4dfc4', .06);
  box(scenery, 90, .018, 52, 25, .02, 22, '#a58f54');
  for (let x = 80; x < 102; x += 2.3) {
    box(scenery, x, .045, 52, .55, .045, 20, '#867849');
    for (let z = 43; z < 62; z += 1.7) {
      box(scenery, x, .39, z, .08, .72, .08, '#aaa94b');
      const crop = cylinder(scenery, x, .88, z, .25, .47, '#dcc465', .12, 4); crop.rotation.z = .15;
    }
  }
  for (const [x, z] of [[69, 19], [70, 16], [73, 18]]) {
    const hay = cylinder(scenery, x, .9, z, .95, 1.8, '#d5bd6b', .95, 8); hay.rotation.z = Math.PI / 2;
  }
  // Harbor pier and moored skiff, out beyond the walkable sand.
  for (let i = 0; i < 21; i++) box(scenery, -111 - i * 1.15, .12, 38, 1.06, .23, 4.5, i % 2 ? '#927955' : '#a18a62');
  for (let x = -111; x > -136; x -= 5) for (const z of [36.2, 39.8]) cylinder(scenery, x, -.1, z, .16, 1.8, '#685b48');
  box(scenery, -125, .15, 43.1, 5.8, .75, 2.2, '#d6d8bf'); box(scenery, -125, .65, 43.1, 4.6, .35, 1.6, '#44696d');
  box(scenery, -124.8, .9, 43.1, 1.6, .3, 1.7, '#c19d62');
  cylinder(scenery, -126, 2.5, 43.1, .07, 4.5, '#f0e8ce');

  // Coastal light and the rescue antenna are original silhouettes for navigation.
  const lighthouse = new THREE.Group(); lighthouse.position.set(-110, 0, -66); scenery.add(lighthouse);
  cylinder(lighthouse, 0, 1, 0, 3, 2, '#d4c9a8', 2.8);
  for (let i = 0; i < 5; i++) cylinder(lighthouse, 0, 2 + i * 2.1, 0, 2.6 - i*.16, 2.1, i % 2 ? '#c76243' : '#e8e1c1', 2.44 - i*.16);
  cylinder(lighthouse, 0, 12.05, 0, 2.3, .35, '#4b635c');
  cylinder(lighthouse, 0, 13.1, 0, 1.7, 1.8, '#8cc3b4', 1.7);
  cylinder(lighthouse, 0, 14.45, 0, 2.2, 1.2, '#475e55', .05);
  for (let i = 0; i < 8; i++) { const a = i*Math.PI/4; cylinder(lighthouse, Math.cos(a)*1.75, 13.1, Math.sin(a)*1.75, .08, 1.9, '#495f57'); }
  const radio = new THREE.Group(); radio.position.set(RADIO.x, 0, RADIO.z); scenery.add(radio);
  box(radio, 0, .1, 0, 8, .2, 7, '#b1ac8c');
  for (const x of [-1.3, 1.3]) for (const z of [-1.3, 1.3]) cylinder(radio, x, 11, z, .13, 22, '#c5bfa7');
  for (let y = 2; y < 22; y += 3) {
    box(radio, 0, y, 0, 2.9, .16, 2.9, y % 2 ? '#bbc3ac' : '#c85e44');
    for (const z of [-1.3,1.3]) { const beam = box(radio, 0, y+1.45, z, .11, 4, .11, '#b8bda6'); beam.rotation.z = .72; }
  }
  cylinder(radio, 0, 23.5, 0, .12, 5, '#e1d3b6');
  const dish = new THREE.Mesh(new THREE.ConeGeometry(1.4, .55, 10), material('#e0ded0')); dish.position.set(1.7, 15, 0); dish.rotation.z = -.9; radio.add(dish);
  sign(radio, 'PINEFALL  •  RESCUE RADIO', 0, 1.8, 3.6, 5.5, .9);

  // Camp geometry stays away from player spawn and its resource / pickup positions.
  for (const x of [-8, 8]) {
    const tent = roof(5, 5, 2.6, x > 0 ? '#bb9860' : '#667951'); tent.position.set(x, .1, 103); scenery.add(tent);
    box(scenery, x, .07, 103, 5.3, .1, 5.3, '#b6a57a');
    box(scenery, x, .85, 105.52, 1, 1.65, .03, '#424d3c');
  }
  for (const l of LOCATIONS) {
    const g = new THREE.Group(); g.position.set(l.x + 5.5, 0, l.z + 8); scenery.add(g);
    cylinder(g, -1.7, 1.15, 0, .1, 2.3, '#776d50'); cylinder(g, 1.7, 1.15, 0, .1, 2.3, '#776d50');
    box(g, 0, 2, 0, 4.2, 1, .12, '#354f40'); sign(g, l.name, 0, 2, .075, 4.15, .95);
  }

  // Instance every harvestable tree; changing a resource node costs only a few matrix writes.
  const treeParts: { mesh: THREE.InstancedMesh; matrices: THREE.Matrix4[] }[] = [];
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const createTreePart = (geometry: THREE.BufferGeometry, color: string, part: 'trunk' | 'low' | 'mid' | 'top' | 'oak') => {
    const mesh = new THREE.InstancedMesh(geometry, material(color), TREES.length);
    const matrices: THREE.Matrix4[] = [];
    TREES.forEach((tree, i) => {
      const s = tree.scale, oak = tree.kind === 'oak';
      let sx = s, sy = s, sz = s, y = 0;
      if (part === 'trunk') { sx *= .45; sz *= .45; sy *= oak ? 3.6 : 4.8; y = sy / 2; }
      if (part === 'low') { sx *= 2.65; sz *= 2.65; sy *= 3.6; y = s * 3.4; }
      if (part === 'mid') { sx *= 2.05; sz *= 2.05; sy *= 3.2; y = s * 5.05; }
      if (part === 'top') { sx *= 1.35; sz *= 1.35; sy *= 2.9; y = s * 6.5; }
      if (part === 'oak') { sx *= 3.25; sz *= 3; sy *= 2.7; y = s * 4.6; }
      if ((part === 'oak' && !oak) || (part !== 'oak' && part !== 'trunk' && oak)) sx = sy = sz = 0;
      position.set(tree.x, y, tree.z); scale.set(sx, sy, sz); rotation.setFromAxisAngle(new THREE.Vector3(0,1,0), i * 1.4);
      matrix.compose(position, rotation, scale); matrices.push(matrix.clone()); mesh.setMatrixAt(i, matrix);
    });
    mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); root.add(mesh); treeParts.push({ mesh, matrices });
  };
  createTreePart(new THREE.CylinderGeometry(.7, 1, 1, 5), '#776548', 'trunk');
  createTreePart(new THREE.ConeGeometry(1, 1, 5), '#476c44', 'low');
  createTreePart(new THREE.ConeGeometry(1, 1, 5), '#567e46', 'mid');
  createTreePart(new THREE.ConeGeometry(1, 1, 5), '#628a49', 'top');
  createTreePart(new THREE.IcosahedronGeometry(1, 0), '#7d994b', 'oak');
  const treeIndexes = new Map(TREES.map((t,i) => [t.id,i]));
  const otherNodes = new Map<string, THREE.Group>();
  for (const node of RESOURCE_NODES.filter(n => n.kind !== 'tree')) {
    const g = new THREE.Group(); g.position.set(node.x, 0, node.z); root.add(g); otherNodes.set(node.id, g);
    if (node.kind === 'rock') {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05), material('#8a9282')); rock.scale.set(1.2,.85,1); rock.position.y=.6; rock.castShadow=true; rock.receiveShadow=true; g.add(rock);
      const small = new THREE.Mesh(new THREE.IcosahedronGeometry(.5), material('#a9ae98')); small.position.set(.9,.22,.3); small.castShadow=true; g.add(small);
    } else {
      box(g, 0, .3, 0, 1.4, .6, 1, '#8c8170');
      const plate = box(g, .2, .7, .1, 1.1, .12, .85, '#76908a', .3); plate.rotation.z=.18;
      box(g, -.5, .7, -.3, .28, 1.1, .22, '#ab7756', .5);
      cylinder(g, .3, .7, -.25, .26, .35, '#5c6c65');
    }
  }

  // Broad clouds use opaque flat shapes; no expensive transparency sorting or textures.
  const clouds = new THREE.Group();
  for (let i = 0; i < 13; i++) {
    const g = new THREE.Group(); g.position.set(Math.sin(i*4.31)*260, 85 + i%4*7, Math.cos(i*2.17)*250); clouds.add(g);
    box(g, 0, 0, 0, 21+i%4*6, 4, 10, '#edf2df'); box(g, -4, 3, 0, 13, 4, 8, '#f8f5e3'); box(g, 9, 1, 1, 13, 3.5, 9, '#edf2df');
  }
  root.add(clouds);

  // Collapse the static architecture by material: hundreds of details, dozens of draws.
  scenery.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  scenery.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const geo = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const normalized = geo.index ? geo.toNonIndexed() : geo;
    if (normalized !== geo) geo.dispose();
    const list = batches.get(object.material) ?? []; list.push(normalized); batches.set(object.material, list); originals.add(object.geometry);
  });
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    if (merged) { const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); }
    geometries.forEach(g => g.dispose());
  }
  // The unit box is shared by live resource / cloud models; keep it until renderer disposal.
  for (const geo of originals) if (geo !== boxGeometry) geo.dispose();
  const hidden = new THREE.Matrix4().makeScale(0,0,0);
  return { root, water, clouds, setNodeActive(id, active) {
    const index = treeIndexes.get(id);
    if (index !== undefined) for (const part of treeParts) { part.mesh.setMatrixAt(index, active ? part.matrices[index] : hidden); part.mesh.instanceMatrix.needsUpdate = true; }
    const other = otherNodes.get(id); if (other) other.visible = active;
  } };
}
