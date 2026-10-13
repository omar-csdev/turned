/** Turned's original cooperative island mode. Angles are radians, positions are meters. */
export const TICK_RATE = 20;
export const MAX_PLAYERS = 8;
export type WeaponId = 'axe' | 'pistol' | 'rifle' | 'shotgun';
export type ResourceId = 'wood' | 'stone' | 'scrap' | 'cloth';
export type Resources = Record<ResourceId, number>;
export type RecipeId = 'bandage' | 'ammo' | 'barricade' | 'campfire' | 'workbench' | 'shotgun';
export type BuildingKind = 'barricade' | 'campfire' | 'workbench';
export type LootKind = 'ammo' | 'medkit' | 'food' | 'water' | 'fuel' | 'scrap' | 'cloth' | 'supply';
export interface Vec2 { x: number; z: number }
export interface PlayerState extends Vec2 {
  id: string; name: string; color: string; y: number; yaw: number; pitch: number;
  health: number; hunger: number; thirst: number; stamina: number;
  weapon: WeaponId; ammo: Record<WeaponId, number>; reserve: number; reloading: number;
  resources: Resources; medkits: number; food: number; water: number; fuel: number;
  hasShotgun: boolean; kills: number; dead: boolean; vehicleId: string | null;
  seat: number; moving: boolean; firing: number; connected: boolean;
}
export interface ZombieState extends Vec2 { id: string; y: number; yaw: number; health: number; kind: 'walker' | 'runner' | 'armored'; attacking: boolean }
export interface VehicleState extends Vec2 { id: string; yaw: number; speed: number; fuel: number; health: number; kind: 'jeep' | 'pickup'; color: string; seats: (string | null)[] }
export interface LootState extends Vec2 { id: string; kind: LootKind; active: boolean }
export interface ResourceNodeState { id: string; health: number; active: boolean }
export interface BuildingState extends Vec2 { id: string; kind: BuildingKind; yaw: number; health: number; ownerId: string }
export interface GameEvent extends Vec2 { id: number; type: 'shot' | 'hit' | 'kill' | 'pickup' | 'hurt' | 'build' | 'notice' | 'win'; y?: number; actorId?: string; targetId?: string; weapon?: WeaponId; text?: string; headshot?: boolean }
export interface GameSnapshot {
  tick: number; time: number; dayTime: number; phase: 'lobby' | 'playing' | 'won';
  players: PlayerState[]; zombies: ZombieState[]; vehicles: VehicleState[]; loot: LootState[];
  nodes: ResourceNodeState[]; buildings: BuildingState[]; events: GameEvent[];
  supplies: number; requiredSupplies: number; extraction: number;
}
/** Camera looks toward -Z at yaw zero. moveZ positive is forward; moveX positive is right. */
export interface PlayerInput { seq: number; moveX: number; moveZ: number; yaw: number; pitch: number; sprint: boolean; jump: boolean; fire: boolean; aim: boolean }
export type PlayerAction = { action: 'reload' | 'interact' | 'heal' | 'eat' | 'drink' | 'respawn' } | { action: 'weapon'; weapon: WeaponId } | { action: 'craft'; recipe: RecipeId };
export interface RoomInfo { code: string; name: string; public: boolean; hostId: string; phase: GameSnapshot['phase']; maxPlayers: number; players: { id: string; name: string; color: string; connected: boolean }[] }
export interface JoinSession { code: string; token: string; playerId: string }
export type ClientMessage = { type: 'input'; input: PlayerInput } | ({ type: 'action' } & PlayerAction) | { type: 'start' } | { type: 'ping'; sent: number };
export type ServerMessage = { type: 'welcome'; playerId: string; room: RoomInfo; snapshot: GameSnapshot } | { type: 'snapshot'; snapshot: GameSnapshot } | { type: 'room'; room: RoomInfo } | { type: 'error'; message: string } | { type: 'pong'; sent: number };
export const WEAPONS: Record<WeaponId, { name: string; damage: number; magazine: number; interval: number; reload: number; range: number }> = {
  axe: { name: 'Hatchet', damage: 38, magazine: 0, interval: .55, reload: 0, range: 3 },
  pistol: { name: '9mm sidearm', damage: 32, magazine: 12, interval: .28, reload: 1.4, range: 65 },
  rifle: { name: 'Ranger rifle', damage: 26, magazine: 30, interval: .11, reload: 2, range: 110 },
  shotgun: { name: 'Field shotgun', damage: 85, magazine: 6, interval: .8, reload: 2.6, range: 23 },
};
export const RECIPES: { id: RecipeId; name: string; description: string; cost: Partial<Resources>; workbench?: boolean }[] = [
  { id: 'bandage', name: 'Field bandage', description: 'Restores 45 health. Use with H.', cost: { cloth: 2 } },
  { id: 'ammo', name: 'Ammunition', description: '24 spare rounds for your firearms.', cost: { scrap: 3 }, workbench: true },
  { id: 'barricade', name: 'Wooden barricade', description: 'Place cover ahead of you. Blocks and distracts infected.', cost: { wood: 8, scrap: 2 } },
  { id: 'campfire', name: 'Campfire', description: 'Place a fire. Slowly heals nearby survivors.', cost: { wood: 6, stone: 4 } },
  { id: 'workbench', name: 'Workbench', description: 'Place a station. Craft advanced gear within 5 meters.', cost: { wood: 12, scrap: 6 } },
  { id: 'shotgun', name: 'Field shotgun', description: 'Unlock a powerful close-range weapon. Equip with 4.', cost: { wood: 6, scrap: 10 }, workbench: true },
];
export const EMPTY_INPUT: PlayerInput = { seq: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, sprint: false, jump: false, fire: false, aim: false };
