# Maze Shooters — instructions for coding agents

Specification edition: 1.0, 26 October 2026. Target: M1 offline prototype.

## Objective

Build a desktop browser game in which two stationary players alternate firing one steerable projectile through a simple 3D maze. A player hit by any projectile loses immediately. The projectile behaves like a small rocket: its heading, velocity, thrust, and angular velocity are separate. M1 is local hotseat on one keyboard, with no server or AI opponent.

This directory initially contains planning documents and custom agent definitions, not a runnable game. Implement the game when the user supplies FIRST_BUILD_PROMPT.txt or an equivalent build request. Do not mark planned behavior as already implemented.

## Read and resolve decisions

Read all ten Markdown files before implementation. Start with README.md, GAME_DESIGN.md, ARCHITECTURE.md, PHYSICS_SPEC.md, MAZE_SPEC.md, and CAMERA_AND_CONTROLS.md. Read NETWORK_PROTOCOL.md to preserve the future authority boundary, then TASKS.md and TEST_PLAN.md for scope and acceptance.

The user's current instructions take precedence. Within this pack, use this ownership of facts:

| Subject | Canonical document |
| --- | --- |
| Scope, player rules, win conditions | GAME_DESIGN.md |
| Module boundaries and state contracts | ARCHITECTURE.md |
| Simulation constants, integration, collisions | PHYSICS_SPEC.md |
| Coordinates, fixture, wall and spawn geometry | MAZE_SPEC.md |
| Input, camera and HUD behavior | CAMERA_AND_CONTROLS.md |
| Future online messages and authority | NETWORK_PROTOCOL.md |
| Work order and completion evidence | TASKS.md and TEST_PLAN.md |

If a conflict changes gameplay, stop only the affected work, identify the exact conflict, and propose one coherent resolution. Continue unrelated work. Routine file organization and implementation details are yours to resolve. Record intentional rule changes in the relevant documents and tests together.

## Non-negotiable M1 rules

- Exactly two fixed players and at most one live projectile.
- No walking, jumping, mouse aiming, pointer lock, or gun rotation before firing.
- WASD affects only the live projectile. W/S applies forward/reverse thrust; A/D applies yaw torque. Keys do not directly set position or lateral velocity.
- Flight is constrained to a horizontal plane in a fully rendered 3D maze. Zero gravity is intentional for M1. Preserve momentum, drift and rotational inertia.
- A wall contact or flight expiry ends the shot and passes the turn. No bounce, penetration, explosion damage, or steering after impact.
- Any player hit loses, including the shooter if their projectile returns. There is no shooter immunity.
- Use one shared fixed-step simulation, independent of Three.js and the DOM. Swept collision decides hits, not render raycasts or visual mesh overlap.
- M1 runtime makes no multiplayer or external service calls. Online work is a later milestone.

## Implementation stack and discipline

Use TypeScript with strict checks, Vite's vanilla TypeScript structure, Three.js for rendering, plain HTML/CSS for the HUD, Vitest for headless logic tests, and Playwright for browser acceptance. Use npm and one committed package-lock.json. Resolve compatible package versions at build time and record the actual Node/package versions in README.md. Use Node 24.x as the project baseline, subject to the installed tools' documented requirements.

Do not add React, a general physics engine, a state library, networking SDK, external models, or an asset pipeline to M1. Simple local geometry and colors are sufficient. If a dependency becomes necessary, explain its concrete benefit before adding it. Keep gameplay constants in `src/shared/config.ts` and typed contracts in `src/shared/types.ts`; avoid duplicated values in renderer code.

Use small modules with explicit inputs and outputs. No frame-dependent forces, setTimeout-driven rules, Math.random in simulation, DOM imports in shared logic, or renderer-owned match state. No secrets belong in code, fixtures, logs, or agent files. Keep existing user changes and avoid unrelated refactors.

## Delegation when building

Use the five project custom agents for bounded implementation/review work when the client supports them. Their files are in `.codex/agents/`. Run only as many as the session permits; the five roles do not require five concurrent workers. The primary agent owns integration and remains responsible for the complete result.

Before any parallel writes, the primary agent must create the scaffold and freeze the shared interfaces described in ARCHITECTURE.md. Assign non-overlapping file ownership and give every worker the milestone, relevant documents, shared contracts, exact writable paths, and acceptance checks. Workers must request shared contract changes through the primary agent.

| Agent name | Owned paths / responsibility |
| --- | --- |
| `simulation` | `src/sim/`, `tests/sim/`; dynamics, swept collisions, match rules |
| `world` | `src/maze/`, `tests/maze/`; fixture, validation, geometry data |
| `client` | `src/client/`; input, scene, camera, HUD, resource cleanup |
| `network` | M1 review only; later `src/network/`, `server/`, `tests/network/` |
| `qa` | `tests/e2e/`, browser acceptance and integration review |

The primary agent owns `src/shared/`, `src/local/`, `src/main.ts`, HTML entry, build/test configuration, package files, documentation, and TASKS.md status. Unit-test ownership follows implementation ownership. QA reports unit-test gaps rather than racing those owners to edit them. Network review and read-only QA analysis can run alongside implementation; end-to-end tests depend on a working integrated app.

If custom agent loading or subagents are unavailable, perform the same roles sequentially and state that in the handoff. Do not create extra user-owned chats for these subtasks. A worker must return changed files, behavior delivered, tests actually run, remaining risks, and any requested contract changes. Wait for required workers, review their results, integrate, then run whole-project checks.

## Finish criteria and reporting

Complete M1 tasks and the M1 acceptance matrix. Test the behaviors that can fail: integration, collision, turn state, input lifecycle, pause, and restart. Avoid tests that merely copy implementation expressions. Run typecheck, unit tests, production build, and Chromium end-to-end tests after integration. Perform a visible browser playthrough if available. Never claim a browser check was run if it was only inspected in code.

Update README.md with real commands and TASKS.md with actual completion evidence. Keep remaining M2/M3 tasks unchecked. Report what works, how to run it, checks passed, and any precise limitation. If the environment blocks a check, report the blocker and leave the item open; do not replace a playable result with a plan when implementation is authorized.
