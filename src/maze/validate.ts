import { CONTACT_EPS, GRID_SIZE, MUZZLE_OFFSET, PLAYER_RADIUS, PROJECTILE_RADIUS, TILE_SIZE } from '../shared/config';
import { forward } from '../shared/math';
import type { PlayerSpawn, Vec2, Wall, WorldGeometry } from '../shared/types';
import { MAZE_ROWS, SPAWN_CELLS } from './fixture';
import { geometryFromRows, tileCenter } from './geometry';

export type MazeValidation = Readonly<{ openCells: number; wallCells: number;
  edges: number; reachableCells: number; spawnDistance: number; symmetric: boolean;
  directSightlineBlocked: boolean }>;
const fail = (message: string): never => { throw new Error(`Invalid maze-01: ${message}`); };
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
const distanceToWall = (p: Vec2, wall: Wall): number => Math.hypot(
  Math.max(wall.minX - p.x, 0, p.x - wall.maxX),
  Math.max(wall.minZ - p.z, 0, p.z - wall.maxZ));

/** Closed segment/rectangle test, only used to validate sightline and straight launch clearance. */
function segmentCrossesWall(start: Vec2, end: Vec2, wall: Wall, padding = 0): boolean {
  let near = 0;
  let far = 1;
  for (const [a, b, min, max] of [
    [start.x, end.x, wall.minX - padding, wall.maxX + padding],
    [start.z, end.z, wall.minZ - padding, wall.maxZ + padding],
  ]) {
    const delta = b - a;
    if (Math.abs(delta) < Number.EPSILON) {
      if (a < min || a > max) return false;
    } else {
      const enter = (min - a) / delta;
      const exit = (max - a) / delta;
      near = Math.max(near, Math.min(enter, exit));
      far = Math.min(far, Math.max(enter, exit));
      if (near > far) return false;
    }
  }
  return true;
}

export function muzzlePosition(spawn: PlayerSpawn): Vec2 {
  const nose = forward(spawn.heading);
  return { x: spawn.position.x + nose.x * MUZZLE_OFFSET,
    z: spawn.position.z + nose.z * MUZZLE_OFFSET };
}

/** Validate physical spawn safety independently so bad injected geometry fails loudly. */
export function validateGeometry(world: WorldGeometry): void {
  if (world.spawns.length !== 2 || new Set(world.spawns.map(s => s.id)).size !== 2 ||
      !world.spawns.some(s => s.id === 'p1') || !world.spawns.some(s => s.id === 'p2')) {
    fail('geometry must contain exactly p1 and p2');
  }
  const ids = new Set<string>();
  let previousIndex = -1;
  for (const wall of world.walls) {
    if (![wall.minX, wall.maxX, wall.minZ, wall.maxZ].every(Number.isFinite)) fail(`non-finite wall ${wall.id}`);
    if (wall.maxX <= wall.minX || wall.maxZ <= wall.minZ) fail(`invalid bounds for ${wall.id}`);
    if (ids.has(wall.id)) fail(`duplicate wall ID ${wall.id}`);
    ids.add(wall.id);
    const match = /^wall:(\d+):(\d+)$/.exec(wall.id);
    if (!match) fail(`invalid wall ID ${wall.id}`);
    const row = Number(match![1]);
    const column = Number(match![2]);
    if (row >= GRID_SIZE || column >= GRID_SIZE) fail(`wall ID outside grid ${wall.id}`);
    const index = row * GRID_SIZE + column;
    if (index <= previousIndex) fail(`wall IDs are not in numeric row-major order at ${wall.id}`);
    previousIndex = index;
    const center = tileCenter(column, row);
    if (wall.minX !== center.x - TILE_SIZE / 2 || wall.maxX !== center.x + TILE_SIZE / 2 ||
        wall.minZ !== center.z - TILE_SIZE / 2 || wall.maxZ !== center.z + TILE_SIZE / 2) {
      fail(`wall bounds differ from tile extent at row ${row}, column ${column}`);
    }
  }
  for (const spawn of world.spawns) {
    if (![spawn.position.x, spawn.position.z, spawn.heading].every(Number.isFinite)) fail(`non-finite ${spawn.id} spawn`);
    for (const wall of world.walls) {
      if (distanceToWall(spawn.position, wall) <= PLAYER_RADIUS + CONTACT_EPS) fail(`${spawn.id} target overlaps ${wall.id}`);
    }
    const muzzle = muzzlePosition(spawn);
    for (const wall of world.walls) {
      if (distanceToWall(muzzle, wall) <= PROJECTILE_RADIUS + CONTACT_EPS) fail(`${spawn.id} unsafe muzzle at ${wall.id}`);
    }
    for (const target of world.spawns) {
      if (distance(muzzle, target.position) <= PROJECTILE_RADIUS + PLAYER_RADIUS + CONTACT_EPS) {
        fail(`${spawn.id} unsafe muzzle overlaps ${target.id}`);
      }
    }
    const expected = SPAWN_CELLS[spawn.id];
    const expectedPosition = tileCenter(expected.column, expected.row);
    if (distance(spawn.position, expectedPosition) > CONTACT_EPS || spawn.heading !== expected.heading) {
      fail(`${spawn.id} spawn position/heading differs from declared metadata`);
    }
    const nose = forward(spawn.heading);
    const ahead = { x: muzzle.x + nose.x * 8, z: muzzle.z + nose.z * 8 };
    if (world.walls.some(w => segmentCrossesWall(muzzle, ahead, w, PROJECTILE_RADIUS))) fail(`${spawn.id} launch corridor is not clear for 8 m`);
  }
  if (distance(world.spawns[0].position, world.spawns[1].position) <= PLAYER_RADIUS * 2 + CONTACT_EPS) fail('target cylinders overlap');
  if (!world.walls.some(w => segmentCrossesWall(world.spawns[0].position, world.spawns[1].position, w))) {
    fail('direct spawn sightline must be blocked by a wall');
  }
}

export function validateMaze(rows: readonly string[] = MAZE_ROWS): MazeValidation {
  if (rows.length !== GRID_SIZE) fail(`expected ${GRID_SIZE} rows, received ${rows.length}`);
  let openCells = 0;
  let wallCells = 0;
  let edges = 0;
  const spawnCells: Record<string, number[]> = { '1': [], '2': [] };
  const open = new Set<number>();
  for (let row = 0; row < GRID_SIZE; row++) {
    if (typeof rows[row] !== 'string' || rows[row].length !== GRID_SIZE) fail(`row ${row} must have ${GRID_SIZE} columns`);
    for (let column = 0; column < GRID_SIZE; column++) {
      const cell = rows[row][column];
      if (!['#', '.', '1', '2'].includes(cell)) fail(`invalid character at row ${row}, column ${column}`);
      if ((row === 0 || row === GRID_SIZE - 1 || column === 0 || column === GRID_SIZE - 1) && cell !== '#') {
        fail(`perimeter must be solid at row ${row}, column ${column}`);
      }
      if (cell === '#') wallCells++;
      else { openCells++; open.add(row * GRID_SIZE + column); }
      if (cell === '1' || cell === '2') spawnCells[cell].push(row * GRID_SIZE + column);
    }
  }
  for (const label of ['1', '2']) {
    if (spawnCells[label].length !== 1) fail(`expected exactly one spawn ${label}, received ${spawnCells[label].length}`);
  }
  const neighbours = (index: number): number[] => {
    const column = index % GRID_SIZE;
    const row = Math.floor(index / GRID_SIZE);
    return [[column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1]]
      .filter(([c, r]) => c >= 0 && c < GRID_SIZE && r >= 0 && r < GRID_SIZE)
      .map(([c, r]) => r * GRID_SIZE + c).filter(i => open.has(i));
  };
  for (const index of open) edges += neighbours(index).length;
  edges /= 2;
  const distances = new Map<number, number>([[spawnCells['1'][0], 0]]);
  const queue = [spawnCells['1'][0]];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbours(queue[i])) {
      if (!distances.has(next)) { distances.set(next, distances.get(queue[i])! + 1); queue.push(next); }
    }
  }
  if (distances.size !== openCells) {
    const unreachable = [...open].find(index => !distances.has(index))!;
    fail(`disconnected open cell at row ${Math.floor(unreachable / GRID_SIZE)}, column ${unreachable % GRID_SIZE}`);
  }
  if (openCells !== 36 || wallCells !== 45) fail(`fixture counts must be 36 open / 45 walls; received ${openCells} / ${wallCells}`);
  if (edges !== 40) fail(`expected 40 graph edges, received ${edges}`);
  const spawnDistance = distances.get(spawnCells['2'][0])!;
  if (spawnDistance !== 12) fail(`expected 12-edge spawn route, received ${spawnDistance}`);
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let column = 0; column < GRID_SIZE; column++) {
      if ((rows[row][column] === '#') !== (rows[GRID_SIZE - 1 - row][GRID_SIZE - 1 - column] === '#')) {
        fail(`occupancy lacks 180-degree symmetry at row ${row}, column ${column}`);
      }
    }
  }
  const geometry = geometryFromRows(rows);
  validateGeometry(geometry);
  // Matching graph statistics alone cannot identify an authored map/version.
  for (let row = 0; row < GRID_SIZE; row++) {
    if (rows[row] !== MAZE_ROWS[row]) fail(`row ${row} differs from the canonical maze-01 fixture`);
  }
  return Object.freeze({ openCells, wallCells, edges, reachableCells: distances.size, spawnDistance,
    symmetric: true, directSightlineBlocked: true });
}
