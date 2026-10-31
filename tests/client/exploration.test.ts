import { describe, expect, it, vi } from 'vitest';
import { crossedGridCells, createExplorationModel } from '../../src/client/exploration';
import { buildWorld } from '../../src/maze/build';
import type { MatchState, PlayerId, ProjectileState, Vec2, WorldGeometry } from '../../src/shared/types';

const arena: WorldGeometry = { mapId: 'test', mapVersion: 1, walls: [], spawns: [] };
const point = (column: number, row: number): Vec2 => ({ x: (column - 4) * 2.5, z: (row - 4) * 2.5 });
const index = (column: number, row: number) => row * 9 + column;
const state = (overrides: Partial<MatchState> = {}): MatchState => ({
  matchId: 'match-1', matchNumber: 1, opener: 'p1', tick: 1, phase: 'flight', activePlayer: 'p1', turnId: 1, nextShotId: 2,
  projectile: null, result: null, resolveTicksRemaining: 0, winner: null, ...overrides,
});
function flying(column: number, row: number, age = 0, owner: PlayerId = 'p1', shotId = 1, matchId = 'match-1'): MatchState {
  const projectile: ProjectileState = { shotId, owner, position: point(column, row), velocity: { x: 5, z: 0 }, heading: Math.PI / 2, angularVelocity: 0, ageTicks: age };
  return state({ matchId, activePlayer: owner, projectile, tick: age + 1 });
}

describe('exploration center-point grid traversal', () => {
  it('crosses every intervening tile at negative world coordinates without revealing neighboring rows', () => {
    expect(crossedGridCells(point(1, 1), point(5, 1))).toEqual([10, 11, 12, 13, 14]);
    expect(crossedGridCells(point(5, 1), point(1, 1))).toEqual([14, 13, 12, 11, 10]);
  });
  it('crosses a whole bounded footprint and rejects invalid/outside segments', () => {
    expect(crossedGridCells({ x: -1000, z: 0 }, { x: 1000, z: 0 })).toEqual(Array.from({ length: 9 }, (_, c) => index(c, 4)));
    expect(crossedGridCells({ x: -1000, z: -1000 }, { x: 1000, z: 1000 })).toEqual(Array.from({ length: 9 }, (_, c) => index(c, c)));
    expect(crossedGridCells({ x: -100, z: -100 }, { x: -50, z: -50 })).toEqual([]);
    expect(crossedGridCells({ x: NaN, z: 0 }, point(1, 1))).toEqual([]);
    expect(crossedGridCells({ x: 11.25, z: 0 }, { x: 11.25, z: 0 })).toEqual([]);
    expect(crossedGridCells(point(1, 1), point(1, 1))).toEqual([10]);
  });
  it('respects half-open outer edges for inward, outward and point-only tangent segments', () => {
    const east = { x: 11.25, z: 0 }, west = { x: -11.25, z: 0 };
    expect(crossedGridCells(east, { x: 20, z: 0 })).toEqual([]);
    expect(crossedGridCells({ x: 20, z: 0 }, east)).toEqual([]);
    expect(crossedGridCells(east, point(7, 4))).toEqual([index(8, 4), index(7, 4)]);
    expect(crossedGridCells({ x: 20, z: 0 }, point(7, 4))).toEqual([index(8, 4), index(7, 4)]);
    expect(crossedGridCells(west, { x: -20, z: 0 })).toEqual([index(0, 4)]);
    expect(crossedGridCells(west, point(1, 4))).toEqual([index(0, 4), index(1, 4)]);
    expect(crossedGridCells({ x: 10, z: -12.5 }, { x: 12.5, z: -10 })).toEqual([]);
    expect(crossedGridCells({ x: -12.5, z: -10 }, { x: -10, z: -12.5 })).toEqual([index(0, 0)]);
    expect(crossedGridCells({ x: -20, z: 11.25 }, { x: 20, z: 11.25 })).toEqual([]);
  });
  it('enters only diagonal cells at exact corners rather than revealing touched side cells', () => {
    expect(crossedGridCells(point(1, 1), point(4, 4))).toEqual([10, 20, 30, 40]);
    expect(crossedGridCells(point(4, 4), point(1, 1))).toEqual([40, 30, 20, 10]);
    expect(crossedGridCells(point(1, 1), { x: point(2, 2).x, z: point(2, 2).z - .01 })).toEqual([10, 11, 20]);
  });
});

describe('private exploration knowledge', () => {
  it('stores only crossed open cells; reveals cardinal neighboring walls and keeps unvisited corridors fogged', () => {
    const model = createExplorationModel(buildWorld(), { resetOnRematch: false });
    model.observe(flying(1, 1)); model.observe(flying(5, 1, 100));
    expect(model.serialize()).toEqual({ p1: [10, 11, 12, 13, 14], p2: [] });
    expect(model.cellKind('p1', index(2, 2))).toBe('wall');
    expect(model.cellKind('p1', index(5, 2))).toBe('fog');
    expect(model.cellKind('p1', index(3, 3))).toBe('fog');
    expect(model.cellKind('p2', 10)).toBe('fog');
    expect(model.cellKind('p2', index(2, 2))).toBe('fog');
  });
  it('keeps wall cells out of saved discovery even when observing a synthetic segment crossing them', () => {
    const model = createExplorationModel(buildWorld(), { resetOnRematch: false });
    model.observe(flying(1, 2)); model.observe(flying(5, 2, 100));
    expect(model.discovered('p1')).toEqual([21, 23]);
  });
  it('includes the final segment to an authoritative wall endpoint, then isolates the next shot and seat', () => {
    const model = createExplorationModel(arena, { resetOnRematch: false });
    model.observe(flying(1, 1));
    model.observe(state({ phase: 'resolve', result: { reason: 'wall', shooter: 'p1', shotId: 1, endpoint: point(4, 1), victim: null, colliderId: 'wall:test' } }));
    expect(model.discovered('p1')).toEqual([10, 11, 12, 13]);
    model.observe(flying(7, 7, 0, 'p2', 2));
    expect(model.serialize()).toEqual({ p1: [10, 11, 12, 13], p2: [70] });
    expect(model.cellKind('p2', index(4, 4))).toBe('fog');
    model.observe(flying(6, 6, 0, 'p1', 3));
    expect(model.discovered('p1')).toEqual([10, 11, 12, 13, 60]);
  });
  it('never bridges different matches or shot IDs, including when the previous result was skipped', () => {
    const model = createExplorationModel(arena, { resetOnRematch: false });
    model.observe(flying(1, 1)); model.observe(flying(5, 5, 0, 'p1', 2));
    model.observe(flying(7, 7, 0, 'p1', 1, 'match-2'));
    expect(model.discovered('p1')).toEqual([10, 50, 70]);
    expect(model.cellKind('p1', index(2, 2))).toBe('fog');
  });
  it('supports keeping or resetting rematch discovery without clearing restored data on first snapshot', () => {
    for (const resetOnRematch of [false, true]) {
      const model = createExplorationModel(arena, { resetOnRematch, initialDiscovery: { p1: [10], p2: [70] } });
      model.observe(state({ phase: 'handoff' }));
      expect(model.serialize()).toEqual({ p1: [10], p2: [70] });
      model.observe(state({ matchId: 'match-2', phase: 'handoff' }));
      expect(model.serialize()).toEqual(resetOnRematch ? { p1: [], p2: [] } : { p1: [10], p2: [70] });
    }
  });
  it('validates restoration, returns sorted copies, and emits once only when discovery actually changes', () => {
    const callback = vi.fn();
    const model = createExplorationModel(buildWorld(), { resetOnRematch: false, initialDiscovery: { p1: [14, 10, 10, 0, NaN, Infinity, -1, 81, 10.5, '11'], p2: 'bad' }, onDiscoveryChange: callback });
    expect(model.serialize()).toEqual({ p1: [10, 14], p2: [] });
    expect(callback).not.toHaveBeenCalled();
    expect(model.restore(null)).toBe(false); expect(model.restore({ p1: false })).toBe(false);
    model.observe(flying(1, 1)); expect(callback).not.toHaveBeenCalled();
    model.observe(flying(5, 1, 100)); expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith({ p1: [10, 11, 12, 13, 14], p2: [] });
    const saved = model.serialize(); (saved.p1 as number[]).push(77);
    expect(model.discovered('p1')).not.toContain(77);
    expect(model.reset()).toBe(true); expect(model.reset()).toBe(false);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(model.restore({ p2: [70, 69, 70, 80] })).toBe(true);
    expect(model.serialize()).toEqual({ p1: [], p2: [69, 70] });
  });
});
