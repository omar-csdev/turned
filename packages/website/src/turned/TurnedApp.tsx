import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Axe,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  Copy,
  Crosshair,
  Crown,
  Droplets,
  Flame,
  Fuel,
  Hammer,
  Heart,
  Leaf,
  Lock,
  LogOut,
  Map,
  MapPin,
  Package,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  Skull,
  Trees,
  Users,
  Volume2,
  Wheat,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  RECIPES,
  WEAPONS,
  type GameSnapshot,
  type PlayerAction,
  type PlayerState,
  type ResourceId,
  type RoomInfo,
  type WeaponId,
} from "@survive-the-night/game-shared/turned/protocol";
import {
  LOCATIONS,
  RADIO,
  RESOURCE_NODES,
  ROADS,
} from "@survive-the-night/game-shared/turned/island";
import type { TurnedEngine } from "./engine";
import "./turned.css";

type Panel = "guide" | "settings" | "crafting" | "pause" | "map" | null;
type PlayTab = "solo" | "host" | "join";
type SettingsState = { sensitivity: number; volume: number; blood: boolean };
const DEFAULT_SETTINGS: SettingsState = { sensitivity: 1, volume: 0.65, blood: true };
function readSettings(): SettingsState {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("turned-settings") || "null");
    if (!saved || typeof saved !== "object") return DEFAULT_SETTINGS;
    const value = saved as Partial<SettingsState>;
    return {
      sensitivity:
        typeof value.sensitivity === "number" && Number.isFinite(value.sensitivity)
          ? Math.min(2.5, Math.max(0.2, value.sensitivity))
          : DEFAULT_SETTINGS.sensitivity,
      volume:
        typeof value.volume === "number" && Number.isFinite(value.volume)
          ? Math.min(1, Math.max(0, value.volume))
          : DEFAULT_SETTINGS.volume,
      blood: typeof value.blood === "boolean" ? value.blood : DEFAULT_SETTINGS.blood,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function clearInviteQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("join")) return;
  url.searchParams.delete("join");
  // Keep the router's history state and unrelated URL parameters intact.
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const RESOURCE_ICONS = { wood: Trees, stone: Package, scrap: Wrench, cloth: Leaf };
const RECIPE_ICONS = {
  bandage: Heart,
  ammo: Crosshair,
  barricade: Shield,
  campfire: Flame,
  workbench: Hammer,
  shotgun: Crosshair,
};
const WEAPON_IDS: WeaponId[] = ["axe", "pistol", "rifle", "shotgun"];
const LOOT_NAMES: Record<string, string> = {
  ammo: "ammunition",
  medkit: "medical supplies",
  food: "canned food",
  water: "bottled water",
  fuel: "fuel can",
  scrap: "scrap metal",
  cloth: "cloth",
  supply: "expedition supply crate",
};
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

export default function TurnedApp() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const engine = useRef<TurnedEngine | null>(null);
  const latest = useRef<GameSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing the island…");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [locked, setLocked] = useState(false);
  const [tab, setTab] = useState<PlayTab>("solo");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [name, setName] = useState("Survivor");
  const [roomName, setRoomName] = useState("The Pinefall expedition");
  const [isPublic, setIsPublic] = useState(false);
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [hit, setHit] = useState(false);
  const eventId = useRef(0);
  const diedAt = useRef<number | null>(null);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playing = snapshot?.phase === "playing" || snapshot?.phase === "won";
  const player = snapshot?.players.find((p) => p.id === playerId);

  useEffect(() => {
    let stopped = false;
    let instance: TurnedEngine | null = null;
    try {
      const storedName = localStorage.getItem("turned-callsign");
      if (storedName) setName(storedName.slice(0, 20));
    } catch {
      /* Storage is optional in private browsers. */
    }
    setSettings(readSettings());
    const invite = new URLSearchParams(window.location.search).get("join");
    if (invite) {
      setCode(
        invite
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 6)
          .toUpperCase(),
      );
      setTab("join");
    }
    import("./engine")
      .then(({ TurnedEngine }) => {
        if (stopped || !canvasHost.current) return;
        instance = new TurnedEngine(canvasHost.current, {
          onSnapshot: (state) => {
            const previous = latest.current;
            latest.current = state;
            setSnapshot(state);
            const ownId = instance?.playerId;
            setPlayerId(ownId || null);
            const fresh = state.events.filter((e) => e.id > eventId.current);
            for (const event of fresh) {
              if (event.actorId === ownId && (event.type === "hit" || event.type === "kill")) {
                setHit(true);
                clearTimeout(hitTimer.current);
                hitTimer.current = setTimeout(() => setHit(false), 140);
              }
              if (event.text && (event.actorId === ownId || !event.actorId)) {
                setNotice(event.text);
                clearTimeout(noticeTimer.current);
                noticeTimer.current = setTimeout(() => setNotice(""), 4200);
              }
            }
            if (fresh.length) eventId.current = Math.max(...fresh.map((e) => e.id));
            const dead = state.players.find((p) => p.id === ownId)?.dead;
            if (dead && diedAt.current === null) diedAt.current = state.time;
            else if (!dead) diedAt.current = null;
            if (
              (state.phase === "won" && previous?.phase !== "won") ||
              (dead && !previous?.players.find((p) => p.id === ownId)?.dead)
            )
              instance?.pause();
          },
          onRoom: (info) => {
            setRoom(info);
            setPlayerId(instance?.playerId || null);
          },
          onStatus: (message) => setStatus(message),
          onError: (message) => {
            setError(message);
            setBusy(false);
          },
          onPointerLock: (active) => {
            setLocked(active);
            if (active) setPanel(null);
            else if (latest.current?.phase === "playing") setPanel((current) => current || "pause");
          },
          onCrafting: (open) => setPanel(open ? "crafting" : null),
          onMap: (open) => setPanel(open ? "map" : null),
          onSession: (session) => {
            setPlayerId(session?.playerId || null);
            if (session) {
              setCode(session.code);
              // Once joined, refreshing must restore the existing survivor instead of
              // treating the original invitation as a request to reserve another seat.
              clearInviteQuery();
            } else {
              if (latest.current) setTab("join");
              setRoom(null);
              setSnapshot(null);
              latest.current = null;
              setPanel(null);
              setLocked(false);
              eventId.current = 0;
              diedAt.current = null;
            }
          },
        });
        engine.current = instance;
        instance.setSettings(readSettings());
        setReady(true);
        setStatus("Island ready");
        if (!invite)
          void instance.resumeSession().catch(() => {
            /* A stale expedition can be replaced from the menu. */
          });
      })
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "Could not initialize the game. Reload to try again.",
        ),
      );
    return () => {
      stopped = true;
      instance?.dispose();
      engine.current = null;
      clearTimeout(hitTimer.current);
      clearTimeout(noticeTimer.current);
      clearTimeout(copyTimer.current);
    };
  }, []);

  async function refreshRooms() {
    setRoomsLoading(true);
    setRoomsError("");
    try {
      const response = await fetch("/turned-api/rooms");
      if (!response.ok)
        throw new Error("Could not reach the expedition server. Try again shortly.");
      const data = await response.json();
      setRooms(data.rooms || []);
    } catch (err) {
      setRoomsError(err instanceof Error ? err.message : "Could not load public expeditions.");
    } finally {
      setRoomsLoading(false);
    }
  }

  async function deploy(joinCode?: string) {
    if (!engine.current || busy) return;
    if (!name.trim()) {
      setError("Choose a callsign before heading out.");
      return;
    }
    setBusy(true);
    setError("");
    eventId.current = 0;
    try {
      try {
        localStorage.setItem("turned-callsign", name.trim());
      } catch {
        /* Optional preference. */
      }
      if (joinCode || tab === "join")
        await engine.current.joinRoom((joinCode || code).trim().toUpperCase(), name.trim());
      else if (tab === "host")
        await engine.current.createRoom(
          name.trim(),
          roomName.trim() || "Pinefall expedition",
          isPublic,
        );
      else await engine.current.quickPlay(name.trim());
      setPlayerId(engine.current.playerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    engine.current?.leave();
    setRoom(null);
    setSnapshot(null);
    latest.current = null;
    setPlayerId(null);
    setPanel(null);
    setLocked(false);
    setError("");
    setNotice("");
    setTab("solo");
    eventId.current = 0;
    clearInviteQuery();
  }
  function resume() {
    setPanel(null);
    engine.current?.lockPointer();
  }
  function openPanel(next: Panel) {
    if (next === "crafting") {
      engine.current?.setCrafting(true);
      setPanel("crafting");
    } else if (next === "map") {
      engine.current?.setMap(true);
      setPanel("map");
    } else {
      setPanel(next);
      if (playing) engine.current?.pause();
    }
  }
  function closePanel() {
    if (playing) resume();
    else setPanel(null);
  }
  function act(action: PlayerAction) {
    engine.current?.action(action);
  }
  function updateSettings(patch: Partial<SettingsState>) {
    const value = { ...settings, ...patch };
    setSettings(value);
    engine.current?.setSettings(value);
    try {
      localStorage.setItem("turned-settings", JSON.stringify(value));
    } catch {
      /* Optional preference. */
    }
  }
  async function copyInvite(link: boolean) {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(
        link ? `${window.location.origin}/?join=${room.code}` : room.code,
      );
      setCopied(link ? "Invite link copied" : "Code copied");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 2400);
    } catch {
      setError(`Clipboard unavailable. Share this expedition code: ${room.code}`);
    }
  }
  const reconnecting = room && /reconnect|disconnect|connecting/i.test(status);

  return (
    <div className={`turned-app ${playing ? "turned-in-game" : "turned-in-menu"}`}>
      <div className="turned-world" ref={canvasHost} aria-label="Pinefall Island game view" />
      {!playing && <div className="turned-menu-shade" />}
      {!playing && (
        <header className="turned-header">
          <button
            className="turned-brand"
            onClick={() => (room ? undefined : setPanel(null))}
            aria-label="Turned home"
          >
            <span className="turned-brand-mark">
              <Trees size={23} strokeWidth={2.5} />
            </span>
            <span>
              TURNED<span className="turned-brand-sub">SURVIVE TOGETHER.</span>
            </span>
          </button>
          <nav aria-label="Main navigation">
            <button onClick={() => setPanel("guide")}>
              <BookOpen size={15} /> Field guide
            </button>
            <button onClick={() => setPanel("settings")}>
              <Settings size={15} /> Settings
            </button>
            <span className="turned-version">ISLAND BUILD / 01</span>
          </nav>
        </header>
      )}

      {!playing && !room && (
        <main className="turned-landing">
          <section className="turned-welcome">
            <div className="turned-eyebrow">
              <span className="turned-signal" /> AN OPEN WORLD. A SECOND CHANCE.
            </div>
            <h1>
              TURNED<span className="turned-title-dot">.</span>
            </h1>
            <p className="turned-intro">
              The island is quiet.
              <br />
              That doesn’t mean you’re alone.
            </p>
            <p className="turned-intro-detail">
              Scavenge. Craft. Stay alive.
              <br className="turned-small-break" /> An original co-op survival adventure, in your
              browser.
            </p>

            <div className="turned-deploy-card">
              <div className="turned-card-caption">
                <span>
                  <Compass size={15} /> YOUR NEXT EXPEDITION
                </span>
                <span>01 — PINEFALL</span>
              </div>
              <div className="turned-play-tabs" role="tablist" aria-label="Expedition mode">
                {(["solo", "host", "join"] as const).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={tab === value}
                    className={tab === value ? "selected" : ""}
                    onClick={() => {
                      setTab(value);
                      setError("");
                    }}
                  >
                    {value === "solo"
                      ? "Play solo"
                      : value === "host"
                        ? "Host friends"
                        : "Join a friend"}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void deploy();
                }}
              >
                <label className="turned-field">
                  <span>YOUR CALLSIGN</span>
                  <input
                    aria-label="Your callsign"
                    maxLength={20}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Choose a survivor name"
                    autoComplete="nickname"
                  />
                </label>
                {tab === "host" && (
                  <>
                    <label className="turned-field">
                      <span>EXPEDITION NAME</span>
                      <input
                        aria-label="Expedition name"
                        maxLength={36}
                        value={roomName}
                        onChange={(event) => setRoomName(event.target.value)}
                      />
                    </label>
                    <label className="turned-check">
                      <input
                        type="checkbox"
                        checked={isPublic}
                        onChange={(event) => setIsPublic(event.target.checked)}
                      />
                      <span>List this expedition publicly</span>
                      <Users size={14} />
                    </label>
                  </>
                )}
                {tab === "join" && (
                  <label className="turned-field">
                    <span>6-CHARACTER INVITE CODE</span>
                    <input
                      aria-label="Invite code"
                      className="turned-code-input"
                      maxLength={6}
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())
                      }
                      placeholder="ABC123"
                      autoComplete="off"
                    />
                  </label>
                )}
                <button
                  type="submit"
                  className="turned-button turned-primary turned-deploy-button"
                  disabled={!ready || busy || !name.trim() || (tab === "join" && code.length !== 6)}
                >
                  <span>
                    {busy
                      ? "Preparing expedition…"
                      : !ready
                        ? "Preparing island…"
                        : tab === "host"
                          ? "Create expedition"
                          : tab === "join"
                            ? "Join expedition"
                            : "Enter the island"}
                  </span>
                  {busy || !ready ? (
                    <RefreshCw size={18} className="turned-spin" />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </button>
              </form>
              <div className="turned-card-foot">
                <span>
                  {tab === "host" ? (
                    <>
                      <Users size={12} /> Up to 8 survivors
                    </>
                  ) : tab === "join" ? (
                    <>
                      <Lock size={12} /> Your squad is waiting
                    </>
                  ) : (
                    <>
                      <Lock size={12} /> Your own private expedition
                    </>
                  )}
                </span>
                <span>No download.</span>
              </div>
            </div>
            <button
              className="turned-browse-link"
              onClick={() => {
                setBrowseOpen(!browseOpen);
                if (!browseOpen) void refreshRooms();
              }}
            >
              <Users size={16} />
              <span>Find an open expedition</span>
              <ArrowRight size={15} />
            </button>
            {browseOpen && (
              <div className="turned-public-rooms">
                <div className="turned-public-heading">
                  <span>OPEN EXPEDITIONS</span>
                  <button
                    aria-label="Refresh public expeditions"
                    onClick={() => void refreshRooms()}
                    disabled={roomsLoading}
                  >
                    <RefreshCw size={15} className={roomsLoading ? "turned-spin" : ""} />
                  </button>
                </div>
                {roomsLoading ? (
                  <p>Checking the radio…</p>
                ) : roomsError ? (
                  <p role="alert">{roomsError}</p>
                ) : rooms.length === 0 ? (
                  <p>No public expeditions yet. Host one and lead the way.</p>
                ) : (
                  rooms.map((publicRoom) => (
                    <button
                      key={publicRoom.code}
                      className="turned-room-row"
                      onClick={() => void deploy(publicRoom.code)}
                      disabled={busy || publicRoom.players.length >= publicRoom.maxPlayers}
                    >
                      <span>
                        {publicRoom.name}
                        <small>
                          {publicRoom.phase === "lobby" ? "At base camp" : "Expedition in progress"}
                        </small>
                      </span>
                      <span>
                        {publicRoom.players.length}/{publicRoom.maxPlayers}
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>
          <aside className="turned-island-feature">
            <div className="turned-world-label">
              <span className="turned-cross">+</span>
              <span>
                46° 14′ N<br />
                63° 08′ W
              </span>
            </div>
            <div className="turned-feature-bottom">
              <div className="turned-island-tag">
                <span className="turned-signal" /> EXPLORE THE FIRST ISLAND
              </div>
              <h2>Pinefall Island</h2>
              <p>
                A little off the coast.
                <br />A long way from safe.
              </p>
              <div className="turned-feature-stats">
                <span>
                  <Trees size={17} /> 6 locations
                </span>
                <span>
                  <Users size={17} /> 1–8 survivors
                </span>
                <span>
                  <Shield size={17} /> Co-op PvE
                </span>
              </div>
              <div className="turned-feature-line" />
              <div className="turned-feature-note">
                <span>GATHER. BUILD. DRIVE. SURVIVE.</span>
                <ArrowDown size={16} />
              </div>
            </div>
          </aside>
        </main>
      )}

      {!playing && room && (
        <main className="turned-lobby-wrap">
          <section className="turned-lobby turned-paper">
            <div className="turned-eyebrow dark">
              <span className="turned-signal" /> BASE CAMP / EXPEDITION LOBBY
            </div>
            <h1>{room.name}</h1>
            <p className="turned-muted">A good plan starts with good company. Invite your crew.</p>
            <div className="turned-invite">
              <div>
                <span>EXPEDITION CODE</span>
                <button onClick={() => void copyInvite(false)} aria-label="Copy expedition code">
                  {room.code}
                  <Copy size={18} />
                </button>
              </div>
              <button
                className="turned-button turned-outline"
                onClick={() => void copyInvite(true)}
              >
                {copied ? <Check size={16} /> : <Users size={16} />}
                {copied || "Copy invite link"}
              </button>
            </div>
            <div className="turned-lobby-heading">
              <span>SURVIVORS</span>
              <span>
                {room.players.length} / {room.maxPlayers}
              </span>
            </div>
            <div className="turned-roster">
              {room.players.map((member) => (
                <div className="turned-member" key={member.id}>
                  <div className="turned-avatar" style={{ background: member.color }}>
                    <span />
                  </div>
                  <span>
                    {member.name}
                    {member.id === playerId && <small>YOU</small>}
                  </span>
                  {member.id === room.hostId && <Crown size={17} aria-label="Host" />}
                  <span className={`turned-member-status ${member.connected ? "online" : ""}`}>
                    {member.connected ? "Ready" : "Reconnecting"}
                  </span>
                </div>
              ))}
              {room.players.length < room.maxPlayers && (
                <div className="turned-empty-member">
                  <Plus size={18} /> Room for a few more good survivors.
                </div>
              )}
            </div>
            <div className="turned-lobby-mission">
              <MapPin size={23} />
              <div>
                <strong>Pinefall Island</strong>
                <span>Cooperative survival · Recover supplies. Reach the radio.</span>
              </div>
              <Shield size={20} />
            </div>
            {room.hostId === playerId ? (
              <button
                className="turned-button turned-primary turned-full"
                onClick={() => {
                  setError("");
                  engine.current?.startGame();
                }}
              >
                <Play size={17} fill="currentColor" /> Start expedition
                <ArrowRight size={18} />
              </button>
            ) : (
              <div className="turned-waiting">
                <span className="turned-signal" /> Waiting for the expedition host to start…
              </div>
            )}
            <button className="turned-leave-link" onClick={leave}>
              <LogOut size={14} /> Leave expedition
            </button>
          </section>
          <aside className="turned-lobby-tip">
            <BookOpen size={20} />
            <span>FIELD NOTE / 001</span>
            <h2>
              Make something
              <br />
              out of nothing.
            </h2>
            <p>
              Take a hatchet to trees and salvage. Build a workbench, craft ammunition, and make
              camp. The things you make might save your life.
            </p>
            <button onClick={() => setPanel("guide")}>
              Read the field guide <ArrowRight size={16} />
            </button>
          </aside>
        </main>
      )}

      {!playing && (
        <footer className="turned-footer">
          <span>
            <span className="turned-footer-square" /> BUILT FOR THE ONES WHO STICK TOGETHER.
          </span>
          <span>
            <span className={`turned-signal ${!ready ? "loading" : ""}`} />{" "}
            {ready ? "BROWSER-BASED · NO ACCOUNT REQUIRED" : status}
          </span>
        </footer>
      )}

      {playing && snapshot && player && (
        <>
          <GameHUD
            snapshot={snapshot}
            player={player}
            room={room}
            locked={locked}
            hit={hit}
            notice={notice}
            onAction={act}
            onPanel={openPanel}
          />
          {snapshot.phase === "won" ? (
            <div className="turned-overlay">
              <section className="turned-result turned-paper">
                <div className="turned-result-icon">
                  <Radio size={34} />
                </div>
                <div className="turned-eyebrow dark">SIGNAL RECEIVED</div>
                <h2>
                  You made it
                  <br />
                  out together.
                </h2>
                <p>
                  The supplies are recovered. The rescue signal is live.
                  <br />
                  Pinefall will remember your expedition.
                </p>
                <div className="turned-result-stats">
                  <div>
                    <strong>
                      {snapshot.supplies}/{snapshot.requiredSupplies}
                    </strong>
                    <span>SUPPLIES RECOVERED</span>
                  </div>
                  <div>
                    <strong>{snapshot.players.reduce((total, p) => total + p.kills, 0)}</strong>
                    <span>INFECTED TAKEN DOWN</span>
                  </div>
                  <div>
                    <strong>
                      {Math.floor(snapshot.time / 60)}:
                      {String(Math.floor(snapshot.time % 60)).padStart(2, "0")}
                    </strong>
                    <span>EXPEDITION TIME</span>
                  </div>
                </div>
                <button className="turned-button turned-primary turned-full" onClick={leave}>
                  Plan the next expedition
                  <ArrowRight size={18} />
                </button>
              </section>
            </div>
          ) : player.dead ? (
            <div className="turned-overlay turned-death-overlay">
              <section className="turned-result turned-paper">
                <Skull className="turned-death-icon" size={42} />
                <div className="turned-eyebrow dark">SURVIVOR DOWN</div>
                <h2>
                  One more
                  <br />
                  chance.
                </h2>
                <p>
                  The island got the better of you.
                  <br />
                  Return to camp and find your crew.
                </p>
                <button
                  className="turned-button turned-primary turned-full"
                  disabled={snapshot.time - (diedAt.current ?? snapshot.time) < 5}
                  onClick={() => {
                    act({ action: "respawn" });
                    resume();
                  }}
                >
                  {snapshot.time - (diedAt.current ?? snapshot.time) < 5
                    ? `Respawn available in ${Math.ceil(5 - (snapshot.time - (diedAt.current ?? snapshot.time)))}s`
                    : "Respawn at survivor camp"}
                  <ArrowRight size={18} />
                </button>
                <button className="turned-leave-link" onClick={leave}>
                  Leave expedition
                </button>
              </section>
            </div>
          ) : (
            !locked &&
            !panel && (
              <div className="turned-ready-overlay">
                <button className="turned-button turned-primary" onClick={resume}>
                  <Play size={20} /> Enter the island
                  <ArrowRight size={20} />
                </button>
                <span>Click to look around · Esc to release your mouse</span>
              </div>
            )
          )}
        </>
      )}

      {panel && !(playing && (player?.dead || snapshot?.phase === "won")) && (
        <Modal panel={panel} playing={Boolean(playing)} onClose={closePanel}>
          {panel === "guide" && <FieldGuide />}
          {panel === "settings" && (
            <>
              <div className="turned-eyebrow dark">MAKE YOURSELF AT HOME</div>
              <h2>Field settings.</h2>
              <p className="turned-muted">Saved on this device, ready for your next expedition.</p>
              <div className="turned-settings">
                <label>
                  <span>
                    <Volume2 size={19} />
                    <strong>Game audio</strong>
                    <output>{Math.round(settings.volume * 100)}%</output>
                  </span>
                  <input
                    aria-label="Game audio volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.volume}
                    onChange={(e) => updateSettings({ volume: +e.target.value })}
                  />
                </label>
                <label>
                  <span>
                    <Crosshair size={19} />
                    <strong>Look sensitivity</strong>
                    <output>{settings.sensitivity.toFixed(1)}×</output>
                  </span>
                  <input
                    aria-label="Look sensitivity"
                    type="range"
                    min="0.2"
                    max="2.5"
                    step="0.1"
                    value={settings.sensitivity}
                    onChange={(e) => updateSettings({ sensitivity: +e.target.value })}
                  />
                </label>
                <label className="turned-toggle">
                  <span>
                    <Droplets size={19} />
                    <span>
                      <strong>Blood effects</strong>
                      <small>Stylized combat particles and hit effects.</small>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.blood}
                    onChange={(e) => updateSettings({ blood: e.target.checked })}
                  />
                  <span className="turned-toggle-track" />
                </label>
              </div>
              <p className="turned-settings-tip">
                <CircleHelp size={16} /> For the best experience, use a keyboard and mouse.
              </p>
            </>
          )}
          {panel === "crafting" && player && snapshot && (
            <Crafting
              player={player}
              snapshot={snapshot}
              notice={notice}
              onAction={(action) => {
                act(action);
                if (
                  action.action === "craft" &&
                  ["barricade", "campfire", "workbench"].includes(action.recipe)
                )
                  resume();
              }}
            />
          )}
          {panel === "map" && snapshot && player && (
            <>
              <div className="turned-eyebrow dark">EXPEDITION FIELD MAP / 01</div>
              <h2>Pinefall Island.</h2>
              <p className="turned-muted">
                Find the supply crates at Cedar Harbor, Golden Fields, and Northstar Outpost. Bring
                your crew to Radio Ridge.
              </p>
              <div className="turned-large-map">
                <IslandMap snapshot={snapshot} player={player} large />
              </div>
              <div className="turned-map-legend">
                <span>
                  <i className="you" /> You
                </span>
                <span>
                  <i className="crew" /> Your crew
                </span>
                <span>
                  <i className="supply" /> Supply crate
                </span>
                <span>
                  <i className="car" /> Vehicle
                </span>
              </div>
            </>
          )}
          {panel === "pause" && (
            <>
              <div className="turned-eyebrow dark">TAKE A BREATHER</div>
              <h2>Still out there.</h2>
              <p className="turned-muted">
                The island keeps moving while this menu is open.
                <br />
                Find somewhere safe before stepping away.
              </p>
              <div className="turned-pause-actions">
                <button className="turned-button turned-primary" onClick={resume}>
                  <Play size={18} /> Back to the island
                  <ArrowRight size={19} />
                </button>
                <button
                  className="turned-button turned-outline"
                  onClick={() => openPanel("crafting")}
                >
                  <Hammer size={18} /> Inventory & crafting<kbd>C</kbd>
                </button>
                <button className="turned-button turned-outline" onClick={() => openPanel("map")}>
                  <Map size={18} /> Island map<kbd>M</kbd>
                </button>
                <button className="turned-button turned-outline" onClick={() => setPanel("guide")}>
                  <BookOpen size={18} /> Field guide
                </button>
                <button
                  className="turned-button turned-outline"
                  onClick={() => setPanel("settings")}
                >
                  <Settings size={18} /> Settings
                </button>
              </div>
              {room && (
                <button className="turned-copy-pause" onClick={() => void copyInvite(true)}>
                  <Copy size={14} /> {copied || `Invite a friend · ${room.code}`}
                </button>
              )}
              <button className="turned-leave-link" onClick={leave}>
                <LogOut size={15} /> Leave expedition
              </button>
            </>
          )}
        </Modal>
      )}

      {playing && locked && status.includes("Mouse capture") && (
        <div className="turned-input-hint" role="status">
          <Crosshair size={13} />
          {status}
        </div>
      )}
      {reconnecting && (
        <div className="turned-connection" role="status">
          <RefreshCw size={15} className="turned-spin" /> {status}
        </div>
      )}
      {error && (
        <div className="turned-error" role="alert">
          <Shield size={19} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

function Modal({
  panel,
  playing,
  onClose,
  children,
}: {
  panel: Panel;
  playing: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    host.current?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !host.current) return;
      const elements = [
        ...host.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ),
      ];
      if (!elements.length) return;
      event.preventDefault();
      const index = elements.indexOf(document.activeElement as HTMLElement);
      const next =
        index < 0
          ? event.shiftKey
            ? elements.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
      elements[next].focus();
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [panel]);
  return (
    <div
      className="turned-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={host}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={
          panel === "crafting"
            ? "Inventory and crafting"
            : panel === "guide"
              ? "Field guide"
              : panel === "map"
                ? "Island map"
                : panel === "pause"
                  ? "Expedition menu"
                  : "Settings"
        }
        className={`turned-modal turned-paper turned-modal-${panel}`}
      >
        <button
          className="turned-modal-close"
          onClick={onClose}
          aria-label={playing ? "Return to game" : "Close dialog"}
        >
          <X size={21} />
        </button>
        {children}
      </div>
    </div>
  );
}

function FieldGuide() {
  const controls = [
    ["W A S D", "Move / drive"],
    ["MOUSE / ARROWS", "Look around"],
    ["LMB", "Fire / swing hatchet"],
    ["RMB", "Aim down sights"],
    ["R", "Reload weapon"],
    ["1 – 4", "Equip weapon"],
    ["E", "Pick up / enter or exit vehicle / radio"],
    ["SHIFT", "Sprint"],
    ["SPACE", "Jump / vehicle brake"],
    ["C / TAB", "Inventory & crafting"],
    ["H", "Use bandage / medkit"],
    ["Q / X", "Eat food / drink water"],
    ["M", "Open island map"],
    ["ESC", "Release mouse / menu"],
  ];
  return (
    <>
      <div className="turned-eyebrow dark">A FEW THINGS BEFORE YOU GO</div>
      <h2>The field guide.</h2>
      <p className="turned-muted">Stick together. Make do. Make it home.</p>
      <div className="turned-guide-steps">
        <div>
          <span>01</span>
          <Trees size={23} />
          <h3>Scavenge & craft</h3>
          <p>
            Use your hatchet on trees, rocks, and scrap piles. Collect cloth and supplies. Open
            crafting to build a workbench, barricades, and healing campfires.
          </p>
        </div>
        <div>
          <span>02</span>
          <Crosshair size={23} />
          <h3>Survive together</h3>
          <p>
            Watch your food, water, and ammunition. Aim for the head. Zombies hear gunfire. Enter a
            jeep with E; your friends can ride along. Collect fuel to refuel nearby.
          </p>
        </div>
        <div>
          <span>03</span>
          <Radio size={23} />
          <h3>Get the signal out</h3>
          <p>
            Recover three supply crates from the harbor, farm, and outpost. Reach Radio Ridge and
            use the transmitter. Keep at least one living survivor within 13 meters of the radio for
            30 seconds to complete the rescue signal.
          </p>
        </div>
      </div>
      <h3 className="turned-controls-title">
        KNOW YOUR CONTROLS <span>KEYBOARD + MOUSE</span>
      </h3>
      <div className="turned-controls">
        {controls.map(([key, description]) => (
          <div key={key}>
            <kbd>{key}</kbd>
            <span>{description}</span>
          </div>
        ))}
      </div>
      <div className="turned-guide-note">
        <Users size={18} />
        <p>
          This is cooperative PvE. There is no friendly fire. Friends can join an expedition that is
          already underway.
        </p>
      </div>
    </>
  );
}

function Crafting({
  player,
  snapshot,
  notice,
  onAction,
}: {
  player: PlayerState;
  snapshot: GameSnapshot;
  notice: string;
  onAction: (action: PlayerAction) => void;
}) {
  const atWorkbench = snapshot.buildings.some(
    (b) => b.kind === "workbench" && b.health > 0 && distance(b, player) <= 5,
  );
  return (
    <>
      <div className="turned-eyebrow dark">MAKE SOMETHING THAT MATTERS</div>
      <h2>Pack & workshop.</h2>
      {notice && (
        <div className="turned-craft-notice" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
      <div className="turned-resource-grid">
        {(Object.keys(RESOURCE_ICONS) as ResourceId[]).map((resource) => {
          const Icon = RESOURCE_ICONS[resource];
          return (
            <div key={resource}>
              <Icon size={21} />
              <strong>{player.resources[resource]}</strong>
              <span>{resource}</span>
            </div>
          );
        })}
      </div>
      <div className="turned-workbench-status">
        <Hammer size={16} />
        <span>
          {atWorkbench
            ? "Workbench in range — advanced recipes available"
            : "Build a workbench to unlock advanced recipes"}
        </span>
        <span className={`turned-signal ${atWorkbench ? "" : "loading"}`} />
      </div>
      <div className="turned-recipe-grid">
        {RECIPES.map((recipe) => {
          const Icon = RECIPE_ICONS[recipe.id];
          const affordable = Object.entries(recipe.cost).every(
            ([key, cost]) => player.resources[key as ResourceId] >= (cost || 0),
          );
          const unlocked = !recipe.workbench || atWorkbench;
          const owned = recipe.id === "shotgun" && player.hasShotgun;
          const isBuilding = ["barricade", "campfire", "workbench"].includes(recipe.id);
          return (
            <div className="turned-recipe" key={recipe.id}>
              <div className="turned-recipe-head">
                <span>
                  <Icon size={25} />
                </span>
                <div>
                  <h3>{recipe.name}</h3>
                  {recipe.workbench && (
                    <small>
                      <Hammer size={11} /> WORKBENCH RECIPE
                    </small>
                  )}
                </div>
              </div>
              <p>{recipe.description}</p>
              <div className="turned-recipe-cost">
                {Object.entries(recipe.cost).map(([resource, cost]) => (
                  <span
                    key={resource}
                    className={
                      player.resources[resource as ResourceId] < (cost || 0) ? "missing" : ""
                    }
                  >
                    {cost} {resource}
                  </span>
                ))}
              </div>
              <button
                className="turned-button turned-outline"
                disabled={!affordable || !unlocked || owned || Boolean(player.vehicleId)}
                onClick={() => onAction({ action: "craft", recipe: recipe.id })}
              >
                {player.vehicleId ? (
                  <>
                    <Lock size={14} /> Exit vehicle first
                  </>
                ) : owned ? (
                  <>
                    <Check size={15} /> Already equipped
                  </>
                ) : !unlocked ? (
                  <>
                    <Lock size={14} /> Workbench required
                  </>
                ) : (
                  <>
                    <Plus size={15} /> {isBuilding ? "Craft & place ahead" : "Craft item"}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div className="turned-build-note">
        <MapPin size={16} />
        <p>
          Structures are placed 3 meters ahead of you. Face clear ground before crafting. Swing your
          hatchet at trees, rocks, and salvage for materials.
        </p>
      </div>
      <div className="turned-supplies">
        <h3>IN YOUR PACK</h3>
        <div>
          <button
            disabled={player.medkits < 1 || player.health >= 100}
            onClick={() => onAction({ action: "heal" })}
          >
            <Heart size={20} />
            <span>
              Medical supplies<strong>{player.medkits}</strong>
            </span>
            <small>USE · H</small>
          </button>
          <button
            disabled={player.food < 1 || player.hunger >= 100}
            onClick={() => onAction({ action: "eat" })}
          >
            <Wheat size={20} />
            <span>
              Canned food<strong>{player.food}</strong>
            </span>
            <small>EAT</small>
          </button>
          <button
            disabled={player.water < 1 || player.thirst >= 100}
            onClick={() => onAction({ action: "drink" })}
          >
            <Droplets size={20} />
            <span>
              Bottled water<strong>{player.water}</strong>
            </span>
            <small>DRINK</small>
          </button>
          <div className="turned-fuel-item">
            <Fuel size={20} />
            <span>
              Fuel cans<strong>{player.fuel}</strong>
            </span>
            <small>E NEAR CAR</small>
          </div>
        </div>
      </div>
    </>
  );
}

function GameHUD({
  snapshot,
  player,
  room,
  locked,
  hit,
  notice,
  onAction,
  onPanel,
}: {
  snapshot: GameSnapshot;
  player: PlayerState;
  room: RoomInfo | null;
  locked: boolean;
  hit: boolean;
  notice: string;
  onAction: (action: PlayerAction) => void;
  onPanel: (panel: Panel) => void;
}) {
  const vehicle = snapshot.vehicles.find((v) => v.id === player.vehicleId);
  const extracting = snapshot.extraction > 0;
  const signalHeld = snapshot.players.some(
    (survivor) => survivor.connected && !survivor.dead && distance(survivor, RADIO) <= 13,
  );
  const heading = Math.round(((((player.yaw * -180) / Math.PI) % 360) + 360) % 360);
  const direction = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(heading / 45) % 8];
  const hour = Math.floor(snapshot.dayTime) % 24;
  const minute = Math.floor((snapshot.dayTime % 1) * 60);
  let prompt = "";
  let promptKey = "E";
  if (vehicle) prompt = `Exit ${vehicle.kind === "jeep" ? "jeep" : "pickup"}`;
  else {
    const loot = snapshot.loot
      .filter((l) => l.active && distance(l, player) < 3.2)
      .sort((a, b) => distance(a, player) - distance(b, player))[0];
    const car = snapshot.vehicles
      .filter((v) => v.health > 0 && distance(v, player) < 4.5)
      .sort((a, b) => distance(a, player) - distance(b, player))[0];
    const node = RESOURCE_NODES.find((n) => {
      const dx = n.x - player.x,
        dz = n.z - player.z;
      const forward = dx * -Math.sin(player.yaw) + dz * -Math.cos(player.yaw);
      const sideways = Math.abs(dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw));
      return (
        forward > 0 &&
        forward < 3 &&
        sideways < 1.25 &&
        snapshot.nodes.some((s) => s.id === n.id && s.active)
      );
    });
    if (distance(RADIO, player) < 4)
      prompt = extracting
        ? "Rescue signal active · hold position"
        : snapshot.supplies >= snapshot.requiredSupplies
          ? "Activate the rescue transmitter"
          : "Radio needs all 3 supply crates";
    else if (loot) prompt = `Collect ${LOOT_NAMES[loot.kind]}`;
    else if (car) {
      const kind = car.kind === "jeep" ? "jeep" : "pickup";
      prompt =
        player.fuel > 0 && car.fuel < 80
          ? `Refuel ${kind} · then press E to enter`
          : !car.seats.includes(null)
            ? `${kind === "jeep" ? "Jeep" : "Pickup"} full · wait for a seat`
            : Math.abs(car.speed) > 4
              ? `Wait for the ${kind} to slow down`
              : `Enter ${kind}`;
    } else if (node) {
      prompt = `${node.kind === "tree" ? "Chop" : "Harvest"} ${node.resource}${player.weapon === "axe" ? "" : " · equip hatchet"}`;
      promptKey = player.weapon === "axe" ? "LMB" : "1";
    }
  }
  const nearLocation = [...LOCATIONS].sort((a, b) => distance(a, player) - distance(b, player))[0];
  return (
    <div className="turned-hud">
      <div className="turned-hud-top">
        <div className="turned-mission">
          <div>
            <span className="turned-signal" /> THE PINEFALL EXPEDITION
          </div>
          <strong>
            {extracting
              ? "Hold the signal."
              : snapshot.supplies >= snapshot.requiredSupplies
                ? "Get the signal out."
                : "Leave no supply behind."}
          </strong>
          <p>
            {extracting
              ? signalHeld
                ? "Defend the radio. Stay within 13 meters until rescue."
                : "Signal paused. Return to Radio Ridge to continue."
              : snapshot.supplies >= snapshot.requiredSupplies
                ? "Reach Radio Ridge. Activate the transmitter."
                : "Recover crates at the harbor, farm, and outpost."}
          </p>
          <div className="turned-objective-progress">
            <span>
              <Package size={14} /> {snapshot.supplies} / {snapshot.requiredSupplies} SUPPLIES
            </span>
            {snapshot.extraction > 0 ? (
              <span>
                <Radio size={14} /> {Math.ceil(30 - snapshot.extraction)}s TO RESCUE
              </span>
            ) : (
              <span>CO-OP PVE</span>
            )}
          </div>
          {snapshot.extraction > 0 && (
            <div className="turned-extraction-bar">
              <i style={{ width: `${(snapshot.extraction / 30) * 100}%` }} />
            </div>
          )}
        </div>
        <div className="turned-compass">
          <span>{direction}</span>
          <i />
          <strong>{heading.toString().padStart(3, "0")}°</strong>
          <small>
            {String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}
          </small>
        </div>
        <div className="turned-hud-map">
          <button aria-label="Open island map" onClick={() => onPanel("map")}>
            <IslandMap snapshot={snapshot} player={player} />
          </button>
          <div>
            <MapPin size={12} />
            <span>
              {distance(nearLocation, player) < 33 ? nearLocation.name : "PINEFALL WILDERNESS"}
            </span>
            <kbd>M</kbd>
          </div>
        </div>
      </div>
      <div className="turned-squad">
        {snapshot.players
          .filter((p) => p.id !== player.id && p.connected)
          .map((member) => (
            <div key={member.id}>
              <span style={{ background: member.color }} />
              <strong>{member.name}</strong>
              {member.dead ? (
                <Skull size={12} />
              ) : (
                <small>
                  {Math.round(member.health)} HP · {Math.round(distance(member, player))}m
                </small>
              )}
            </div>
          ))}
      </div>
      {!player.dead && locked && (
        <>
          <div
            className={`turned-crosshair ${hit ? "hit" : ""} ${player.weapon === "axe" ? "melee" : ""}`}
          >
            <i />
            <i />
            <i />
            <i />
          </div>
          {prompt && (
            <div className="turned-interact">
              <kbd>{promptKey}</kbd>
              <span>{prompt}</span>
            </div>
          )}
        </>
      )}
      {notice && (
        <div className="turned-event-notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {vehicle && (
        <div className="turned-vehicle-panel">
          <div>
            <Fuel size={18} />
            <strong>{vehicle.kind === "jeep" ? "ISLAND JEEP" : "FIELD PICKUP"}</strong>
            <span>{player.seat === 0 ? "DRIVER" : "PASSENGER"}</span>
          </div>
          <p>
            <strong>
              {Math.round(Math.abs(vehicle.speed) * 3.6)}
              <small>KM/H</small>
            </strong>
            <span>
              FUEL <b>{Math.round(vehicle.fuel)}%</b>
              <br />
              CONDITION <b>{Math.round((vehicle.health / 250) * 100)}%</b>
            </span>
          </p>
          <small>
            {player.seat === 0
              ? "W/S Accelerate · A/D Steer · Space Brake"
              : "Enjoy the ride. Stay alert."}{" "}
            · E Exit
          </small>
        </div>
      )}
      <div className="turned-hud-bottom">
        <div className="turned-vitals">
          <div className="turned-survivor-label">
            <span>{player.name}</span>
            <span>
              <Skull size={12} /> {player.kills}
            </span>
          </div>
          <Vital label="Health" value={player.health} icon={<Heart size={16} />} kind="health" />
          <div className="turned-small-vitals">
            <Vital label="Hunger" value={player.hunger} icon={<Wheat size={14} />} kind="hunger" />
            <Vital
              label="Thirst"
              value={player.thirst}
              icon={<Droplets size={14} />}
              kind="thirst"
            />
            <Vital label="Stamina" value={player.stamina} icon={<Zap size={14} />} kind="stamina" />
          </div>
          <div className="turned-hud-help">
            <span>
              <kbd>H</kbd> Heal
            </span>
            <button onClick={() => onPanel("crafting")}>
              <kbd>C</kbd> Craft & pack
            </button>
            <button onClick={() => onPanel("pause")}>
              <kbd>ESC</kbd> Menu
            </button>
          </div>
        </div>
        <div className="turned-hotbar">
          {WEAPON_IDS.map((weapon, index) => (
            <button
              key={weapon}
              aria-label={`Equip ${WEAPONS[weapon].name}`}
              className={`${player.weapon === weapon ? "selected" : ""} ${weapon === "shotgun" && !player.hasShotgun ? "unavailable" : ""}`}
              disabled={weapon === "shotgun" && !player.hasShotgun}
              onClick={() => onAction({ action: "weapon", weapon })}
            >
              <kbd>{index + 1}</kbd>
              <WeaponIcon weapon={weapon} />
              <span>{weapon === "axe" ? "HATCHET" : weapon.toUpperCase()}</span>
              {weapon === "shotgun" && !player.hasShotgun && (
                <Lock size={12} className="turned-weapon-lock" />
              )}
            </button>
          ))}
        </div>
        <div className="turned-ammo">
          <div>{WEAPONS[player.weapon].name}</div>
          {player.weapon === "axe" ? (
            <strong className="turned-melee-label">
              READY<small>MELEE / HARVEST</small>
            </strong>
          ) : (
            <>
              <strong>
                {String(player.ammo[player.weapon]).padStart(2, "0")}
                <span>/ {player.reserve}</span>
              </strong>
              <small>
                {player.reloading > 0 ? (
                  <>
                    <RefreshCw size={12} className="turned-spin" /> RELOADING…
                  </>
                ) : (
                  <>
                    <kbd>R</kbd> RELOAD
                  </>
                )}
              </small>
            </>
          )}
          <div className="turned-room-hud">
            <Users size={11} /> {snapshot.players.filter((p) => p.connected).length} SURVIVORS
            <span>{room?.code}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Vital({
  label,
  value,
  icon,
  kind,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  kind: string;
}) {
  return (
    <div
      className={`turned-vital turned-vital-${kind} ${value < 25 ? "low" : ""}`}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div>
        {icon}
        <span>{kind === "health" ? label.toUpperCase() : ""}</span>
        <strong>{Math.round(value)}</strong>
      </div>
      <div className="turned-vital-track">
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function WeaponIcon({ weapon }: { weapon: WeaponId }) {
  if (weapon === "axe") return <Axe size={32} strokeWidth={1.5} />;
  return (
    <svg viewBox="0 0 64 36" aria-hidden="true" className="turned-gun-icon">
      <path
        fill="currentColor"
        d={
          weapon === "pistol"
            ? "M14 9h35v9H30l-5 15H15l5-16h-6z M47 11h5v5h-5z"
            : weapon === "rifle"
              ? "M5 16h9v-6h29v4h16v4H41v7h-9l-3-7h-4l-3 14h-8l2-14-11 9z M27 7h11v3H27z"
              : "M3 15h12v-4h34v2h13v5H31v6h-8v-5h-4L7 29l-5-5 9-8z"
        }
      />
    </svg>
  );
}

function IslandMap({
  snapshot,
  player,
  large = false,
}: {
  snapshot: GameSnapshot;
  player: PlayerState;
  large?: boolean;
}) {
  return (
    <svg
      viewBox="-165 -171 330 342"
      className="turned-island-map"
      role="img"
      aria-label={`Map of Pinefall Island, your position ${Math.round(player.x)}, ${Math.round(player.z)}`}
    >
      <defs>
        <pattern
          id={large ? "turned-map-grid-large" : "turned-map-grid"}
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
        >
          <path d="M22 0H0V22" fill="none" stroke="#a3bec0" strokeWidth=".45" />
        </pattern>
      </defs>
      <rect x="-165" y="-171" width="330" height="342" fill="#9db9b9" />
      <rect
        x="-165"
        y="-171"
        width="330"
        height="342"
        fill={`url(#${large ? "turned-map-grid-large" : "turned-map-grid"})`}
      />
      <path
        d="M-8-153C36-160 80-129 104-93S145-40 142 4s-17 99-61 123-86 33-121 20-78-37-91-72-24-67-8-108 40-94 75-108 38-10 56-12"
        fill="#ded4af"
        stroke="#ecdfbe"
        strokeWidth="6"
      />
      <path
        d="M-8-147C36-154 75-124 99-89S137-40 135 4s-14 93-58 116-81 31-115 19-74-35-86-69-23-63-7-103 38-89 72-103 35-10 51-11"
        fill="#92a77e"
      />
      {ROADS.map((road, i) => (
        <rect
          key={i}
          x={road.x - road.width / 2}
          y={road.z - road.depth / 2}
          width={road.width}
          height={road.depth}
          fill="#d3cbb0"
        />
      ))}
      {LOCATIONS.map((location) => (
        <g key={location.name}>
          <rect
            x={location.x - 5}
            y={location.z - 5}
            width="10"
            height="10"
            rx="2"
            fill={location.kind === "radio" ? "#dae87e" : "#536854"}
            stroke="#eff1d1"
            strokeWidth="1.5"
          />
          {large && (
            <text
              x={location.x}
              y={location.z + (location.kind === "radio" ? -12 : 16)}
              textAnchor="middle"
              fill="#243e36"
              stroke="#cad5ae"
              strokeWidth="2"
              paintOrder="stroke"
              fontSize="6.5"
              fontWeight="800"
              letterSpacing=".2"
            >
              {location.name}
            </text>
          )}
        </g>
      ))}
      {snapshot.loot
        .filter((l) => l.active && l.kind === "supply")
        .map((loot) => (
          <path
            key={loot.id}
            d="M0-5 5 0 0 5-5 0z"
            transform={`translate(${loot.x} ${loot.z})`}
            fill="#f2b94e"
            stroke="#53492b"
            strokeWidth="1"
          />
        ))}
      {snapshot.vehicles
        .filter((v) => v.health > 0)
        .map((vehicle) => (
          <rect
            key={vehicle.id}
            x="-2.5"
            y="-4"
            width="5"
            height="8"
            rx="1"
            transform={`translate(${vehicle.x} ${vehicle.z}) rotate(${(-vehicle.yaw * 180) / Math.PI})`}
            fill="#eff0d7"
            stroke="#476b64"
            strokeWidth="1"
          />
        ))}
      {snapshot.players
        .filter((p) => p.connected && p.id !== player.id)
        .map((member) => (
          <circle
            key={member.id}
            cx={member.x}
            cy={member.z}
            r="3.5"
            fill={member.dead ? "#77392f" : member.color}
            stroke="#fffbe5"
            strokeWidth="1.5"
          />
        ))}
      <circle cx={player.x} cy={player.z} r="9" fill="#eaffae" opacity=".24" />
      <path
        d="M0-7 4 5 0 3-4 5z"
        transform={`translate(${player.x} ${player.z}) rotate(${(-player.yaw * 180) / Math.PI})`}
        fill="#f5ffb6"
        stroke="#264838"
        strokeWidth="1.2"
      />
      <text x="-146" y="-148" fontSize="12" fontWeight="800" fill="#365954">
        N
      </text>
      <path d="M-141-144v12m-4-9 4-4 4 4" stroke="#365954" strokeWidth="1.5" fill="none" />
      {large && (
        <text x="145" y="154" textAnchor="end" fill="#42645d" fontSize="6" letterSpacing="1">
          PINEFALL SURVEY / 01
        </text>
      )}
    </svg>
  );
}
