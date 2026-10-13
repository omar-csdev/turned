import type { LootKind, ResourceId, Vec2 } from './protocol';
export const ISLAND_NAME = 'Pinefall Island';
export const WORLD_SIZE = 320;
export const SPAWN: Vec2 = { x: 0, z: 92 };
export const RADIO: Vec2 = { x: 0, z: -104 };
export interface IslandBuilding extends Vec2 { id: string; width: number; depth: number; height: number; color: string; roof: string; kind: 'house' | 'barn' | 'hangar' | 'shop' | 'tower' }
export interface IslandTree extends Vec2 { id: string; scale: number; kind: 'pine' | 'oak' }
export interface IslandResource extends Vec2 { id: string; kind: 'tree' | 'rock' | 'salvage'; resource: ResourceId }
export const LOCATIONS = [
  { name: 'SURVIVOR CAMP', x: 0, z: 92, kind: 'camp' },
  { name: 'CEDAR HARBOR', x: -66, z: 37, kind: 'town' },
  { name: 'GOLDEN FIELDS', x: 68, z: 35, kind: 'farm' },
  { name: 'NORTHSTAR OUTPOST', x: -65, z: -66, kind: 'military' },
  { name: 'PINEFALL AIRSTRIP', x: 65, z: -65, kind: 'airfield' },
  { name: 'RADIO RIDGE', ...RADIO, kind: 'radio' },
] as const;
export const ROADS = [
  { x: 0, z: 0, width: 8, depth: 230 },
  { x: 0, z: 36, width: 174, depth: 8 },
  { x: 0, z: -66, width: 174, depth: 8 },
  { x: -66, z: -15, width: 7, depth: 108 },
  { x: 68, z: -15, width: 7, depth: 108 },
];
export const ISLAND_BUILDINGS: IslandBuilding[] = [
  { id: 'harbor-1', x: -54, z: 24, width: 12, depth: 10, height: 6, color: '#ddaa72', roof: '#425963', kind: 'house' },
  { id: 'harbor-2', x: -81, z: 23, width: 12, depth: 10, height: 5, color: '#bb6650', roof: '#4b5352', kind: 'house' },
  { id: 'harbor-store', x: -51, z: 49, width: 14, depth: 9, height: 5, color: '#719c98', roof: '#344a4e', kind: 'shop' },
  { id: 'harbor-3', x: -82, z: 51, width: 11, depth: 10, height: 7, color: '#d9d3b2', roof: '#9c584a', kind: 'house' },
  { id: 'farm-barn', x: 82, z: 24, width: 16, depth: 13, height: 8, color: '#b74d3c', roof: '#454e43', kind: 'barn' },
  { id: 'farm-home', x: 51, z: 51, width: 12, depth: 11, height: 6, color: '#e5ce92', roof: '#557479', kind: 'house' },
  { id: 'outpost-a', x: -82, z: -82, width: 17, depth: 9, height: 4, color: '#6e775a', roof: '#3d4b38', kind: 'hangar' },
  { id: 'outpost-b', x: -49, z: -78, width: 14, depth: 9, height: 4, color: '#889276', roof: '#4b5344', kind: 'hangar' },
  { id: 'outpost-tower', x: -86, z: -50, width: 4, depth: 4, height: 10, color: '#736a53', roof: '#556047', kind: 'tower' },
  { id: 'airstrip-hangar', x: 49, z: -82, width: 19, depth: 17, height: 8, color: '#b3b9aa', roof: '#637277', kind: 'hangar' },
  { id: 'airstrip-office', x: 50, z: -48, width: 11, depth: 8, height: 4, color: '#c6b08b', roof: '#40585c', kind: 'shop' },
];
export function isOnIsland(x: number, z: number, margin = 0): boolean {
  const r = Math.sqrt((x / 140) ** 2 + (z / 151) ** 2);
  const theta = Math.atan2(z, x);
  return r < 1 - margin / 140 + .035 * Math.sin(theta * 5) + .025 * Math.cos(theta * 3);
}
export function isBlocked(x: number, z: number, radius = .4): boolean {
  return !isOnIsland(x, z, radius + 3) || ISLAND_BUILDINGS.some(b => Math.abs(x - b.x) < b.width / 2 + radius && Math.abs(z - b.z) < b.depth / 2 + radius);
}
let seed = 73129;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
export const TREES: IslandTree[] = [];
for (let i = 0; i < 330; i++) {
  const x = random() * 268 - 134, z = random() * 276 - 138;
  if (!isOnIsland(x, z, 11) || isBlocked(x, z, 4) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 11 ||
    ROADS.some(r => Math.abs(x-r.x)<r.width/2+3 && Math.abs(z-r.z)<r.depth/2+3) || (x>75 && x<97 && z< -35 && z> -100)) continue;
  TREES.push({ id: `tree-${i}`, x, z, scale: .7 + random() * .7, kind: random() > .24 ? 'pine' : 'oak' });
}
export const RESOURCE_NODES: IslandResource[] = [
  ...TREES.map(t => ({ id: t.id, x: t.x, z: t.z, kind: 'tree' as const, resource: 'wood' as const })),
  ...[{x:8,z:88},{x:-10,z:82},{x:18,z:54},{x:-38,z:13},{x:46,z:-20},{x:-22,z:-90}].map((p,i)=>({id:`rock-${i}`,...p,kind:'rock' as const,resource:'stone' as const})),
  ...[{x:12,z:90},{x:-8,z:94},{x:-65,z:47},{x:73,z:43},{x:-57,z:-57},{x:62,z:-52}].map((p,i)=>({id:`salvage-${i}`,...p,kind:'salvage' as const,resource:'scrap' as const})),
];
export const LOOT_SPAWNS: {id:string; kind:LootKind; x:number; z:number}[] = [
  {id:'camp-ammo',kind:'ammo',x:3,z:89},{id:'camp-medkit',kind:'medkit',x:-3,z:89},
  {id:'camp-food',kind:'food',x:4,z:94},{id:'camp-water',kind:'water',x:-4,z:94},
  ...LOCATIONS.filter(l=>l.kind!=='camp' && l.kind!=='radio').flatMap((l,i)=>[
    {id:`ammo-${i}`,kind:'ammo' as const,x:l.x+5,z:l.z+3},
    {id:`cloth-${i}`,kind:'cloth' as const,x:l.x+8,z:l.z},
    {id:`food-${i}`,kind:'food' as const,x:l.x-3,z:l.z+5},
    {id:`water-${i}`,kind:'water' as const,x:l.x+3,z:l.z-5},
    {id:`fuel-${i}`,kind:'fuel' as const,x:l.x-5,z:l.z-3},
    {id:`scrap-${i}`,kind:'scrap' as const,x:l.x-2,z:l.z-6},
  ]),
  {id:'supply-harbor',kind:'supply',x:-71,z:36},
  {id:'supply-farm',kind:'supply',x:72,z:28},
  {id:'supply-military',kind:'supply',x:-66,z:-74},
];
export const VEHICLE_SPAWNS = [
  {id:'camp-jeep',x:7,z:80,yaw:0,kind:'jeep' as const,color:'#dba346'},
  {id:'harbor-pickup',x:-66,z:58,yaw:Math.PI,kind:'pickup' as const,color:'#659d9b'},
  {id:'farm-pickup',x:68,z:47,yaw:0,kind:'pickup' as const,color:'#b65344'},
  {id:'outpost-jeep',x:-68,z:-51,yaw:Math.PI/2,kind:'jeep' as const,color:'#788458'},
];
export const ZOMBIE_SPAWNS = LOCATIONS.filter(l=>l.kind!=='camp').flatMap((l,i)=>Array.from({length: i===2?10:7},(_,j)=>({x:l.x+Math.cos(j*2.4)* (9+j),z:l.z+Math.sin(j*2.4)*(9+j),kind:(j%6===0?'runner':j%5===0?'armored':'walker') as 'walker'|'runner'|'armored'}))).filter(p=>!isBlocked(p.x,p.z,1));
