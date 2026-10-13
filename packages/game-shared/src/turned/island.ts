import type { LootKind, ResourceId, Vec2 } from './protocol';
export const ISLAND_NAME = 'Pinefall Island';
export const WORLD_SIZE = 320;
export const SPAWN: Vec2 = { x: 0, z: 92 };
export const RADIO: Vec2 = { x: 0, z: -104 };
export type BuildingTheme = 'home' | 'market' | 'clinic' | 'diner' | 'workshop' | 'barn' | 'barracks' | 'armory' | 'office';
export interface IslandBuilding extends Vec2 { id: string; width: number; depth: number; height: number; color: string; roof: string; kind: 'house' | 'barn' | 'hangar' | 'shop' | 'tower'; enterable?: boolean; theme?: BuildingTheme }
/** y is the bottom elevation. Renderers and the authoritative simulation share these boxes. */
export interface IslandWall extends Vec2 { id: string; buildingId: string; y: number; width: number; depth: number; height: number }
export type InteriorPropKind = 'bed' | 'table' | 'chair' | 'sofa' | 'shelf' | 'counter' | 'crate' | 'barrel' | 'locker' | 'bench' | 'medical' | 'cabinet';
export interface InteriorProp extends IslandWall { kind: InteriorPropKind; yaw: number; collidable: boolean }
export interface IslandTree extends Vec2 { id: string; scale: number; kind: 'pine' | 'oak' }
export interface IslandResource extends Vec2 { id: string; kind: 'tree' | 'rock' | 'salvage'; resource: ResourceId }
export const LOCATIONS = [
  { name: 'SURVIVOR CAMP', x: 0, z: 92, kind: 'camp' },
  { name: 'CEDAR HARBOR', x: -66, z: 37, kind: 'town' },
  { name: 'GOLDEN FIELDS', x: 68, z: 35, kind: 'farm' },
  { name: 'NORTHSTAR OUTPOST', x: -65, z: -66, kind: 'military' },
  { name: 'PINEFALL AIRSTRIP', x: 65, z: -65, kind: 'airfield' },
  { name: 'RADIO RIDGE', ...RADIO, kind: 'radio' },
  { name: 'MOSS CREEK', x: -35, z: -16, kind: 'town' },
  { name: 'EASTVALE', x: 38, z: -13, kind: 'town' },
] as const;
export const ROADS = [
  { x: 0, z: 0, width: 8, depth: 230 },
  { x: 0, z: 36, width: 174, depth: 8 },
  { x: 0, z: -66, width: 174, depth: 8 },
  { x: -66, z: -15, width: 7, depth: 108 },
  { x: 68, z: -15, width: 7, depth: 108 },
  { x: -34, z: -16, width: 64, depth: 5 },
  { x: -35, z: 11, width: 5, depth: 50 },
  { x: 34, z: -13, width: 68, depth: 5 },
  { x: 38, z: 12, width: 5, depth: 48 },
  { x: -95, z: 36, width: 51, depth: 6 },
];
export const ISLAND_BUILDINGS: IslandBuilding[] = [
  { id: 'harbor-1', x: -54, z: 24, width: 12, depth: 10, height: 4, color: '#ddaa72', roof: '#425963', kind: 'house', theme: 'home' },
  { id: 'harbor-2', x: -81, z: 23, width: 12, depth: 10, height: 4, color: '#bb6650', roof: '#4b5352', kind: 'house', theme: 'home' },
  { id: 'harbor-store', x: -51, z: 49, width: 14, depth: 9, height: 4, color: '#719c98', roof: '#344a4e', kind: 'shop', theme: 'market' },
  { id: 'harbor-3', x: -82, z: 51, width: 11, depth: 10, height: 4, color: '#d9d3b2', roof: '#9c584a', kind: 'house', theme: 'home' },
  { id: 'harbor-4', x: -103, z: 22, width: 11, depth: 10, height: 4, color: '#93a8a1', roof: '#536c69', kind: 'house', theme: 'home' },
  { id: 'harbor-diner', x: -81, z: 73, width: 13, depth: 10, height: 4, color: '#c29a78', roof: '#6a4c47', kind: 'shop', theme: 'diner' },
  { id: 'harbor-clinic', x: -51, z: 73, width: 13, depth: 10, height: 4, color: '#e2ddc9', roof: '#537b77', kind: 'shop', theme: 'clinic' },
  { id: 'harbor-workshop', x: -83, z: -1, width: 12, depth: 12, height: 4.5, color: '#a39375', roof: '#465352', kind: 'hangar', theme: 'workshop' },
  { id: 'harbor-warehouse', x: -107, z: -1, width: 14, depth: 12, height: 5, color: '#829ba0', roof: '#425e65', kind: 'hangar', theme: 'workshop' },
  { id: 'farm-barn', x: 82, z: 24, width: 16, depth: 13, height: 6, color: '#b74d3c', roof: '#454e43', kind: 'barn', theme: 'barn' },
  { id: 'farm-home', x: 51, z: 51, width: 12, depth: 11, height: 4, color: '#e5ce92', roof: '#557479', kind: 'house', theme: 'home' },
  { id: 'farm-cottage', x: 51, z: 20, width: 12, depth: 10, height: 4, color: '#cbd7a3', roof: '#56664b', kind: 'house', theme: 'home' },
  { id: 'farm-shed', x: 108, z: 21, width: 12, depth: 10, height: 5, color: '#b18c61', roof: '#68694f', kind: 'barn', theme: 'barn' },
  { id: 'farm-workshop', x: 52, z: 76, width: 14, depth: 11, height: 4.5, color: '#a49d7f', roof: '#4c6154', kind: 'hangar', theme: 'workshop' },
  { id: 'outpost-a', x: -82, z: -82, width: 17, depth: 9, height: 4, color: '#6e775a', roof: '#3d4b38', kind: 'hangar', theme: 'barracks' },
  { id: 'outpost-b', x: -49, z: -78, width: 14, depth: 9, height: 4, color: '#889276', roof: '#4b5344', kind: 'hangar', theme: 'armory' },
  { id: 'outpost-tower', x: -86, z: -50, width: 4, depth: 4, height: 10, color: '#736a53', roof: '#556047', kind: 'tower', enterable: false },
  { id: 'outpost-infirmary', x: -48, z: -49, width: 13, depth: 10, height: 4, color: '#b8c3a1', roof: '#455847', kind: 'shop', theme: 'clinic' },
  { id: 'outpost-command', x: -105, z: -67, width: 12, depth: 10, height: 4, color: '#7a896c', roof: '#354a3c', kind: 'hangar', theme: 'office' },
  { id: 'airstrip-hangar', x: 49, z: -82, width: 19, depth: 17, height: 6, color: '#b3b9aa', roof: '#637277', kind: 'hangar', theme: 'workshop' },
  { id: 'airstrip-office', x: 50, z: -48, width: 11, depth: 8, height: 4, color: '#c6b08b', roof: '#40585c', kind: 'shop', theme: 'office' },
  { id: 'moss-home-1', x: -24, z: -3, width: 11, depth: 10, height: 4, color: '#d6ad83', roof: '#465c63', kind: 'house', theme: 'home' },
  { id: 'moss-home-2', x: -47, z: -3, width: 12, depth: 10, height: 4, color: '#a3bda5', roof: '#5c6954', kind: 'house', theme: 'home' },
  { id: 'moss-market', x: -24, z: -30, width: 12, depth: 10, height: 4, color: '#a3b9b0', roof: '#455d5e', kind: 'shop', theme: 'market' },
  { id: 'moss-home-3', x: -47, z: -30, width: 12, depth: 10, height: 4, color: '#bc7d62', roof: '#536467', kind: 'house', theme: 'home' },
  { id: 'east-home-1', x: 26, z: 0, width: 12, depth: 10, height: 4, color: '#d6c891', roof: '#4e797a', kind: 'house', theme: 'home' },
  { id: 'east-home-2', x: 50, z: 0, width: 12, depth: 10, height: 4, color: '#92aea1', roof: '#505e57', kind: 'house', theme: 'home' },
  { id: 'east-diner', x: 26, z: -27, width: 12, depth: 10, height: 4, color: '#c9836f', roof: '#5e5350', kind: 'shop', theme: 'diner' },
  { id: 'east-workshop', x: 50, z: -27, width: 12, depth: 10, height: 4.5, color: '#a0b0b1', roof: '#4b686e', kind: 'hangar', theme: 'workshop' },
];
export function isInsideBuilding(x: number, z: number, b: IslandBuilding, margin = 0): boolean {
  return Math.abs(x - b.x) < b.width / 2 + margin && Math.abs(z - b.z) < b.depth / 2 + margin;
}
export function buildingEntrance(b: IslandBuilding, offset = 1.4): Vec2 { return { x: b.x, z: b.z + b.depth / 2 + offset }; }
export function buildingDoorWidth(b: IslandBuilding): number { return b.kind === 'hangar' ? 6 : b.kind === 'barn' ? 4.8 : 2.8; }
export const BUILDING_WALLS: IslandWall[] = ISLAND_BUILDINGS.flatMap(b => {
  if (b.enterable === false) return [{ id: b.id + '-solid', buildingId: b.id, x: b.x, z: b.z, y: 0, width: b.width, depth: b.depth, height: b.height }];
  const walls: IslandWall[] = [];
  const add = (id: string, x: number, z: number, width: number, depth: number, height = b.height, y = 0) => walls.push({ id: b.id + '-' + id, buildingId: b.id, x: b.x + x, z: b.z + z, width, depth, height, y });
  const w = b.width, d = b.depth, t = .28, door = buildingDoorWidth(b);
  add('back', 0, -d / 2, w, t);
  for (const side of [-1, 1]) {
    const wing = (w - door) / 2;
    add('door-jamb-' + side, side * (door / 2 + wing / 2), d / 2, wing, t);
    add('side-back-' + side, side * w / 2, -(d / 2 + 1.2) / 2, t, d / 2 - 1.2);
    add('side-front-' + side, side * w / 2, (d / 2 + 1.2) / 2, t, d / 2 - 1.2);
    add('window-sill-' + side, side * w / 2, 0, t, 2.4, 1.05);
    add('window-header-' + side, side * w / 2, 0, t, 2.4, b.height - 2.55, 2.55);
  }
  add('door-header', 0, d / 2, door, t, b.height - 2.8, 2.8);
  // Houses have a rear bedroom and a connected front living room, never a dead-end sealed room.
  if (b.theme === 'home') {
    const wing = (w - 2.4) / 2;
    for (const side of [-1, 1]) add('room-divider-' + side, side * (1.2 + wing / 2), -d * .1, wing, t, 2.8);
    add('room-header', 0, -d * .1, 2.4, t, .5, 2.8);
  }
  return walls;
});
export const INTERIOR_PROPS: InteriorProp[] = ISLAND_BUILDINGS.filter(b => b.enterable !== false).flatMap(b => {
  const props: InteriorProp[] = [];
  const add = (kind: InteriorPropKind, x: number, z: number, width: number, depth: number, height: number, collidable = true, yaw = 0) => props.push({ id: b.id + '-prop-' + props.length, buildingId: b.id, kind, x: b.x + x, z: b.z + z, y: 0, width, depth, height, yaw, collidable });
  const left = -b.width / 2 + 1.3, right = b.width / 2 - 1.3, back = -b.depth / 2 + 1.3;
  switch (b.theme) {
    case 'home':
      add('bed', left + .4, back + .2, 2.2, 2.1, .65); add('cabinet', right, back, 1.4, .7, 1.4);
      add('sofa', left, b.depth * .22, 2.3, 1, 1); add('table', right - .3, b.depth * .22, 1.6, 1.3, .8);
      add('chair', right - .3, b.depth * .22 + 1.2, .6, .6, .95); add('counter', right, -b.depth * .02, .8, 1.2, 1); break;
    case 'market':
      add('shelf', left, back + .5, .8, 2.3, 1.4); add('shelf', right, back + .5, .8, 2.3, 1.4);
      add('counter', left + .6, b.depth * .2, 2.4, .85, 1); add('crate', right, b.depth * .24, 1, 1, .8); break;
    case 'clinic':
      add('medical', left + .3, back + .5, 2, 2.4, .85); add('medical', right - .3, back + .5, 2, 2.4, .85);
      add('cabinet', left, b.depth * .2, 1, .6, 1.4); add('table', right, b.depth * .2, 1.6, 1, .8); break;
    case 'diner':
      add('counter', left, 0, .9, b.depth * .55, 1);
      for (const z of [back + .4, b.depth * .22]) { add('table', right - .3, z, 1.5, 1.2, .8); add('chair', right - .3, z + 1, .55, .55, .95); }
      add('cabinet', left + .8, back, 1.8, .65, 1.4); break;
    case 'barracks':
      for (const x of [left + .3, right - .3]) for (const z of [back + .5, b.depth * .22]) add('bed', x, z, 2, 1.7, .7);
      add('locker', right, 0, .8, .6, 1.8); add('crate', left, 0, .8, .8, .8); break;
    case 'armory':
      add('locker', left, back, 1, .6, 1.8); add('locker', right, back, 1, .6, 1.8);
      add('bench', left + .5, b.depth * .12, 2.4, .9, .9); add('crate', right, b.depth * .16, 1.3, 1.2, .9); break;
    case 'office':
      add('table', left + .5, back + .5, 2.2, 1, .8); add('chair', left + .5, back + 1.5, .6, .6, .95);
      add('cabinet', right, back, 1.5, .7, 1.4); add('bench', right, b.depth * .2, 1.8, .8, .85); break;
    case 'barn':
      for (const x of [left, right]) { add('crate', x, back + .4, 1.5, 1.5, 1); add('barrel', x, b.depth * .18, .9, .9, 1.1); }
      add('bench', right, 0, 2, .8, .85); break;
    default:
      add('bench', left, back + .5, 2.3, 1, .9); add('shelf', right, back + .4, .8, 2.4, 1.4);
      add('crate', left, b.depth * .22, 1.2, 1.2, 1); add('barrel', right, b.depth * .22, .9, .9, 1.1); break;
  }
  return props;
});
export function isOnIsland(x: number, z: number, margin = 0): boolean {
  const r = Math.sqrt((x / 140) ** 2 + (z / 151) ** 2), theta = Math.atan2(z, x);
  return r < 1 - margin / 140 + .035 * Math.sin(theta * 5) + .025 * Math.cos(theta * 3);
}
export function intersectsProp(x: number, z: number, p: InteriorProp, radius = .4): boolean {
  const dx = x - p.x, dz = z - p.z, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return Math.abs(dx * c - dz * s) < p.width / 2 + radius && Math.abs(dx * s + dz * c) < p.depth / 2 + radius;
}
export function isBlocked(x: number, z: number, radius = .4): boolean {
  return !isOnIsland(x, z, radius + 3) || BUILDING_WALLS.some(w => w.y < .8 && Math.abs(x - w.x) < w.width / 2 + radius && Math.abs(z - w.z) < w.depth / 2 + radius) || INTERIOR_PROPS.some(p => p.collidable && intersectsProp(x, z, p, radius));
}
/** Static visibility used by loot prompts and map validation; windows and doorways stay open. */
export function hasStaticLineOfSight(from: Vec2 & { y: number }, to: Vec2 & { y: number }): boolean {
  const intersects = (box: IslandWall, yaw = 0) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), dx = from.x - box.x, dz = from.z - box.z;
    const vx = to.x - from.x, vz = to.z - from.z;
    let near = 0, far = 1;
    for (const [origin, direction, min, max] of [
      [dx * c - dz * s, vx * c - vz * s, -box.width / 2, box.width / 2],
      [from.y, to.y - from.y, box.y, box.y + box.height],
      [dx * s + dz * c, vx * s + vz * c, -box.depth / 2, box.depth / 2],
    ]) {
      if (Math.abs(direction) < 1e-8) { if (origin < min || origin > max) return false; }
      else {
        const a = (min - origin) / direction, b = (max - origin) / direction;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
      }
    }
    return near < .9999 && far > .0001;
  };
  return !BUILDING_WALLS.some(w => intersects(w)) && !INTERIOR_PROPS.some(p => p.collidable && intersects(p, p.yaw));
}
export const VEHICLE_SPAWNS = [
  {id:'camp-jeep',x:7,z:80,yaw:0,kind:'jeep' as const,color:'#dba346'},
  {id:'harbor-pickup',x:-66,z:58,yaw:Math.PI,kind:'pickup' as const,color:'#659d9b'},
  {id:'farm-pickup',x:68,z:47,yaw:0,kind:'pickup' as const,color:'#b65344'},
  {id:'outpost-jeep',x:-68,z:-51,yaw:Math.PI/2,kind:'jeep' as const,color:'#788458'},
];
let seed = 73129;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
export const TREES: IslandTree[] = [];
for (let i = 0; i < 390; i++) {
  const x = random() * 268 - 134, z = random() * 276 - 138;
  if (!isOnIsland(x, z, 11) || ISLAND_BUILDINGS.some(b => isInsideBuilding(x, z, b, 3)) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 11 ||
    VEHICLE_SPAWNS.some(v => Math.hypot(x - v.x, z - v.z) < 5) ||
    ISLAND_BUILDINGS.some(b => Math.abs(x - b.x) < buildingDoorWidth(b) / 2 + 2 && z > b.z && z < b.z + b.depth / 2 + 7) ||
    ROADS.some(r => Math.abs(x-r.x)<r.width/2+3 && Math.abs(z-r.z)<r.depth/2+3) || (x>75 && x<97 && z< -35 && z> -100)) continue;
  TREES.push({ id: `tree-${i}`, x, z, scale: .7 + random() * .7, kind: random() > .24 ? 'pine' : 'oak' });
}
export const RESOURCE_NODES: IslandResource[] = [
  ...TREES.map(t => ({ id: t.id, x: t.x, z: t.z, kind: 'tree' as const, resource: 'wood' as const })),
  ...[{x:8,z:88},{x:-10,z:82},{x:18,z:54},{x:-38,z:13},{x:46,z:-20},{x:-22,z:-90}].map((p,i)=>({id:`rock-${i}`,...p,kind:'rock' as const,resource:'stone' as const})),
  ...[{x:12,z:90},{x:-8,z:94},{x:-65,z:47},{x:73,z:43},{x:-57,z:-57},{x:62,z:-52}].map((p,i)=>({id:`salvage-${i}`,...p,kind:'salvage' as const,resource:'scrap' as const})),
];
export const LOOT_SPAWNS: {id:string; kind:LootKind; x:number; z:number; y?:number; buildingId?:string}[] = [
  {id:'camp-ammo',kind:'ammo',x:3,z:89},{id:'camp-medkit',kind:'medkit',x:-3,z:89},
  {id:'camp-food',kind:'food',x:4,z:94},{id:'camp-water',kind:'water',x:-4,z:94},
  ...ISLAND_BUILDINGS.filter(b => b.enterable !== false).flatMap(b => {
    const kinds: LootKind[] = b.theme === 'clinic' ? ['medkit','cloth','water'] : b.theme === 'armory' || b.theme === 'barracks' ? ['ammo','ammo','cloth'] : b.theme === 'workshop' ? ['scrap','fuel','ammo'] : b.theme === 'barn' ? ['food','cloth','fuel'] : ['food','water','cloth'];
    return kinds.map((kind,i) => ({ id: b.id + '-loot-' + i, kind, x: b.x + (i - 1) * .85, z: b.z - b.depth * .3, y: 0, buildingId: b.id }));
  }),
  ...INTERIOR_PROPS.filter(p => p.kind === 'shelf' || p.kind === 'cabinet').map(p => ({id:p.id+'-loot',kind:(p.kind==='cabinet'?'medkit':'ammo') as LootKind,x:p.x,z:p.z,y:p.height+.05,buildingId:p.buildingId})),
  {id:'supply-harbor',kind:'supply',x:-51,z:50,y:0,buildingId:'harbor-store'},
  {id:'supply-farm',kind:'supply',x:82,z:25,y:0,buildingId:'farm-barn'},
  {id:'supply-military',kind:'supply',x:-49,z:-77,y:0,buildingId:'outpost-b'},
];
export const ZOMBIE_SPAWNS = LOCATIONS.filter(l=>l.kind!=='camp').flatMap((l,i)=>Array.from({length: l.kind==='military'?10:7},(_,j)=>({x:l.x+Math.cos(j*2.4)* (9+j),z:l.z+Math.sin(j*2.4)*(9+j),kind:(j%6===0?'runner':j%5===0?'armored':'walker') as 'walker'|'runner'|'armored'}))).filter(p=>!isBlocked(p.x,p.z,1) && !ISLAND_BUILDINGS.some(b=>isInsideBuilding(p.x,p.z,b,.5)));
