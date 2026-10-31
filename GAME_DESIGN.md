# Maze Shooters — game design


## Authorized M2 simultaneous mode — 28 October 2026

The user chose real-time multiplayer with **one live missile per player simultaneously**. The M1 turn/handoff/one-missile rules below remain the offline mode. Online has two independent ready/flight/resolve slots, no turns, and no opener. Both stationary players may fire at any time their own gun is ready. A miss gives that seat the existing 90-tick result interval before firing again; the other missile continues. Missiles pass through each other. The earliest fatal swept contact wins; equal-time contacts defeating both players produce a draw. Self-hit still loses. A fatal result cancels all flight and resolves for 90 ticks before gameOver.

Private rooms require both compatible seats to choose Ready initially and both to request Rematch later. Both maps and splashes reset on each rematch. Reload resumes the same online match/seat within the reconnect grace, restoring its map. Online menus suspend only local input; the server continues. Room forfeits and reconnect/Ready deadlines are specified in NETWORK_PROTOCOL.md. Fixed guns, the 9×9 map, unchanged rocket dynamics and offline hotseat remain available.

Specification edition: 1.0. M1 is the offline hotseat prototype.

## Experience and core loop

You are a stationary shooter hidden in a maze. You cannot walk or aim the gun. On your turn, you launch a small steerable rocket-like projectile, use its camera to explore corridors, and try to hit the opponent before time runs out. Choosing when to thrust, coast, brake, and rotate matters more than reflex firing.

Both players use identical equipment. The only changing tactical object is the active projectile. There are no pickups, armor, alternate weapons, moving platforms, or destructible walls. The game is a single-match duel: the first player hit loses, and the other wins. There is no separate health or damage calculation.

## M1 scope

Deliver one local browser session, one keyboard, two human players, one fixed maze, readable 3D walls and targets, fixed pre-shot views, a projectile-following flight view, timed flight, clear results, pause/resume, and rematch. No accounts, lobby, server, bots, mobile touch controls, procedural generation, downloadable assets, or public deployment are required.

The stationary bodies and gun headings are fixed for an entire match. Player 1 begins the first match. Rematches retain the fixture and player positions but alternate which player shoots first. There is no random initial advantage beyond this declared opener. Opening-shot advantage must be observed in playtesting; symmetry alone is not evidence of balance.

## State machine

Use these exact phase names in implementation and tests:

```text
new match -> handoff(active opener) -> ready -> flight -> resolve
                                              miss -> handoff(other player)
                                               hit -> gameOver -> rematch -> handoff
```

The two branches out of `resolve` occur only after its result duration. A hit determines the winner on the collision tick; the brief result presentation does not delay or change that decision.

| Phase | Player experience | Accepted gameplay action | Exit |
| --- | --- | --- | --- |
| `handoff` | Opaque screen names the next player; scene is obscured | Ready confirmation by active seat | `ready` |
| `ready` | Fixed gun view and Fire button; no timer offline | Fire once | `flight` |
| `flight` | Projectile-following camera; countdown and controls | Active seat's WASD state | A collision or lifetime expiry -> `resolve` |
| `resolve` | Impact/expiry label, frozen flight view | None | After 90 simulation ticks: `gameOver` on hit; otherwise next `handoff` |
| `gameOver` | Winner, loser, result, Rematch button | Rematch | New match, alternating opener |

Ready is deliberately untimed offline, allowing the keyboard to change hands. No automatic firing, shooting on key release, or auto-skipping occurs. Controls pressed in one phase do not queue a fire or movement command for a later phase. Repeated, stale, or invalid actions leave match state unchanged.

Pause is an offline local-session overlay, not another match phase. It freezes simulation, countdown, result duration, and camera updates. Focus loss or tab hiding pauses and clears held controls. Returning to the tab does not resume until the user explicitly resumes. No background time is deducted.

## Shots and outcomes

Fire always launches at the active player's fixed muzzle point and heading, with the same initial velocity. There is only one projectile and no ammo inventory. WASD cannot change a player's body or the original gun heading. W/↑ accelerates along the projectile's nose, S/↓ accelerates opposite the nose, and A/D or ←/→ changes yaw through angular acceleration. A turned projectile can still drift in its old direction; S is not a guaranteed world-space brake after a turn.

The flight plane is one metre above the floor. M1 uses zero gravity, no lift, no vertical steering, and no terrain elevation. The environment is 3D while navigation physics is planar. PHYSICS_SPEC.md defines every numeric constant and step order.

The shot lasts at most 18 simulated seconds. Holding no controls consumes time and permits coasting. There is no fuel budget separate from the timer. A wall contact destroys the projectile. A collision with either player's body defeats that player, including a returning shot against its owner. The muzzle is outside the shooter's body, so no temporary immunity is needed. A gun mesh is cosmetic and not another collider.

Resolution reasons are `wall`, `timeout`, or `hit`. A `hit` records the victim and the other player's victory; self-hit is a `hit` whose victim equals the shooter. A `wall` or `timeout` is a miss and passes the turn. Numerical collisions with the world boundary are wall impacts. Invalid geometry or non-finite simulation state is an implementation error, never an invented competitive outcome.

No bouncing, wall penetration, blast radius, simultaneous live shots, bullet-to-bullet collision, draw timer, or turn limit is present. Matches can continue indefinitely if both players keep missing. A player hit on the last permitted flight step loses: valid contact takes priority over timeout, as defined in PHYSICS_SPEC.md.

## Information and cameras

The player sees their own stationary view before shooting and follows their projectile during flight. Walls occlude targets normally. Each player has a private exploration map that lights cells crossed by their own missile for the rest of the match. Unvisited corridors remain dark; the map never supplies the opponent's position. No wall-transparent target marker, opponent arrow or omniscient camera is shown. Neutral corridor landmarks can help a player remember where they have been.

The flight camera follows the projectile heading rather than instantly aligning velocity to the view. This makes nose direction and drift visible. A small HUD speed readout and remaining-time display support learning. Show Player 1/Player 2 labels as well as colors. Never use color alone to communicate whose turn or who won.

The handoff screen obscures the scene before switching to the next player's view. Local hotseat is an honest shared-screen prototype, not secure hidden-information play. Debug tools may show the full fixture only in a clearly labeled development mode, disabled by default and absent from the normal play flow.

## Visual and interaction direction

Use clean, low-detail geometry: pale or desaturated walls, a contrasting floor, cyan Player 1, amber Player 2, and a bright emissive projectile. Targets should look like simple stationary human-sized training dummies with clear bases and gun barrels. Use flat or simple lit materials without downloaded textures. Different neutral wall panels or floor stripes can distinguish regions without pointing to an opponent.

The HUD must remain readable at 1280 by 720 and 1920 by 1080. It shows active player, phase, remaining flight seconds, speed, and brief control help. Ready, Fire, Resume, and Rematch must be accessible buttons with visible keyboard focus. Mouse clicks operate those buttons but never aim. Respect reduced-motion preferences by omitting nonessential shake, flash, and camera easing. Gameplay remains keyboard based in M1.

## Learning and balance checks

On the first ready screen show: "Space: fire. W/S or ↑/↓: thrust. A/D or ←/→: rotate. Release to coast. Hit yourself and you lose." Keep this help available on later turns without blocking input.

Playtests must establish that a new player understands fixed shooter positions, notices that turning does not erase drift, can brake before a corner, and recognizes the difference between a miss and self-hit. At least one normal-control replay must reach each opposing spawn within the default lifetime with collision enabled. The map's connected grid is necessary but does not prove dynamic playability.

Start with the canonical tuning unchanged. If the route is impractical, adjust one coherent set of acceleration, yaw, or lifetime values, record why, update dependent specs/tests, and re-run the playability gate. Do not silently add aim assist, target teleportation, invulnerability, or wall clipping to force a pass.

## Later milestones

M2 adds private online rooms and server authority using the same simulation and fixed fixture. M3 may add seeded mazes, optional flight prediction, sound, training mode, or alternative rules. Each extension must retain a working M1 path and introduce its own acceptance checks. Full vertical flight is a separate control and collision design, not an incidental visual effect.

## Authorized navigation and visual update — 26 October 2026

Each player retains their own recent wall-impact splashes as local navigation memory. Only the active seat's marks are visible; ordinary wall occlusion applies. They persist between that player's shots and reset on rematch, with a bounded history of 32 impacts per seat. Wall splashes supplement the private explored-cell map; no through-wall target overlay is added. The projectile is now shown as a small missile with a light smoke trail, which reduced-motion mode omits. These visuals do not change the physical circle, thrust, lifetime, wall impact rules or self-hit defeat. Arrow keys are equivalent alternatives to WASD, including opposing-key cancellation and clearing at phase/focus boundaries.

## Authorized exploration map — 26 October 2026

Each seat owns a separate discovered-cell map. An accepted shot starts revealing the missile's current open tile; every open tile crossed by its center on later authoritative flight segments stays lit. Terminal segments count, and exploration must not depend on render frame rate. Unvisited corridors stay fogged. Walls directly adjacent to discovered cells may be drawn to explain corridor boundaries, but must not reveal neighboring open corridors. Show the active seat's own home and live missile heading/location; never show the other seat's route, map or target location. Hide and blank the panel during opaque handoffs.

Exploration is local navigation memory, separate from match outcomes and collision. Keep discovered cells across shots and turns within the current match. Both players' exploration resets on Rematch, as explicitly requested by the user, and reloading starts a fresh match with empty maps. No browser storage is needed. Wall splashes also reset on rematch. This is shared-screen hotseat privacy, not a security boundary against inspection or someone watching the other player's turn.

## Easier navigation layout — 27 October 2026

The user requested fewer playing tiles before moving on to M2. The current maze is a symmetric 9×9 fixture with 36 open cells and a 30 m shortest spawn route. A straightforward winning route has two turns, compared with four turns and 50 m in the initial 13×13 map. Corridors remain 2.5 m wide, and missile handling, physical radii and the 18-second lifetime remain unchanged. Targets still have no direct sightline, so steering remains necessary. Private exploration uses the new 9×9 grid and continues to reset on Rematch. This layout change is mapVersion 2 and does not introduce online runtime code.
