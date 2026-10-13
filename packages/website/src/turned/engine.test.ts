import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSnapshot, JoinSession, PlayerState, RoomInfo } from '@survive-the-night/game-shared/turned/protocol';

const rendering = vi.hoisted(() => ({ canvas: null as any, views: [] as number[][], aim: false, disposed: false }));
vi.mock('./render/renderer', () => ({
  TurnedRenderer: class {
    canvas = rendering.canvas;
    setPreview() {}
    setSnapshot() {}
    setSettings() {}
    setView(...view: number[]) { rendering.views.push(view); }
    setAim(aim: boolean) { rendering.aim = aim; }
    update() {}
    dispose() { rendering.disposed = true; }
  },
}));
import { TurnedEngine, type EngineCallbacks } from './engine';

class ElementStub extends EventTarget {
  tagName = 'DIV';
  isContentEditable = false;
  requestPointerLock: (() => void) | undefined;
}
class SocketStub {
  static OPEN = 1;
  static sockets: SocketStub[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: URL) { SocketStub.sockets.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close = vi.fn(() => { this.readyState = 3; });
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
  disconnect(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

const session: JoinSession = { code: 'ABC234', token: 'a-secret-only-stored-in-this-tab', playerId: 'survivor-1' };
const room: RoomInfo = { code: session.code, name: 'Friends', hostId: session.playerId, public: false, phase: 'playing', maxPlayers: 8, players: [] };
function player(): PlayerState {
  return { id: session.playerId, name: 'Ada', color: '#fff', x: 0, z: 0, y: 0, yaw: 0, pitch: 0,
    health: 100, hunger: 100, thirst: 100, stamina: 100, weapon: 'pistol', ammo: { axe: 0, pistol: 12, rifle: 30, shotgun: 6 },
    reserve: 90, reloading: 0, resources: { wood: 0, stone: 0, scrap: 0, cloth: 0 }, medkits: 1, food: 1, water: 1,
    fuel: 0, hasShotgun: false, kills: 0, dead: false, vehicleId: null, seat: 0, moving: false, firing: 0, connected: true };
}
function snapshot(): GameSnapshot {
  return { tick: 1, time: 0, dayTime: .4, phase: 'playing', players: [player()], zombies: [], vehicles: [], loot: [],
    nodes: [], buildings: [], events: [], supplies: 0, requiredSupplies: 3, extraction: 0 };
}
function welcome(socket: SocketStub, state = snapshot()) {
  socket.receive({ type: 'welcome', playerId: session.playerId, room, snapshot: state });
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('Turned browser engine', () => {
  let engine: TurnedEngine;
  let browser: EventTarget;
  let doc: EventTarget & { pointerLockElement: ElementStub | null; hidden: boolean; exitPointerLock: () => void };
  let callbacks: EngineCallbacks;
  let storage: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    rendering.canvas = new ElementStub();
    rendering.canvas.tagName = 'CANVAS';
    rendering.views = [];
    rendering.disposed = false;
    rendering.aim = false;
    SocketStub.sockets = [];
    browser = Object.assign(new EventTarget(), { location: { href: 'https://turned.test/', protocol: 'https:' } });
    doc = Object.assign(new EventTarget(), { pointerLockElement: null as ElementStub | null, hidden: false,
      exitPointerLock: () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); } });
    storage = new Map();
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ...session }) }));
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('WebSocket', SocketStub);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    callbacks = { onSnapshot: vi.fn(), onRoom: vi.fn(), onStatus: vi.fn(), onError: vi.fn(), onPointerLock: vi.fn(),
      onSession: vi.fn(), onCrafting: vi.fn(), onMap: vi.fn() };
    engine = new TurnedEngine(new ElementStub() as unknown as HTMLElement, callbacks);
  });
  afterEach(() => { engine.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function connect() {
    const pending = engine.createRoom('Ada', 'Friends', false);
    await flush();
    const socket = SocketStub.sockets.at(-1)!;
    welcome(socket);
    await pending;
    return socket;
  }
  function key(code: string, type = 'keydown', target?: ElementStub) {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false });
    if (target) Object.defineProperty(event, 'target', { value: target });
    browser.dispatchEvent(event);
    return event;
  }
  function mouse(button: number, type = 'mousedown') {
    const event = Object.assign(new Event(type), { button });
    Object.defineProperty(event, 'target', { value: rendering.canvas });
    browser.dispatchEvent(event);
  }
  function lastInput(socket: SocketStub) { return socket.sent.filter(message => message.type === 'input').at(-1)?.input; }

  it('starts quick play only after the server welcomes the survivor', async () => {
    const pending = engine.quickPlay('Ada');
    await flush();
    const socket = SocketStub.sockets[0];
    expect(socket.sent).toEqual([]);
    expect(socket.url.protocol).toBe('wss:');
    welcome(socket);
    await pending;
    expect(socket.sent).toContainEqual({ type: 'start' });
    expect(engine.connected).toBe(true);
    expect(engine.playerId).toBe(session.playerId);
    expect(callbacks.onSnapshot).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Ada', roomName: "Ada's expedition", public: false });
  });

  it('normalizes diagonal movement, sends sequenced complete input, and clears firing on pause', async () => {
    const socket = await connect();
    engine.lockPointer(); // Pointer-lock-less browsers still have keyboard aiming.
    key('KeyW');
    key('KeyD');
    key('ShiftLeft');
    mouse(0);
    mouse(2);
    vi.advanceTimersByTime(50);
    const moving = lastInput(socket);
    expect(moving).toMatchObject({ sprint: true, fire: true, aim: true, jump: false, yaw: 0, pitch: 0 });
    expect(Math.hypot(moving.moveX, moving.moveZ)).toBeCloseTo(1);
    engine.pause();
    expect(lastInput(socket)).toMatchObject({ moveX: 0, moveZ: 0, fire: false, aim: false, sprint: false });
    expect(lastInput(socket).seq).toBeGreaterThan(moving.seq);
    engine.lockPointer();
    vi.advanceTimersByTime(50);
    expect(lastInput(socket).moveZ).toBe(0);
    expect(rendering.aim).toBe(false);
  });

  it('crafting releases gameplay input and sends only explicit crafting actions', async () => {
    const socket = await connect();
    engine.lockPointer();
    key('KeyW');
    mouse(0);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(engine.crafting).toBe(true);
    expect(callbacks.onCrafting).toHaveBeenLastCalledWith(true);
    key('KeyW');
    vi.advanceTimersByTime(50);
    expect(lastInput(socket)).toMatchObject({ moveX: 0, moveZ: 0, fire: false });
    engine.action({ action: 'craft', recipe: 'workbench' });
    expect(socket.sent.at(-1)).toEqual({ type: 'action', action: 'craft', recipe: 'workbench' });
    key('Tab');
    expect(engine.crafting).toBe(false);
    expect(callbacks.onPointerLock).toHaveBeenLastCalledWith(true);
  });

  it('preserves a short trigger or jump tap between network updates for exactly one input', async () => {
    const socket = await connect();
    engine.lockPointer();
    mouse(0);
    mouse(0, 'mouseup');
    key('Space');
    key('Space', 'keyup');
    vi.advanceTimersByTime(50);
    expect(lastInput(socket)).toMatchObject({ fire: true, jump: true });
    vi.advanceTimersByTime(50);
    expect(lastInput(socket)).toMatchObject({ fire: false, jump: false });
  });

  it('updates captured mouse view immediately and clamps pitch to the renderer limit', async () => {
    const socket = await connect();
    rendering.canvas.requestPointerLock = () => {
      doc.pointerLockElement = rendering.canvas;
      doc.dispatchEvent(new Event('pointerlockchange'));
    };
    engine.lockPointer();
    browser.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 100, movementY: -10000 }));
    expect(rendering.views.at(-1)?.[0]).toBeCloseTo(-.22);
    expect(rendering.views.at(-1)?.[1]).toBe(1.45);
    vi.advanceTimersByTime(50);
    expect(lastInput(socket).yaw).toBeCloseTo(-.22);
    expect(lastInput(socket).pitch).toBe(1.45);
    doc.exitPointerLock();
    expect(callbacks.onPointerLock).toHaveBeenLastCalledWith(false);
  });

  it('does not consume typing in text fields or repeat discrete weapon actions', async () => {
    const socket = await connect();
    engine.lockPointer();
    const input = new ElementStub();
    input.tagName = 'INPUT';
    expect(key('KeyW', 'keydown', input).defaultPrevented).toBe(false);
    key('Digit3', 'keydown', input);
    expect(socket.sent.some(message => message.type === 'action')).toBe(false);
    key('Digit3');
    expect(socket.sent.at(-1)).toEqual({ type: 'action', action: 'weapon', weapon: 'rifle' });
    vi.advanceTimersByTime(50);
    expect(lastInput(socket).moveZ).toBe(0);
  });

  it('lets the crafting dialog own Tab navigation without closing it', async () => {
    await connect();
    engine.setCrafting(true);
    const handledByModal = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Tab', repeat: false });
    handledByModal.preventDefault();
    browser.dispatchEvent(handledByModal);
    expect(engine.crafting).toBe(true);
  });

  it('clears held controls when the player dies and does not replay held fire after respawn', async () => {
    const socket = await connect();
    engine.lockPointer();
    key('KeyW');
    mouse(0);
    const dead = snapshot();
    dead.players[0].dead = true;
    socket.receive({ type: 'snapshot', snapshot: dead });
    expect(lastInput(socket)).toMatchObject({ moveZ: 0, fire: false });
    socket.receive({ type: 'snapshot', snapshot: snapshot() });
    engine.lockPointer();
    vi.advanceTimersByTime(50);
    expect(lastInput(socket)).toMatchObject({ moveZ: 0, fire: false });
  });

  it('reconnects with the same session and keeps gameplay paused until resumed', async () => {
    const socket = await connect();
    engine.lockPointer();
    key('KeyW');
    socket.disconnect();
    expect(engine.connected).toBe(false);
    vi.advanceTimersByTime(500);
    const replacement = SocketStub.sockets[1];
    expect(replacement.url.searchParams.get('token')).toBe(session.token);
    welcome(replacement);
    await flush();
    expect(engine.connected).toBe(true);
    vi.advanceTimersByTime(50);
    expect(lastInput(replacement)).toMatchObject({ moveZ: 0, fire: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after another tab takes over the survivor', async () => {
    const socket = await connect();
    socket.disconnect(4000);
    vi.advanceTimersByTime(30_000);
    expect(SocketStub.sockets).toHaveLength(1);
    expect(engine.session).toBeNull();
    expect(storage.size).toBe(0);
    expect(callbacks.onError).toHaveBeenLastCalledWith('This survivor connected in another tab.');
  });

  it('stops retrying a server that never welcomes the reconnecting socket', async () => {
    const socket = await connect();
    socket.disconnect();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(SocketStub.sockets.length).toBeLessThanOrEqual(6);
    expect(engine.connected).toBe(false);
    expect(engine.session).toBeNull();
    expect(callbacks.onError).toHaveBeenLastCalledWith('Connection lost. Check your connection and rejoin with the lobby code.');
  });

  it('restores this tab’s saved survivor through the socket without reserving another player', async () => {
    storage.set('turned.island-session.v1', JSON.stringify(session));
    const pending = engine.resumeSession();
    const socket = SocketStub.sockets[0];
    welcome(socket);
    expect(await pending).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(engine.session).toEqual(session);
  });

  it('explains a failed restoration and retains the same survivor for a retry', async () => {
    storage.set('turned.island-session.v1', JSON.stringify(session));
    const pending = engine.resumeSession();
    SocketStub.sockets[0].disconnect();
    expect(await pending).toBe(false);
    expect(storage.size).toBe(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Could not restore your previous expedition.'));
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('Previous session unavailable');
    const retry = engine.resumeSession();
    const replacement = SocketStub.sockets[1];
    expect(replacement.url.searchParams.get('token')).toBe(session.token);
    welcome(replacement);
    expect(await retry).toBe(true);
    expect(engine.session).toEqual(session);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a cold renderer to delay delivery of the saved-session welcome', async () => {
    storage.set('turned.island-session.v1', JSON.stringify(session));
    const pending = engine.resumeSession();
    const socket = SocketStub.sockets[0];
    vi.advanceTimersByTime(12_000);
    expect(socket.close).not.toHaveBeenCalled();
    welcome(socket);
    expect(await pending).toBe(true);
  });

  it('bounds a silent restore attempt while retaining the survivor for a later retry', async () => {
    storage.set('turned.island-session.v1', JSON.stringify(session));
    const pending = engine.resumeSession();
    const socket = SocketStub.sockets[0];
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await pending).toBe(false);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(1);
    expect(engine.connected).toBe(false);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Reload to retry'));
  });

  it('preserves helpful admission errors instead of turning them into timeout errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'This lobby is full.' }) });
    await expect(engine.joinRoom('abc234', 'Ada')).rejects.toThrow('This lobby is full.');
    expect(callbacks.onError).toHaveBeenCalledWith('This lobby is full.');
    expect(engine.session).toBeNull();
    expect(SocketStub.sockets).toHaveLength(0);
  });

  it('leaves without keeping timers, socket callbacks, or keyboard listeners active', async () => {
    const socket = await connect();
    engine.lockPointer();
    engine.dispose();
    const messages = socket.sent.length;
    key('Digit2');
    vi.advanceTimersByTime(30_000);
    expect(socket.sent).toHaveLength(messages);
    expect(socket.close).toHaveBeenCalled();
    expect(socket.onmessage).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(rendering.disposed).toBe(true);
    expect(storage.size).toBe(1); // Refresh/remount can restore this tab's session.
  });
});
