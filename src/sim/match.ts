import { FLIGHT_TICKS, RESOLVE_TICKS } from '../shared/config';
import { otherPlayer, validMask } from '../shared/math';
import type { KeyMask, MatchCommand, MatchState, PlayerId, ShotResult, WorldGeometry } from '../shared/types';
import { findCollision } from './collision';
import { integrateProjectile, launchProjectile } from './projectile';

export function createMatch(world: WorldGeometry, options: {matchId: string; matchNumber: number; opener: PlayerId}): MatchState {
  if (!options.matchId || !Number.isSafeInteger(options.matchNumber) || options.matchNumber < 1) throw new Error('Invalid match identity');
  if (!world.spawns.some(p => p.id === options.opener)) throw new Error('Missing opener spawn');
  return { ...options, tick: 0, phase: 'handoff', activePlayer: options.opener, turnId: 1, nextShotId: 1, projectile: null, result: null, resolveTicksRemaining: 0, winner: null };
}

/** Accepting an intent never consumes simulation time. The local authority owns command batching. */
export function applyCommand(state: MatchState, world: WorldGeometry, command: MatchCommand): {state: MatchState; accepted: boolean} {
  const reject = { state, accepted: false };
  if (command.matchId !== state.matchId || command.turnId !== state.turnId || command.playerId !== state.activePlayer) return reject;
  if (command.type === 'ready' && state.phase === 'handoff') return { state: { ...state, phase: 'ready' }, accepted: true };
  if (command.type === 'fire' && state.phase === 'ready') {
    const spawn = world.spawns.find(p => p.id === state.activePlayer);
    if (!spawn) throw new Error('Missing active spawn');
    return { state: { ...state, phase: 'flight', nextShotId: state.nextShotId + 1, projectile: launchProjectile(spawn, state.nextShotId) }, accepted: true };
  }
  return reject;
}

function resolve(state: MatchState, result: ShotResult): MatchState {
  return { ...state, phase: 'resolve', projectile: null, result, resolveTicksRemaining: RESOLVE_TICKS, winner: result.victim ? otherPlayer(result.victim) : null };
}

export function stepMatch(state: MatchState, world: WorldGeometry, controls: KeyMask): MatchState {
  if (!validMask(controls)) throw new Error('Invalid control mask: expected integer 0..15');
  if (state.phase === 'gameOver') return state;
  const next: MatchState = { ...state, tick: state.tick + 1 };
  if (state.phase === 'resolve') {
    const remaining = state.resolveTicksRemaining - 1;
    if (remaining > 0) return { ...next, resolveTicksRemaining: remaining };
    if (state.winner) return { ...next, phase: 'gameOver', resolveTicksRemaining: 0 };
    return { ...next, phase: 'handoff', activePlayer: otherPlayer(state.activePlayer), turnId: state.turnId + 1, result: null, resolveTicksRemaining: 0 };
  }
  if (state.phase !== 'flight') return next;
  const old = state.projectile;
  if (!old || old.ageTicks >= FLIGHT_TICKS) throw new Error('Invalid live flight state');
  const p = integrateProjectile(old, controls);
  const collision = findCollision(old.position, p.position, world);
  if (collision) {
    const endpoint = { x: old.position.x + (p.position.x - old.position.x) * collision.time, z: old.position.z + (p.position.z - old.position.z) * collision.time };
    return resolve(next, { reason: collision.reason, shotId: old.shotId, shooter: old.owner, endpoint, victim: collision.victim, colliderId: collision.colliderId });
  }
  if (p.ageTicks === FLIGHT_TICKS) return resolve(next, { reason: 'timeout', shotId: p.shotId, shooter: p.owner, endpoint: p.position, victim: null, colliderId: null });
  return { ...next, projectile: p };
}

export function createRematch(previous: MatchState, world: WorldGeometry, newMatchId: string): MatchState {
  if (previous.phase !== 'gameOver') throw new Error('Rematch requires gameOver');
  if (newMatchId === previous.matchId) throw new Error('Rematch requires a new match ID');
  return createMatch(world, { matchId: newMatchId, matchNumber: previous.matchNumber + 1, opener: otherPlayer(previous.opener) });
}
