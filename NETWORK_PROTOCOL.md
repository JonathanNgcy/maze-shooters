# Maze Shooters — private real-time rooms

Protocol edition 2, 28 October 2026. This replaces the original alternating-turn M2 draft. The user chose simultaneous play with one live missile per player. Offline M1 keeps rulesVersion 1; online uses protocol 2 / rulesVersion 2 with maze-01 / mapVersion 2.

## Authority and timing

The Node WebSocket server imports the pure maze, projectile, collision and simultaneous-match modules. Each room has two stationary human seats. Both may fire independently and steer only their own live missile. Clients send intent; they cannot provide player identity, positions, velocity, heading, time, collision claims or a winner. There are no accounts, spectators, walking, pre-shot aiming, prediction, lag compensation or public hosting in this milestone.

The server advances 120 fixed steps per second from a monotonic clock, sends snapshots every six ticks (20 Hz), and publishes transitions immediately. At most 30 catch-up ticks are allowed per driver cycle; greater overload ends active rooms with an error rather than dropping competitive flight time. Browser requestAnimationFrame only interpolates snapshots approximately 100 ms behind receipt time. It never runs authoritative physics, extrapolates into unseen collisions, or blends across match/shot/phase boundaries.

An accepted launch has age zero. Each seat can launch at most once per boundary; both can launch on the same boundary while an existing opponent shot continues normally. Wall contact or the 18-second flight limit starts that seat's 90-tick result interval, then its gun becomes ready again. The opponent's flight continues throughout. Missiles pass through each other.

All fatal swept contacts in a tick are compared by normalized time of impact. The earliest contact decides the loser, including self-hit. Equal-time fatal contacts on different victims within TOI_EPS produce a draw; iteration order cannot decide a winner. A fatal result immediately cancels both flights and starts the global 90-tick result interval, then gameOver. Exploration stops at the earliest fatal instant. A canceled shot receives no invented impact result.

## Rooms and identity

Create assigns p1 and a cryptographically generated six-character room code; Join assigns the vacant p2 seat. Both must be connected, acknowledge the exact compatible world/rules, and choose Ready before the first match starts. There are no turns or opener in online play. After a match ends, both connected compatible seats must request Rematch. It creates a new matchId, increments matchNumber, resets tick/shot IDs, controls, private discoveries and impact histories. Room identity and seat assignment persist.

Welcome supplies a fresh opaque reconnect token. Only its digest is retained server-side; the browser stores its own token in sessionStorage so reload can reclaim the same seat. Tokens are never placed in URLs, public test hooks or logs. Resume rotates the token and increments the connection generation, invalidates the old socket, resets client sequence numbers, clears input and queued fire, sends a complete snapshot, and requires compatibility again. Resume never rewinds the match or resets a Ready deadline. Dispose/reload retains the browser credential; Leave deletes it.

When both seats are connected and compatible, each unready seat has 30 wall-clock seconds to choose Ready. A disconnected seat has 30 seconds to reconnect. The simulation continues with zero input while disconnected. One overdue seat loses by room-level forfeit; two overdue seats abandon the room without a winner. Leaving during live play forfeits immediately. A creator whose opponent never joined cannot award a fictional opponent a victory. Waiting rooms expire after 120 seconds. Empty terminal rooms are reclaimed.

A forfeit freezes the last simulation state and sets a separate RoomOutcome; it never fabricates a collision or ShotResult. A pre-start forfeit allocates an unadvanced empty match context so both seats can subsequently request a rematch. An already-established hit/draw takes precedence over leave or deadline forfeits. Within a cycle, simulation is committed before deadlines are checked. Ended, abandoned and error room statuses stop presentation of any remaining live flight.

## Exact wire messages

All frames are UTF-8 JSON objects with `v: 2` and `type`. Client frames are limited to 1024 bytes. Exact schemas reject extra fields, unsupported versions, invalid masks, non-finite values, unsafe sequences, unknown types and binary frames. The server binds identity to socket room/seat/generation. There is no client playerId or turnId.

| Client type | Fields after v/type | Context |
| --- | --- | --- |
| create | requestId | Unbound socket |
| join | requestId, code | Unbound socket; vacant waiting room |
| resume | requestId, token | Unbound socket; valid existing seat |
| compatible | seq, rulesVersion, mapId, mapVersion | Current welcomed generation |
| ready | seq | Waiting compatible seat |
| fire | seq, matchId | Own ready gun in playing match |
| input | seq, matchId, shotId, mask | Own current live missile; mask integer 0..15 |
| rematch | seq, matchId | Ended room, both connected and compatible |
| leave | seq | Bound compatible seat |
| ping | seq, clientTimeMs | Diagnostic only |

Sequences increase per connection generation starting at 1. Replayed or older sequences are rejected and do not refresh input. Stale match/shot requests are rejected rather than rebound. Fire is queued for the next tick; a second queued fire for that seat is rejected. Input is coalesced to the newest valid mask. Clients send changes plus a 30 Hz heartbeat during flight. The mask expires after twelve simulation ticks (100 ms) without a fresh valid input. Phase/shot changes, disconnect, replacement and new matches clear controls. Opening a menu, blur or hidden tab sends zero; the online match does not pause.

Limits are 60 input messages and five gameplay actions per second per socket, with a separate five-per-second room-request limit. Repeated invalid/rate-limited messages close the connection and invoke normal disconnect grace. Socket count, room count, frame payload and outbound backpressure are bounded. This local prototype does not claim hardened public-service abuse protection.

| Server type | Content |
| --- | --- |
| welcome | requestId, roomId, code, seat, token, generation, rulesVersion, exact WorldGeometry |
| snapshot | room: complete RoomSnapshot |
| ack | seq, accepted, optional stable rejection code |
| error | stable code, safe human-readable message |
| pong | clientTimeMs, serverTimeMs |

RoomSnapshot carries roomId/code, revision, eventId, monotonic serverTimeMs, status (`waiting`, `playing`, `ended`, `abandoned`, `error`), both seat connection/compatibility/Ready/rematch flags and deadlines, public simultaneous state or null, RoomOutcome or null, lastProcessedSeq, and **only the receiving seat's** complete explored cells and latest 32 shot results. Public state contains both projectile slots and excludes both private maps/histories. Full snapshots restore knowledge even after skipped renders or reconnect; clients never infer exploration from low-rate interpolated segments. No separate event stream is required: eventId marks transitions, while matchId/shotId deduplicate cosmetic impacts from complete result history.

RoomOutcome is a hit, a simultaneous-hit draw, or a forfeit (`disconnect`, `leave`, `ready_deadline`). Pure simulation outcomes exclude forfeits. Stable rejection examples include BAD_MESSAGE, TOO_LARGE, DUPLICATE, DUPLICATE_ACTION, STALE_CONTEXT, WRONG_PHASE, INCOMPATIBLE, RATE_LIMIT, NOT_BOUND, NOT_CONNECTED, ROOM_FULL, ROOM_NOT_FOUND, INVALID_TOKEN and EXPIRED_TOKEN.

```json
{"v":2,"type":"input","seq":87,"matchId":"m_7","shotId":3,"mask":9}
```

Mask 9 requests forward thrust and right yaw. It supplies no movement result. Source contracts in `src/shared/realtime.ts` and exact input parsing in `src/network/protocol.ts` are executable counterparts to this document.

## Presentation, operation and limits

Each client always has its own seat's stationary camera, follows only its own missile, sees its own map/splashes, and can see physically visible opponent missiles through the normal occluded 3D scene. The HUD indicates opponent gun/flight state. Escape suspends local controls and explicitly says the duel continues. Reload resumes the current room while it exists; both maps reset only on a new match. Offline reload still starts a fresh local match.

`npm run dev:online` starts Vite on 127.0.0.1:5173 and the room server on 127.0.0.1:8787. Open `/?online=1` in two independent browser contexts, create/join by code, and choose Ready in both. Vite and preview proxy `/duel` to the server. The browser uses native WebSocket and selects wss on an HTTPS page. The server uses ws 8.22.0. Server CLI supports HOST/PORT; default loopback is deliberate. Remote internet play still requires a reachable host, HTTPS/WSS reverse proxy and operational deployment; none is provisioned here. Rooms are in memory and disappear on server restart.

The full static fixture and public snapshots expose target coordinates to an inspecting client. Per-seat maps are a normal UI/privacy boundary, not protection against map-reading cheats. There is no persisted server replay recorder; deterministic headless input replays validate shared dynamics. Prediction, deployment, accounts, durable rooms, audio and further modes remain subsequent scope.

Acceptance is tracked in TEST_PLAN.md and TASKS.md, including real two-context play, latency, malformed messages, input expiry, reconnect generations, deadlines, simultaneous collision rules and two-party map reset.
