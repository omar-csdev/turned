# Turned implementation notes

## Scope

The primary `/` and `/play` experience is a new first-person cooperative island mode built within the existing TypeScript monorepo. The original canvas game remains available at `/classic`, including its larger original item/crafting implementation. The new mode has its own deliberately smaller survival inventory and six meaningful crafting recipes.

Pinefall is an original compact coastal island, inspired by the exploration and survival structure of sandbox zombie games. It does not use proprietary maps, models, sounds, or textures. Geometry, animated characters, weapons, vehicles, and effects are generated in Three.js; sound is synthesized locally.

## Independent workstreams

- `packages/game-shared/src/turned/protocol.ts`: wire types, weapon tuning, recipes.
- `packages/game-shared/src/turned/island.ts`: deterministic map, eight points of interest, three settlements, shared wall/window/door geometry, themed furniture, indoor loot, and resource/vehicle/zombie spawns.
- `packages/game-shared/src/turned/simulation.ts`: authoritative simulation: movement, needs, combat, zombie AI, vehicles, harvesting, construction, and cooperative extraction.
- `packages/game-server/src/turned/server.ts`: HTTP lobby admission and WebSocket transport, room isolation, capability tokens, host transfer, reconnect grace, message validation, limits, and cleanup.
- `packages/website/src/turned/engine.ts`: browser lifecycle, input, networking/reconnection and synthesized sound.
- `packages/website/src/turned/render/`: procedural island, animated models, lighting, camera, particles, and GPU cleanup.
- `packages/website/src/turned/TurnedApp.tsx` and `turned.css`: landing menu, host/join flow, lobby, HUD, crafting, map, settings, and outcome screens.

The server runs 20 ticks per second. Clients send input and discrete actions, never positions, resource quantities, damage, or inventory state. Simulation snapshots synchronize all survivors, infected, cars, loot, harvested resources, and built structures. Rendering interpolates authoritative positions and applies mouse orientation immediately.

Guest room tokens are randomly generated per player and retained in the tab's session storage, not exposed in room listings. Public lobbies are listed only on the current server. Private lobbies require an invite code. The server bounds room capacity, input size, message rates and slow-client queues. It validates names, actions and finite numeric input.

## Validation

Validation used Node.js 24, Chromium, and the existing regression suites:

- 227 unit/integration tests passed: 163 shared, 4 classic client, 28 server, 17 island browser-engine, and 15 renderer tests. The island coverage includes harvesting, crafting costs and stations, collision, weapon damage/reload, zombie attacks, vehicle passengers/ramming, respawn, extraction, room isolation, reconnection, cold renderer startup, saved-survivor retries, and hostile input boundaries. New map tests flood-fill navigable ground from camp to all 28 interiors, 117 loot placements and objectives, verify road/parking clearance, and raycast all door/window openings and furnishing bounds.
- Website TypeScript checking and the production website/world builds passed.
- A clean Docker image installed from the lockfile and built both services. A real three-container Compose deployment became healthy and served the landing page, play route, lobby creation, WebSocket welcome, and running expedition snapshots through Nginx.
- The gateway preserves per-client lobby limits, suppresses token-bearing socket access logs, and handles failed/truncated upstream requests. The optional build-time CA secret was absent from the runtime image.

All three Chromium browser checks in `tests/e2e/turned.spec.ts` passed against the expanded map: multiplayer/settings in the full run and interior exploration in a targeted retry. They use visible UI and keyboard/mouse actions, observing authoritative wire snapshots without altering game state. Two survivor sessions cover invitations, movement, firing/reload, synchronized crafting, driving/braking/exiting, and session restoration. A solo survivor walks from camp into the furnished harbor market, recovers its indoor mission crate and ordinary floor loot. Settings persistence, invalid invites, and narrow menu layouts are also checked. Both players remained active during refresh; no game state injection or rendering suspension was used. Software WebGL exposed a short connection timeout, covered by delayed-welcome and saved-session retry tests.

Baseline website TypeScript issues were corrected as part of integration: TanStack's required strict null checking, safe remaining-buffer inspection, a nullable legacy leaderboard display name, and discriminated NPC dialogue chunk handling.

The expanded map includes 29 buildings, 142 furniture props, 117 loot spawns and 8 named regions. Cedar Harbor has homes, a market, diner, clinic, warehouses and workshops; Moss Creek and Eastvale add residential and commercial streets; Golden Fields includes farmhouses, barns and a workshop; Northstar has barracks, an armory, command office, infirmary and watchtower. The watchtower remains a solid landmark; all other mapped buildings are enterable. Elevated shelf loot uses the same visibility checks as floor loot, and walls/furniture stop shots and prevent collecting supplies through walls. Infected route around exteriors and through doorways into connected bedroom spaces.

An eight-player simulation benchmark with 45 infected over 1,000 ticks including snapshots averaged 2.05ms per tick (p95 3.23ms), within the 50ms budget at 20Hz. This is a local CPU benchmark, not a public-server load test. Expired zombie-drop meshes are removed, and active drops are capped independently from authored map loot.

## Current limits and next steps

1. **Persistence:** worlds and inventory are in memory. Add versioned world saves and resumable account identities before offering persistent public servers.
2. **World depth:** this is one compact map with 28 furnished, enterable buildings across three settlements, a farm complex, military base, and airstrip. Houses have connected living rooms and bedrooms; loot includes floor and shelf pickups. Doors and windows are permanently open, and buildings have one playable floor. Next add interactive doors, upper floors/stairs, swimming, terrain elevation, additional biomes and weather.
3. **Crafting:** six recipes support the loop: bandages, ammo, barricades, campfires, workbenches and shotgun. Structures can be dismantled with the hatchet. Next add repair, storage, building rotation/preview, roofs/floors and more material tiers. Existing classic-mode recipes remain separate rather than pretending inventory transfers between modes.
4. **Combat:** firearms are server-authoritative hitscan with reloads and headshots. Add lag compensation, richer weapon tuning, attachments, melee variety and longer difficulty balancing sessions. Zombies use local obstacle avoidance, not global navigation meshes.
5. **Vehicles:** four shared vehicles support drivers/passengers, fuel, collision damage and ramming. There is no suspension physics, repair system, or persistent vehicle storage.
6. **Platforms:** mouse and keyboard desktop browsers are the target. Add touch/gamepad controls, accessible remapping and wider low-end-device performance testing.
7. **Hosting:** the supplied Docker Compose deployment was tested locally. Deploy HTTPS and keep WebSockets on the same public origin; real internet deployment, cross-region latency and production load require independent validation.
8. **Session lifecycle:** creating a new expedition starts a fresh world. Long disconnected sessions expire; extraction completes the current expedition. There is no saved progression or cross-server matchmaker.
