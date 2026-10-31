import { describe, expect, it } from 'vitest';
import { FLIGHT_TICKS, MAP_VERSION, PLAYER_RADIUS, PROJECTILE_RADIUS, RESOLVE_TICKS, RULES_VERSION, TOI_EPS } from '../../src/shared/config';
import { crossedGridCells } from '../../src/shared/exploration-grid';
import { REALTIME_RULES_VERSION, SHOT_HISTORY_LIMIT } from '../../src/shared/realtime';
import type { RealtimeFire, RealtimeMatchState, RealtimeShot } from '../../src/shared/realtime';
import type { PlayerId, ProjectileState, Vec2, WorldGeometry } from '../../src/shared/types';
import { createMatch, createRealtimeMatch, integrateProjectile, stepRealtime } from '../../src/sim';

const controls = { p1: 0, p2: 0 };
const arena: WorldGeometry = {
  mapId: 'test', mapVersion: MAP_VERSION, walls: [],
  spawns: [
    { id: 'p1', position: { x: -7.5, z: -7.5 }, heading: Math.PI / 2 },
    { id: 'p2', position: { x: 7.5, z: 7.5 }, heading: -Math.PI / 2 },
  ],
};
const initial = (world = arena) => createRealtimeMatch(world, { matchId: 'simultaneous', matchNumber: 1 });
const fire = (playerId: PlayerId): RealtimeFire => ({ type: 'fire', matchId: 'simultaneous', playerId });
const tick = (state: RealtimeMatchState, world = arena) => stepRealtime(state, world, [], controls);
const shot = (owner: PlayerId, position: Vec2, velocity: Vec2, ageTicks = 0, shotId = owner === 'p1' ? 1 : 2): RealtimeShot => ({
  phase: 'flight', projectile: { owner, position, velocity, heading: owner === 'p1' ? Math.PI / 2 : -Math.PI / 2, angularVelocity: 0, ageTicks, shotId }, result: null, resolveTicksRemaining: 0,
});
const withShots = (p1: RealtimeShot, p2: RealtimeShot, world = arena): RealtimeMatchState => ({ ...initial(world), nextShotId: 3, shots: { p1, p2 } });
const duelWorld: WorldGeometry = { ...arena, spawns: [
  { ...arena.spawns[0], position: { x: -2, z: 0 } },
  { ...arena.spawns[1], position: { x: 2, z: 0 } },
] };
const hitRadius = PLAYER_RADIUS + PROJECTILE_RADIUS;
function opposedShots(gap1 = 0.02, gap2 = 0.02): RealtimeMatchState {
  return withShots(shot('p1', { x: 2 - hitRadius - gap1, z: 0 }, { x: 5, z: 0 }), shot('p2', { x: -2 + hitRadius + gap2, z: 0 }, { x: -5, z: 0 }), duelWorld);
}

describe('simultaneous authority tick', () => {
  it('launches both seats at age zero, rejects duplicates/stale intent, and advances one tick', () => {
    const s = stepRealtime(initial(), arena, [fire('p1'), fire('p1'), { ...fire('p2'), matchId: 'stale' }, fire('p2')], { p1: 9, p2: 6 });
    expect(s.tick).toBe(1); expect(s.nextShotId).toBe(3);
    expect(s.shots.p1.projectile).toMatchObject({ owner: 'p1', shotId: 1, ageTicks: 0, angularVelocity: 0, position: { x: -6.85, z: -7.5 } });
    expect(s.shots.p2.projectile).toMatchObject({ owner: 'p2', shotId: 2, ageTicks: 0, angularVelocity: 0, position: { x: 6.85, z: 7.5 } });
    const second = stepRealtime(s, arena, [fire('p1'), fire('p2')], controls);
    expect(second.nextShotId).toBe(3); expect(second.shots.p1.projectile?.ageTicks).toBe(1); expect(second.shots.p2.projectile?.ageTicks).toBe(1);
  });
  it('launching the second seat never suppresses the first live missile step', () => {
    const first = stepRealtime(initial(), arena, [fire('p1')], controls);
    const second = stepRealtime(first, arena, [fire('p2')], { p1: 1, p2: 9 });
    expect(second.shots.p1.projectile?.ageTicks).toBe(1); expect(second.shots.p1.projectile!.velocity.x).toBeGreaterThan(5);
    expect(second.shots.p2.projectile?.ageTicks).toBe(0); expect(second.shots.p2.projectile?.angularVelocity).toBe(0);
  });
  it('samples independent controls without rotating old linear velocity', () => {
    const launched = stepRealtime(initial(), arena, [fire('p1'), fire('p2')], controls);
    const a = stepRealtime(launched, arena, [], { p1: 8, p2: 4 });
    const b = stepRealtime(launched, arena, [], { p1: 8, p2: 9 });
    expect(a.shots.p1).toEqual(b.shots.p1);
    expect(a.shots.p1.projectile!.heading).toBeGreaterThan(Math.PI / 2);
    expect(a.shots.p1.projectile!.velocity.z).toBeCloseTo(0, 12);
    expect(a.shots.p2.projectile!.velocity.x).toBeGreaterThan(-5);
    expect(a.shots.p2).not.toEqual(b.shots.p2);
  });
  it('resolves a wall miss only for its seat, then permits relaunch while the other keeps flying', () => {
    const w: WorldGeometry = { ...arena, walls: [{ id: 'wall:1:2', minX: -6.5, maxX: -6, minZ: -8, maxZ: -7 }] };
    let s = stepRealtime(initial(w), w, [fire('p1'), fire('p2')], controls);
    while (s.shots.p1.phase === 'flight') s = tick(s, w);
    expect(s.phase).toBe('playing'); expect(s.outcome).toBeNull(); expect(s.shots.p1.result?.reason).toBe('wall');
    const p2Age = s.shots.p2.projectile!.ageTicks;
    for (let i = 0; i < RESOLVE_TICKS - 1; i++) s = tick(s, w);
    expect(s.shots.p1.phase).toBe('resolve'); expect(s.shots.p1.resolveTicksRemaining).toBe(1);
    s = stepRealtime(s, w, [fire('p1')], controls);
    expect(s.shots.p1.phase).toBe('ready'); expect(s.shots.p2.projectile?.ageTicks).toBe(p2Age + RESOLVE_TICKS);
    const relaunched = stepRealtime(s, w, [fire('p1')], controls);
    expect(relaunched.shots.p1.projectile?.shotId).toBe(3); expect(relaunched.shots.p1.projectile?.ageTicks).toBe(0);
    expect(relaunched.shots.p2.projectile?.ageTicks).toBe(p2Age + RESOLVE_TICKS + 1);
    expect(relaunched.history.p1).toHaveLength(1);
  });
  it('times out only the expiring seat at age 2160 and never integrates it again', () => {
    const state = withShots(shot('p1', { x: 0, z: 0 }, { x: 0, z: 0 }, FLIGHT_TICKS - 1), shot('p2', { x: 5, z: 5 }, { x: 0, z: 0 }, 10));
    const expired = tick(state);
    expect(expired.shots.p1.result?.reason).toBe('timeout'); expect(expired.shots.p1.projectile).toBeNull();
    expect(expired.shots.p1.resolveTicksRemaining).toBe(90); expect(expired.shots.p2.projectile?.ageTicks).toBe(11);
    const next = tick(expired); expect(next.history.p1).toHaveLength(1); expect(next.shots.p1.result).toBe(expired.shots.p1.result);
  });
  it('gives inclusive last-step collision priority over timeout', () => {
    const projectile = shot('p1', { x: 0, z: 0 }, { x: 5, z: 0 }, FLIGHT_TICKS - 1).projectile!;
    const end = integrateProjectile(projectile, 0).position;
    const w: WorldGeometry = { ...arena, spawns: [arena.spawns[0], { ...arena.spawns[1], position: { x: end.x + hitRadius, z: 0 } }] };
    const state = { ...initial(w), shots: { ...initial(w).shots, p1: { ...shot('p1', projectile.position, projectile.velocity), projectile } } };
    const hit = tick(state, w);
    expect(hit.outcome).toEqual({ cause: 'hit', winner: 'p1', loser: 'p2', detail: 'hit' }); expect(hit.history.p1[0].reason).toBe('hit');
  });
  it('has no projectile-projectile collision', () => {
    const s = tick(withShots(shot('p1', { x: -0.01, z: 1 }, { x: 5, z: 0 }), shot('p2', { x: 0.01, z: 1 }, { x: -5, z: 0 }), duelWorld), duelWorld);
    expect(s.shots.p1.projectile!.position.x).toBeGreaterThan(0); expect(s.shots.p2.projectile!.position.x).toBeLessThan(0);
    expect(s.phase).toBe('playing'); expect(s.history).toEqual({ p1: [], p2: [] });
  });
});

describe('simultaneous fatal contacts', () => {
  it('draws on tied hits to different victims, with 90 following frozen ticks', () => {
    const s = tick(opposedShots(), duelWorld);
    expect(s.outcome).toEqual({ cause: 'draw', winner: null, loser: null, detail: 'simultaneous_hits' });
    expect(s.history.p1[0].victim).toBe('p2'); expect(s.history.p2[0].victim).toBe('p1');
    expect(s.resolveTicksRemaining).toBe(90);
    for (const seat of ['p1', 'p2'] as const) expect(s.shots[seat]).toMatchObject({ phase: 'resolve', projectile: null, resolveTicksRemaining: 90 });
    let frozen = s;
    for (let i = 0; i < 89; i++) frozen = stepRealtime(frozen, duelWorld, [fire('p1'), fire('p2')], { p1: 9, p2: 3 });
    expect(frozen.phase).toBe('resolve'); expect(frozen.resolveTicksRemaining).toBe(1); expect(frozen.history).toBe(s.history); expect(frozen.explored).toBe(s.explored);
    const over = tick(frozen, duelWorld); expect(over.phase).toBe('gameOver'); expect(over.shots.p1.resolveTicksRemaining).toBe(0); expect(tick(over, duelWorld)).toBe(over);
  });
  it('uses earliest normalized fatal contact rather than seat iteration order', () => {
    const p1Wins = tick(opposedShots(0.01, 0.03), duelWorld);
    expect(p1Wins.outcome).toMatchObject({ cause: 'hit', winner: 'p1', loser: 'p2' }); expect(p1Wins.history.p2).toHaveLength(0);
    const p2Wins = tick(opposedShots(0.03, 0.01), duelWorld);
    expect(p2Wins.outcome).toMatchObject({ cause: 'hit', winner: 'p2', loser: 'p1' }); expect(p2Wins.history.p1).toHaveLength(0);
    expect(p2Wins.shots.p1).toMatchObject({ phase: 'resolve', projectile: null, result: null });
  });
  it('uses TOI_EPS for cross-missile ties and does not count later contacts outside it', () => {
    const displacement = 5 * Math.exp(-0.18 / 120) / 120;
    expect(tick(opposedShots(0.02, 0.02 + displacement * TOI_EPS / 2), duelWorld).outcome?.cause).toBe('draw');
    expect(tick(opposedShots(0.02, 0.02 + displacement * TOI_EPS * 2), duelWorld).outcome?.cause).toBe('hit');
  });
  it('tied contacts against the same victim yield one winner, including a self-hit', () => {
    const s = withShots(shot('p1', { x: 2 - hitRadius - 0.02, z: 0 }, { x: 5, z: 0 }), shot('p2', { x: 2 + hitRadius + 0.02, z: 0 }, { x: -5, z: 0 }), duelWorld);
    const result = tick(s, duelWorld);
    expect(result.outcome).toEqual({ cause: 'hit', winner: 'p1', loser: 'p2', detail: 'self_hit' });
    expect(result.history.p1[0].victim).toBe('p2'); expect(result.history.p2[0].victim).toBe('p2');
  });
  it('an ordinary reverse-thrust return defeats its owner and freezes the other seat', () => {
    let s = stepRealtime(initial(), arena, [fire('p1'), fire('p2')], controls);
    for (let i = 0; i < FLIGHT_TICKS && s.phase === 'playing'; i++) s = stepRealtime(s, arena, [], { p1: 4, p2: 0 });
    expect(s.outcome).toEqual({ cause: 'hit', winner: 'p2', loser: 'p1', detail: 'self_hit' }); expect(s.history.p1[0].victim).toBe('p1');
    expect(s.shots.p2).toMatchObject({ phase: 'resolve', projectile: null, result: null }); expect(s.history.p2).toHaveLength(0);
  });
});

describe('seat-specific exploration and terminal history', () => {
  it('discovers each launch cell only for its owner', () => {
    const s = stepRealtime(initial(), arena, [fire('p1')], controls);
    expect(s.explored.p1).toEqual(crossedGridCells(s.shots.p1.projectile!.position, s.shots.p1.projectile!.position)); expect(s.explored.p2).toEqual([]);
  });
  it('truncates exploration at the earliest fatal time, before another missile crosses a new cell', () => {
    const p1Start = { x: 1.20, z: 0 };
    const s = withShots(shot('p1', p1Start, { x: 9, z: 0 }), shot('p2', { x: -7.5 + hitRadius + 0.002, z: -7.5 }, { x: -5, z: 0 }));
    const fullEnd = integrateProjectile(s.shots.p1.projectile!, 0).position;
    expect(crossedGridCells(p1Start, fullEnd)).toHaveLength(2);
    const ended = tick(s);
    expect(ended.outcome?.cause).toBe('hit'); expect(ended.explored.p1).toEqual(crossedGridCells(p1Start, p1Start));
    expect(ended.history.p1).toHaveLength(0);
  });
  it('does not reveal closed tiles or record a later wall after a fatal contact', () => {
    const w: WorldGeometry = { ...arena, walls: [{ id: 'wall:4:5', minX: 1.25, maxX: 3.75, minZ: -1.25, maxZ: 1.25 }] };
    const start = { x: 1.1, z: 0 };
    const s = withShots(shot('p1', start, { x: 9, z: 0 }), shot('p2', { x: -7.5 + hitRadius + 0.002, z: -7.5 }, { x: -5, z: 0 }), w);
    const ended = tick(s, w); expect(ended.history.p1).toHaveLength(0);
    expect(ended.explored.p1).toEqual(crossedGridCells(start, start));
  });
  it('retains only the latest 32 real per-seat results without mutating saved snapshots', () => {
    const w: WorldGeometry = { ...arena, walls: [{ id: 'wall:4:5', minX: 1.6, maxX: 2, minZ: -1, maxZ: 1 }] };
    let s = initial(w); const original = s, saved = JSON.stringify(s), worldSaved = JSON.stringify(w);
    for (let i = 1; i <= SHOT_HISTORY_LIMIT + 4; i++) {
      s = { ...s, shots: { ...s.shots, p1: shot('p1', { x: 1.45, z: 0 }, { x: 5, z: 0 }, 0, i) } };
      s = tick(s, w);
    }
    expect(s.history.p1).toHaveLength(32); expect(s.history.p1[0].shotId).toBe(5); expect(s.history.p1.at(-1)?.shotId).toBe(36); expect(s.history.p2).toHaveLength(0);
    expect(JSON.stringify(original)).toBe(saved); expect(JSON.stringify(w)).toBe(worldSaved);
    const before = s, serial = JSON.stringify(s); tick(s, w); expect(JSON.stringify(before)).toBe(serial);
  });
  it('validates controls and identity, and keeps the separate offline match API/rules version', () => {
    expect(() => stepRealtime(initial(), arena, [], { p1: 16, p2: 0 })).toThrow(/mask/);
    expect(() => createRealtimeMatch(arena, { matchId: '', matchNumber: 1 })).toThrow(/identity/);
    expect(() => createRealtimeMatch({ ...arena, spawns: [arena.spawns[0]] }, { matchId: 'm', matchNumber: 1 })).toThrow(/spawn/);
    expect(RULES_VERSION).toBe(1); expect(REALTIME_RULES_VERSION).toBe(2);
    expect(createMatch(arena, { matchId: 'offline', matchNumber: 1, opener: 'p1' }).phase).toBe('handoff');
  });
});
