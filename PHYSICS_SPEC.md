# Maze Shooters — projectile physics and collision


## M2 simultaneous composition — 28 October 2026

All numeric dynamics, launch geometry, collision radii, swept primitives and step ordering below remain unchanged. Offline rulesVersion 1 still permits one live projectile total. User-authorized online rulesVersion 2 permits one live projectile per seat, with separate ready/flight/resolve states. Each accepted launch has age zero while any existing opponent flight integrates once on that boundary. A miss counts down 90 subsequent ticks for its seat without stopping the opponent. Missiles do not collide with each other.

For each tick, compute both proposed flight segments and their first wall/player contacts. Compare all fatal contacts by normalized time of impact before committing the competitive outcome. Earliest fatal contact determines the victim; contacts within existing TOI_EPS that defeat different victims produce a draw. Tied contacts on the same victim still award the other seat victory. Self-hit has no immunity. Exploration includes only travel up to the earliest fatal instant. Later impacts/timeouts do not become events after the match has ended. A fatal result cancels both projectiles and starts the global 90-tick resolve interval, then gameOver. Room forfeits freeze simulation separately and never manufacture collision results. These rules are implemented and tested in `src/sim/realtime.ts` and `tests/sim/realtime.test.ts`.

Canonical M1 numeric rules. All physics uses plain TypeScript numbers, not Three.js objects.

## Model, units and orientation

The projectile is a circle in the horizontal XZ plane, rendered as a small missile centered at Y = 1.0 metre. Its visual body fits within the unchanged projectile radius; smoke and wall splashes have no collision or damage. X points right/east, Y points up, and increasing Z follows increasing maze row/south. Y is fixed; gravity, pitch and roll are zero. Heading psi = 0 faces -Z/north; +pi/2 faces +X/east; pi faces +Z/south; -pi/2 faces -X/west. Positive yaw turns right when seen from above.

Define forward as `f(psi) = (sin(psi), -cos(psi))` in (x,z). Store heading separately from linear velocity. A rotation must never rotate or replace the velocity vector. A/D rotates the nose; momentum continues along the previous velocity until thrust and drag change it. For a Three.js object modeled nose-forward along local -Z, set its Y rotation to `-psi` to match this convention.

## Canonical constants

Use these exact defaults in `src/shared/config.ts` under named constants. Other documents refer here rather than inventing competing tuning.

| Constant | Default | Meaning |
| --- | ---: | --- |
| `SIM_HZ` | 120 | Fixed steps per simulated second |
| `DT` | 1 / 120 s | Integrator step |
| `FLIGHT_TICKS` | 2160 | 18 seconds maximum flight |
| `RESOLVE_TICKS` | 90 | 0.75 seconds frozen result |
| `PROJECTILE_Y` | 1.0 m | Fixed flight height |
| `PROJECTILE_RADIUS` | 0.12 m | Physical circle radius |
| `MUZZLE_OFFSET` | 0.65 m | From shooter center along its heading |
| `LAUNCH_SPEED` | 5.0 m/s | Initial forward velocity |
| `FORWARD_ACCEL` | 10.0 m/s² | W thrust acceleration |
| `REVERSE_ACCEL` | 6.0 m/s² | S thrust opposite nose |
| `LINEAR_DRAG` | 0.18 s^-1 | Exponential isotropic velocity damping |
| `MAX_SPEED` | 9.0 m/s | Vector magnitude cap |
| `YAW_ACCEL` | 8.0 rad/s² | A/D angular acceleration magnitude |
| `ANGULAR_DRAG` | 3.0 s^-1 | Exponential angular-velocity damping |
| `MAX_YAW_RATE` | 2.8 rad/s | Absolute angular-velocity cap |
| `PLAYER_RADIUS` | 0.35 m | Target cylinder radius |
| `PLAYER_HEIGHT` | 1.8 m | Target cylinder height from floor |
| `CONTACT_EPS` | 1e-7 m | Geometric contact tolerance |
| `TOI_EPS` | 1e-7 | Normalized contact-time tie tolerance |

The model uses acceleration directly; mass and fuel are not state variables. Do not accidentally multiply thrust by another mass factor or apply drag twice. Caps affect magnitudes, not individual vector components.

## Input mask

Mask bits are W=1, A=2, S=4, D=8. Only integers 0..15 are valid. Clear input on phase changes, pause, focus loss, rematch and teardown. Ignore key-repeat for button-like actions. Controls affect only `flight`; no other phase can store control intent for later.

For each step derive:

- `yawAxis = held(D) - held(A)`, giving -1, 0 or +1.
- `thrustAccel = 0` if W and S are both held or both released; otherwise +10 for W and -6 for S.

Opposing keys cancel; W+S does not produce +4 acceleration. A+D cancels angular acceleration but does not erase existing spin. No input still applies drag. S accelerates opposite the nose and can eventually produce reverse travel; it is not an instantaneous stop or a world-space velocity brake.

## Launch and tick semantics

On an accepted Fire command, allocate the next shot ID, place the projectile at `player.position + f(player.heading) * MUZZLE_OFFSET`, set velocity to `f(player.heading) * LAUNCH_SPEED`, copy the heading, set angular velocity and ageTicks to zero. The fire-acceptance step does not integrate the projectile. The first of up to 2160 dynamics steps occurs on the next fixed step.

The muzzle must be validated for wall and player clearance. At the declared offset, its surface is 0.18 m beyond its owner's body surface. There is no owner immunity at launch or later. Do not move the projectile forward extra distance to avoid a test failure; a bad muzzle is a fixture error.

## Exact integration order

For an active flight step with old position p, velocity v, heading psi and angular velocity omega:

```text
omega1 = clamp((omega + yawAxis * YAW_ACCEL * DT)
               * exp(-ANGULAR_DRAG * DT), -MAX_YAW_RATE, MAX_YAW_RATE)
psi1 = wrapToMinusPiInclusivePiExclusive(psi + omega1 * DT)
v1 = (v + f(psi1) * thrustAccel * DT) * exp(-LINEAR_DRAG * DT)
if length(v1) > MAX_SPEED: v1 = v1 * MAX_SPEED / length(v1)
p1 = p + v1 * DT
```

This is a specified semi-implicit update with exponential damping. Use the updated heading for thrust. Use the resulting straight segment p->p1 as the physical trajectory for this step; do not introduce a different curved sweep between those endpoints. At maximum speed that segment is 0.075 m long, but continuous collision is still required.

Find the earliest swept collision along p->p1. If contact occurs at normalized time u in [0,1], use `p + u*(p1-p)` as the result endpoint, increment ageTicks once, remove the live projectile, and enter resolve. Contact is inclusive at u=0 or u=1. If no contact occurs, commit p1, v1, psi1 and omega1, then increment ageTicks. If ageTicks is now 2160, resolve as timeout at p1. Never integrate step 2161. A hit or wall contact on step 2160 takes priority over timeout, including at its endpoint.

Flight age is an integer count, not an accumulated float or browser timer. Remaining seconds are `max(0, FLIGHT_TICKS - ageTicks) / SIM_HZ`. Pause advances neither age nor result ticks. Headless tests may step faster than real time without changing results.

## Swept collisions

Collision geometry is independent of visible meshes. The projectile circle collides with every solid wall rectangle and both target circles in XZ. Walls span Y=0..3; targets span Y=0..1.8; the projectile's fixed vertical interval lies within both, so planar testing is sufficient. There is no floor/ceiling contact during valid planar flight.

**Targets:** Solve segment-vs-circle for radius `PLAYER_RADIUS + PROJECTILE_RADIUS`, taking the earliest real root in [0,1]. Starting overlap/touch is u=0. A zero-length segment must still detect overlap; otherwise return no contact. The target's world position never changes. The shooter is tested exactly like the other target.

**Walls:** Test a moving point against the rectangle expanded by a circular radius, which is a rounded rectangle. An expanded axis-aligned bounding box is allowed as a broad phase only. For the exact narrow phase:

1. Test initial point distance to the closed original rectangle; distance <= projectile radius plus contact tolerance is initial contact.
2. Test the four offset face segments, retaining only intersections within the original face's perpendicular range.
3. Test four corner circles of projectile radius, retaining roots only in that corner's exterior quadrant.
4. Retain valid entry/tangent contacts in [0,1], with the earliest contact winning.

Equivalent segment-to-rounded-rectangle mathematics is acceptable if tests establish the same contact times. Do not accept the square corner of an expanded AABB as a hit: that would make diagonally grazing a maze corner behave differently from the declared circle. CONTACT_EPS stabilizes closed-contact comparisons; it must not be used as a large collision skin or visible gap.

Evaluate every relevant candidate, then choose the minimum time. For contacts within TOI_EPS, choose a wall before a player so a wall cannot be shot through. Break wall ties by the stable row-major wall order in MAZE_SPEC.md, and player ties by p1 before p2. Iteration order or a hash map must not decide outcomes. A segment starting inside geometry is a contact at zero, even though valid fixtures should prevent it.

Wall contact returns reason wall and its wall ID. Target contact returns reason hit and the victim ID; winner is the other player. Timeout has no victim or collider ID. Do not reflect velocity, slide, nudge through walls, spawn another shot, or continue processing impacts after the earliest terminal result.

## Resolution and reproducibility

On termination set result duration to 90 ticks without decrementing it on that termination step. Next 90 fixed steps count down. Input is ignored and the result endpoint remains frozen. At zero, a miss switches the active player, increments turnId and enters handoff; a hit enters gameOver with the already-determined winner.

Given an identical initial state, world, and per-tick input trace on the same runtime, the simulation must produce identical outputs. Across JavaScript engines, compare numeric trajectories with defined tolerances, not a promise of binary lockstep: trigonometric implementations may differ. M2 uses server authority rather than trusting client determinism. Replay files store the rule/map versions and run-length encoded key masks; rendering and input event timestamps are not the replay source of truth.

## Required evidence

TEST_PLAN.md specifies analytic checks, high-speed sweeps, exact corner grazing, self-hits, final-tick collisions, and replay consistency. The current 9×9 fixture has a 30 m graph path between spawn centers, but that alone does not prove a steerable trajectory. Before M1 is complete, capture a normal-control replay that hits the opponent from each seat within 2160 steps with full collision enabled. If tuning changes, bump rulesVersion for a published incompatible replay/protocol change and update the documents, constants, tests and replay metadata together.
