# Maze Shooters — implementation tasks

M1 is implemented. The completion evidence below distinguishes automated checks, visible playthrough observations, and environment limitations. M2/M3 remain future work.

## Work ownership and dependency order

Primary owns scaffold, shared contracts, local authority/loop, integration, package files and documentation. Simulation owns physics/collision/match and its unit tests. World owns fixture/geometry/validation and its unit tests. Client owns rendering/input/cameras/HUD. Network reviews the pure authority seam in M1. QA owns browser tests and reports acceptance findings. See AGENTS.md for exact paths.

```text
M1.0 contracts/scaffold
    -> M1.1 world + M1.2 simulation + M1.3 client skeleton (independent paths)
    -> M1.4 local session/integration
    -> M1.5 browser interaction/cameras + M1.6 playability
    -> M1.7 QA/review -> M1.8 handoff
```

Workers can proceed against frozen contracts, but integrated gameplay depends on both world and simulation. Network read-only review can occur as code appears. Schedule roles within the available concurrency limit. Do not spawn five workers simply because five definitions exist, and do not let two workers edit shared contracts or lockfiles.

## M1.0 — scaffold and shared contracts

- [x] Read the ten specs and inspect the destination repository before changing it; preserve user work.
- [x] Create Vite vanilla TypeScript structure in the project root without replacing the pack.
- [x] Add Three.js, strict TypeScript, compatible Vite/Vitest/Playwright tooling, one npm lockfile, and local scripts from README.md.
- [x] Record actual runtime/package versions and require WebGL 2 with a useful unsupported-browser message.
- [x] Define shared types, numeric constants, heading/math helpers, rule tuple, and immutable snapshot expectations.
- [x] Define the one-tick entry point so command acceptance cannot double-integrate or double-increment tick.
- [x] Set explicit worker ownership and delegate independent work using the five custom roles when available.

Exit: scaffold typechecks, command and geometry interfaces exist, and workers can build without changing each other's files.

## M1.1 — fixed maze and spawns

- [x] Store the exact maze-01 rows, mapVersion and spawn headings.
- [x] Build row-major wall rectangles and spawn records using the declared tile transform.
- [x] Validate dimensions, characters, perimeter, counts, connectivity, graph route, occupancy symmetry, muzzle/target clearance and blocked direct sightline.
- [x] Add focused maze unit tests; expose plain world data without importing Three.js.

Exit: the current mapVersion 2 immutable world has 36 open cells, 45 wall cells and the declared 12-edge spawn path. Tests catch malformed fixtures and coordinate/scale errors.

## M1.2 — pure simulation and match rules

- [x] Implement specified launch, thrust, yaw, damping, speed cap and integer flight age.
- [x] Implement exact swept target circles and rounded-rectangle wall collision, including initial overlap, tangent contact and stable tie priority.
- [x] Implement handoff/ready/flight/resolve/gameOver transitions and legal command/context validation.
- [x] Implement wall miss, timeout, opponent hit, self-hit, final-tick collision priority and one live shot invariant.
- [x] Preserve terminal endpoint and winner during the result phase; count down exactly 90 following ticks.
- [x] Implement clean rematch creation with new match ID and alternating opener.
- [x] Add headless tests from the M1 logic matrix in TEST_PLAN.md, including trajectory/replay checks.

Exit: complete matches can run headlessly with no DOM, Three.js or timer dependency. Invalid actions cannot change the current flight or winner.

## M1.3 — client foundation

- [x] Create one scene, renderer, reusable geometry/materials, lighting, floor, walls, fixed targets and gun visuals.
- [x] Draw walls/targets from the same geometry data consumed by simulation.
- [x] Create accessible HUD/overlays and input adapter against frozen session contracts.
- [x] Implement a genuinely fixed ready camera and correctly signed heading transforms.
- [x] Handle resize, render pixel ratio cap, unsupported graphics, listener disposal and application cleanup.

Exit: rendering can display snapshots without owning or modifying gameplay state. A stationary scene alone is not a playable milestone.

## M1.4 — offline session and full loop

- [x] Wire ordered commands, active seat context, per-tick input sampling and fixed-step accumulation.
- [x] Enforce at most one accepted phase-changing command per tick and no integration on launch tick.
- [x] Implement capped catch-up, render interpolation, phase snaps and terminal result view.
- [x] Implement opaque handoffs, untimed Ready, Fire, miss turn-pass, hit result, and Rematch.
- [x] Implement explicit pause/resume plus blur/visibility pause; clear inputs and reset accumulator correctly.
- [x] Keep M1 free of game-service sockets, accounts, lobby setup and AI opponent code.

Exit: two humans can play multiple alternating turns and finish/rematch a duel on one keyboard.

## M1.5 — flight camera and interaction quality

- [x] Follow heading with the declared offset/target; preserve visible drift rather than orienting velocity to camera.
- [x] Clamp the chase arm against walls and support safe close-wall nose view.
- [x] Show flight time, speed, active player, control help and correct outcome wording.
- [x] Reject held-key/repeat/double-activation bugs across launch, phase changes, pause and rematch.
- [x] Verify keyboard focus, buttons, reduced motion, graphics failure messaging and both target viewport sizes.

Exit: players can steer through corners with readable camera and HUD; the view never reveals behind a wall through chase-camera clipping.

## M1.6 — reachability and tuning gate

- [x] Demonstrate a real collision-enabled flight that hits p2 from p1 within the default lifetime.
- [x] Demonstrate the equivalent p2-to-p1 shot.
- [x] Store the two valid input replays with rule/map metadata and assertions in the implemented tests.
- [x] Perform a human playthrough for each seat; assess drift, reverse thrust, cornering, result clarity and opener advantage.
- [x] If tuning changes are necessary, update the canonical specs/constants/tests coherently and re-run both replays.

Exit: at least one physically valid winning trajectory per seat is proven; graph connectivity and forced-position test hooks do not satisfy this gate.

## M1.7 — integrated QA and network seam review

- [x] Pass `npm run typecheck`, `npm run test:unit`, and `npm run build`.
- [x] Pass the Playwright Chromium M1 suite through actual browser/UI controls.
- [x] Check a production preview for startup, graphics, core inputs and absence of development test-mutation APIs.
- [x] Review pure-module imports and authority boundary with the network role; fix findings without adding networking.
- [x] Confirm no unexpected browser exceptions, double-fired shots, stuck controls, or growth in renderer/listener counts across ten rematches.
- [x] Record browser/device, viewport, command results, replay evidence and any remaining limitation.

Exit: every required M1 row in TEST_PLAN.md passes or is explicitly blocked with evidence. A blocked acceptance row means M1 remains incomplete.

## M1.8 — delivery

- [x] Update README.md with real commands, tested versions, how to play, current implementation status and concrete limitations.
- [x] Mark only completed tasks; leave future work open.
- [x] Summarize changes, checks actually run, how to start the game and any remaining risk. Include a screenshot or local preview if the environment supports it.

M1 is done when a new developer can install, run, play, win, and rematch offline using only the README and the project files. No public deployment is required.

## M2 — simultaneous private online duel, user-authorized 28 October 2026

- [x] Freeze explicit simultaneous state, seat-specific session and protocol v2 contracts; keep offline rulesVersion 1 and online rulesVersion 2 separate.
- [x] Implement one live missile per seat, independent launch/miss/reload, shared rocket dynamics, aggregate swept fatal outcomes and equal-time draw rules.
- [x] Add compatible ws tooling, private room codes, compatibility/Ready flow and server authority with the same canonical 9×9 world.
- [x] Validate exact intents, socket-bound identity/generation, monotonic sequences, input expiry, rate/payload limits and stable rejection codes.
- [x] Run a monotonic 120 Hz server with 20 Hz snapshots and explicit catch-up overload failure.
- [x] Implement browser transport/interpolation and explicit own-seat camera/input/HUD, dual missile rendering, private maps/splashes and connection status.
- [x] Keep all authoritative discovered cells/history per seat and restore complete knowledge through snapshots/reconnect; reset both on rematch.
- [x] Implement initial Ready/disconnect/waiting deadlines, hit/draw precedence, forfeits and abandonment without fabricated shot results.
- [x] Implement reconnect token digest/rotation, old-generation invalidation, full resync and two-party rematch.
- [x] Pass strict typecheck, 98 logic/transport tests and production build; retain both canonical offline winning replays.
- [x] Pass final M1 + M2 browser regression, actual two-context latency and reconnect checks; record evidence below.

## M3 — optional extensions, separately scoped

- [ ] Propose and approve seeded generator rules, spawn fairness and generator versioning.
- [ ] Consider flight prediction/reconciliation after measuring online input latency.
- [ ] Add sound, local training, visual polish or alternate match formats only with explicit scope and tests.

Do not treat this wishlist as part of the first-build prompt.

## M1 completion evidence — 26 October 2026 (original mapVersion 1)

Implementation revision: the initial Git commit containing this record, source, test replays and the single `package-lock.json`. Existing planning documents and the original ZIP were preserved. Five project roles were delegated with non-overlapping ownership after freezing shared contracts: world, simulation, client, QA, and read-only network review. The `.codex/agents/` definitions were recovered unchanged from the supplied ZIP.

| Gate | Actual evidence |
| --- | --- |
| Runtime | Node 24.22.1, npm 10.9.8; all dependency versions and engine requirements recorded in README |
| `npm run typecheck` | Exit 0, strict TypeScript 7.0.2; includes unit and browser test sources |
| `npm run test:unit` | Exit 0: 47 tests in 6 files; dynamics, exact collisions, fixture validation, match/context rules, snapshots, frame schedules, pause and driver cap |
| `npm run build` | Exit 0; 24 modules; local production assets; standard 562 kB chunk warning |
| `npm run test:e2e` | Exit 0: 16 passed, one explicit headless native-tab environment skip; real input listeners/buttons are exercised |
| Production preview | Real Ready/Space/W/D/Escape work on port 4173; no external requests/browser exceptions in production test; query fixture ignored and no test global |
| Production inspection | `rg` found no `__MAZE_TEST__`, named test worlds, or development-session API in `dist` |
| Replay R02 | `tests/replays/p1-win.json` and `p2-win.json`: opponent hit at tick 1772, same canonical geometry and rules, no teleportation; each replay repeated identically |
| Ten rematches | Alternating opener/new match IDs/reset shot IDs; one persistent canvas and unchanged global listener count |
| Authority review | Pure imports work in Node; JSON-serializable immutable snapshots/world; stale intent cannot stall flight; renderer never assigns hits/winners; no network runtime |

The headless suite used Chromium 151.0.7922.34 (cached Playwright build 1234), macOS 27.0.1 arm64, 1280x720 and 1920x1080, with SwiftShader. The requested Chromium 156 download failed with socket/time-out/DNS errors; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects the existing Chromium. The normal install command remains documented for new machines. Headless background tabs in this environment report both visible and focused; the test skips only after detecting that exact condition. Deterministic blur/input clearing and explicit resume pass; actual native focus-loss pause was also observed during the visible playthrough. Software-rendered automation is not claimed as hardware graphics certification.

Visible desktop Chrome 155.0.8059.86 playthrough used the normal canonical fixture with no test query. Both fixed seat views were inspected. Player 1 reverse thrust reduced speed to about 1.4 m/s, yaw changed the camera heading while motion continued; a low-speed attempt ran out of time and passed to Player 2. Player 2 thrust reached about 6.5 m/s, left yaw visibly turned the view, and the turn passed after a wall miss. Opaque handoffs and focus-loss pause/resume were readable. A later visible canonical-game result showed Player 2 self-hit and Player 1 victory. These were short human-style steering attempts, not a claim of manually flying the full winning route. The full routes are independently proven by recorded collision-enabled replays.

Playability observation: thrust requires early braking before corners; turning the nose does not cancel drift. The unchanged 18-second lifetime accommodates the demonstrated stop/turn route with about 3.23 seconds spare. A known successful route allows an opening-shot win; opener advantage and novice learning time have not been quantified, and symmetry is not presented as balance evidence. No tuning changes or aim assistance were added.

Browser coverage mapping: B01–B06/B08–B13 pass automated interaction/presentation checks; B07 passes deterministic input/focus checks plus native focus-loss observation, with the extra native-tab automation probe skipped as described. B14 passes local-driver cap/reset tests. Ready/flight/result screenshots are in `artifacts/`. Firefox/Safari, broader comfort testing and competitive balance remain follow-up limitations, not implemented M2/M3 scope.

## Requested gameplay polish — 26 October 2026

- [x] Add private, match-scoped wall-impact splashes, retaining at most the latest 32 per player; hide the other seat's history and clear on rematch.
- [x] Capture actual authoritative wall results even when the full resolve phase occurs between rendered frames; deduplicate by match/shot and clip splashes to physical wall faces.
- [x] Replace the sphere with a local-geometry missile whose nose/body/fins/engine remain within the existing projectile radius and follow its heading.
- [x] Add 24 pooled smoke particles, with flight-tick emission/aging, frozen pause/resolve, cleanup between shots, depth testing and reduced-motion suppression.
- [x] Add arrow-key aliases alongside WASD, including overlapping alias release, opposing cancellation, native-scroll handling, phase/focus clearing and editable-element behavior.
- [x] Update canonical design/control/physics presentation notes, HUD help and README; physics constants, masks, fixture and both winning replays remain unchanged.
- [x] Pass strict typecheck, 47 unit tests, production build and the complete Chromium suite: 25 passed, one existing headless native-tab probe skipped, exit 0 (58.1 s).
- [x] Visually review current flight and impact screenshots; remove the old temporary wireframe marker from wall hits so the persistent splash remains clear.

Primary handled input/HUD/app observation and documentation, delegating only scene/effects work to client and nine new browser checks to QA with non-overlapping paths. Browser checks use the same cached Chromium/Node 24 setup documented above. Smoke is deliberately subtle in the rear chase view and is omitted under reduced motion. Historical route overlays were not added: the chosen navigation memory is each player's own real wall-impact splashes. No dependency, collision, rule/map version or networking change was introduced. Full regression also rechecked production preview isolation and ten rematches. The new scene and media listener resources are disposed and bounded. Screenshots: `artifacts/polish-flight.png`, `artifacts/polish-impact.png`.

## Private exploration maps — 26 October 2026

- [x] Add separate per-seat discovered-cell knowledge and a north-up HUD map, with fogged unknown corridors, nearby known walls, own home and live missile heading/location.
- [x] Reveal every open tile crossed by authoritative missile-center segments, including terminal segments and shots whose whole resolve happens between rendered frames.
- [x] Keep discovery between shots/turns in a match; reset both players' maps on Rematch and start fresh on reload, following the user's explicit reset preference.
- [x] Hide and blank map cells, owner/count attributes and marker coordinates during handoff; never display the other seat's route or opponent position.
- [x] Keep exploration outside simulation/collision/match authority; use bounded grid traversal and per-seat sets, with no new dependencies, browser storage or external services.
- [x] Handle world bounds, half-open cell edges, exact diagonal crossings, invalid cell data, shot/match boundaries and idempotent disposal; graphics failure removes the map.
- [x] Verify readability and no overlap at 1280x720 and 1920x1080, with pause and resize preserving current-match discoveries.
- [x] Update the canonical design, maze, controls and architecture notes to permit this user-authorized map; retain unchanged physics and both winning replays.
- [x] Pass `npm run typecheck`, `npm run test:unit` (57 tests in 7 files), `npm run build`, and `npm run test:e2e` (30 passed, one existing native-tab environment probe skipped; exit 0, 1.4 minutes).

Client owned the new pure exploration model, DOM/CSS map and ten unit tests. QA owned five new browser tests using actual buttons/arrows and the canonical fixture. Primary integrated authority notifications, cleanup, HUD help, Vitest discovery and documentation. The browser suite confirmed both players reset on a real self-hit/rematch cycle, privacy across ordinary misses, a full shot skipped between RAF frames, and fresh discovery after reload. Current-match discovery has no timed fade or history cap: every legitimately crossed open cell stays lit until Rematch. Adjacent wall hints do not reveal adjacent unflown corridors. Screenshots were visually reviewed; `artifacts/exploration-map.png` shows four flown cells, wall context and the own-seat markers. Existing input, pause, collision, production isolation and ten-rematch checks remain passing. Automated tests use the same Node 24/cached Chromium/SwiftShader setup documented above, with its unchanged headless native-tab limitation.

## Smaller exploration map — 27 October 2026

Reduced map widths from 222/244 px to 200/220 px at the supported desktop sizes (about 10%), with slightly tighter padding and corresponding smaller narrow-screen variants. Text sizes and discovery behavior remain unchanged. `npm run build` passed, including strict typecheck; both existing Chromium map-layout checks passed at 1280x720 and 1920x1080 with no HUD overlap (2 passed, 12.2 s).

## Fewer maze tiles — 27 October 2026

- [x] Replace the 13×13 mapVersion 1 fixture with the exact 9×9 mapVersion 2 fixture in MAZE_SPEC.md: 81 total tiles, 36 open cells, 45 walls, 40 graph edges and five cycles.
- [x] Preserve 180-degree occupancy symmetry, safe opposite fixed guns, 8 m launch clearance, no direct target sightline and the same 2.5 m corridor width.
- [x] Reduce the shortest spawn path from 20 to 12 edges (50 m to 30 m), with a clear two-turn winning route instead of four turns.
- [x] Update canonical spawns/muzzles to ±7.5/±6.85 m, derive world extent from GRID_SIZE/TILE_SIZE, and validate all geometry/counts/connectivity/metadata against the new fixture.
- [x] Drive exploration CSS dimensions and floor-grid subdivision from shared GRID_SIZE; update the unit/browser coordinate and privacy expectations to 81 cells while preserving the small 200/220 px panel sizing.
- [x] Replace both versioned ordinary-control replays: each hits the opponent with full collision at tick 978 (8.15 s), without changing physics, lifetime, collision radii or adding aim assistance.
- [x] Pass `npm run typecheck`, all 57 unit tests, production build and full Chromium regression (30 passed, one existing headless native-tab probe skipped; exit 0, 1.4 minutes).
- [x] Verify normal buttons/arrows, wall misses, private exploration, rematch/reset, both viewports, ten rematches and production-preview isolation on the smaller world.
- [x] Update current specs/README/test matrix and preserve historical mapVersion 1 evidence as history; keep M2/M3 tasks open.

Primary froze the new shared grid/map version and canonical spec before delegating. World owned fixture/validation/maze tests, client owned exploration grid/tests, and QA owned browser expectations and acceptance. Primary integrated floor geometry, replay discovery and docs. Replays now leave 9.85 simulated seconds spare under the unchanged 18-second limit, compared with approximately 3.23 on the old route. This demonstrates a shorter valid route; novice ease and competitive balance still benefit from broader human playtesting. The private maps still retain only their owner's crossed cells for the current match and both clear on Rematch. Runtime/dependency versions remain those recorded in README, with no new packages or network services. `artifacts/smaller-maze.png` was visually reviewed and shows clean 3D flight and the 9×9 explored-cell board. Automated graphics remain SwiftShader with the same documented native-tab limitation. Online phase two is subsequent work and has not been started in this change.

## M2 implementation evidence — 28 October 2026

The user explicitly changed the next milestone to real-time simultaneous play with one live missile per player. Protocol/rules version 2 replaces the previous alternating-turn M2 draft. Offline rulesVersion 1, the 9×9 mapVersion 2 fixture, all existing controls and both 978-tick winning replays remain available. Primary froze the shared online contracts before delegation. Simulation owned the new pure simultaneous tick/tests, client owned explicit seat-based presentation, network owned authority/transport/validation tests, and QA owned actual two-context browser acceptance. Primary integrated shared helpers, browser transport, routing/scripts/config, dependency lockfile and documentation.

| Gate | Actual evidence |
| --- | --- |
| Runtime | Node 24.22.1 / npm 10.9.8; ws 8.22.0 and @types/ws 8.18.2 added, all other package versions retained |
| Strict typecheck | Exit 0, includes source/server/unit/browser sources |
| Full logic/transport suite | Exit 0: 98 tests in 12 files, including 17 simultaneous rules, 19 network authority/protocol/actual WebSocket checks and five browser transport boundary checks |
| Production build | Exit 0, 37 modules; shared Three.js bundle 582 kB plus lazy online transport/presentation chunks; existing large-chunk warning only |
| Full Chromium regression | Exit 0: 40 passed, one existing headless native-tab environment skip (3.2 minutes); all ten online cases passed again alongside offline, exploration and polish regression |
| Focused online Chromium acceptance | Exit 0: 10/10 passed (1.7 minutes), actual two-context rooms and real server; 100/250 ms round-trip delay plus ordered 0/5/10 ms jitter agree on authoritative winner |
| Production inspection | No __MAZE_TEST__, __MAZE_ONLINE_TEST__ or developmentSession symbols in dist |
| Pure authority boundary | No DOM, window, Three.js, browser storage, requestAnimationFrame, setTimeout or Math.random references in shared/maze/sim/server |
| Local startup | npm run dev:online starts Vite 5173 + room server 8787, actual /health and /duel tested; no public deployment |
| Visible playthrough | In-app browser on the canonical world: real Create/Join/Ready, both missiles in flight, p1 Up thrust with visible smoke/map, p2 separate untouched map, p2 reverse-thrust self-hit with matching p1 victory, two-party rematch resets both maps to zero, Leave produces room forfeit |

Network tests use both deterministic injected clocks and actual localhost WebSockets. They cover simultaneous age-zero launch, forged/stale/wrong-shot intents, twelve-tick input expiry, replayed/out-of-order input, projected private knowledge, rotated credentials/old-generation invalidation, Ready/disconnect/waiting expiry, pre-start rematch, no-opponent abandonment, hit precedence, payload/binary/rate limits, six-tick snapshot cadence and explicit overload failure. Browser transport tests verify no client physics advancement, seat-free fire intent, zero controls on suspension, matching-shot interpolation, stale snapshot rejection, reconnect sequence/token rotation, expired credential cleanup, invalid-code recovery and incompatible render data rejection.

Private rooms are held in process memory. Online reload restores the same match during grace using a sessionStorage credential; server restart discards rooms. This differs intentionally from offline reload, which creates a fresh match. No public HTTPS/WSS service, account system, durable match store, prediction, lag compensation or server replay recorder is included. Static geometry/public missile snapshots are inspectable, so normal map privacy is not anti-cheat security. Firefox/Safari, competitive balance, internet deployment and broader human multiplayer playtesting remain unverified. M3 stays open.

Final browser acceptance used the documented cached Chromium 151 / SwiftShader, two independent 1280×720 contexts and the actual room server, including the production preview proxy. New tests cover independent missiles/own input and fixed seat view, exact private exploration projection, independent wall-miss rearming, real reverse-thrust self-hit agreement, global frozen resolve, two-party rematch with both maps empty, Escape input suspension without server pause, real reload resync with cleared controls and no duplicate fire, third-seat rejection, malformed-code recovery, production hook isolation, and transparent delayed packets with ordered jitter. All ten passed in both the focused and full runs. The final production rebuild includes shader warm-up before the online lobby to avoid a first-flight software-renderer stall. The two early timing-sensitive test failures were corrected by that warm-up plus observing short-lived result messages directly rather than depending on a later poll catching the 0.75-second window; no simulation timing was weakened.

The existing headless native-tab probe remains the sole skip, with the same environment evidence recorded for M1. Real in-app browser interaction separately verified normal UI controls and both seat views. `artifacts/online-duel.png` was visually reviewed and shows private navigation memory and opponent flight status; smoke/missile flight was also observed during the visible playthrough. All current screenshot artifacts were refreshed by acceptance. No public deployment was performed, and all M3 items remain unchecked.

## Submission preparation — 30 October 2026

The user asked to finish the remaining submission features and selected Render Free with no payment method after comparing Vercel. Scope is touch input, phone layouts, a single production Node host, capacity/liveness safeguards, real browser proof and submission materials. No AI runtime, new database, new game mode or serverless architecture migration is included.

- [x] Add held touch controls using the same authoritative input masks, multi-touch thrust/yaw, cancellation/capture/focus/phase cleanup, and accessible button state.
- [x] Preserve offline hotseat and existing keyboard/arrows; retain the 9×9 maze and per-rematch map reset.
- [x] Add phone portrait/landscape and safe-area layouts with reachable room, Ready, Fire, menu, results and private maps.
- [x] Serve built assets and WebSockets from a single explicit production Node service, with correct MIME/cache policy and traversal/source-file protection.
- [x] Open online mode from the hosted root while preserving explicit offline entry.
- [x] Add validated production capacity defaults of 16 rooms/32 sockets, safe rejected-socket handling, and WebSocket ping/pong dead-peer cleanup.
- [x] Recover a usable lobby when a restarted host loses an in-memory room/reconnect token.
- [x] Add Render Free deployment configuration and instructions without changing any account billing settings.
- [x] Prepare truthful game description, AI attribution, official-rule links, deadline conflict and manual eligibility/entry checklist in submission/SUBMISSION.md.
- [x] Pass strict typecheck, production build, and 112 tests in 14 files (full suite exit 0; Node 24.22.1).
- [x] Pass actual phone multi-touch and portrait/landscape browser checks, including the production Node origin.
- [x] Pass full desktop/offline/online regression and capture the required actual-play cover.
- [ ] Publish through the user's signed-in Render account, verify Free/no payment method, and test the actual public HTTPS/WSS URL.
- [ ] Account owner confirms contest eligibility/Work mission requirements and submits manually; no automated entry has been made.

Primary owns integration, transport recovery, package/test/deploy configuration, docs and source packaging. Client owns touch/responsive presentation and five focused input tests. Network owns production assets/configuration/liveness with protocol unchanged. QA owns phone browser coverage and real-play screenshot capture. The first worker browser attempt was blocked waiting for tool approval and produced no browser evidence; primary runs browser acceptance directly. Hosting account access remains separate from completed local source work.

Final local acceptance: strict typecheck and production build passed; full unit/transport suite passed **112 tests in 14 files**; focused phone suite passed **5/5** (43 seconds); complete Chromium suite passed **45 with one existing native-tab environment skip** (4.0 minutes), exit 0. The five new browser checks use real CDP multi-touch and actual button taps at 390×844 and 844×390. They cover combined thrust/yaw, release/cancel, menu/fresh input, phase/reconnect clearing and same-origin production Node assets/WebSockets without test hooks. Initial speed comparisons failed because snapshots predated the accepted zero-input packet; traces proved the release was sent and accepted. Tests now anchor comparisons to its accepted sequence and acknowledged snapshot, then check damping and the absence of renewed nonzero input. No physics or timing rules were loosened.

Actual play screenshots were reviewed: artifacts/mobile-390x844.png, artifacts/mobile-844x390.png and artifacts/submission-cover.png. Phone controls, private map and telemetry fit without overlap; the desktop cover shows the real missile, smoke and navigation memory. Public assets include third-party license notices. Production dependency/rule/map versions remain unchanged; no package was added. The same Node 24/cached Chromium/SwiftShader environment was used. Physical iOS/Android hardware, Safari, mobile soft-keyboard behavior, public hosting and public load testing remain unverified. No paid feature, payment method or contest entry was enabled.
