# Maze Shooters — test and acceptance plan

This file defines required evidence. M1 is now implemented; actual results, version records, browser limitations, replay paths and visible playthrough notes are recorded in TASKS.md. The matrices below remain the acceptance contracts rather than a substitute for that execution record.

## Test layers and execution

Use Vitest for pure simulation/maze tests and Playwright Chromium for browser integration. Use assertions about externally meaningful results and analytic trajectories, not tests that duplicate the code's expressions without an independent expectation. Most failure-prone rules belong headlessly; camera readability and control feel require visible play.

Run typecheck, unit tests, production build, and browser acceptance once integration is complete. Repeat affected checks after a change; do not continually broaden unrelated suites after they pass. Playwright must launch its own configured local web server and use an isolated context per test. Avoid arbitrary sleeps; wait for state/UI conditions or advance known fixed ticks through a development-only hook when exact timing is necessary.

Supported M1 acceptance baseline is a desktop Chromium browser with WebGL 2, keyboard input, and 1280x720 plus 1920x1080 viewports. Record actual browser, OS and device. Firefox/Safari smoke checks are useful follow-up; do not claim them without running them. A headless software-rendering limitation must be reported rather than interpreted as successful graphics QA.

## M1 pure logic matrix

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| M01 | Parse canonical fixture | 9x9; 36 open, 45 walls, 40 graph edges; all open cells reached |
| M02 | Fixture shape and transforms | Perimeter solid; spawn centers/muzzles exact; wall IDs stable; each tile extent correct |
| M03 | Structural validation failures | Wrong length/character, missing spawn, broken perimeter, disconnected open cell and unsafe muzzle rejected with useful diagnostics |
| M04 | Geometry fairness | 180-degree occupancy symmetry; 12-edge spawn path; direct spawn segment blocked |
| P01 | Launch p1 and p2 | Muzzle positions, opposite heading/velocity, speed 5, age 0, spin 0; no launch-tick displacement |
| P02 | No-input coasting | In empty test geometry, after 120 steps speed is `5 * exp(-0.18)` within 1e-9 and heading remains fixed |
| P03 | Analytic coast displacement | With q=`exp(-0.18/120)`, displacement magnitude after n steps is `5/120 * q*(1-q**n)/(1-q)` within 1e-8 for n=120, compared independently of production integrator |
| P04 | W and S | W increases forward speed then respects magnitude cap; sustained S reduces and reverses initially forward travel without instant stopping |
| P05 | Yaw and drift | A/D produce opposite signed yaw; old velocity is not rotated by a yaw-only control; spin decays when released |
| P06 | Opposing keys | W+S equals no-thrust trajectory; A+D equals no-torque trajectory, preserving existing drift/spin |
| P07 | Frame-rate independence | The same per-tick trace under 30/60/144 Hz render schedules produces the same final state after equal simulated tick counts |
| P08 | Plane and limits | Y remains a render constant; speed <=9; abs spin <=2.8; heading wraps to [-pi,pi); all numbers finite |
| C01 | Swept target contact | Known segment/circle contact time equals analytic root; endpoint overlap, tangent, starting overlap and zero-length cases handled |
| C02 | Swept wall face | A segment crossing a wall resolves at its near expanded face, including a synthetic long segment that endpoints alone would miss |
| C03 | Rounded corner | A diagonal corner miss outside the rounded expansion is not falsely hit by an expanded AABB; true arc tangent does hit |
| C04 | Earliest contact and ties | Wall before a behind-wall target; TOI_EPS ties use wall then numeric row-major wall order, then p1/p2 |
| C05 | Shooter collision | Initial muzzle is safe; a returning path can hit its owner and awards the other player victory |
| C06 | Lifetime boundary | Step 2160 allows inclusive contact; collision wins over expiry; no-contact at that age resolves timeout and step 2161 never runs |
| S01 | Turn loop | Initial handoff -> ready -> flight -> resolve -> opposite handoff; turnId increments exactly once on miss |
| S02 | Legal actions | Wrong seat, phase, matchId, turnId, repeated Fire and stale commands leave state unchanged |
| S03 | Same-tick double command | Ready+Fire queued together accepts only Ready, with no retained Fire; a subsequent fresh Fire launches once |
| S04 | Resolve duration | Terminal flight step sets 90; next 89 steps remain resolve; next step transitions; projectile never remains live |
| S05 | Hit and self-hit | Winner assigned on contact, preserved during resolve, then gameOver; no turn pass or second shot follows |
| S06 | Rematch isolation | New matchId, clean projectile/input/result/tick/IDs, same map/spawns, alternate opener; old queued commands fail |
| S07 | Snapshot ownership | Advancing sim does not mutate saved previous snapshots or immutable world geometry |
| R01 | Replay consistency | Re-run fixed initial state + tick masks in same runtime for identical output; cross-runtime numeric checks use tolerance |
| R02 | Actual fixture win paths | Stored normal-control replays hit the opponent from each spawn within 2160 steps with full collision and no state teleportation |

Use small synthetic geometry for isolated collision and lifetime tests where the canonical maze would terminate a shot early. Do not disable collisions in the canonical-map playability replays. For collision unit tests, numbers near epsilon need explicit entry, tangent and miss cases on both sides of the boundary.

P07 compares equal simulated time. A deliberate overloaded frame that invokes the offline driver's drop policy is tested separately, since that driver intentionally slows simulated time under overload. No test should require wall-clock match duration to remain constant under a rendering stall.

## M1 browser and local-session matrix

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| B01 | Cold start | No browser exception; floor/walls/targets render; opaque Player 1 handoff visible; no service setup needed |
| B02 | Ready then Fire | Button and keyboard paths work; fixed view persists under mouse/WASD; one fresh Fire creates one shot and switches camera |
| B03 | Thrust and yaw via real keys | A/D turns nose and camera; W/S changes speed; released input coasts; trajectory is not direct WASD strafing |
| B04 | Miss and handoff | Wall and timeout each show correct result, 90-tick resolve, next named player, opaque cover and untimed Ready |
| B05 | Opponent hit and self-hit | Correct authoritative winner/victim wording; no steering after impact; Rematch available after resolve |
| B06 | Rematch | At least ten cycles keep one renderer/loop and one listener set; transient meshes clear; opener alternates |
| B07 | Blur/visibility pause | Hold thrust/turn, hide or blur, return: paused until explicit resume; no lost flight time, stuck keys or automatic fire |
| B08 | Escape pause in each live phase | Underlying phase/timers/camera freeze and resume without duplicate action; gameOver has no active pause timer |
| B09 | Repeats and UI focus | Holding Space/Enter cannot cross phases; focused button activation causes one action; Tab works; editable elements do not steer |
| B10 | Chase camera at corners | Solid walls occlude camera arm; fallback view stays readable; no view through walls; no physics changes due to camera sweep |
| B11 | HUD and resize | Both viewport sizes fit; timer starts 18.0, never displays live 0.0; labels use text plus color; resize does not reset state |
| B12 | Production preview | Build loads; inputs and loop work; bundled assets local; no development mutation globals/query fixture access |
| B13 | Graphics/reduced motion | Unsupported/lost graphics produces useful message and clears controls; reduced motion removes decorative flashes/shake |
| B14 | Catch-up policy | A long frame runs at most 12 steps; no teleport/instant expiry; resume resets accumulator; a dropped-time diagnostic is development-only |

Real UI interaction is required for B02, B03, B07 and B09. Test hooks may inspect state or advance exact steps, but may not stand in for key/button listeners. B05 may use a named close-range development fixture to isolate the presentation path, while R02 independently proves full-map winning shots. The production preview must not load that fixture through a query flag.

For timeout testing, use a safe synthetic arena and deterministic stepping so the shot survives without a wall. Do not globally turn off collision. For blur, send real focus/visibility changes if supported; otherwise combine an automated event-path test with an explicitly recorded manual tab-switch test.

## Playability replay format and human checks

In the implemented suite store replay data as plain JSON with `rulesVersion`, `mapId`, `mapVersion`, `shooter`, and `runs: [{ticks: positiveInteger, mask: 0..15}]`. Replay starts immediately after an accepted Fire, so the muzzle state has ageTicks=0. Expand each run into the exact masks for subsequent physics steps; stop once the shot resolves and assert reason hit, victim is the other player, and age <=2160. Do not insert position/velocity changes or switch to an easier fixture mid-trace. A passing replay for each shooter is required even if a development controller helped discover it; any controller is test tooling and not normal game aim assistance.

Manually play each seat. Confirm that the scene feels 3D, pre-shot aim is fixed, drift is visible, reverse thrust can help before a corner, the timer gives enough exploration time, and the target is readable. Observe opening-shot advantage and note it without claiming symmetry proves balance. Record at least one screenshot of ready, flight and result where tooling allows. Assertions alone cannot certify camera comfort or control feel.

## M2 simultaneous online matrix — 28 October 2026

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| N01 | Two browser contexts | Distinct seats, compatible rules/world, both Ready, third client rejected |
| N02 | Simultaneous authority | Both missiles launch independently, max one per seat, age-zero launch, opponent continues through other miss, authoritative self-hit/win agreement; equal fatal TOI draw |
| N03 | Forged intent | Extra identity/position/winner, stale match/shot, invalid mask/version/sequence and malformed frames rejected |
| N04 | Input gaps/duplicates | Valid newest mask, duplicate cannot refresh, twelve-tick expiry, immediate disconnect/phase clear |
| N05 | Latency | Approximately 100/250 ms round-trip delay/jitter, eventual state/outcome agreement, no client-created hits or duplicate fire |
| N06 | Reconnect | Real reload restores same seat/match/private knowledge; token rotates, old generation rejected, controls cleared |
| N07 | Deadlines | Initial Ready deadline, disconnect grace, no-opponent abandonment, hit precedence and dual-overdue abandonment |
| N08 | Knowledge/history | Only recipient discoveries/history sent; complete snapshots restore skipped updates; per-match/shot effect deduplication |
| N09 | Rematch | Both request; new match/tick/shot context; both maps/history reset; old match requests rejected |
| N10 | Transport/boundary | Actual ws transport, oversized/binary/rate enforcement, pure server imports, production excludes test hooks |
| N11 | Online menu | Escape/blur sends zero and suspends own controls; authoritative time/opponent continue |

Run the full existing M1 regression alongside the new suite. Hosted WSS/public deployment is outside this local milestone; normal browser selection of wss on HTTPS does not certify deployment. Input replays remain collision-enabled. Private map rendering must consume server cells rather than connect low-rate render samples.

## Completion record

During implementation record the date, commit/revision if present, runtime/tool versions, commands and exit results, browser/device, failed rows and fixes, replay paths, and manual findings in TASKS.md or this file. Do not pre-check rows based on this specification. A limitation must identify the missing behavior or environment blocker. M1 is complete only when its logic, browser and playability gates have passed; M2 completion must be supported by the separately recorded checks.

## Gameplay polish acceptance — 26 October 2026

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| UX01 | Arrow aliases | Real ↑/↓/←/→ drive the same mask and trajectory as W/S/A/D; overlapping aliases do not double force, releasing one keeps the other active, opposites cancel |
| UX02 | Arrow lifecycle | Pre-held/repeated arrows cannot carry through launch/pause; editable/outside focus clears steering and requires fresh input; captured flight arrows prevent scrolling |
| UX03 | Private wall history | Actual wall results record once, persist for their owner's later turns, hide for the other seat, reset on rematch, remain bounded to 32 per seat and clip to the wall surface |
| UX04 | Skipped render frames | A wall shot that resolves entirely between renders still records its mark through authority-state observation |
| UX05 | Missile and smoke | Nose/body/fins/engine match authoritative heading and fit existing collision envelope; smoke is bounded, depth-tested, frozen with pause/resolve, cleared between shots and disabled by reduced motion |
| UX06 | Resources and presentation | Disposing removes cosmetic groups/media listeners and releases geometry/materials; normal flight/impact screenshots show readable additions without physics changes |

The exact collision-enabled winning replays remain required after these cosmetic/input changes; no tuning or rule/map version change is introduced.

## Private exploration map acceptance — 26 October 2026

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| EX01 | Traversed cells | A shot reveals only open tiles its center crosses, including complete segments between observations and the terminal endpoint; negative coordinates, grid corners and world bounds are handled |
| EX02 | Private knowledge | Separate p1/p2 histories; active-seat-only map, no opponent marker or unvisited corridor reveal; handoff hides and blanks the map |
| EX03 | Match-long discovery | Visited cells stay lit across shots and turns; both maps reset on Rematch and page reload starts fresh; invalid/out-of-range/wall cell data is discarded |
| EX04 | Authority/lifecycle | Skipped render frames still collect all discoveries, pause adds none, new shots do not connect unrelated endpoints, graphics failure/disposal remove the map |
| EX05 | Usable HUD | Counts, legend, own home and live heading marker are readable at 1280x720 and 1920x1080 without colliding with telemetry, ready help or controls |
| EX06 | Session isolation | No browser storage is needed; maps belong only to the current match and cannot carry a previous match's route into the next |

Keep the unchanged collision-enabled win replays and existing browser input/miss/hit/rematch checks passing.

## Smaller maze acceptance — 27 October 2026

The current authored fixture is `maze-01`, mapVersion 2. Verify the exact 9×9 occupancy, 36 connected open tiles, 45 walls, 40 edges, five cycles, safe spawns at ±7.5 m, muzzles at ±6.85 m, blocked direct sightline and 12-edge shortest path. The canonical two-turn waypoint route is `(1,1) -> (5,1) -> (5,7) -> (7,7)`, with a rotated counterpart for the other seat. Replays must hit the opponent using only ordinary controls and all collisions; current traces take 978 ticks each. Confirm the exploration HUD renders 81 cells, uses current-grid coordinates for both homes/missile markers, retains private discoveries between turns and resets both on Rematch. Keep the small HUD panel dimensions and all unchanged input/physics tests passing. M2 uses the same smaller fixture.
