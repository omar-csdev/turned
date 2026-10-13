# Turned implementation notes

## Scope

The primary `/` and `/play` experience is a new first-person cooperative island mode built within the existing TypeScript monorepo. The original canvas game remains available at `/classic`, including its larger original item/crafting implementation. The new mode has its own deliberately smaller survival inventory and six meaningful crafting recipes.

Pinefall is an original compact coastal island, inspired by the exploration and survival structure of sandbox zombie games. It does not use proprietary maps, models, sounds, or textures. Geometry, animated characters, weapons, vehicles, and effects are generated in Three.js; sound is synthesized locally.

## Independent workstreams

- `packages/game-shared/src/turned/protocol.ts`: wire types, weapon tuning, recipes.
- `packages/game-shared/src/turned/island.ts`: deterministic map, points of interest, resource/loot/vehicle/zombie spawns and solid building footprints.
- `packages/game-shared/src/turned/simulation.ts`: authoritative simulation: movement, needs, combat, zombie AI, vehicles, harvesting, construction, and cooperative extraction.
- `packages/game-server/src/turned/server.ts`: HTTP lobby admission and WebSocket transport, room isolation, capability tokens, host transfer, reconnect grace, message validation, limits, and cleanup.
- `packages/website/src/turned/engine.ts`: browser lifecycle, input, networking/reconnection and synthesized sound.
- `packages/website/src/turned/render/`: procedural island, animated models, lighting, camera, particles, and GPU cleanup.
- `packages/website/src/turned/TurnedApp.tsx` and `turned.css`: landing menu, host/join flow, lobby, HUD, crafting, map, settings, and outcome screens.

The server runs 20 ticks per second. Clients send input and discrete actions, never positions, resource quantities, damage, or inventory state. Simulation snapshots synchronize all survivors, infected, cars, loot, harvested resources, and built structures. Rendering interpolates authoritative positions and applies mouse orientation immediately.

Guest room tokens are randomly generated per player and retained in the tab's session storage, not exposed in room listings. Public lobbies are listed only on the current server. Private lobbies require an invite code. The server bounds room capacity, input size, message rates and slow-client queues. It validates names, actions and finite numeric input.

## Validation

Validation used Node.js 24, Chromium, and the existing regression suites:

- 203 unit/integration tests passed: 154 shared, 4 classic client, 28 server, and 17 island browser-engine tests. These include 54 new island tests covering harvesting, crafting costs and stations, collision, weapon damage/reload, zombie attacks, vehicle passengers/ramming, respawn, the complete extraction condition, room isolation, reconnection, slow renderer startup, retrying a saved survivor, and hostile input boundaries.
- Website TypeScript checking and the production website/world builds passed.
- A clean Docker image installed from the lockfile and built both services. A real three-container Compose deployment became healthy and served the landing page, play route, lobby creation, WebSocket welcome, and running expedition snapshots through Nginx.
- The gateway preserves per-client lobby limits, suppresses token-bearing socket access logs, and handles failed/truncated upstream requests. The optional build-time CA secret was absent from the runtime image.

Both Chromium browser tests in `tests/e2e/turned.spec.ts` passed. They exercise two separate survivor sessions through visible UI and keyboard/mouse actions, observing authoritative wire snapshots without altering game state. They cover invitation admission, movement, firing/reload, synchronized crafting, driving/braking/exiting, session restoration, settings persistence, invalid invites, and narrow menu layouts. Both players remained active during refresh; no game state injection or rendering suspension was used. Software WebGL exposed a short connection timeout, now covered by delayed-welcome and saved-session retry regression tests.

Baseline website TypeScript issues were corrected as part of integration: TanStack's required strict null checking, safe remaining-buffer inspection, a nullable legacy leaderboard display name, and discriminated NPC dialogue chunk handling.

## Current limits and next steps

1. **Persistence:** worlds and inventory are in memory. Add versioned world saves and resumable account identities before offering persistent public servers.
2. **World depth:** this is one compact map. Buildings currently have solid footprints and exterior loot; interior rooms, swimming, terrain elevation, doors, additional biomes and weather would expand exploration.
3. **Crafting:** six recipes support the loop: bandages, ammo, barricades, campfires, workbenches and shotgun. Structures can be dismantled with the hatchet. Next add repair, storage, building rotation/preview, roofs/floors and more material tiers. Existing classic-mode recipes remain separate rather than pretending inventory transfers between modes.
4. **Combat:** firearms are server-authoritative hitscan with reloads and headshots. Add lag compensation, richer weapon tuning, attachments, melee variety and longer difficulty balancing sessions. Zombies use local obstacle avoidance, not global navigation meshes.
5. **Vehicles:** four shared vehicles support drivers/passengers, fuel, collision damage and ramming. There is no suspension physics, repair system, or persistent vehicle storage.
6. **Platforms:** mouse and keyboard desktop browsers are the target. Add touch/gamepad controls, accessible remapping and wider low-end-device performance testing.
7. **Hosting:** the supplied Docker Compose deployment was tested locally. Deploy HTTPS and keep WebSockets on the same public origin; real internet deployment, cross-region latency and production load require independent validation.
8. **Session lifecycle:** creating a new expedition starts a fresh world. Long disconnected sessions expire; extraction completes the current expedition. There is no saved progression or cross-server matchmaker.
