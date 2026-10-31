import { describe, expect, it } from 'vitest';
import { buildWorld, tileCenter } from '../../src/maze/build';
import { MAZE_ROWS } from '../../src/maze/fixture';
import { muzzlePosition, validateGeometry, validateMaze } from '../../src/maze/validate';
import type { WorldGeometry } from '../../src/shared/types';

const replaceCell = (rows: readonly string[], row: number, column: number, value: string): string[] =>
  rows.map((text, i) => i === row ? text.slice(0, column) + value + text.slice(column + 1) : text);

describe('canonical maze-01 fixture (M01–M04)', () => {
  it('has the declared counts, one connected component and 12-edge spawn path', () => {
    expect(validateMaze()).toEqual({ openCells: 36, wallCells: 45, edges: 40,
      reachableCells: 36, spawnDistance: 12, symmetric: true, directSightlineBlocked: true });
    expect(MAZE_ROWS).toHaveLength(9);
    expect(MAZE_ROWS.every(row => row.length === 9)).toBe(true);
  });

  it('converts coordinates and every solid tile extent without renderer scaling', () => {
    expect(tileCenter(0, 0)).toEqual({ x: -10, z: -10 });
    expect(tileCenter(4, 4)).toEqual({ x: 0, z: 0 });
    expect(tileCenter(8, 8)).toEqual({ x: 10, z: 10 });
    const world = buildWorld();
    expect(world.mapId).toBe('maze-01');
    expect(world.mapVersion).toBe(2);
    expect(world.walls).toHaveLength(45);
    let index = 0;
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 9; column++) {
        if (MAZE_ROWS[row][column] !== '#') continue;
        const wall = world.walls[index++];
        expect(wall).toEqual({ id: `wall:${row}:${column}`,
          minX: column * 2.5 - 11.25, maxX: column * 2.5 - 8.75,
          minZ: row * 2.5 - 11.25, maxZ: row * 2.5 - 8.75 });
      }
    }
    expect(world.walls[0].minX).toBe(-11.25);
    expect(world.walls.at(-1)!.maxZ).toBe(11.25);
  });

  it('places opposite players and safe muzzles at the exact declared coordinates', () => {
    const world = buildWorld();
    expect(world.spawns).toEqual([
      { id: 'p1', position: { x: -7.5, z: -7.5 }, heading: Math.PI / 2 },
      { id: 'p2', position: { x: 7.5, z: 7.5 }, heading: -Math.PI / 2 },
    ]);
    expect(muzzlePosition(world.spawns[0])).toEqual({ x: -6.85, z: -7.5 });
    expect(muzzlePosition(world.spawns[1])).toEqual({ x: 6.85, z: 7.5 });
    // Declared 0.65 m center offset minus 0.35 m target and 0.12 m projectile.
    expect(Math.hypot(muzzlePosition(world.spawns[0]).x + 7.5,
      muzzlePosition(world.spawns[0]).z + 7.5) - 0.47).toBeCloseTo(0.18, 12);
  });

  it('preserves occupancy under rotation and blocks the direct spawn segment', () => {
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 9; column++) {
        expect(MAZE_ROWS[row][column] === '#').toBe(MAZE_ROWS[8 - row][8 - column] === '#');
      }
    }
    // The diagonal connecting (-7.5,-7.5) and (7.5,7.5) crosses this solid tile center (-5,-5).
    const blocker = buildWorld().walls.find(w => w.id === 'wall:2:2')!;
    expect(blocker.minX).toBeLessThan(-5);
    expect(blocker.maxX).toBeGreaterThan(-5);
    expect(blocker.minZ).toBeLessThan(-5);
    expect(blocker.maxZ).toBeGreaterThan(-5);
  });

  it('deep-freezes geometry and does not change caller rows', () => {
    const rows = [...MAZE_ROWS];
    const saved = [...rows];
    const world = buildWorld(rows);
    expect(rows).toEqual(saved);
    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.isFrozen(world.walls)).toBe(true);
    expect(Object.isFrozen(world.spawns)).toBe(true);
    expect(world.walls.every(Object.isFrozen)).toBe(true);
    expect(world.spawns.every(s => Object.isFrozen(s) && Object.isFrozen(s.position))).toBe(true);
    expect(() => { (world.walls[0] as { minX: number }).minX = 0; }).toThrow(TypeError);
  });
});

describe('invalid maze diagnostics (M03)', () => {
  it('rejects wrong dimensions, characters and a broken perimeter with locations', () => {
    expect(() => buildWorld(MAZE_ROWS.slice(1))).toThrow(/expected 9 rows/);
    expect(() => buildWorld(MAZE_ROWS.map((r, i) => i === 4 ? r.slice(1) : r))).toThrow(/row 4 must have 9 columns/);
    expect(() => buildWorld(replaceCell(MAZE_ROWS, 4, 3, ' '))).toThrow(/invalid character at row 4, column 3/);
    expect(() => buildWorld(replaceCell(MAZE_ROWS, 0, 1, '.'))).toThrow(/perimeter.*row 0, column 1/);
  });

  it('rejects missing or duplicate spawn labels', () => {
    expect(() => buildWorld(replaceCell(MAZE_ROWS, 1, 1, '.'))).toThrow(/exactly one spawn 1, received 0/);
    expect(() => buildWorld(replaceCell(MAZE_ROWS, 1, 2, '1'))).toThrow(/exactly one spawn 1, received 2/);
  });

  it('reports an isolated open cell before generic fixture-count mismatches', () => {
    const rows = replaceCell(replaceCell(MAZE_ROWS, 3, 1, '#'), 3, 3, '#');
    expect(() => buildWorld(rows)).toThrow(/disconnected open cell at row 3, column 2/);
  });

  it('rejects changed occupancy even when it remains connected', () => {
    expect(() => buildWorld(replaceCell(MAZE_ROWS, 2, 2, '.'))).toThrow(/fixture counts/);
  });

  it('rejects swapped spawn metadata', () => {
    const rows = replaceCell(replaceCell(MAZE_ROWS, 1, 1, '2'), 7, 7, '1');
    expect(() => buildWorld(rows)).toThrow(/spawn position\/heading differs/);
  });

  it('rejects unsafe muzzle independently of target clearance', () => {
    const world = buildWorld();
    const unsafe: WorldGeometry = { ...world, spawns: [
      { ...world.spawns[0], position: { x: 8.1, z: -7.5 } }, world.spawns[1],
    ] };
    expect(() => validateGeometry(unsafe)).toThrow(/p1 unsafe muzzle at wall:1:8/);
  });

  it('rejects nonfinite geometry, target overlap, missing targets and inconsistent bounds', () => {
    const world = buildWorld();
    expect(() => validateGeometry({ ...world, spawns: [{ ...world.spawns[0], heading: NaN }, world.spawns[1]] })).toThrow(/non-finite p1 spawn/);
    expect(() => validateGeometry({ ...world, spawns: [world.spawns[0]] })).toThrow(/exactly p1 and p2/);
    expect(() => validateGeometry({ ...world, spawns: [{ ...world.spawns[0], position: { x: -10, z: -10 } }, world.spawns[1]] })).toThrow(/target overlaps/);
    expect(() => validateGeometry({ ...world, walls: [{ ...world.walls[0], minX: -11 }, ...world.walls.slice(1)] })).toThrow(/wall bounds differ from tile extent/);
  });

  it('rejects reordered or duplicated collider IDs rather than relying on iteration order', () => {
    const world = buildWorld();
    expect(() => validateGeometry({ ...world, walls: [world.walls[1], world.walls[0], ...world.walls.slice(2)] })).toThrow(/numeric row-major order/);
    expect(() => validateGeometry({ ...world, walls: [world.walls[0], world.walls[0], ...world.walls.slice(2)] })).toThrow(/duplicate wall ID/);
  });
});
