import { createHash, randomBytes } from 'node:crypto';
import { buildWorld } from '../src/maze/build';
import { createRealtimeMatch, stepRealtime } from '../src/sim/realtime';
import { otherPlayer } from '../src/shared/math';
import {
  DISCONNECT_GRACE_MS, INPUT_EXPIRY_TICKS, PLAYERS, READY_DEADLINE_MS,
  REALTIME_RULES_VERSION, SNAPSHOT_INTERVAL_TICKS, WAITING_ROOM_EXPIRY_MS,
} from '../src/shared/realtime';
import type { ClientMessage, RealtimeFire, RealtimeMatchState, RealtimeSeatStatus, RoomOutcome, RoomSnapshot, ServerMessage } from '../src/shared/realtime';
import type { KeyMask, PlayerId, WorldGeometry } from '../src/shared/types';
import { parseClientMessage, ProtocolError } from '../src/network/protocol';

export interface AuthorityPeer { id: string; send(message: ServerMessage): void; close(code?: number, reason?: string): void }
type Binding = { roomId: string; seat: PlayerId; generation: number };
type Connection = { peer: AuthorityPeer; binding: Binding | null; joins: number[]; actions: number[]; inputs: number[]; strikes: number };
type Seat = {
  connectionId: string | null; generation: number; tokenDigest: string | null; lastSeq: number;
  compatible: boolean; ready: boolean; rematch: boolean; readyDeadlineMs: number | null; disconnectDeadlineMs: number | null;
  mask: KeyMask; inputShotId: number | null; inputExpiresAtTick: number;
};
type Room = {
  id: string; code: string; createdAt: number; revision: number; eventId: number;
  status: RoomSnapshot['status']; seats: Record<PlayerId, Seat>; state: RealtimeMatchState | null;
  outcome: RoomOutcome | null; matchNumber: number; commands: Map<PlayerId, RealtimeFire>;
};
export type DuelAuthorityOptions = { world?: WorldGeometry; now?: () => number; maxRooms?: number; maxConnections?: number };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const newSeat = (): Seat => ({ connectionId: null, generation: 0, tokenDigest: null, lastSeq: 0, compatible: false, ready: false, rematch: false, readyDeadlineMs: null, disconnectDeadlineMs: null, mask: 0, inputShotId: null, inputExpiresAtTick: 0 });
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createDuelAuthority(options: DuelAuthorityOptions = {}) {
  const world = options.world ?? buildWorld();
  const now = options.now ?? (() => performance.now());
  const connections = new Map<string, Connection>();
  const rooms = new Map<string, Room>();
  const codes = new Map<string, string>();
  const tokens = new Map<string, {roomId: string; seat: PlayerId}>();
  const send = (connection: Connection, message: ServerMessage) => { try { connection.peer.send(message); } catch { /* Transport close will clear held controls. */ } };
  const error = (connection: Connection, code: string, message: string) => send(connection, { v: 2, type: 'error', code, message });
  const ack = (connection: Connection, seq: number, accepted: boolean, code?: string) => send(connection, { v: 2, type: 'ack', seq, accepted, ...(code ? {code} : {}) });
  const clearInput = (seat: Seat) => { seat.mask = 0; seat.inputShotId = null; seat.inputExpiresAtTick = 0; };
  const seatStatus = (seat: Seat): RealtimeSeatStatus => ({ connected: seat.connectionId !== null, compatible: seat.compatible, ready: seat.ready, rematch: seat.rematch, readyDeadlineMs: seat.readyDeadlineMs, disconnectDeadlineMs: seat.disconnectDeadlineMs });
  function snapshot(room: Room, seatId: PlayerId): RoomSnapshot {
    const state = room.state;
    const publicState = state ? (({ explored: _explored, history: _history, ...publicFields }) => publicFields)(state) : null;
    return {
      roomId: room.id, code: room.code, revision: room.revision, eventId: room.eventId, serverTimeMs: now(), status: room.status,
      seats: {p1: seatStatus(room.seats.p1), p2: seatStatus(room.seats.p2)}, state: publicState, outcome: room.outcome,
      explored: state?.explored[seatId] ?? [], history: state?.history[seatId] ?? [], lastProcessedSeq: room.seats[seatId].lastSeq,
    };
  }
  function publish(room: Room) {
    for (const seatId of PLAYERS) {
      const connectionId = room.seats[seatId].connectionId;
      const connection = connectionId ? connections.get(connectionId) : undefined;
      if (connection) send(connection, {v: 2, type: 'snapshot', room: snapshot(room, seatId)});
    }
  }
  function changed(room: Room) { room.revision++; room.eventId++; publish(room); }
  function end(room: Room, status: RoomSnapshot['status'], outcome: RoomOutcome | null) {
    // A pre-start forfeit still needs a match identity for both-seat rematch intents.
    // Simulation never invents a collision or winner for this room-level result.
    if (!room.state && outcome?.cause === 'forfeit') {
      room.matchNumber++;
      room.state = createRealtimeMatch(world, {matchId: `m_${randomBytes(12).toString('hex')}`, matchNumber: room.matchNumber});
    }
    room.status = status; room.outcome = outcome; room.commands.clear();
    for (const seat of Object.values(room.seats)) { clearInput(seat); seat.readyDeadlineMs = null; }
    changed(room);
  }
  function deleteRoom(room: Room) {
    rooms.delete(room.id); codes.delete(room.code);
    for (const seat of Object.values(room.seats)) if (seat.tokenDigest) tokens.delete(seat.tokenDigest);
    for (const connection of connections.values()) if (connection.binding?.roomId === room.id) connection.binding = null;
  }
  function start(room: Room) {
    room.matchNumber++;
    room.state = createRealtimeMatch(world, { matchId: `m_${randomBytes(12).toString('hex')}`, matchNumber: room.matchNumber });
    room.status = 'playing'; room.outcome = null; room.commands.clear();
    for (const seat of Object.values(room.seats)) { clearInput(seat); seat.ready = true; seat.rematch = false; seat.readyDeadlineMs = null; }
    changed(room);
  }
  function maybeStart(room: Room) {
    if (room.status === 'waiting' && PLAYERS.every(id => room.seats[id].connectionId && room.seats[id].compatible && room.seats[id].ready)) start(room);
  }
  function updateReadyDeadlines(room: Room) {
    if (room.status !== 'waiting' || !PLAYERS.every(id => room.seats[id].connectionId && room.seats[id].compatible)) return;
    for (const seat of Object.values(room.seats)) if (!seat.ready && seat.readyDeadlineMs === null) seat.readyDeadlineMs = now() + READY_DEADLINE_MS;
  }
  function bind(connection: Connection, room: Room, seatId: PlayerId, requestId: string) {
    const seat = room.seats[seatId];
    const oldConnection = seat.connectionId ? connections.get(seat.connectionId) : undefined;
    if (seat.tokenDigest) tokens.delete(seat.tokenDigest);
    const token = randomBytes(24).toString('base64url');
    seat.tokenDigest = digest(token); tokens.set(seat.tokenDigest, {roomId: room.id, seat: seatId});
    seat.generation++; seat.connectionId = connection.peer.id; seat.lastSeq = 0;
    seat.compatible = false; seat.rematch = false; seat.disconnectDeadlineMs = null; clearInput(seat); room.commands.delete(seatId);
    connection.binding = {roomId: room.id, seat: seatId, generation: seat.generation};
    if (oldConnection && oldConnection !== connection) oldConnection.peer.close(1000, 'Seat resumed on a new connection.');
    send(connection, {v: 2, type: 'welcome', requestId, roomId: room.id, code: room.code, seat: seatId, token, generation: seat.generation, rulesVersion: REALTIME_RULES_VERSION, world});
    changed(room);
  }
  function consume(times: number[], limit: number): boolean {
    const cutoff = now() - 1000;
    while (times.length && times[0] <= cutoff) times.shift();
    if (times.length >= limit) return false;
    times.push(now()); return true;
  }
  function strike(connection: Connection) {
    if (++connection.strikes >= 3) { connection.peer.close(1008, 'Invalid or excessive messages.'); disconnect(connection.peer.id); }
  }
  function bound(connection: Connection): {room: Room; seat: Seat; seatId: PlayerId} | null {
    const binding = connection.binding;
    if (!binding) return null;
    const room = rooms.get(binding.roomId), seat = room?.seats[binding.seat];
    if (!room || !seat || seat.connectionId !== connection.peer.id || seat.generation !== binding.generation) return null;
    return {room, seat, seatId: binding.seat};
  }
  function receive(id: string, raw: string, binary = false): void {
    const connection = connections.get(id); if (!connection) return;
    let message: ClientMessage;
    try { if (binary) throw new ProtocolError('BAD_MESSAGE'); message = parseClientMessage(raw); }
    catch (problem) { error(connection, problem instanceof ProtocolError ? problem.code : 'BAD_MESSAGE', 'Invalid client intent.'); strike(connection); return; }
    if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
      if (connection.binding) { error(connection, 'ALREADY_BOUND', 'This connection already has a seat.'); return; }
      if (!consume(connection.joins, 5)) { error(connection, 'RATE_LIMIT', 'Too many room requests.'); strike(connection); return; }
      if (message.type === 'create') {
        if (rooms.size >= (options.maxRooms ?? 128)) { error(connection, 'ROOM_LIMIT', 'No room is currently available.'); return; }
        let code: string;
        do { code = [...randomBytes(6)].map(byte => codeAlphabet[byte & 31]).join(''); } while (codes.has(code));
        const room: Room = { id: `r_${randomBytes(12).toString('hex')}`, code, createdAt: now(), revision: 0, eventId: 0, status: 'waiting', seats: {p1: newSeat(), p2: newSeat()}, state: null, outcome: null, matchNumber: 0, commands: new Map() };
        rooms.set(room.id, room); codes.set(code, room.id); bind(connection, room, 'p1', message.requestId);
      } else if (message.type === 'join') {
        const roomId = codes.get(message.code), room = roomId ? rooms.get(roomId) : undefined;
        if (!room) { error(connection, 'ROOM_NOT_FOUND', 'That waiting room is unavailable.'); return; }
        if (room.seats.p2.tokenDigest) { error(connection, 'ROOM_FULL', 'That room already has two players.'); return; }
        if (room.status !== 'waiting') { error(connection, 'ROOM_NOT_FOUND', 'That waiting room is unavailable.'); return; }
        bind(connection, room, 'p2', message.requestId);
      } else {
        const token = tokens.get(digest(message.token)), room = token ? rooms.get(token.roomId) : undefined;
        if (!token || !room || room.status === 'abandoned' || room.status === 'error') { error(connection, 'INVALID_TOKEN', 'That reconnect session is unavailable.'); return; }
        const seat = room.seats[token.seat];
        if (seat.disconnectDeadlineMs !== null && now() >= seat.disconnectDeadlineMs) { error(connection, 'EXPIRED_TOKEN', 'The reconnect grace period has expired.'); return; }
        bind(connection, room, token.seat, message.requestId);
      }
      return;
    }
    const context = bound(connection);
    if (!context) { ack(connection, message.seq, false, 'NOT_BOUND'); return; }
    const {room, seat, seatId} = context;
    if (message.seq <= seat.lastSeq) { ack(connection, message.seq, false, 'DUPLICATE'); return; }
    seat.lastSeq = message.seq;
    if (message.type === 'ping') { send(connection, {v: 2, type: 'pong', clientTimeMs: message.clientTimeMs, serverTimeMs: now()}); return; }
    if (message.type === 'compatible') {
      if (message.rulesVersion !== REALTIME_RULES_VERSION || message.mapId !== world.mapId || message.mapVersion !== world.mapVersion) { ack(connection, message.seq, false, 'INCOMPATIBLE'); return; }
      seat.compatible = true; updateReadyDeadlines(room); ack(connection, message.seq, true); changed(room); maybeStart(room); return;
    }
    if (!seat.compatible) { ack(connection, message.seq, false, 'INCOMPATIBLE'); return; }
    if (message.type === 'input') {
      if (!consume(connection.inputs, 60)) { ack(connection, message.seq, false, 'RATE_LIMIT'); strike(connection); return; }
      const p = room.state?.shots[seatId].projectile;
      if (room.status !== 'playing' || room.state?.phase !== 'playing' || !p || room.state.shots[seatId].phase !== 'flight') { ack(connection, message.seq, false, 'WRONG_PHASE'); return; }
      if (message.matchId !== room.state.matchId || message.shotId !== p.shotId) { ack(connection, message.seq, false, 'STALE_CONTEXT'); return; }
      seat.mask = message.mask; seat.inputShotId = p.shotId; seat.inputExpiresAtTick = room.state.tick + INPUT_EXPIRY_TICKS;
      ack(connection, message.seq, true); return;
    }
    if (!consume(connection.actions, 5)) { ack(connection, message.seq, false, 'RATE_LIMIT'); strike(connection); return; }
    if (message.type === 'leave') {
      ack(connection, message.seq, true);
      if (room.status === 'playing' && !room.outcome) end(room, 'ended', {cause: 'forfeit', winner: otherPlayer(seatId), loser: seatId, detail: 'leave'});
      else if (room.status === 'waiting') end(room, 'abandoned', null);
      connection.peer.close(1000, 'Left the room.'); disconnect(id); return;
    }
    if (message.type === 'ready') {
      if (room.status !== 'waiting') { ack(connection, message.seq, false, 'WRONG_PHASE'); return; }
      if (seat.readyDeadlineMs !== null && now() >= seat.readyDeadlineMs) { checkDeadlines(); ack(connection, message.seq, false, 'READY_DEADLINE'); return; }
      seat.ready = true; seat.readyDeadlineMs = null; ack(connection, message.seq, true); changed(room); maybeStart(room); return;
    }
    if (message.type === 'fire') {
      if (room.status !== 'playing' || !room.state || room.state.phase !== 'playing' || room.state.shots[seatId].phase !== 'ready') { ack(connection, message.seq, false, 'WRONG_PHASE'); return; }
      if (message.matchId !== room.state.matchId) { ack(connection, message.seq, false, 'STALE_CONTEXT'); return; }
      if (room.commands.has(seatId)) { ack(connection, message.seq, false, 'DUPLICATE_ACTION'); return; }
      room.commands.set(seatId, {type: 'fire', matchId: room.state.matchId, playerId: seatId}); ack(connection, message.seq, true); return;
    }
    if (message.type === 'rematch') {
      if (room.status !== 'ended' || !room.state || message.matchId !== room.state.matchId) { ack(connection, message.seq, false, 'STALE_CONTEXT'); return; }
      if (!PLAYERS.every(player => room.seats[player].connectionId && room.seats[player].compatible)) { ack(connection, message.seq, false, 'NOT_CONNECTED'); return; }
      seat.rematch = true; ack(connection, message.seq, true); changed(room);
      if (PLAYERS.every(player => room.seats[player].rematch)) start(room);
    }
  }
  function disconnect(id: string): void {
    const connection = connections.get(id); if (!connection) return;
    const context = bound(connection); connections.delete(id);
    if (!context) return;
    const {room, seat, seatId} = context;
    seat.connectionId = null; seat.rematch = false; seat.disconnectDeadlineMs = now() + DISCONNECT_GRACE_MS; clearInput(seat); room.commands.delete(seatId); changed(room);
  }
  function checkDeadlines(): void {
    const time = now();
    for (const room of [...rooms.values()]) {
      if (room.status === 'waiting' && time - room.createdAt >= WAITING_ROOM_EXPIRY_MS) { end(room, 'abandoned', null); deleteRoom(room); continue; }
      if (room.status === 'abandoned' || room.status === 'error') {
        if (PLAYERS.every(id => room.seats[id].connectionId === null) && PLAYERS.every(id => room.seats[id].disconnectDeadlineMs === null || time >= room.seats[id].disconnectDeadlineMs!)) deleteRoom(room);
        continue;
      }
      if (room.outcome) {
        if (room.status === 'ended' && PLAYERS.every(id => room.seats[id].connectionId === null && room.seats[id].disconnectDeadlineMs !== null && time >= room.seats[id].disconnectDeadlineMs!)) deleteRoom(room);
        continue;
      }
      const disconnected = PLAYERS.filter(id => room.seats[id].disconnectDeadlineMs !== null && time >= room.seats[id].disconnectDeadlineMs!);
      if (disconnected.length === 2) { end(room, 'abandoned', null); deleteRoom(room); continue; }
      if (disconnected.length === 1) {
        const loser = disconnected[0];
        if (!room.seats[otherPlayer(loser)].tokenDigest) { end(room, 'abandoned', null); deleteRoom(room); }
        else end(room, 'ended', {cause: 'forfeit', winner: otherPlayer(loser), loser, detail: 'disconnect'});
        continue;
      }
      if (room.status === 'waiting') {
        const overdue = PLAYERS.filter(id => !room.seats[id].ready && room.seats[id].readyDeadlineMs !== null && time >= room.seats[id].readyDeadlineMs!);
        if (overdue.length === 2) end(room, 'abandoned', null);
        else if (overdue.length === 1) { const loser = overdue[0]; end(room, 'ended', {cause: 'forfeit', winner: otherPlayer(loser), loser, detail: 'ready_deadline'}); }
      }
    }
  }
  function step(ticks = 1): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 10_000) throw new Error('Invalid authority tick count');
    for (let tick = 0; tick < ticks; tick++) {
      for (const room of rooms.values()) {
        if (room.status !== 'playing' || !room.state) continue;
        const old = room.state;
        const controls = {p1: 0, p2: 0};
        for (const id of PLAYERS) {
          const seat = room.seats[id], p = old.shots[id].projectile;
          if (p && seat.inputShotId === p.shotId && old.tick < seat.inputExpiresAtTick && seat.connectionId) controls[id] = seat.mask;
          else clearInput(seat);
        }
        room.state = stepRealtime(old, world, [...room.commands.values()], controls); room.commands.clear(); room.revision++;
        const transition = old.phase !== room.state.phase || PLAYERS.some(id => old.shots[id].phase !== room.state!.shots[id].phase || old.shots[id].projectile?.shotId !== room.state!.shots[id].projectile?.shotId);
        for (const id of PLAYERS) if (old.phase !== room.state.phase || old.shots[id].phase !== room.state.shots[id].phase || old.shots[id].projectile?.shotId !== room.state.shots[id].projectile?.shotId) clearInput(room.seats[id]);
        if (room.state.outcome) room.outcome = room.state.outcome;
        if (room.state.phase === 'gameOver') { room.status = 'ended'; for (const seat of Object.values(room.seats)) clearInput(seat); }
        if (transition) room.eventId++;
        if (transition || room.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) publish(room);
      }
      // A hit determined on this tick is committed before any deadline can forfeit the room.
      checkDeadlines();
    }
  }
  function connect(peer: AuthorityPeer): boolean {
    if (connections.has(peer.id) || connections.size >= (options.maxConnections ?? 256)) { peer.close(1013, 'Server connection limit reached.'); return false; }
    connections.set(peer.id, {peer, binding: null, joins: [], actions: [], inputs: [], strikes: 0}); return true;
  }
  function failOverload(): void {
    for (const room of rooms.values()) if (room.status === 'playing') end(room, 'error', room.outcome);
  }
  return { world, connect, receive, disconnect, step, checkDeadlines, failOverload,
    get roomCount() {return rooms.size;}, get connectionCount() {return connections.size;} };
}
export type DuelAuthority = ReturnType<typeof createDuelAuthority>;
