# Maze Shooters — architecture


## Implemented M2 boundary — 28 October 2026

Offline contracts and modules below retain their existing semantics. Online uses explicit RealtimeMatchState/RealtimeSessionAPI in `src/shared/realtime.ts`; it never projects a false activePlayer into M1 MatchState. `src/sim/realtime.ts` composes the shared projectile integration and swept collision primitives for two independent slots and aggregates fatal times before assigning an outcome. Shared `exploration-grid.ts` traverses authoritative per-tick segments. Both per-seat exploration and bounded result histories belong to online server state.

`server/authority.ts` owns room identity, cryptographic token digests/generations, exact intent validation, queued fire, expiring masks, deadlines, private snapshot projections and rematch. `server/index.ts` owns the monotonic 120 Hz driver and ws transport. Neither imports the DOM or Three.js. `src/network/session.ts` owns browser transport, online-only sessionStorage credentials, immutable snapshots and 100 ms interpolation; it never steps physics or creates outcomes. `src/network/client-messages.ts` rejects incompatible/non-finite render data. `src/client/online-app.ts`, online HUD/input and explicit seat-based scene methods render both missiles and the local camera/map. `src/main.ts` selects online only with `?online=1`; the default remains local hotseat with no game service calls.

On reconnect the full receiving-seat knowledge replaces presentation data; interpolated positions never reveal cells. Cosmetic effects deduplicate by match/shot and remain bounded. Forfeits are room outcomes outside pure collision state. The original planned alternating-turn network protocol is superseded by NETWORK_PROTOCOL.md edition 2.

The following contracts describe the preserved M1 offline mode; the M2 contracts and authority are described above and in NETWORK_PROTOCOL.md.

## Components and dependency direction

Use one Vite application, not a monorepo for M1. Three.js renders state; it never owns it. A pure TypeScript simulation receives geometry, commands, and key masks. A local authority/session applies commands at tick boundaries and owns pause, the accumulator, turn context, and rematch. The client reads authoritative snapshots and renders an interpolated view.

```text
src/shared <- src/maze
src/shared <- src/sim
src/shared + src/maze + src/sim <- src/local
src/shared + src/maze + read-only local session API <- src/client
src/main -> local session + client composition
```

`src/shared`, `src/maze`, and `src/sim` have no Three.js, DOM, window, audio, browser clock, network, or storage dependencies. Simulation consumes `WorldGeometry`; it does not build maze meshes. The maze module emits plain geometry data; client rendering converts that data into meshes. Avoid dependency cycles.

## Planned source layout

```text
src/
  main.ts
  shared/
    types.ts          # canonical contracts, identifiers, discriminated unions
    config.ts         # named rules and tuning, no UI state
    math.ts           # scalar/vector helpers and angle wrapping
  maze/
    fixture.ts        # exact maze-01 rows and spawn metadata
    build.ts          # grid -> immutable WorldGeometry
    validate.ts       # structural and spawn validation
  sim/
    projectile.ts     # fixed-step dynamics
    collision.ts      # swept circle vs wall/target
    match.ts          # legal commands, phases, resolution, winner
    index.ts          # small public API
  local/
    session.ts        # authority, command queue, pause, fixed-step loop
  client/
    input.ts
    cameras.ts
    scene.ts
    hud.ts
    app.ts
    styles.css
tests/
  sim/
  maze/
  e2e/
```

The primary agent creates shared contracts and package/test configuration before delegating. Small variations in filenames are acceptable if ownership and dependency boundaries remain clear. Do not put all game logic in `main.ts`.

## Data contracts

Use serializable plain values, with metres, seconds, radians, and integer ticks. `Vec2` is `{x: number, z: number}`. `PlayerId` is `'p1' | 'p2'`. The rule tuple is `rulesVersion: 1`, `mapId: 'maze-01'`, `mapVersion: 2`. No PRNG is needed for the fixed M1 fixture.

Minimum contracts to freeze before worker writes:

```ts
type Phase = 'handoff' | 'ready' | 'flight' | 'resolve' | 'gameOver';
type KeyMask = number; // integer 0..15; W=1, A=2, S=4, D=8
type Wall = { id: string; minX: number; maxX: number;
              minZ: number; maxZ: number };
type PlayerSpawn = { id: PlayerId; position: Vec2; heading: number };
type WorldGeometry = { mapId: string; mapVersion: number;
  walls: readonly Wall[]; spawns: readonly PlayerSpawn[] };
type ProjectileState = { shotId: number; owner: PlayerId;
  position: Vec2; velocity: Vec2; heading: number;
  angularVelocity: number; ageTicks: number };
type ShotResult = { reason: 'wall' | 'timeout' | 'hit';
  shotId: number; shooter: PlayerId; endpoint: Vec2;
  victim: PlayerId | null; colliderId: string | null };
type CommandContext = { matchId: string; turnId: number };
type MatchCommand = CommandContext & (
  { type: 'ready'; playerId: PlayerId } |
  { type: 'fire'; playerId: PlayerId }
);
```

`MatchState` contains matchId, matchNumber (starts at 1), opener, tick, phase, activePlayer, turnId (starts at 1), nextShotId (starts at 1), projectile or null, result or null, resolveTicksRemaining, and winner or null. Store the rule tuple and immutable player spawn data with the session/world, not mutable player positions. A result identifies the last shot; shot IDs are allocated only when fire succeeds and are monotonic within a match. A new match gets a new matchId and resets tick, turnId and shot IDs; matchNumber increments and opener alternates. Old commands cannot address the new match.

In `flight` there is one projectile, no result, zero resolve ticks, and no winner. In `resolve` projectile is null, result is present, remaining ticks are 1..90, and winner is already set only for a hit. In `gameOver` result and winner remain, remaining ticks is zero. In `handoff`/`ready`, projectile/result/winner are null and remaining ticks is zero. `activePlayer` remains the shot owner through resolution and gameOver; only a miss's handoff switches it. The winner on self-hit is therefore not necessarily activePlayer.

## Public API behavior

Implement equivalents of:

```ts
createMatch(world, { matchId, matchNumber, opener }): MatchState
applyCommand(state, world, command): { state: MatchState; accepted: boolean }
stepMatch(state, world, controls: KeyMask): MatchState
createRematch(previous, world, newMatchId): MatchState
```

Names may vary, semantics may not. Treat returned snapshots as immutable: previous render samples must not change under the renderer. A copy-on-write implementation is sufficient; a general entity/component system is unnecessary.

The local session queues commands in arrival order and applies them before a fixed step. Validate matchId, turnId, phase, and active seat. Accept Ready only in `handoff`, Fire only in `ready`. If Ready and Fire are queued before the same step, process at most one accepted phase-changing command for that step and reject the other; do not defer it to the next phase. Reject stale context rather than silently rebinding it. Input adapters clear their held states on phase changes; Fire starts with mask zero. The first dynamics step occurs on the next fixed step after launch, not in the launch step.

`stepMatch` advances the integer tick once per unpaused fixed step in every phase except `gameOver`, where it is a no-op. Ready/handoff have no gameplay timers. A flight step integrates once, checks swept collision, increments age, and resolves the shot if necessary. A terminal flight step creates a result with 90 resolve ticks; the next 90 steps count down. On reaching zero, hit -> gameOver; miss -> increment turnId, switch active player, clear result, handoff. No further command or physics occurs in that same transition step.

The session may short-circuit the dynamics call on a step where it accepted Ready/Fire, but it still advances the match tick exactly once. Implement this through one explicit tick entry point, avoiding accidental double increments between command and step functions. A rematch is a session action accepted only in gameOver; it creates a clean match instead of mutating the previous one in place. Offline seat identity is asserted by the UI and is not a security boundary.

For clarity, `applyCommand` never increments tick or integrates. The composed tick entry point does the following: if gameOver, return unchanged; otherwise process queued commands until at most one phase-changing command is accepted, rejecting additional phase-changing commands for that boundary. If one was accepted, return its resulting state with tick incremented once and do not call the dynamics/result advance. If none was accepted, call `stepMatch`, which increments tick once and advances the current phase normally. Invalid commands must not suppress physics. This means an accepted Fire produces flight at age zero, and the next tick is the first movement tick. Do not both increment tick in the wrapper and let `stepMatch` increment it again.

## Fixed-step driver and rendering

Use the animation loop only to accumulate elapsed time, consume fixed steps, and render. The offline driver clamps a frame's elapsed time to 0.1 seconds and runs at most 12 fixed steps per rendered frame. If a complete step remains after that cap, discard complete excess steps, retain only the fractional remainder, and increment a development diagnostic. This prevents a spiral after a stall. It deliberately slows simulated time under sustained overload; it never jumps the projectile forward or expires it using wall time.

Pause stops accumulation and simulation, clears controls, and resets the accumulator. Resume resets the animation time origin and requires fresh inputs. This applies to flight and the result duration. Render with alpha = remainder / dt between previous and current positions and shortest-arc headings; never blend across shot IDs, phase switches, pause/resume, or rematches. A one-step render delay is acceptable. Countdown, winner, and accepted actions always read current authoritative state.

Keep the terminal endpoint in ShotResult for impact rendering. Remove the live projectile from simulation immediately, freeze the terminal view, and show a cosmetic impact marker during resolve. Cosmetic particles never become colliders or change timing.

## Errors, resources and diagnostics

Validate the fixture before creating a match. Invalid rows, disconnected cells, unsafe muzzle positions, or non-finite inputs fail with a clear development error; do not silently repair the map. Mask input at the adapter and validate again at authority boundaries. Do not propagate NaN into a camera or authoritative snapshot.

Register event listeners once and remove them on dispose. Reuse the renderer and maze for rematches; clear shot-specific meshes and UI state. Dispose Three.js geometries/materials on application teardown. Handle resize, device pixel ratio changes, WebGL creation failure, and context loss with readable UI. A graphics failure must stop the local loop and clear input until recovery/reload.

A development-only query flag may expose state inspection, deterministic fixed-step advancement, and named test fixtures for Playwright. Restrict it to Vite development/test mode. Production must not expose fixture mutation, forced wins, arbitrary positions, or test globals. End-to-end tests must also cover normal UI actions; a test hook cannot substitute for working input.

## Online seam

M2 now imports shared, maze and sim from a Node authority without browser shims. It validates seat identity, consumes expiring key masks and publishes snapshots through the explicit RealtimeSessionAPI. Offline keeps its own local session and MatchState; NETWORK_PROTOCOL.md separates simultaneous online rules and room outcomes from offline behavior.

## Local exploration memory — 26 October 2026

In offline mode, `src/client/exploration.ts` owns presentation-only per-seat discovery, consuming immutable authority snapshots and shared tile dimensions. It walks complete missile-center segments (including terminal results) and never writes simulation, world or match state. `exploration-map.ts` renders only the active seat's knowledge and clears displayed contents during handoff. `app.ts` observes every session notification rather than sampling discoveries only during RAF. Discovery lives only in memory for the current match and resets for both seats on Rematch; reloading also starts fresh. No browser storage or external calls are added.
