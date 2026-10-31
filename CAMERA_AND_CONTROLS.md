# Maze Shooters — camera, controls and HUD


## Online simultaneous controls — 28 October 2026

The M1 controls/cameras below remain unchanged offline. Online each browser controls only its bound seat. Enter/Ready confirms the initial room; Space/Fire launches whenever that seat's gun is ready. WASD and arrows steer its own missile with the same aliases, torque and thrust; the opponent may fly simultaneously. The stationary camera always belongs to the local seat, and flight follows only that seat's missile. The other missile remains ordinary occluded world geometry. Own private maps/splashes are supplied by the server and reset on rematch.

Escape/Menu, blur and tab hiding clear input and suspend local controls, with a visible “Duel continues” overlay. They never pause server physics or opponent control. Resume requires fresh input; no held key queues firing. Reload reconnects to the same seat within grace, requiring fresh controls. Connection status and own/opponent flight readiness are visible. NETWORK_PROTOCOL.md defines the room lifecycle and deadlines.

M1 is a keyboard-controlled desktop browser game. Fixed pre-shot views and a controlled projectile are core rules, not optional camera modes.

## Keyboard and buttons

| Context | Input | Behavior |
| --- | --- | --- |
| `handoff` | Ready button or Enter | Acknowledge the named active player; enter ready |
| `ready` | Fire button or Space | Fire once in the fixed gun direction |
| `flight` | W or ↑ | Accelerate along the projectile nose |
| `flight` | S or ↓ | Accelerate opposite the nose; can reverse travel |
| `flight` | A / D or ← / → | Angular acceleration left / right |
| Any live offline phase | Escape or Pause button | Pause; use Escape or Resume button to resume |
| `gameOver` | Rematch button | New match, alternating opener |

There is no movement of the shooter, mouse look, mouse aiming, pointer lock, jump, pitch, boost, or fire-on-hold. Mouse clicks may operate buttons. Use physical `KeyboardEvent.code` values KeyW/KeyA/KeyS/KeyD, ArrowUp/ArrowLeft/ArrowDown/ArrowRight, Space, Enter and Escape. Label WASD and arrow alternatives together; custom remapping remains later work. Arrow aliases produce the same four-bit intent mask. Holding two keys for one action does not double its force; releasing one leaves that action held until its other alias is released. Prevent arrow scrolling only while the focused game captures flight controls.

Capture keys only while the game surface or its controls have focus and no editable form is active. Prevent scrolling for captured Space only when it triggers the game action. Keep Tab navigation and visible focus intact. Handle focused button Enter/Space using its native activation without also firing a global action: one event must produce at most one command. Ignore repeated keydown events for Ready, Fire and Pause, and require a fresh keydown after each phase transition.

Track held WASD/arrow keys separately from edge-triggered actions. Sample the mask for each fixed simulation step. W+S and A+D cancel their corresponding accelerations. Keyup releases its physical key even if the scene no longer has focus; its action bit stays set if another alias is still held. Entering an editable element or moving focus outside the game clears armed controls. Clear all held controls on phase change, launch, pause, blur, tab hide, rematch, graphics failure and dispose. A key held while pressing Fire must be released and pressed again before it can steer the new shot. Do not retain a queued Fire or Ready through a phase change.

Ignore auto-repeat keydown for WASD/arrow keys as well as action keys: a movement bit becomes held only on a fresh non-repeated keydown and clears on keyup. After input is cleared, repeated keydown from a still-held key must not re-arm it. If the adapter tracks physical-down keys separately, block them until keyup at each clearing boundary. This is necessary to make launch and focus-resume behavior match the rule above.

## Pre-shot camera

In `ready`, use a PerspectiveCamera with vertical FOV 70 degrees, near plane 0.04 m, far plane 60 m, and aspect from the render area. Its world position is the active shooter's XZ center at Y=1.45 m. Its look target is 4 m forward along that shooter's heading at Y=1.0 m. This gives a small fixed downward view toward the muzzle's flight plane.

Position, yaw, pitch and roll are fixed throughout ready. Mouse motion and WASD cannot affect the camera. The gun remains horizontal at Y=1.0, regardless of the camera's slight downward pitch. Do not use the screen center ray to aim the launch: muzzle and heading come from authoritative spawn data. Hide the local shooter's body if it obscures this view; show their fixed gun. Such mesh visibility changes never affect collisions.

## Flight camera

Use the same FOV and clipping planes. Let p be the rendered projectile center at Y=1.0 and f its heading vector from PHYSICS_SPEC.md. The desired position is `p - 0.65*f + (0,0.28,0)`. The desired look target is `p + 2.0*f`. Up is world +Y; do not roll the camera. Yaw follows heading, not velocity. Its pitch is determined by that offset and target and does not respond to mouse input.

M1 requires no extra camera spring. Use the fixed-step position/heading interpolation in ARCHITECTURE.md and update the camera directly from that render sample. Never smooth physics state or feed a camera orientation back into simulation. Snap rather than interpolate across launch, termination, new turn, or rematch. Show both player bodies during flight, including the shooter's body so a returning shot is understandable.

Walls must not let the chase camera reveal the room behind them. Sweep a cosmetic sphere of radius 0.08 m from p toward the desired camera position against the same walls, considering their Y extent. Shorten the camera arm to the first contact minus a 0.02 m margin. If available arm length is below 0.15 m, use a nose-view fallback at p plus 0.10 m in +Y, looking toward the same forward target. That fallback has no rearward offset and remains inside the projectile's available horizontal clearance. Hide the projectile mesh when it blocks this view. Camera collision never changes the projectile path or causes a shot result.

The camera can use the shared wall geometry and collision helpers but must supply its own radius. Do not mistake this cosmetic sweep for authoritative projectile collision. Do not fade walls to transparency to solve occlusion. If the camera cannot be placed safely because the authoritative projectile has just impacted, freeze the last safe camera for the result view and show the impact label.

## Transitions

At app start, create the match in handoff with a full opaque overlay. Do not expose the scene while resources initialize or while selecting the next seat. Ready dismisses the overlay and snaps to that seat's pre-shot view. Fire snaps to the flight view on the accepted launch state, then tracks the active projectile.

On impact or timeout, remove the live projectile mesh, show a small impact/expiry marker at the result endpoint, and freeze the safe flight camera. Keep this presentation during the 90-tick resolve phase. Hit results already have an authoritative winner but input remains disabled until gameOver. On a miss's handoff, make the overlay opaque before switching the camera behind it. On gameOver keep the result view and show winner, victim, self-hit wording if relevant, and Rematch.

Rematch keeps the same map and spawn assignments, clears all input and transient meshes, alternates opener, and returns to an opaque handoff. There is no automatic rematch or mid-flight restart button in normal play. A clearly marked development reset may exist only in test/development mode.

## HUD copy and hierarchy

Show active player by text and color, plus a small phase label. In ready show "Your gun is fixed. Fire, then steer the projectile." and the concise control help. Fire is visibly enabled only in ready. During flight show remaining time to one decimal place using a ceiling to the next tenth (so a new shot shows 18.0 and a live shot does not show 0.0 prematurely), speed in m/s, and WASD help.

Use these outcome semantics, with natural phrasing:

- Wall: "Wall hit. Player N is next."
- Timeout: "Time up. Player N is next."
- Opponent hit: "Player N wins — Player M was hit."
- Self-hit: "Player N hit themselves. Player M wins."

The next player for a miss is derived from the shooter, not guessed from a HUD counter. Winner and victim for hit copy come from authoritative state. Do not announce a win based on a visible overlap or a client camera ray.

The private exploration map is permitted in the normal HUD. Trajectory previews, wall-transparent labels, world coordinates, physics debug panels and developer terminology remain outside the player flow. Each player sees their own wall-impact splashes from earlier shots in this match, occluded normally by the world. Keep at most the latest 32 wall impacts per seat; clear all on Rematch. The other seat never sees those private marks. A dev-only overlay must be clearly labeled, off by default, and gated out of production test-mutation APIs.

## Pause, focus and error behavior

Offline Escape pauses an active match; Escape or Resume resumes it. Pause may be opened from handoff, ready, flight or resolve. It preserves the underlying phase and shows "Paused"; focus loss uses "Paused — window lost focus". Returning focus does not resume automatically. Clear keys and the accumulator on both pause and resume. A held Space, Enter, Escape or movement key cannot carry into the resumed state.

Buttons need accessible names, visible focus, and sufficient contrast. Mark phase/result messages as a polite live status without announcing a rapidly changing countdown every frame. Support reduced motion by removing decorative flashes/shake; the flight movement itself is essential. Resize updates projection and renderer size without resetting the match; cap rendering pixel ratio at 2. Show a clear message for unsupported WebGL 2 or lost graphics context, stop the session loop, and offer reload/recovery. No new controls are needed for M1 mobile browsers; show a keyboard requirement if the viewport/input makes the desktop interaction unusable.

## Browser acceptance

Manually verify that fixed view stays fixed during mouse/WASD motion; flight visibly drifts after turns; reverse thrust is understandable; camera arms do not reveal through walls; controls never stick after blur; pause preserves time; keyboard and button actions never double-fire; and all overlays fit at both target resolutions. QA must include a complete miss-and-handoff cycle and a real hit-and-rematch cycle. TEST_PLAN.md specifies reproducible checks and development fixture constraints.

## Authorized visual update — 26 October 2026

Render the projectile as a small local-geometry missile with nose, body, fins and an engine, facing its authoritative heading. Keep the visual body within the existing projectile collision radius. A short, pooled, depth-tested smoke trail is cosmetic, emits/ages in simulated flight time and freezes with pause/result. Disable smoke under reduced-motion preference and clear it on a new shot, handoff or rematch. Wall splashes record actual authoritative wall results once per shot, sit on the struck wall face and are clipped to its surface. They are navigation memory, with no explosion damage or effect on collision. No route autopilot or opponent location cue is introduced.

## Exploration map HUD — 26 October 2026

Place a compact north-up map at the bottom right, above the control help and below telemetry, readable at both acceptance viewports. Label the active player and show explored-cell count. Light only the open grid cells their missile has crossed, plus nearby wall tiles as context. Unknown corridors stay dark. The missile marker follows its authoritative heading and position during that seat's flight; the home marker identifies only their own spawn. Keep the two seats' discovered cells independent, blank the DOM map contents and hide the panel during handoff, and remove it on graphics failure/disposal. The map does not capture controls.

Every authority-state notification feeds exploration, including terminal endpoints, so catch-up frames cannot skip cell discoveries. Pause does not reveal more cells. Both seats' explored maps reset on Rematch. A page reload starts a fresh match and empty discovery. No browser storage is used. This supersedes the original M1 ban on minimaps at the user's explicit request.

## Submission mobile input — 30 October 2026

Online play also supports held on-screen thrust, reverse, left and right buttons. Independent pointers combine with the same WASD masks, allowing thrust and yaw together without changing physics. Pointer release, cancellation, lost capture, blur, hidden tabs, connection changes and shot/phase boundaries clear active controls. Held inputs cannot carry through launch, menu/resume or a rematch. Portrait and landscape layouts retain the own-seat exploration map and reachable room/Ready/Fire/result/menu controls. Offline hotseat keeps its existing keyboard controls. Touch buttons have accessible labels, pressed state and large targets; viewport safe areas are respected.
