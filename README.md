# Maze Shooters

Two players. One maze. Steer your missile to find them first.

Maze Shooters is a 1v1 stationary-shooter game for desktop browsers, with offline hotseat and simultaneous private online duels. After firing a gun in a fixed direction, each player pilots their projectile through the maze using thrust and rotation. Momentum makes cornering a skill. A player struck by a projectile loses the match.

## Implementation status

The M1 offline prototype and M2 private real-time multiplayer are implemented in this project root. The game uses the exact maze-01 version 2 fixture and pure fixed-step physics. Offline uses a local authority; online uses a Node WebSocket room server with one live missile per player. Three.js renders authoritative snapshots. Public hosting and M3 remain future work. See [TASKS.md](TASKS.md) for actual verification evidence and limitations.

Source lives in `src/shared`, `src/maze`, `src/sim`, `src/local`, `src/network`, `src/client`, and `server`. Tests live in `tests`; full-collision winning control traces are in `tests/replays`. The original specifications and first-build prompt are retained. The five supplied project agent definitions are restored in `.codex/agents/`.

## Current prototype decisions

| Decision | M1 choice |
| --- | --- |
| Runtime | Desktop browser with WebGL 2 and keyboard |
| Rendering | Three.js, simple 3D geometry, perspective cameras |
| App | TypeScript strict, Vite, plain HTML/CSS HUD |
| Simulation | Custom pure TypeScript, 120 fixed steps per simulated second |
| Play mode | Two humans sharing one keyboard, with opaque turn handoffs |
| Players | Fixed positions, fixed gun headings, one-hit defeat |
| Projectile | One at a time; W/S thrust, A/D yaw; horizontal flight with inertia |
| Shot lifetime | 18 simulated seconds, then a miss |
| Maze | One fixed, symmetric 9 by 9 fixture (mapVersion 2); no direct spawn-to-spawn sightline |
| Tests | Vitest for logic; Playwright Chromium for browser acceptance |
| Multiplayer | Separate simultaneous private rooms; default offline mode needs no server |

These choices extend the original concept, with the maze reduced at the user's request on 27 October 2026. Horizontal flight, zero gravity, local hotseat, and self-hit defeat keep the first prototype bounded. The original concept asks for rocket-like handling; here that means thrust, angular momentum, coasting, and drift rather than vertical rocket landing. If full vertical flight is later desired, revise the controls, geometry, and collision spec together.

## Reading guide

Read [AGENTS.md](AGENTS.md) for coding rules, [GAME_DESIGN.md](GAME_DESIGN.md) for the player experience, and [ARCHITECTURE.md](ARCHITECTURE.md) for implementation boundaries. Use [PHYSICS_SPEC.md](PHYSICS_SPEC.md), [MAZE_SPEC.md](MAZE_SPEC.md), and [CAMERA_AND_CONTROLS.md](CAMERA_AND_CONTROLS.md) while building. [NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md) defines the implemented simultaneous protocol v2. [TASKS.md](TASKS.md) orders the work and [TEST_PLAN.md](TEST_PLAN.md) defines the gates.

## Local development commands

Use Node 24.x (`nvm use` reads `.nvmrc`) and npm. The lockfile fixes dependency versions. Browser acceptance requires the Playwright Chromium browser installed once.

```sh
npm install
npx playwright install chromium
npm run dev -- --host 127.0.0.1
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run preview -- --host 127.0.0.1
```

Use `npm ci` for clean reproducible installs. Open the localhost URL printed by `npm run dev`; production output is served with `npm run preview` after `npm run build`. Script contracts: `typecheck` runs TypeScript without emitting; `test:unit` runs Vitest once; `build` typechecks and bundles; `test:e2e` runs Playwright with a configured local web server. Use local npm package binaries. Offline mode needs no game server; online mode runs the included room server. Do not scaffold into a second nested project directory or overwrite these documents with a template README.

| Tested component | Exact version |
| --- | --- |
| Node / npm | 24.22.1 / 10.9.8 |
| Three.js / @types/three | 0.186.1 / 0.186.0 |
| TypeScript / @types/node | 7.0.2 / 26.6.5 |
| Vite / Vitest / Playwright | 8.3.5 / 5.0.5 / 1.64.1 |
| ws / @types/ws | 8.22.0 / 8.18.2 |
| Automated Chromium | 151.0.7922.34, cached Playwright build 1234, SwiftShader |
| Visible desktop Chrome | 155.0.8059.86, macOS 27.0.1, Apple Silicon arm64 |

Package engine requirements were verified from installed package metadata: Vite accepts Node ^20.19 or >=22.12; Vitest accepts ^22.12, ^24 or >=26; Playwright requires >=20; TypeScript requires >=16.20. The project baseline is Node 24, which satisfies them. See [Vite requirements](https://vite.dev/guide/), [Vitest requirements](https://vitest.dev/guide/), and [Playwright installation](https://playwright.dev/docs/intro).

The bundled app Node runtime rejects third-party native bindings due to macOS library validation. Verification used the conventional Node 24.22.1 runtime from the local dependency cache. A normal Node 24 installation is sufficient; no special app runtime is required.

Browser download for the newest Playwright Chromium failed with connection timeouts/DNS errors here. Tests ran against the already-installed Chromium using this supported override (substitute your own absolute executable path):

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE="/absolute/path/to/chromium" npm run test:e2e
```

Automated browser tests use software rendering. A visible desktop Chrome playthrough checked the actual 3D view, controls, both seats and focus-loss behavior separately. Headless Chromium did not deliver native background-tab visibility changes, so that one environment probe is skipped after detecting the limitation; the deterministic blur/input lifecycle test passes. Firefox and Safari have not been tested. Balance and new-player learning time need broader human playtesting.

The shared production JavaScript bundle is about 582 kB (150 kB gzip), primarily Three.js; online transport/presentation load as separate approximately 10/15 kB chunks; Vite reports its standard 500 kB chunk warning. All assets are local, and no development test API or named test fixture is included in production.

Offline means local gameplay after installation, with bundled assets and no multiplayer service. M1 does not promise install-free operation, a service worker, or reopening a `file://` URL. Vite development traffic is development tooling, not a game networking feature.

## How to play offline

1. Hand the keyboard to the player named on the opaque handoff screen.
2. Choose Ready. The view is locked at that player's stationary gun.
3. Press Space or select Fire once. The view follows the projectile.
4. Hold W/↑ for forward thrust, S/↓ for reverse thrust, A/D or ←/→ to rotate left/right. Release keys to coast; rotation and sideways drift decay gradually.
5. Hit the opponent to win. Hit yourself to lose. A wall impact or expiry passes the turn after a brief result view.
6. Use Escape to pause/resume in the offline build. A focus loss also pauses. At match end, choose Rematch; the starting player alternates.

There is no walking, free aiming, AI opponent, health system, or account setup. Each seat has a private map that fills in as their own missile explores. Local hotseat does not provide secure hidden information from someone watching the same screen.

## Custom agents

The five TOMLs use the standalone project agent format: `name`, `description`, and `developer_instructions`. They intentionally omit model, reasoning, provider, and permission overrides, so the parent session supplies those settings. Place them at the included `.codex/agents/` paths. A new Codex session in the extracted project can use the names `simulation`, `world`, `client`, `network`, and `qa`.

The first-build prompt requests delegation with clear ownership. Five definitions are available; only independent work should run concurrently, within the client's limits. Network is a review role in M1. The primary agent creates shared interfaces and integrates work. If the client does not discover custom definitions, pass their instructions to ordinary subagents or execute the roles sequentially. No extra registration file is included or required by the current standalone format.

## Milestones

- **M1:** A tested offline hotseat prototype, including a demonstrably reachable target and useful projectile handling.
- **M2:** Two browser clients in a private room, server-authoritative simulation, snapshots, reconnect handling, validation, and the online tests in TEST_PLAN.md.
- **M3:** Optional seeded mazes, prediction, sound, visual polish, and additional play modes, each approved and specified before implementation.

Advance only after the preceding milestone's gate passes. A beautiful scene without a playable full turn loop is not M1 completion.

## Sources and provenance

The linked planning conversation supplied the core idea: 1v1, stationary shooters, alternating shots, a simple 3D maze, fixed view before firing, timed steerable projectiles, and rocket-like WASD physics. The retrieved assistant replies contained reference markers rather than their full text. This pack therefore supplies new, explicit implementation decisions; it does not claim to recover those earlier assistant documents verbatim.

The project agent format was checked against the official [Codex subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) on 26 October 2026. That page documents project agent discovery, required fields, parent setting inheritance, and delegation. The pack uses only that schema's required fields.

Implementation references: [Three.js scene setup](https://threejs.org/manual/pages/creating-a-scene.html), [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer), [Vite getting started](https://vite.dev/guide/), [Vitest getting started](https://vitest.dev/guide/), and [Playwright installation](https://playwright.dev/docs/intro). Three.js documents WebGL 2 support for its renderer; Vite documents vanilla TypeScript scaffolding; Vitest and Playwright document the selected test tools. Recheck their installed-version requirements during implementation. Physics values, map data, game rules, and module layout below are project design choices, not claims from those sources.

## Replay evidence and development tools

`tests/replays/p1-win.json` and `p2-win.json` contain only versioned WASD masks. Both hit the opposing target on the current 9×9 mapVersion 2 fixture after 978 physics steps (8.15 simulated seconds). Unit tests replay each twice with exact collision enabled and assert the winner. `tools/discover-replay.ts` is an offline test controller and is never imported by the game. To reproduce discovery/checking under Node 24:

```sh
node --import ./tools/ts-loader.mjs tools/discover-replay.ts
node --import ./tools/ts-loader.mjs tools/check-replays.ts
```

For browser acceptance only, Vite development mode with `?test=1&manual=1` exposes inspection and exact stepping. Optional named `fixture=duel` and `fixture=arena` isolate result/timeout presentation while preserving collision. These parameters and hooks are absent from the production build. Normal play starts without query parameters.

Screenshots from acceptance are saved to `artifacts/ready.png`, `artifacts/flight.png`, and `artifacts/result.png`.

## Gameplay polish — 26 October 2026

The projectile has a small missile body and a short cosmetic smoke trail (omitted with reduced motion). Your own wall-impact splashes stay visible on later turns to help recognize previous misses; the other player sees only their own marks. Each seat keeps its latest 32 marks until Rematch. Arrow keys work alongside WASD; both input layouts drive the same unchanged simulation.

This update passed strict typecheck, all 47 unit tests (including both unchanged full-maze win replays), production build, and 25 Chromium browser checks with the existing native-tab environment probe skipped. Nine new checks cover arrow aliases/lifecycle, private history, skipped-frame impacts, smoke, missile geometry and cleanup. Preview screenshots are `artifacts/polish-flight.png` and `artifacts/polish-impact.png`.

## Private exploration maps — 26 October 2026

Every open maze cell crossed by your missile stays lit on your own map. Unknown corridors remain dark; nearby walls, your home and your live missile help you orient yourself. The map switches privately with the active player and is hidden during handoff. Your explored cells stay lit for all later turns in the current match; the other player's discoveries stay separate. Both maps reset on Rematch, and reloading starts a fresh match. Exploration is held in memory, with no browser storage or external calls. Wall splashes also reset on rematch.

The exploration-map preview is saved in `artifacts/exploration-map.png`. The visible map is north-up: your explored corridor cells are cyan/amber, known neighboring wall cells are gray, and unvisited corridors remain dark. The home square and live missile arrow belong only to the current player.

Exploration-map verification passed strict typecheck, 57 unit tests (including both unchanged canonical win replays), production build, and 30 Chromium browser checks; the existing headless native-tab probe remains skipped. Five new browser cases cover discovery, privacy, skipped frames, reset on rematch/reload, pause and both viewport layouts.

## Smaller maze — 27 October 2026

The playing maze is now 9×9 instead of 13×13: 81 total tiles instead of 169, with 36 open corridor tiles instead of 77. Its two-turn route is 30 metres rather than the former four-turn, 50-metre route. The unchanged missile physics and 18-second lifetime leave more time to brake and navigate. Both fully collision-enabled winning replays now reach the opponent in 8.15 simulated seconds. The small private exploration panel automatically uses the new grid, and both maps still reset on Rematch. The authored layout is `maze-01`, mapVersion 2; previous mapVersion 1 recordings are incompatible. M2 adds simultaneous online duels using this fixture (see below).

Smaller-maze verification: strict typecheck, all 57 unit tests, production build and full Chromium acceptance passed (30 browser checks; one existing native-tab environment probe skipped). Preview: `artifacts/smaller-maze.png`. Previous dated completion records describe the earlier fixtures; the current map/replay contract is version 2.

## Simultaneous private online duels — 28 October 2026

Use Node 24 and install the lockfile dependencies, then:

```sh
npm run dev:online
```

Open [online mode](http://127.0.0.1:5173/?online=1) in two independent browser profiles/contexts. Create a room in one, enter its six-character code in the other, and choose Ready in both. You can also choose **Online duel** from the offline header. Each player may fire and steer their own missile at the same time. A wall miss or expiry briefly reloads only that player's gun. Missiles pass through each other. First player hit loses, including self-hit; equal-time fatal hits on both players draw. Both players must request a rematch, which clears both exploration maps and impact histories.

WASD/arrows and Space retain the same handling. Each browser follows only its own missile and displays only its own explored cells and wall splashes. Escape/Menu or focus loss suspends your controls while **the duel continues** on the server. Initial Ready and disconnect grace are 30 seconds; a waiting room expires after two minutes. Reload automatically reconnects to the same seat during grace, restores its current-match map, and requires fresh steering. An online-only sessionStorage credential supports reload; Leave removes it. Offline reload still starts a fresh local match and makes no game-service calls.

For separate terminals or production preview:

```sh
npm run server
# In another terminal:
npm run dev
# Or after npm run build:
npm run preview
```

The room server defaults to 127.0.0.1:8787, with `/health` and `/duel`; Vite/preview proxy `/duel` to it. `npm run dev:online` starts both processes and forwards shutdown. These commands support local verification and private host development. Internet hosting is not provisioned: another device requires a reachable host and hosted use needs an HTTPS/WSS reverse proxy. Rooms are in memory and disappear when the server restarts. There are no accounts, matchmaking, durable rooms, client prediction or lag compensation.

The server runs shared physics at 120 Hz with 20 Hz snapshots. Browser rendering interpolates at about 100 ms delay. Latest controls expire after 100 ms without a fresh packet, preventing a lost key release from applying indefinitely. Every hit, draw, miss and forfeit is server-authoritative. Private maps are accumulated from full per-tick paths on the server, so network/render gaps cannot invent shortcut exploration. Full snapshots reveal static target positions to an inspecting client; normal per-player map privacy is not anti-cheat security.

The only added runtime dependency is [ws](https://github.com/websockets/ws), a small Node WebSocket server library; browsers use native WebSocket. It avoids a multiplayer framework while providing real frame limits and connection lifecycle handling. Protocol and implementation details are in NETWORK_PROTOCOL.md. The prior alternating-turn online draft has been superseded by the user's simultaneous-play choice.

Online development inspection uses `?online=1&test=1` with a read-only snapshot/seat/connection hook. It exposes no token, forced movement or simulation stepping and is absent in production. New browser acceptance uses an actual server and two independent contexts; `artifacts/online-duel.png` records the simultaneous view. Current validation results are recorded in TASKS.md.

M2 verification passed strict typecheck, all **98 logic/transport tests**, production build, and the full Chromium regression: **40 passed, one existing headless native-tab visibility probe skipped**. All ten online browser cases passed twice, including real 100/250 ms round-trip WebSocket delay with ordered 0/5/10 ms jitter. A visible in-app browser playthrough checked both seats, missiles/smoke, private exploration, self-hit outcome and map reset on a two-party rematch. Opening shaders are warmed before the online lobby to avoid a launch-time compile hitch. See TASKS.md for precise evidence and the unchanged browser/platform limitations.

## Submission preparation — 30 October 2026

Online play now has held touch controls and phone layouts, alongside WASD/arrows. Production can serve the built game and WebSockets from one Node service using `npm run build` then `npm start`; its public root opens online mode and `/?offline=1` retains hotseat. See [DEPLOYMENT.md](DEPLOYMENT.md) for the selected no-card Render Free setup, capacity/billing limits and actual public verification steps. [The submission kit](submission/SUBMISSION.md) contains the description, AI attribution, cover path and official-rule deadline conflict. A prepared configuration does not mean the game is already publicly deployed or entered in the contest.

Submission-build verification: strict typecheck/build passed, **112 unit/transport tests passed**, and Chromium passed **45 browser checks with one existing native-tab environment skip**. Five new phone cases also passed as a focused run. Screenshots are `artifacts/mobile-390x844.png`, `artifacts/mobile-844x390.png`, and `artifacts/submission-cover.png`. Mobile evidence is Chromium touch emulation, not physical iOS/Android certification. Public deployment and its account billing settings still require separate verification.
