# Turned

An original, first-person cooperative survival game in the browser. Make a private expedition, share its invite code, and survive **Pinefall Island** with up to eight players. Explore three settlements, farmland, a military base, an airstrip, and a radio station across eight named areas. The map has 29 buildings, including 28 enterable homes, shops, clinics, diners, barns, workshops, barracks, and an armory. All models are original, procedural low-poly geometry.

## Play locally

Requires **Node.js 24** and npm. The new island mode needs **no database, account, API key, or downloaded art**.

```bash
npm ci
npm run dev
```

Open the website on port **3000**. Vite forwards the game API and WebSocket to port **3003**. Choose **Play solo**, or host an expedition and share its invitation. Friends on the same network can use the host computer's network address on port 3000. For friends over the internet, host the application on a reachable HTTPS origin with WebSocket forwarding; a localhost invitation only works on your own computer.

Use a desktop browser with WebGL2, a keyboard, and a mouse. Click into the game to capture the pointer. Escape releases it. Menus adapt to smaller screens; touch gameplay is not implemented.

## Survive, craft, and extract

- Recover three marked supply crates across the island, then activate the radio at **Radio Ridge**. Keep someone near the radio through the rescue countdown while infected attack.
- Scavenge ammunition, food, water, bandages, scrap, cloth, and fuel. Hunger, thirst, stamina, and ammunition matter. Friendly fire is disabled.
- Enter buildings through their open front doorways. Rooms contain beds, desks, sofas, storage shelves, counters, crates, and other themed furniture. Search floors and shelves for indoor loot; clinics favor medical supplies, the military base favors ammunition, and workshops stock fuel and crafting materials. Walls and furniture block movement and gunfire; windows and doors remain open. Infected can pursue you indoors.
- Equip the hatchet to harvest trees, rocks, and salvage piles. Open crafting to make bandages, barricades, campfires, and workbenches. Workbenches unlock ammunition and the field shotgun.
- Structures are placed on open ground **three meters ahead**. Barricades obstruct infected; campfires heal nearby survivors. Crafting is validated on the server and shared by everyone in the lobby. Use the hatchet to dismantle structures.
- Drive jeeps and pickups. Friends can ride in passenger seats. Vehicles use fuel, take collision damage, and can run over infected. Slow down to get out. Carry fuel and interact with a depleted vehicle to refuel it.
- If you die, respawn at camp after five seconds. Your team's recovered mission supplies remain.

| Control | Action |
| --- | --- |
| WASD | Move / drive; S reverses, A/D steer |
| Mouse | Look |
| Left click | Fire / swing hatchet |
| Right click | Aim |
| Shift / Space | Sprint / jump (Space brakes in a vehicle) |
| R | Reload |
| E | Pick up / enter or exit vehicle / activate radio |
| 1 / 2 / 3 / 4 | Hatchet / pistol / rifle / crafted shotgun |
| H / Q / X | Bandage / eat / drink |
| C or Tab | Crafting and supplies |
| M | Island map |
| Escape | Release pointer / menu |
| Arrow keys | Look fallback when pointer lock is unavailable |

Sound, mouse sensitivity, and blood effects can be changed in the game settings.

## Checks

Browser tests use system Chromium when available. Otherwise install it with `npx playwright install chromium`, or set `CHROMIUM_PATH` to your Chromium executable. They start the development servers automatically if needed.

```bash
npm run test:turned
npm run test:e2e
npm run test --workspace=packages/game-shared
npm run test --workspace=packages/game-client -- --run
npm run test --workspace=packages/game-server -- --run
npm run typecheck --workspace=packages/website
npm run build
```

`npm run build` builds the island server and website. The older canvas game is retained at `/classic`, with its original server and PostgreSQL setup documented in [docs/classic-setup.md](docs/classic-setup.md). Use `npm run dev:legacy` for that workflow. The new mode and the classic game use separate sessions and inventories.

## Hosting a shared island server

```bash
docker compose -f compose.turned.yml up --build -d
```

This builds the website and world server and fronts them with Nginx on port **8080**, forwarding HTTP and WebSockets under one origin. Put that gateway behind your hosting provider's HTTPS endpoint. Do not expose the world server directly when using this configuration.

For custom deployments, run the built website with `node packages/website/.output/server/index.mjs` on port 3000 and the world with `npm run start:turned-server` on port 3003. Forward `/turned-api/` and `/turned-socket` to the world; forward everything else to the website. See [deploy/turned.nginx.conf](deploy/turned.nginx.conf). `TURNED_PORT` changes the world port. `TURNED_SERVER_URL` changes Vite's development proxy target.

Set `TURNED_TRUST_PROXY=1` only when the world is reachable exclusively through a gateway that overwrites `X-Forwarded-For`, as the supplied Compose configuration does. This preserves per-client lobby rate limits. Keep WebSocket query strings out of access logs because they contain session tokens.

Expeditions live in server memory. Reconnection restores your player during a short disconnect grace period; **server restarts erase lobbies and worlds**. Persistent worlds, account progression, and public-server discovery across multiple hosts are future work. See [implementation notes](docs/turned-implementation.md) for architecture, validation, and limits.
