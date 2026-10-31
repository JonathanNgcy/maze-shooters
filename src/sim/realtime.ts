import { FLIGHT_TICKS, RESOLVE_TICKS, TOI_EPS } from '../shared/config';
import { crossedGridCells, openGridCells } from '../shared/exploration-grid';
import { otherPlayer, validMask } from '../shared/math';
import { PLAYERS, SHOT_HISTORY_LIMIT } from '../shared/realtime';
import type { DuelOutcome, RealtimeControls, RealtimeFire, RealtimeMatchState, RealtimeShot } from '../shared/realtime';
import type { Collision, PlayerId, ProjectileState, ShotResult, Vec2, WorldGeometry } from '../shared/types';
import { findCollision } from './collision';
import { integrateProjectile, launchProjectile } from './projectile';

const readyShot = (): RealtimeShot => ({ phase: 'ready', projectile: null, result: null, resolveTicksRemaining: 0 });
const pointAt = (start: Vec2, end: Vec2, time: number): Vec2 => ({ x: start.x + (end.x - start.x) * time, z: start.z + (end.z - start.z) * time });
const addHistory = (history: readonly ShotResult[], result: ShotResult): readonly ShotResult[] => [...history, result].slice(-SHOT_HISTORY_LIMIT);

type Segment = Readonly<{ owner: PlayerId; start: Vec2; next: ProjectileState; collision: Collision | null }>;

export function createRealtimeMatch(world: WorldGeometry, options: { matchId: string; matchNumber: number }): RealtimeMatchState {
  if (!options.matchId || !Number.isSafeInteger(options.matchNumber) || options.matchNumber < 1) throw new Error('Invalid realtime match identity');
  if (PLAYERS.some(id => world.spawns.filter(spawn => spawn.id === id).length !== 1)) throw new Error('Realtime match requires exactly one spawn per seat');
  return {
    ...options, tick: 0, phase: 'playing', nextShotId: 1,
    shots: { p1: readyShot(), p2: readyShot() }, outcome: null, resolveTicksRemaining: 0,
    explored: { p1: [], p2: [] }, history: { p1: [], p2: [] },
  };
}

/**
 * One authoritative simultaneous tick. A launch consumes only its seat's dynamics step.
 * Global resolve/gameOver freezes both seats as resolve/null-projectile; a seat whose
 * flight was interrupted may have a null result. Its history records no fabricated hit.
 */
export function stepRealtime(state: RealtimeMatchState, world: WorldGeometry, commands: readonly RealtimeFire[], controls: RealtimeControls): RealtimeMatchState {
  if (!validMask(controls.p1) || !validMask(controls.p2)) throw new Error('Invalid realtime control mask: expected integers 0..15');
  if (state.phase === 'gameOver') return state;
  if (state.phase === 'resolve') {
    const remaining = state.resolveTicksRemaining - 1;
    if (remaining < 0 || !state.outcome) throw new Error('Invalid global resolve state');
    return {
      ...state, tick: state.tick + 1, phase: remaining === 0 ? 'gameOver' : 'resolve', resolveTicksRemaining: remaining,
      shots: {
        p1: { ...state.shots.p1, resolveTicksRemaining: remaining },
        p2: { ...state.shots.p2, resolveTicksRemaining: remaining },
      },
    };
  }

  const shots: Record<PlayerId, RealtimeShot> = { ...state.shots };
  const history: Record<PlayerId, readonly ShotResult[]> = { ...state.history };
  const explored: Record<PlayerId, readonly number[]> = { ...state.explored };
  // Open cells derive only from physical geometry, never from an observer's render state.
  const open = openGridCells(world);
  const discover = (owner: PlayerId, start: Vec2, end: Vec2): void => {
    const cells = new Set(explored[owner]);
    for (const cell of crossedGridCells(start, end)) if (open.has(cell)) cells.add(cell);
    explored[owner] = [...cells].sort((a, b) => a - b);
  };
  const launched = new Set<PlayerId>();
  let nextShotId = state.nextShotId;
  for (const command of commands) {
    if (command.type !== 'fire' || command.matchId !== state.matchId || !PLAYERS.includes(command.playerId)) continue;
    const seat = command.playerId;
    if (launched.has(seat) || state.shots[seat].phase !== 'ready') continue;
    const spawn = world.spawns.find(player => player.id === seat);
    if (!spawn) throw new Error('Missing realtime spawn');
    const projectile = launchProjectile(spawn, nextShotId++);
    shots[seat] = { phase: 'flight', projectile, result: null, resolveTicksRemaining: 0 };
    launched.add(seat);
    discover(seat, projectile.position, projectile.position);
  }

  const segments: Segment[] = [];
  for (const seat of PLAYERS) {
    if (launched.has(seat)) continue;
    const shot = state.shots[seat];
    if (shot.phase === 'resolve') {
      if (shot.resolveTicksRemaining < 1) throw new Error('Invalid seat resolve state');
      shots[seat] = shot.resolveTicksRemaining === 1 ? readyShot() : { ...shot, resolveTicksRemaining: shot.resolveTicksRemaining - 1 };
      continue;
    }
    if (shot.phase !== 'flight') continue;
    const old = shot.projectile;
    if (!old || old.owner !== seat || old.ageTicks >= FLIGHT_TICKS) throw new Error('Invalid realtime live flight state');
    const next = integrateProjectile(old, controls[seat]);
    segments.push({ owner: seat, start: old.position, next, collision: findCollision(old.position, next.position, world) });
  }

  const fatal = segments.filter(segment => segment.collision?.reason === 'hit');
  const terminalTime = fatal.length ? Math.min(...fatal.map(segment => segment.collision!.time)) : 1;
  const decisive = fatal.filter(segment => segment.collision!.time <= terminalTime + TOI_EPS);
  let outcome: DuelOutcome | null = null;
  if (decisive.length) {
    const victims = new Set(decisive.map(segment => segment.collision!.victim!));
    if (victims.size > 1) outcome = { cause: 'draw', winner: null, loser: null, detail: 'simultaneous_hits' };
    else {
      const loser = decisive[0].collision!.victim!;
      outcome = { cause: 'hit', winner: otherPlayer(loser), loser, detail: decisive.some(segment => segment.owner === loser) ? 'self_hit' : 'hit' };
    }
  }

  for (const segment of segments) {
    const { owner, start, next, collision } = segment;
    // A tied fatal contact is competitive evidence, but never reveals travel past the
    // earliest fatal instant. A later wall/timeout is not an event in the ended match.
    const contactOccurs = collision !== null && (collision.time <= terminalTime || (collision.reason === 'hit' && collision.time <= terminalTime + TOI_EPS));
    const travelTime = Math.min(terminalTime, collision?.time ?? 1);
    const endpoint = pointAt(start, next.position, travelTime);
    discover(owner, start, endpoint);
    let result: ShotResult | null = null;
    if (contactOccurs && collision) {
      result = { reason: collision.reason, shotId: next.shotId, shooter: owner, endpoint, victim: collision.victim, colliderId: collision.colliderId };
    } else if (terminalTime === 1 && next.ageTicks === FLIGHT_TICKS) {
      result = { reason: 'timeout', shotId: next.shotId, shooter: owner, endpoint, victim: null, colliderId: null };
    }
    if (result) {
      shots[owner] = { phase: 'resolve', projectile: null, result, resolveTicksRemaining: RESOLVE_TICKS };
      history[owner] = addHistory(history[owner], result);
    } else shots[owner] = { phase: 'flight', projectile: next, result: null, resolveTicksRemaining: 0 };
  }

  if (outcome) {
    for (const seat of PLAYERS) shots[seat] = { ...shots[seat], phase: 'resolve', projectile: null, resolveTicksRemaining: RESOLVE_TICKS };
  }
  return {
    ...state, tick: state.tick + 1, nextShotId, shots, explored, history,
    phase: outcome ? 'resolve' : 'playing', outcome, resolveTicksRemaining: outcome ? RESOLVE_TICKS : 0,
  };
}
