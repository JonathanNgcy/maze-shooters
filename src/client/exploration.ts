import { GRID_SIZE, TILE_SIZE } from '../shared/config';
import {crossedGridCells} from '../shared/exploration-grid';
export {crossedGridCells} from '../shared/exploration-grid';
import type { MatchState, PlayerId, Vec2, WorldGeometry } from '../shared/types';
import type { ExplorationDiscovery, ExplorationOptions } from './exploration-contract';

export type ExplorationCellKind = 'fog' | 'visited' | 'wall';
export interface ExplorationModel {
  observe(state: MatchState): boolean;
  serialize(): ExplorationDiscovery;
  discovered(seat: PlayerId): readonly number[];
  cellKind(seat: PlayerId, cell: number): ExplorationCellKind;
  reset(): boolean;
  /** Valid arrays replace their seat; malformed seat fields leave existing data untouched. */
  restore(value: unknown): boolean;
}
const COUNT = GRID_SIZE * GRID_SIZE;
const sameCells = (a: ReadonlySet<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every((cell) => b.has(cell));

export function createExplorationModel(world: WorldGeometry, options: ExplorationOptions): ExplorationModel {
  const blocked = new Set<number>();
  for (let row = 0; row < GRID_SIZE; row++) for (let column = 0; column < GRID_SIZE; column++) {
    const x = (column - (GRID_SIZE - 1) / 2) * TILE_SIZE, z = (row - (GRID_SIZE - 1) / 2) * TILE_SIZE;
    if (world.walls.some((wall) => x >= wall.minX && x <= wall.maxX && z >= wall.minZ && z <= wall.maxZ)) blocked.add(row * GRID_SIZE + column);
  }
  const discovery: Record<PlayerId, Set<number>> = { p1: new Set(), p2: new Set() };
  let matchId: string | null = null;
  let previous: { shotId: number; owner: PlayerId; position: Vec2; age: number } | null = null;
  const serialize = (): ExplorationDiscovery => ({ p1: [...discovery.p1].sort((a, b) => a - b), p2: [...discovery.p2].sort((a, b) => a - b) });
  const notify = () => options.onDiscoveryChange?.(serialize());
  function restore(value: unknown, emit = true): boolean {
    if (value === null || typeof value !== 'object') return false;
    let changed = false;
    try {
      for (const seat of ['p1', 'p2'] as const) {
        const candidate = (value as Record<string, unknown>)[seat];
        if (!Array.isArray(candidate)) continue;
        const next = new Set<number>();
        // Discovery is bounded to the configured grid, regardless of restoration input size.
        for (const cell of candidate) if (typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < COUNT && !blocked.has(cell)) next.add(cell);
        if (!sameCells(next, discovery[seat])) { discovery[seat] = next; changed = true; }
      }
    } catch { /* Invalid unknown data must never prevent play. */ }
    if (changed && emit) notify();
    return changed;
  }
  restore(options.initialDiscovery, false);
  const reveal = (seat: PlayerId, start: Vec2, end: Vec2): boolean => {
    let changed = false;
    for (const cell of crossedGridCells(start, end)) if (!blocked.has(cell) && !discovery[seat].has(cell)) { discovery[seat].add(cell); changed = true; }
    return changed;
  };
  return {
    serialize,
    discovered(seat) { return [...discovery[seat]].sort((a, b) => a - b); },
    cellKind(seat, cell) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= COUNT) return 'fog';
      if (discovery[seat].has(cell)) return 'visited';
      if (!blocked.has(cell)) return 'fog';
      const row = Math.floor(cell / GRID_SIZE), column = cell % GRID_SIZE;
      const neighbors = [row > 0 ? cell - GRID_SIZE : -1, row + 1 < GRID_SIZE ? cell + GRID_SIZE : -1, column > 0 ? cell - 1 : -1, column + 1 < GRID_SIZE ? cell + 1 : -1];
      return neighbors.some((neighbor) => discovery[seat].has(neighbor)) ? 'wall' : 'fog';
    },
    restore(value) { return restore(value); },
    reset() {
      previous = null;
      const changed = discovery.p1.size > 0 || discovery.p2.size > 0;
      discovery.p1.clear(); discovery.p2.clear();
      if (changed) notify();
      return changed;
    },
    observe(state) {
      let changed = false;
      if (matchId !== state.matchId) {
        if (matchId !== null && options.resetOnRematch) {
          changed = discovery.p1.size > 0 || discovery.p2.size > 0;
          discovery.p1.clear(); discovery.p2.clear();
        }
        matchId = state.matchId; previous = null;
      }
      const p = state.projectile;
      if (state.phase === 'flight' && p) {
        const joined = previous && previous.shotId === p.shotId && previous.owner === p.owner && previous.age <= p.ageTicks;
        changed = reveal(p.owner, joined ? previous!.position : p.position, p.position) || changed;
        previous = { shotId: p.shotId, owner: p.owner, position: p.position, age: p.ageTicks };
      } else if (state.result && (state.phase === 'resolve' || state.phase === 'gameOver')) {
        const result = state.result;
        const joined = previous && previous.shotId === result.shotId && previous.owner === result.shooter;
        changed = reveal(result.shooter, joined ? previous!.position : result.endpoint, result.endpoint) || changed;
        previous = null;
      } else previous = null;
      if (changed) notify();
      return changed;
    },
  };
}
