import {
  EMPTY_INPUT, TICK_RATE,
  type ClientMessage, type GameEvent, type GameSnapshot, type JoinSession,
  type PlayerAction, type PlayerInput, type PlayerState, type RoomInfo, type ServerMessage,
} from '@survive-the-night/game-shared/turned/protocol';
import { TurnedRenderer } from './render/renderer';

export interface EngineCallbacks {
  onSnapshot(snapshot: GameSnapshot): void;
  onRoom(room: RoomInfo): void;
  onStatus(status: string): void;
  onError(message: string): void;
  onPointerLock(locked: boolean): void;
  onSession?(session: JoinSession | null): void;
  onCrafting?(open: boolean): void;
  onMap?(open: boolean): void;
}

const SESSION_KEY = 'turned.island-session.v1';
// A cold WebGL frame can briefly stall browser event delivery on software/low-end GPUs.
const CONNECT_TIMEOUT_MS = 30_000;
const LOOK_LIMIT = 1.45;
const TAU = Math.PI * 2;
const WEAPON_KEYS = { Digit1: 'axe', Digit2: 'pistol', Digit3: 'rifle', Digit4: 'shotgun' } as const;
const ACTION_KEYS = { KeyR: 'reload', KeyE: 'interact', KeyH: 'heal', KeyQ: 'eat', KeyX: 'drink' } as const;
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function editing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not connect to the island. Please try again.';
}
function validSession(value: unknown): value is JoinSession {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<JoinSession>;
  return typeof s.code === 'string' && /^[A-Z0-9]{6}$/.test(s.code) &&
    typeof s.token === 'string' && s.token.length >= 16 && s.token.length < 256 &&
    typeof s.playerId === 'string' && s.playerId.length > 0 && s.playerId.length < 100;
}

/** Networking, local view and input only. The server owns all gameplay state. */
export class TurnedEngine {
  private readonly renderer: TurnedRenderer;
  private readonly audio = new IslandAudio();
  private readonly keys = new Set<string>();
  private socket: WebSocket | null = null;
  private snapshot: GameSnapshot | null = null;
  private currentSession: JoinSession | null = null;
  private joined = false;
  private disposed = false;
  private controlsActive = false;
  private pointerRequested = false;
  private craftOpen = false;
  private mapVisible = false;
  private firing = false;
  private firePressed = false;
  private jumpPressed = false;
  private aiming = false;
  private yaw = 0;
  private pitch = 0;
  private sensitivity = 1;
  private seq = 0;
  private epoch = 0;
  private lastEventId = -1;
  private lastFrame = 0;
  private frame = 0;
  private reconnectAttempts = 0;
  private reconnectStarted = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectCancel: (() => void) | null = null;
  private request: AbortController | null = null;
  private readonly inputTimer: ReturnType<typeof setInterval>;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private status = '';

  constructor(container: HTMLElement, private readonly callbacks: EngineCallbacks) {
    this.renderer = new TurnedRenderer(container);
    this.renderer.setPreview(true);
    this.renderer.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.renderer.canvas.addEventListener('webglcontextlost', this.onContextLost);
    document.addEventListener('pointerlockchange', this.onPointerChange);
    document.addEventListener('pointerlockerror', this.onPointerError);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pagehide', this.onPageHide);
    this.inputTimer = setInterval(() => this.sendInput(), 1000 / TICK_RATE);
    this.pingTimer = setInterval(() => {
      if (this.connected) this.send({ type: 'ping', sent: Date.now() });
    }, 5000);
    this.frame = requestAnimationFrame(this.animate);
    this.setStatus('Ready for the island');
  }

  get playerId(): string | null { return this.currentSession?.playerId ?? null; }
  get session(): JoinSession | null { return this.currentSession ? { ...this.currentSession } : null; }
  get connected(): boolean { return this.joined && this.socket?.readyState === WebSocket.OPEN; }
  get crafting(): boolean { return this.craftOpen; }
  get mapOpen(): boolean { return this.mapVisible; }

  async createRoom(name: string, roomName: string, isPublic: boolean): Promise<void> {
    await this.reserve('/turned-api/rooms', { name, roomName, public: isPublic });
  }

  async joinRoom(code: string, name: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      const error = new Error('Enter the six-character invite code.');
      this.callbacks.onError(error.message);
      throw error;
    }
    await this.reserve(`/turned-api/rooms/${normalized}/join`, { name });
  }

  async quickPlay(name: string): Promise<void> {
    await this.createRoom(name, `${name.trim() || 'Survivor'}'s expedition`, false);
    this.startGame();
  }

  /** Explicitly restore this tab's session after a refresh. No credentials go into URLs in the page. */
  async resumeSession(): Promise<boolean> {
    if (this.disposed || this.currentSession) return false;
    let saved: unknown;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return false; }
    if (!validSession(saved)) return false;
    this.leave(false);
    this.currentSession = saved;
    const epoch = this.epoch;
    this.setStatus('Rejoining your island…');
    try {
      await this.connectOnce(saved, epoch);
      return true;
    } catch (error) {
      if (epoch === this.epoch) {
        this.leave(false);
        this.setStatus('Previous session unavailable');
        this.callbacks.onError(`Could not restore your previous expedition. ${errorText(error)} Reload to retry, or join a new expedition.`);
      }
      return false;
    }
  }

  startGame(): void {
    this.audio.unlock();
    if (!this.connected) { this.callbacks.onError('Connect to a lobby before starting.'); return; }
    this.send({ type: 'start' });
  }

  action(action: PlayerAction): void {
    this.audio.unlock();
    if (!this.connected) { this.callbacks.onError('The island is reconnecting. Try again once connected.'); return; }
    this.send({ type: 'action', ...action });
  }

  /** Call directly from a click handler so browser pointer lock has a user gesture. */
  lockPointer(): void {
    if (this.disposed || !this.connected) return;
    this.audio.unlock();
    this.setCrafting(false);
    this.setMap(false);
    if (document.pointerLockElement === this.renderer.canvas) {
      this.setControls(true);
      return;
    }
    this.pointerRequested = true;
    try {
      if (!this.renderer.canvas.requestPointerLock) { this.pointerFallback(); return; }
      const pending = this.renderer.canvas.requestPointerLock();
      if (pending && typeof pending.catch === 'function') void pending.catch(() => this.pointerFallback());
    } catch { this.pointerFallback(); }
  }

  pause(): void {
    this.pointerRequested = false;
    this.setControls(false);
    if (document.pointerLockElement === this.renderer.canvas) document.exitPointerLock?.();
  }

  setCrafting(open: boolean): void {
    if (open && (!this.connected || this.snapshot?.phase !== 'playing' || this.localPlayer?.dead)) return;
    if (this.craftOpen === open) return;
    this.craftOpen = open;
    if (open) { this.setMap(false); this.pause(); }
    this.callbacks.onCrafting?.(open);
  }

  setMap(open: boolean): void {
    if (open && (!this.connected || this.snapshot?.phase !== 'playing')) return;
    if (this.mapVisible === open) return;
    this.mapVisible = open;
    if (open) { this.setCrafting(false); this.pause(); }
    this.callbacks.onMap?.(open);
  }

  setSettings(settings: { sensitivity?: number; blood?: boolean; volume?: number }): void {
    if (Number.isFinite(settings.sensitivity)) this.sensitivity = Math.max(.15, Math.min(3, settings.sensitivity!));
    if (typeof settings.blood === 'boolean') this.renderer.setSettings({ blood: settings.blood });
    if (Number.isFinite(settings.volume)) this.audio.setVolume(Math.max(0, Math.min(1, settings.volume!)));
  }

  leave(clearSaved = true): void {
    this.epoch++;
    this.request?.abort();
    this.request = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connectCancel?.();
    this.connectCancel = null;
    this.pause();
    this.setCrafting(false);
    this.setMap(false);
    const socket = this.socket;
    this.socket = null;
    this.joined = false;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close(1000, 'Left island');
    }
    this.currentSession = null;
    this.snapshot = null;
    this.lastEventId = -1;
    this.yaw = this.pitch = this.seq = 0;
    this.reconnectAttempts = 0;
    this.reconnectStarted = 0;
    this.audio.stopEngine();
    this.renderer.setPreview(true);
    if (clearSaved) this.saveSession(null);
    this.callbacks.onSession?.(null);
    this.setStatus('Ready for the island');
  }

  dispose(): void {
    if (this.disposed) return;
    this.leave(false);
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    clearInterval(this.inputTimer);
    clearInterval(this.pingTimer);
    this.renderer.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.renderer.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    document.removeEventListener('pointerlockchange', this.onPointerChange);
    document.removeEventListener('pointerlockerror', this.onPointerError);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pagehide', this.onPageHide);
    this.audio.dispose();
    this.renderer.dispose();
  }

  private get localPlayer(): PlayerState | undefined {
    return this.snapshot?.players.find(player => player.id === this.playerId);
  }

  private async reserve(path: string, body: Record<string, unknown>): Promise<void> {
    if (this.disposed) throw new Error('This game view has been closed.');
    this.leave();
    const epoch = this.epoch;
    const request = new AbortController();
    this.request = request;
    const timeout = setTimeout(() => request.abort(), 12_000);
    this.setStatus('Connecting to the island…');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: request.signal });
      let result: unknown;
      try { result = await response.json(); } catch { throw new Error('The island server is unavailable. Please try again.'); }
      if (!response.ok) {
        const message = (result as { error?: unknown })?.error;
        throw new Error(typeof message === 'string' ? message : 'The island server could not create this session.');
      }
      if (!validSession(result)) throw new Error('The server returned an invalid session. Please try again.');
      if (epoch !== this.epoch || this.disposed) throw new Error('Connection cancelled.');
      this.currentSession = result;
      await this.connectOnce(result, epoch);
    } catch (error) {
      if (epoch === this.epoch && !this.disposed) {
        const message = request.signal.aborted ? 'The island server did not respond. Please try again.' : errorText(error);
        this.leave();
        this.setStatus('Connection unavailable');
        this.callbacks.onError(message);
        throw new Error(message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.request === request) this.request = null;
    }
  }

  private connectOnce(session: JoinSession, epoch: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (epoch !== this.epoch || this.disposed) { reject(new Error('Connection cancelled.')); return; }
      const url = new URL('/turned-socket', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('code', session.code);
      url.searchParams.set('token', session.token);
      const socket = new WebSocket(url);
      this.socket = socket;
      let welcomed = false;
      const cancel = () => {
        clearTimeout(timeout);
        reject(new Error('Connection cancelled.'));
      };
      this.connectCancel = cancel;
      const timeout = setTimeout(() => {
        if (this.socket === socket) this.socket = null;
        socket.onclose = null;
        socket.onmessage = null;
        socket.close();
        if (this.connectCancel === cancel) this.connectCancel = null;
        reject(new Error('Could not reach the multiplayer server. Please try again.'));
      }, CONNECT_TIMEOUT_MS);
      socket.onmessage = event => {
        if (epoch !== this.epoch || this.socket !== socket || this.disposed) return;
        let message: ServerMessage;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'welcome') {
          clearTimeout(timeout);
          welcomed = true;
          this.connectCancel = null;
          this.joined = true;
          this.currentSession = { ...session, playerId: message.playerId };
          this.seq = 0;
          this.reconnectAttempts = 0;
          this.reconnectStarted = 0;
          const player = message.snapshot.players.find(p => p.id === message.playerId);
          if (player) { this.yaw = player.yaw; this.pitch = player.pitch; }
          this.lastEventId = Math.max(-1, ...message.snapshot.events.map(e => e.id));
          this.renderer.setView(this.yaw, this.pitch);
          this.saveSession(this.currentSession);
          this.callbacks.onSession?.({ ...this.currentSession });
          this.callbacks.onRoom(message.room);
          this.applySnapshot(message.snapshot);
          this.setStatus('Connected');
          resolve();
        } else if (message.type === 'snapshot' && welcomed) this.applySnapshot(message.snapshot);
        else if (message.type === 'room') this.callbacks.onRoom(message.room);
        else if (message.type === 'error') this.callbacks.onError(message.message);
      };
      socket.onerror = () => { /* Close reports a safe message without leaking the token-bearing URL. */ };
      socket.onclose = event => {
        clearTimeout(timeout);
        if (this.connectCancel === cancel) this.connectCancel = null;
        if (epoch !== this.epoch || this.socket !== socket || this.disposed) return;
        this.socket = null;
        this.joined = false;
        this.pause();
        if (!welcomed) { reject(new Error('Could not join this island. The invite or saved session may have expired.')); return; }
        if ([1001, 1008, 4000].includes(event.code)) {
          const message = event.code === 4000 ? 'This survivor connected in another tab.' :
            event.code === 1001 ? 'This island session has ended. Create a new lobby.' : 'The server closed this connection. Please rejoin.';
          this.leave();
          this.setStatus('Disconnected');
          this.callbacks.onError(message);
        } else this.scheduleReconnect(epoch);
      };
    });
  }

  private scheduleReconnect(epoch: number): void {
    if (epoch !== this.epoch || this.disposed || !this.currentSession) return;
    if (!this.reconnectStarted) this.reconnectStarted = Date.now();
    if (this.reconnectAttempts >= 5 || Date.now() - this.reconnectStarted > 25_000) {
      this.leave();
      this.setStatus('Disconnected');
      this.callbacks.onError('Connection lost. Check your connection and rejoin with the lobby code.');
      return;
    }
    const delay = Math.min(500 * 2 ** this.reconnectAttempts, 6000);
    this.reconnectAttempts++;
    this.setStatus(`Reconnecting… (${this.reconnectAttempts}/5)`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const session = this.currentSession;
      if (!session || epoch !== this.epoch) return;
      void this.connectOnce(session, epoch).catch(() => this.scheduleReconnect(epoch));
    }, delay);
  }

  private applySnapshot(snapshot: GameSnapshot): void {
    const wasDead = this.localPlayer?.dead;
    this.snapshot = snapshot;
    this.renderer.setPreview(snapshot.phase === 'lobby');
    this.renderer.setSnapshot(snapshot, this.playerId!);
    const player = this.localPlayer;
    if (player?.dead && !wasDead || snapshot.phase === 'won') {
      this.setCrafting(false);
      this.setMap(false);
      if (this.controlsActive) this.pause();
    }
    for (const event of snapshot.events) {
      if (event.id <= this.lastEventId) continue;
      if (player) this.audio.event(event, player);
      this.lastEventId = Math.max(this.lastEventId, event.id);
    }
    this.callbacks.onSnapshot(snapshot);
  }

  private setStatus(status: string): void {
    if (status === this.status) return;
    this.status = status;
    this.callbacks.onStatus(status);
  }

  private saveSession(session: JoinSession | null): void {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* Private browsing may disable session storage. Gameplay still works. */ }
  }

  private send(message: ClientMessage): void {
    if (!this.connected || !this.socket || this.socket.bufferedAmount > 64 * 1024) return;
    this.socket.send(JSON.stringify(message));
  }

  private sendInput(): void {
    if (!this.connected) return;
    const active = this.controlsActive && !this.craftOpen && !this.mapVisible && this.snapshot?.phase === 'playing' && !this.localPlayer?.dead;
    const input: PlayerInput = { ...EMPTY_INPUT, seq: ++this.seq, yaw: this.yaw, pitch: this.pitch };
    if (active) {
      input.moveX = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      input.moveZ = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
      const length = Math.hypot(input.moveX, input.moveZ);
      if (length > 1) { input.moveX /= length; input.moveZ /= length; }
      input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      input.jump = this.keys.has('Space') || this.jumpPressed;
      input.fire = this.firing || this.firePressed;
      input.aim = this.aiming;
    }
    this.send({ type: 'input', input });
    this.firePressed = this.jumpPressed = false;
  }

  private setControls(active: boolean): void {
    const changed = this.controlsActive !== active;
    this.controlsActive = active;
    if (!active) {
      this.keys.clear();
      this.firing = this.aiming = this.firePressed = this.jumpPressed = false;
      this.renderer.setAim(false);
      this.sendInput();
    }
    if (changed) this.callbacks.onPointerLock(active);
  }

  private pointerFallback(): void {
    if (!this.pointerRequested || this.disposed || !this.connected) return;
    this.pointerRequested = false;
    this.setControls(true);
    this.setStatus('Mouse capture unavailable — use arrow keys to look');
  }

  private onPointerChange = (): void => {
    const locked = document.pointerLockElement === this.renderer.canvas;
    this.pointerRequested = false;
    this.setControls(locked && !this.craftOpen && !this.mapVisible);
  };
  private onPointerError = (): void => this.pointerFallback();
  private onContextMenu = (event: Event): void => event.preventDefault();
  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.pause();
    this.callbacks.onError('The graphics context was interrupted. Refresh to restore the game; your session is saved in this tab.');
  };
  private onBlur = (): void => { this.pause(); this.audio.stopEngine(); };
  private onVisibility = (): void => { if (document.hidden) this.onBlur(); };
  private onPageHide = (): void => this.leave(false);

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || editing(event.target) || !this.connected || this.snapshot?.phase !== 'playing') return;
    if (event.code === 'Escape') {
      this.setCrafting(false);
      this.setMap(false);
      this.pause();
      return;
    }
    if (event.code === 'KeyC' || event.code === 'Tab') {
      if (event.repeat || (!this.controlsActive && !this.craftOpen)) return;
      event.preventDefault();
      if (this.craftOpen) this.lockPointer();
      else this.setCrafting(true);
      return;
    }
    if (event.code === 'KeyM') {
      if (event.repeat || (!this.controlsActive && !this.mapVisible)) return;
      event.preventDefault();
      if (this.mapVisible) this.lockPointer();
      else this.setMap(true);
      return;
    }
    if (!this.controlsActive || this.craftOpen || this.mapVisible || this.localPlayer?.dead) return;
    if (MOVEMENT_KEYS.has(event.code)) { event.preventDefault(); this.keys.add(event.code); }
    if (event.repeat) return;
    if (event.code === 'Space') this.jumpPressed = true;
    this.audio.unlock();
    const weapon = WEAPON_KEYS[event.code as keyof typeof WEAPON_KEYS];
    const action = ACTION_KEYS[event.code as keyof typeof ACTION_KEYS];
    if (weapon) { event.preventDefault(); this.action({ action: 'weapon', weapon }); }
    if (action) { event.preventDefault(); this.action({ action }); }
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onMouseMove = (event: MouseEvent): void => {
    if (!this.controlsActive || document.pointerLockElement !== this.renderer.canvas) return;
    const scale = .0022 * this.sensitivity * (this.aiming ? .62 : 1);
    this.yaw = (this.yaw - event.movementX * scale) % TAU;
    this.pitch = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, this.pitch - event.movementY * scale));
    this.renderer.setView(this.yaw, this.pitch);
  };
  private onMouseDown = (event: MouseEvent): void => {
    if (!this.controlsActive || this.craftOpen || this.mapVisible || this.localPlayer?.dead) return;
    if (document.pointerLockElement !== this.renderer.canvas && event.target !== this.renderer.canvas) return;
    this.audio.unlock();
    if (event.button === 0) this.firing = this.firePressed = true;
    if (event.button === 2) { this.aiming = true; this.renderer.setAim(true); }
  };
  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.firing = false;
    if (event.button === 2) { this.aiming = false; this.renderer.setAim(false); }
  };

  private animate = (time: number): void => {
    if (this.disposed) return;
    const dt = Math.min(.08, this.lastFrame ? (time - this.lastFrame) / 1000 : 1 / 60);
    this.lastFrame = time;
    if (this.controlsActive && !this.craftOpen && !this.mapVisible) {
      const turn = Number(this.keys.has('ArrowLeft')) - Number(this.keys.has('ArrowRight'));
      const tilt = Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'));
      if (turn || tilt) {
        this.yaw = (this.yaw + turn * dt * 1.9 * this.sensitivity) % TAU;
        this.pitch = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, this.pitch + tilt * dt * 1.4 * this.sensitivity));
        this.renderer.setView(this.yaw, this.pitch);
      }
    }
    if (this.snapshot && this.connected && !document.hidden) this.audio.update(this.snapshot, this.localPlayer, dt);
    else this.audio.stopEngine();
    try { this.renderer.update(dt); }
    catch (error) {
      this.pause();
      this.callbacks.onError(errorText(error));
      return;
    }
    this.frame = requestAnimationFrame(this.animate);
  };
}

/** Small original WebAudio effects; no borrowed audio assets or autoplay requirement. */
class IslandAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = .4;
  private engine: { oscillator: OscillatorNode; gain: GainNode } | null = null;
  private stepClock = 0;
  private growlClock = 0;

  unlock(): void {
    try {
      if (!this.context) {
        const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) return;
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional when the browser blocks it. */ }
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.context) this.master.gain.setTargetAtTime(volume, this.context.currentTime, .03);
  }

  private tone(frequency: number, end: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const oscillator = context.createOscillator(), envelope = context.createGain();
    const at = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), at + duration);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + .004);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }

  private burst(duration: number, gain: number, frequency: number): void {
    const context = this.context;
    if (!context || !this.master || !this.noise || context.state !== 'running') return;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
    source.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const at = context.currentTime;
    envelope.gain.setValueAtTime(gain, at);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(at);
    source.stop(at + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  event(event: GameEvent, player: PlayerState): void {
    const distance = Math.hypot(event.x - player.x, event.z - player.z);
    const gain = event.actorId === player.id ? 1 : Math.max(0, 1 - distance / 65) * .6;
    if (gain < .01) return;
    if (event.type === 'shot') {
      if (event.weapon === 'axe') this.burst(.13, .22 * gain, 900);
      else {
        this.burst(event.weapon === 'shotgun' ? .22 : .12, .65 * gain, event.weapon === 'rifle' ? 3500 : 2200);
        this.tone(event.weapon === 'shotgun' ? 85 : 140, 38, .13, .4 * gain, 'triangle');
      }
    } else if (event.type === 'hit' || event.type === 'kill') {
      this.burst(.09, .22 * gain, 600);
      if (event.actorId === player.id) this.tone(event.headshot ? 980 : 620, 360, .07, .1, 'triangle');
    } else if (event.type === 'hurt' && event.targetId === player.id) {
      this.tone(105, 48, .25, .3, 'triangle');
      this.burst(.14, .16, 300);
    } else if (event.type === 'pickup' && event.actorId === player.id) {
      this.tone(550, 650, .12, .12, 'sine');
      this.tone(820, 950, .17, .1, 'sine', .07);
    } else if (event.type === 'build') {
      this.burst(.18, .4 * gain, 550);
      this.tone(175, 75, .1, .2 * gain, 'triangle');
    } else if (event.type === 'win') {
      for (const [i, note] of [440, 554, 659, 880].entries()) this.tone(note, note, .5, .1, 'triangle', i * .13);
    }
  }

  update(snapshot: GameSnapshot, player: PlayerState | undefined, dt: number): void {
    const context = this.context;
    if (!player || player.dead || snapshot.phase !== 'playing' || !context || context.state !== 'running' || !this.master) { this.stopEngine(); return; }
    const vehicle = player.vehicleId && snapshot.vehicles.find(v => v.id === player.vehicleId);
    if (vehicle && vehicle.fuel > 0 && vehicle.health > 0) {
      if (!this.engine) {
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = 'sawtooth';
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(this.master);
        oscillator.start();
        this.engine = { oscillator, gain };
      }
      this.engine.oscillator.frequency.setTargetAtTime(32 + Math.abs(vehicle.speed) * 5, context.currentTime, .1);
      this.engine.gain.gain.setTargetAtTime(.025 + Math.min(.04, Math.abs(vehicle.speed) * .003), context.currentTime, .1);
    } else this.stopEngine();
    this.stepClock -= dt;
    if (player.moving && !vehicle && player.y < .1 && this.stepClock <= 0) {
      this.burst(.045, .045, 380);
      this.stepClock = .34;
    }
    this.growlClock -= dt;
    if (this.growlClock <= 0) {
      const near = snapshot.zombies.some(z => z.health > 0 && Math.hypot(z.x - player.x, z.z - player.z) < 15);
      if (near) { this.tone(83, 42, .8, .055, 'sawtooth'); this.burst(.5, .035, 500); }
      this.growlClock = 3.7;
    }
  }

  stopEngine(): void {
    if (!this.engine) return;
    this.engine.oscillator.stop();
    this.engine.oscillator.disconnect();
    this.engine.gain.disconnect();
    this.engine = null;
  }

  dispose(): void {
    this.stopEngine();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.noise = null;
  }
}
