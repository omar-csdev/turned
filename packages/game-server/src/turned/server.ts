import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_PLAYERS, RECIPES, TICK_RATE, WEAPONS, type ClientMessage, type JoinSession, type PlayerInput, type PlayerState, type RoomInfo, type ServerMessage } from '../../../game-shared/src/turned/protocol';
import { GameSimulation } from '../../../game-shared/src/turned/simulation';

const COLORS = ['#dba346', '#65b7ad', '#be766c', '#9a8ec7', '#91ab64', '#73a3c9', '#d597b0', '#b6ad94'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JSON_LIMIT = 2048;
const SOCKET_LIMIT = 4096;

interface Bucket { available: number; updated: number }
interface Member {
  id: string; token: string; player: PlayerState; socket?: WebSocket;
  expires: number; lastSeq: number; messages: Bucket; actions: Bucket;
}
interface Room {
  code: string; name: string; public: boolean; hostId: string;
  simulation: GameSimulation; members: Map<string, Member>; created: number;
}
export interface TurnedServerOptions {
  maxRooms?: number;
  /** Tests and local hosts may shorten reservation/reconnection expiry. */
  disconnectGraceMs?: number;
  reservationMs?: number;
  roomLifetimeMs?: number;
  requestLimitPerMinute?: number;
  /** Enable only behind a gateway that overwrites X-Forwarded-For with the client IP. */
  trustProxy?: boolean;
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function name(value: unknown, fallback: string, length: number): string {
  if (typeof value !== 'string') return fallback;
  return value.normalize('NFKC').replace(/[\p{C}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, length) || fallback;
}
function consume(bucket: Bucket, capacity: number, perSecond: number, now = Date.now()): boolean {
  bucket.available = Math.min(capacity, bucket.available + Math.max(0, now - bucket.updated) / 1000 * perSecond);
  bucket.updated = now;
  if (bucket.available < 1) return false;
  bucket.available--;
  return true;
}
function bucket(capacity: number): Bucket { return { available: capacity, updated: Date.now() }; }
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > JSON_LIMIT) {
        if (!failed) reject(new RequestError(413, 'Request is too large.'));
        failed = true;
        chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!object(body)) throw new Error('object required');
        resolve(body);
      } catch { reject(new RequestError(400, 'Send a valid JSON object.')); }
    });
    req.on('error', () => reject(new RequestError(400, 'Could not read the request.')));
    req.on('aborted', () => reject(new RequestError(400, 'Request was interrupted.')));
  });
}
function input(value: unknown): PlayerInput | undefined {
  if (!object(value)) return;
  if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 0) return;
  for (const key of ['moveX', 'moveZ', 'yaw', 'pitch']) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return;
  }
  if (Math.abs(value.moveX as number) > 1 || Math.abs(value.moveZ as number) > 1 || Math.abs(value.yaw as number) > 1e6 || Math.abs(value.pitch as number) > Math.PI / 2) return;
  for (const key of ['sprint', 'jump', 'fire', 'aim']) if (typeof value[key] !== 'boolean') return;
  return { seq: value.seq as number, moveX: value.moveX as number, moveZ: value.moveZ as number,
    yaw: (value.yaw as number) % (Math.PI * 2), pitch: value.pitch as number,
    sprint: value.sprint as boolean, jump: value.jump as boolean, fire: value.fire as boolean, aim: value.aim as boolean };
}
function clientMessage(value: unknown): ClientMessage | undefined {
  if (!object(value)) return;
  if (value.type === 'start') return { type: 'start' };
  if (value.type === 'ping' && typeof value.sent === 'number' && Number.isFinite(value.sent)) return { type: 'ping', sent: value.sent };
  if (value.type === 'input') {
    const checked = input(value.input);
    return checked ? { type: 'input', input: checked } : undefined;
  }
  if (value.type === 'action') {
    if (value.action === 'weapon' && typeof value.weapon === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, value.weapon)) {
      return { type: 'action', action: 'weapon', weapon: value.weapon as keyof typeof WEAPONS };
    }
    if (value.action === 'craft' && RECIPES.some(recipe => recipe.id === value.recipe)) {
      return { type: 'action', action: 'craft', recipe: value.recipe as typeof RECIPES[number]['id'] };
    }
    if (value.action === 'reload' || value.action === 'interact' || value.action === 'heal' || value.action === 'eat' || value.action === 'drink' || value.action === 'respawn') {
      return { type: 'action', action: value.action };
    }
  }
}

/** Anonymous, isolated PvE sessions. Tokens are capability credentials and never enter public room data. */
export function createTurnedServer(options: TurnedServerOptions = {}) {
  const rooms = new Map<string, Room>();
  const requestBuckets = new Map<string, Bucket>();
  const maxRooms = options.maxRooms ?? 64;
  const graceMs = options.disconnectGraceMs ?? 30_000;
  const reservationMs = options.reservationMs ?? 45_000;
  const lifetimeMs = options.roomLifetimeMs ?? 6 * 60 * 60_000;
  const requestLimit = options.requestLimitPerMinute ?? 120;
  const trustProxy = options.trustProxy ?? (process.env.TURNED_TRUST_PROXY === '1');
  let closing = false;

  const info = (room: Room): RoomInfo => ({ code: room.code, name: room.name, public: room.public,
    hostId: room.hostId, phase: room.simulation.phase, maxPlayers: MAX_PLAYERS,
    players: [...room.members.values()].map(({ player }) => ({ id: player.id, name: player.name, color: player.color, connected: player.connected })) });
  function send(socket: WebSocket | undefined, message: ServerMessage) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Never accumulate an unbounded queue for a slow or suspended browser.
    if (socket.bufferedAmount > 512 * 1024) { socket.close(1013, 'Connection is too slow. Reconnect to continue.'); return; }
    socket.send(JSON.stringify(message));
  }
  function broadcast(room: Room, message: ServerMessage) {
    for (const member of room.members.values()) send(member.socket, message);
  }
  function publishRoom(room: Room) { broadcast(room, { type: 'room', room: info(room) }); }
  function transferHost(room: Room) {
    const host = room.members.get(room.hostId);
    if (host?.socket?.readyState === WebSocket.OPEN) return;
    const successor = [...room.members.values()].find(member => member.socket?.readyState === WebSocket.OPEN)
      ?? (host ? undefined : room.members.values().next().value);
    if (successor) room.hostId = successor.id;
  }
  function reserve(room: Room, callsign: unknown): JoinSession {
    if (room.simulation.phase === 'won') throw new RequestError(409, 'This expedition has finished. Create a new lobby to play again.');
    if (room.members.size >= MAX_PLAYERS) throw new RequestError(409, 'This lobby is full.');
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const color = COLORS.find(candidate => ![...room.members.values()].some(member => member.player.color === candidate)) ?? COLORS[0];
    const player = room.simulation.addPlayer(id, name(callsign, 'Survivor', 20), color);
    room.simulation.setConnected(id, false);
    room.members.set(id, { id, token, player, expires: Date.now() + reservationMs, lastSeq: -1, messages: bucket(180), actions: bucket(24) });
    if (!room.hostId) room.hostId = id;
    publishRoom(room);
    return { code: room.code, token, playerId: id };
  }
  function cleanup(now: number) {
    for (const room of rooms.values()) {
      for (const member of room.members.values()) {
        if (!member.socket && now >= member.expires) {
          room.members.delete(member.id);
          room.simulation.removePlayer(member.id);
          transferHost(room);
          publishRoom(room);
        }
      }
      if (!room.members.size || now - room.created >= lifetimeMs) {
        rooms.delete(room.code);
        for (const member of room.members.values()) member.socket?.close(1001, 'This session has ended. Create a new lobby.');
      }
    }
    for (const [key, entry] of requestBuckets) if (now - entry.updated > 120_000) requestBuckets.delete(key);
  }
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/turned-api/health' && req.method === 'GET') { json(res, 200, { ok: true, game: 'turned', rooms: rooms.size }); return; }
      if (!path.startsWith('/turned-api/')) throw new RequestError(404, 'Not found.');
      // HTTP admission only; game input is limited per authenticated socket, never per IP.
      const forwarded = req.headers['x-forwarded-for'];
      const address = trustProxy && typeof forwarded === 'string' && isIP(forwarded)
        ? forwarded : req.socket.remoteAddress ?? 'unknown';
      let requests = requestBuckets.get(address);
      if (!requests) {
        if (requestBuckets.size >= 10_000) throw new RequestError(503, 'Server is busy. Try again shortly.');
        requests = bucket(requestLimit);
        requestBuckets.set(address, requests);
      }
      if (!consume(requests, requestLimit, requestLimit / 60)) throw new RequestError(429, 'Too many lobby requests. Please wait a moment.');
      if (path === '/turned-api/rooms' && req.method === 'GET') {
        json(res, 200, { rooms: [...rooms.values()].filter(room => room.public && room.simulation.phase !== 'won').map(info) }); return;
      }
      if (path === '/turned-api/rooms' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.public !== undefined && typeof body.public !== 'boolean') throw new RequestError(400, 'Lobby visibility must be true or false.');
        cleanup(Date.now());
        if (rooms.size >= maxRooms) throw new RequestError(503, 'All island sessions are busy. Try again shortly.');
        let code: string;
        do { code = [...randomBytes(6)].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(''); } while (rooms.has(code));
        const room: Room = { code, name: name(body.roomName, `${name(body.name, 'Survivor', 20)}'s island`, 40), public: body.public === true,
          hostId: '', simulation: new GameSimulation(), members: new Map(), created: Date.now() };
        rooms.set(code, room);
        json(res, 201, reserve(room, body.name)); return;
      }
      const join = /^\/turned-api\/rooms\/([a-zA-Z0-9]{6})\/join$/.exec(path);
      if (join && req.method === 'POST') {
        const body = await readBody(req);
        const room = rooms.get(join[1].toUpperCase());
        if (!room) throw new RequestError(404, 'Lobby not found. Check the invite code.');
        json(res, 200, reserve(room, body.name)); return;
      }
      throw new RequestError(404, 'Not found.');
    })().catch(error => {
      if (!res.headersSent && !res.destroyed) json(res, error instanceof RequestError ? error.status : 500,
        { error: error instanceof RequestError ? error.message : 'The server could not complete this request.' });
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: SOCKET_LIMIT, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return;
    }
    const room = rooms.get((url.searchParams.get('code') ?? '').toUpperCase());
    const token = url.searchParams.get('token');
    const member = room && [...room.members.values()].find(candidate => candidate.token === token);
    if (closing || url.pathname !== '/turned-socket' || !room || !member || (!member.socket && member.expires <= Date.now())) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    // Repeated authenticated upgrade attempts still have a bounded connection budget.
    if (sockets.clients.size >= maxRooms * MAX_PLAYERS + 8) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
    }
    if (!consume(member.messages, 180, 90)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      const previous = member.socket;
      member.socket = ws;
      if (previous) { previous.close(4000, 'Connected in another tab.'); previous.terminate(); }
      room.simulation.setConnected(member.id, true);
      member.lastSeq = -1;
      member.expires = Infinity;
      let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) { ws.terminate(); return; }
        alive = false;
        ws.ping();
      }, 15_000);
      heartbeat.unref();
      ws.on('pong', () => { alive = true; });
      ws.on('error', () => { /* close handles cleanup; no credential-bearing request logs */ });
      ws.on('close', () => {
        clearInterval(heartbeat);
        if (member.socket !== ws) return;
        member.socket = undefined;
        room.simulation.setConnected(member.id, false);
        member.expires = Date.now() + graceMs;
        transferHost(room);
        publishRoom(room);
      });
      ws.on('message', (bytes, binary) => {
        if (member.socket !== ws || !rooms.has(room.code)) return;
        if (!consume(member.messages, 180, 90)) { ws.close(1008, 'Too many messages.'); return; }
        let message: ClientMessage | undefined;
        try { if (!binary) message = clientMessage(JSON.parse(bytes.toString())); } catch { /* reject malformed data below */ }
        if (!message) { send(ws, { type: 'error', message: 'Invalid game message.' }); return; }
        if (message.type === 'ping') { send(ws, { type: 'pong', sent: message.sent }); return; }
        if (message.type === 'input') {
          if (message.input.seq <= member.lastSeq) return;
          member.lastSeq = message.input.seq;
          room.simulation.setInput(member.id, message.input);
        } else if (message.type === 'start') {
          if (room.hostId !== member.id) { send(ws, { type: 'error', message: 'Only the lobby host can start the expedition.' }); return; }
          room.simulation.start();
          publishRoom(room);
        } else if (consume(member.actions, 24, 12)) {
          room.simulation.action(member.id, message);
        }
      });
      send(ws, { type: 'welcome', playerId: member.id, room: info(room), snapshot: room.simulation.snapshot() });
      publishRoom(room);
    });
  });
  let ticks = 0;
  const timer = setInterval(() => {
    if (closing) return;
    for (const room of rooms.values()) {
      if (![...room.members.values()].some(member => member.socket?.readyState === WebSocket.OPEN)) continue;
      const previousPhase = room.simulation.phase;
      room.simulation.step(1 / TICK_RATE);
      broadcast(room, { type: 'snapshot', snapshot: room.simulation.snapshot() });
      if (room.simulation.phase !== previousPhase) publishRoom(room);
    }
    if (++ticks % TICK_RATE === 0) cleanup(Date.now());
  }, 1000 / TICK_RATE);
  timer.unref();

  return {
    server,
    listen(port = Number(process.env.TURNED_PORT ?? process.env.PORT ?? 3003), host = '0.0.0.0'): Promise<{ port: number; host: string }> {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          const address = server.address();
          if (!address || typeof address === 'string') { reject(new Error('Server did not expose a TCP address.')); return; }
          resolve({ port: address.port, host: address.address });
        });
      });
    },
    async close(): Promise<void> {
      closing = true;
      clearInterval(timer);
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rooms.clear();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createTurnedServer();
  app.listen().then(({ port }) => console.log(`Turned island server listening on port ${port}`)).catch(() => {
    console.error('Turned could not start. Check the port configuration.');
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
}
