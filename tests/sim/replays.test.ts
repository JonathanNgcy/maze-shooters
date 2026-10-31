import { describe, expect, it } from 'vitest';
import { buildWorld } from '../../src/maze/build';
import { FLIGHT_TICKS, MAP_ID, MAP_VERSION, RULES_VERSION } from '../../src/shared/config';
import { otherPlayer, validMask } from '../../src/shared/math';
import type { Replay } from '../../src/shared/types';
import { applyCommand, createMatch, stepMatch } from '../../src/sim';
import p1Replay from '../replays/p1-win.json';
import p2Replay from '../replays/p2-win.json';

const world = buildWorld();
const replays: Replay[] = [p1Replay as Replay, p2Replay as Replay];

function play(replay: Replay) {
  let state = createMatch(world, { matchId: 'recorded-replay', matchNumber: 1, opener: replay.shooter });
  for (const type of ['ready', 'fire'] as const) {
    const accepted = applyCommand(state, world, { type, matchId: state.matchId, turnId: state.turnId, playerId: replay.shooter });
    expect(accepted.accepted).toBe(true);
    state = accepted.state;
  }
  expect(state.projectile?.ageTicks).toBe(0);
  let ticks = 0;
  // The fixture and the same authoritative collision code stay enabled for every recorded tick.
  for (const run of replay.runs) for (let i = 0; i < run.ticks; i++) {
    expect(state.phase).toBe('flight');
    state = stepMatch(state, world, run.mask);
    ticks++;
  }
  return { state, ticks };
}

describe('recorded normal-control wins on maze-01', () => {
  for (const replay of replays) it(`${replay.shooter} reaches the opposing target within the canonical lifetime reproducibly`, () => {
    expect(replay.rulesVersion).toBe(RULES_VERSION);
    expect(replay.mapId).toBe(MAP_ID);
    expect(replay.mapVersion).toBe(MAP_VERSION);
    expect(['p1', 'p2']).toContain(replay.shooter);
    expect(replay.runs.length).toBeGreaterThan(0);
    for (const run of replay.runs) {
      expect(Number.isSafeInteger(run.ticks) && run.ticks > 0).toBe(true);
      expect(validMask(run.mask)).toBe(true);
      expect(Object.keys(run).sort()).toEqual(['mask', 'ticks']);
    }
    const first = play(replay), repeated = play(replay);
    expect(repeated).toEqual(first);
    expect(first.ticks).toBeLessThanOrEqual(FLIGHT_TICKS);
    expect(first.state.phase).toBe('resolve');
    expect(first.state.projectile).toBeNull();
    expect(first.state.result?.reason).toBe('hit');
    expect(first.state.result?.shooter).toBe(replay.shooter);
    expect(first.state.result?.victim).toBe(otherPlayer(replay.shooter));
    expect(first.state.winner).toBe(replay.shooter);
  });
});
