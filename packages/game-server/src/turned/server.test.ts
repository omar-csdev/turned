import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { EMPTY_INPUT, MAX_PLAYERS, type JoinSession, type RoomInfo, type ServerMessage } from '../../../game-shared/src/turned/protocol';
import { createTurnedServer, type TurnedServerOptions } from './server';
import { GameSimulation } from '../../../game-shared/src/turned/simulation';

const applications: ReturnType<typeof createTurnedServer>[] = [];
afterEach(async () => { await Promise.all(applications.splice(0).map(app => app.close())); vi.restoreAllMocks(); });

async function application(options: TurnedServerOptions = {}) {
  const app = createTurnedServer(options);
  applications.push(app);
  const { port } = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  async function post(path: string, body: unknown) {
    return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function create(name = 'Survivor', isPublic = false): Promise<JoinSession> {
    const response = await post('/turned-api/rooms', { name, roomName: 'Friends on Pinefall', public: isPublic });
    expect(response.status).toBe(201);
    return response.json() as Promise<JoinSession>;
  }
  async function join(code: string, name = 'Friend'): Promise<JoinSession> {
    const response = await post(`/turned-api/rooms/${code}/join`, { name });
    expect(response.status).toBe(200);
    return response.json() as Promise<JoinSession>;
  }
  return { app, base, post, create, join, socket: (session: JoinSession) => connect(base, session) };
}

function connect(base: string, session: JoinSession) {
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/turned-socket?code=${session.code}&token=${session.token}`);
  const messages: ServerMessage[] = [];
  const waiters = new Set<() => void>();
  socket.on('message', bytes => {
    messages.push(JSON.parse(bytes.toString()));
    for (const waiter of waiters) waiter();
  });
  socket.on('error', () => {});
  function next<T extends ServerMessage['type']>(type: T, predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { waiters.delete(check); reject(new Error(`Timed out waiting for ${type}`)); }, 4000);
      function check() {
        const index = messages.findIndex(message => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>));
        if (index === -1) return;
        clearTimeout(timeout);
        waiters.delete(check);
        resolve(messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>);
      }
      waiters.add(check);
      check();
    });
  }
  return { socket, next, send: (message: unknown) => socket.send(JSON.stringify(message)) };
}

describe('Turned HTTP and WebSocket sessions', () => {
  it('lists only public lobbies and keeps tokens and state isolated between rooms', async () => {
    const app = await application();
    const privateSession = await app.create('Private host');
    const publicSession = await app.create('Public host', true);
    const privateClient = app.socket(privateSession);
    const publicClient = app.socket(publicSession);
    const [privateWelcome, publicWelcome] = await Promise.all([privateClient.next('welcome'), publicClient.next('welcome')]);
    expect(privateWelcome.snapshot.players.map(player => player.id)).toEqual([privateSession.playerId]);
    expect(publicWelcome.snapshot.players.map(player => player.id)).toEqual([publicSession.playerId]);
    const listing = await (await fetch(app.base + '/turned-api/rooms')).json() as { rooms: RoomInfo[] };
    expect(listing.rooms.map((room: { code: string }) => room.code)).toEqual([publicSession.code]);
    expect(JSON.stringify(listing)).not.toContain(publicSession.token);
    expect(JSON.stringify(privateWelcome)).not.toContain(privateSession.token);
    publicClient.send({ type: 'start' });
    expect((await publicClient.next('snapshot', message => message.snapshot.phase === 'playing')).snapshot.phase).toBe('playing');
    expect((await privateClient.next('snapshot')).snapshot.phase).toBe('lobby');
  });

  it('requires the host to start and admits friends to an ongoing expedition', async () => {
    const app = await application();
    const hostSession = await app.create();
    const host = app.socket(hostSession);
    await host.next('welcome');
    const friendSession = await app.join(hostSession.code.toLowerCase());
    const friend = app.socket(friendSession);
    await friend.next('welcome');
    friend.send({ type: 'start' });
    expect((await friend.next('error')).message).toMatch(/host/);
    expect((await host.next('snapshot')).snapshot.phase).toBe('lobby');
    host.send({ type: 'start' });
    await friend.next('snapshot', message => message.snapshot.phase === 'playing');
    const lateSession = await app.join(hostSession.code, 'Late friend');
    const late = app.socket(lateSession);
    const welcome = await late.next('welcome');
    expect(welcome.snapshot.phase).toBe('playing');
    expect(welcome.snapshot.players).toHaveLength(3);
  });

  it('enforces capacity including reserved slots and bounds anonymous room creation', async () => {
    const app = await application({ maxRooms: 1 });
    const session = await app.create();
    for (let i = 1; i < MAX_PLAYERS; i++) await app.join(session.code, `Friend ${i}`);
    expect((await app.post(`/turned-api/rooms/${session.code}/join`, { name: 'Extra' })).status).toBe(409);
    expect((await app.post('/turned-api/rooms', { name: 'Second host' })).status).toBe(503);
    expect((await fetch(app.base + '/turned-api/health')).status).toBe(200);
  });

  it('closes completed expeditions to new players while allowing existing survivors to reconnect', async () => {
    // The simulation suite covers winning through play; this fixture exercises server admission at that phase.
    vi.spyOn(GameSimulation.prototype, 'step').mockImplementation(function (this: GameSimulation) { if (this.phase === 'playing') this.phase = 'won'; });
    const app = await application();
    const session = await app.create('Winner', true);
    const client = app.socket(session);
    await client.next('welcome');
    client.send({ type: 'start' });
    await client.next('room', message => message.room.phase === 'won');
    expect(await (await fetch(app.base + '/turned-api/rooms')).json()).toEqual({ rooms: [] });
    const refused = await app.post(`/turned-api/rooms/${session.code}/join`, { name: 'Late friend' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: expect.stringMatching(/finished/) });
    const closed = new Promise<void>(resolve => client.socket.once('close', () => resolve()));
    client.socket.close();
    await closed;
    const reconnected = app.socket(session);
    expect((await reconnected.next('welcome')).snapshot.phase).toBe('won');
  });

  it('rejects malformed requests, unknown messages and invalid inputs without crashing', async () => {
    const app = await application();
    expect((await fetch(app.base + '/turned-api/rooms', { method: 'POST', body: '{bad' })).status).toBe(400);
    expect((await app.post('/turned-api/rooms', { roomName: 'a'.repeat(3000) })).status).toBe(413);
    expect((await app.post('/turned-api/rooms', { public: 'yes' })).status).toBe(400);
    expect((await app.post('/turned-api/rooms/ABCDEF/join', { name: 'Friend' })).status).toBe(404);
    const session = await app.create('  <Friend>\u0000  ');
    const client = app.socket(session);
    expect((await client.next('welcome')).room.players[0].name).toBe('Friend');
    for (const malformed of ['{', JSON.stringify({ type: 'teleport', x: 999 }), JSON.stringify({ type: 'input', input: { ...EMPTY_INPUT, moveX: 200 } }), JSON.stringify({ type: 'input', input: { ...EMPTY_INPUT, yaw: null } }), JSON.stringify({ type: 'action', action: 'weapon', weapon: '__proto__' })]) {
      client.socket.send(malformed);
      expect((await client.next('error')).message).toBe('Invalid game message.');
    }
    client.send({ type: 'ping', sent: 731 });
    expect((await client.next('pong')).sent).toBe(731);
    expect(await (await fetch(app.base + '/turned-api/health')).json()).toMatchObject({ ok: true });
  });

  it('refuses invalid capability tokens and keeps valid sessions usable', async () => {
    const app = await application();
    const session = await app.create();
    const invalid = app.socket({ ...session, token: 'wrong' });
    const status = await new Promise<number>(resolve => {
      invalid.socket.on('unexpected-response', (_, response) => { response.resume(); invalid.socket.terminate(); resolve(response.statusCode ?? 0); });
    });
    expect(status).toBe(401);
    const valid = app.socket(session);
    expect((await valid.next('welcome')).playerId).toBe(session.playerId);
  });

  it('transfers host on disconnect and reconnects the same survivor within the grace period', async () => {
    const app = await application();
    const hostSession = await app.create();
    const host = app.socket(hostSession);
    await host.next('welcome');
    const friendSession = await app.join(hostSession.code);
    const friend = app.socket(friendSession);
    await friend.next('welcome');
    host.socket.close();
    const room = await friend.next('room', message => message.room.hostId === friendSession.playerId);
    expect(room.room.players.find(player => player.id === hostSession.playerId)?.connected).toBe(false);
    const reconnected = app.socket(hostSession);
    const welcome = await reconnected.next('welcome');
    expect(welcome.playerId).toBe(hostSession.playerId);
    expect(welcome.room.players).toHaveLength(2);
    expect(welcome.room.hostId).toBe(friendSession.playerId);
    friend.send({ type: 'start' });
    await reconnected.next('snapshot', message => message.snapshot.phase === 'playing');
  });

  it('ignores replayed input sequences and accepts fresh sequences after reconnect', async () => {
    const app = await application();
    const session = await app.create();
    const client = app.socket(session);
    const welcome = await client.next('welcome');
    client.send({ type: 'start' });
    client.send({ type: 'input', input: { ...EMPTY_INPUT, seq: 5, yaw: 1, moveZ: 1 } });
    client.send({ type: 'input', input: { ...EMPTY_INPUT, seq: 4, yaw: 2, moveZ: 1 } });
    const moved = (await client.next('snapshot', message => message.snapshot.players[0].moving)).snapshot.players[0];
    expect(moved.yaw).toBeCloseTo(1);
    expect(Math.hypot(moved.x - welcome.snapshot.players[0].x, moved.z - welcome.snapshot.players[0].z)).toBeLessThan(2);
    const closed = new Promise<void>(resolve => client.socket.once('close', () => resolve()));
    client.socket.close();
    await closed;
    const reconnected = app.socket(session);
    await reconnected.next('welcome');
    reconnected.send({ type: 'input', input: { ...EMPTY_INPUT, seq: 0, yaw: .5, moveZ: 1 } });
    const resumed = (await reconnected.next('snapshot', message => message.snapshot.players[0].moving)).snapshot.players[0];
    expect(resumed.yaw).toBeCloseTo(.5);
  });

  it('expires abandoned reservations and removes empty rooms', async () => {
    const app = await application({ reservationMs: 50 });
    await app.create('Absent host', true);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(await (await fetch(app.base + '/turned-api/rooms')).json()).toEqual({ rooms: [] });
  });

  it('limits oversized websocket payloads and keeps the server responsive', async () => {
    const app = await application();
    const session = await app.create();
    const client = app.socket(session);
    await client.next('welcome');
    const closed = new Promise<number>(resolve => client.socket.once('close', code => resolve(code)));
    client.socket.send('x'.repeat(5000));
    expect(await closed).toBe(1009);
    expect((await fetch(app.base + '/turned-api/health')).status).toBe(200);
  });

  it('limits repeated lobby requests without applying an IP quota to game input', async () => {
    const app = await application({ requestLimitPerMinute: 10 });
    const session = await app.create();
    const clients = [app.socket(session)];
    for (let i = 1; i < MAX_PLAYERS; i++) clients.push(app.socket(await app.join(session.code, `Friend ${i}`)));
    await Promise.all(clients.map(client => client.next('welcome')));
    expect((await fetch(app.base + '/turned-api/rooms')).status).toBe(200);
    expect((await fetch(app.base + '/turned-api/rooms')).status).toBe(200);
    expect((await fetch(app.base + '/turned-api/rooms')).status).toBe(429);
    for (const client of clients) {
      for (let i = 0; i < 60; i++) client.send({ type: 'input', input: { ...EMPTY_INPUT, seq: i } });
      client.send({ type: 'ping', sent: 52 });
    }
    for (const client of clients) expect((await client.next('pong')).sent).toBe(52);
  });

  it('trusts forwarded client addresses only when a controlled gateway is configured', async () => {
    const direct = await application({ requestLimitPerMinute: 1 });
    const headersA = { 'X-Forwarded-For': '192.0.2.10' }, headersB = { 'X-Forwarded-For': '192.0.2.11' };
    expect((await fetch(direct.base + '/turned-api/rooms', { headers: headersA })).status).toBe(200);
    expect((await fetch(direct.base + '/turned-api/rooms', { headers: headersB })).status).toBe(429);

    const proxied = await application({ requestLimitPerMinute: 1, trustProxy: true });
    expect((await fetch(proxied.base + '/turned-api/rooms', { headers: headersA })).status).toBe(200);
    expect((await fetch(proxied.base + '/turned-api/rooms', { headers: headersB })).status).toBe(200);
    expect((await fetch(proxied.base + '/turned-api/rooms', { headers: headersA })).status).toBe(429);
    expect((await fetch(proxied.base + '/turned-api/rooms', { headers: { 'X-Forwarded-For': 'invalid, spoofed' } })).status).toBe(200);
    expect((await fetch(proxied.base + '/turned-api/rooms', { headers: { 'X-Forwarded-For': 'another invalid string' } })).status).toBe(429);
  });
});
