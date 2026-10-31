import { GRID_SIZE, TILE_SIZE } from './config';
import type { Vec2, WorldGeometry } from './types';

const HALF_WIDTH = GRID_SIZE * TILE_SIZE / 2;
const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.z);

/**
 * Center-point traversal in north-up row-major grid coordinates. Cells are half-open;
 * an exact corner crossing enters the diagonal cell, without revealing side neighbors.
 * Clip first so malformed/out-of-world coordinates cannot create an unbounded loop.
 */
export function crossedGridCells(start: Vec2, end: Vec2): readonly number[] {
  if (!finite(start) || !finite(end)) return [];
  const ax = (start.x + HALF_WIDTH) / TILE_SIZE, az = (start.z + HALF_WIDTH) / TILE_SIZE;
  const bx = (end.x + HALF_WIDTH) / TILE_SIZE, bz = (end.z + HALF_WIDTH) / TILE_SIZE;
  const dx = bx - ax, dz = bz - az;
  if (![ax, az, bx, bz, dx, dz].every(Number.isFinite)) return [];
  let enter = 0, exit = 1;
  for (const [a, d] of [[ax, dx], [az, dz]]) {
    if (d === 0) { if (a < 0 || a >= GRID_SIZE) return []; continue; }
    const t0 = -a / d, t1 = (GRID_SIZE - a) / d;
    enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
    if (enter > exit) return [];
  }
  if (exit < 0 || enter > 1) return [];
  if (enter === exit) {
    const touchX = ax + dx * enter, touchZ = az + dz * enter;
    if (touchX < 0 || touchX >= GRID_SIZE || touchZ < 0 || touchZ >= GRID_SIZE) return [];
  }
  // The positive outer edge is outside the half-open grid. Inward segments still start
  // in the last cell; a point merely resting on that edge reveals nothing.
  if (dx === 0 && dz === 0) {
    const c = Math.floor(ax), r = Math.floor(az);
    return c >= 0 && c < GRID_SIZE && r >= 0 && r < GRID_SIZE ? [r * GRID_SIZE + c] : [];
  }
  const bound = (v: number) => Math.min(GRID_SIZE - 1e-10, Math.max(0, v));
  const x = bound(ax + dx * enter), z = bound(az + dz * enter);
  const endX = bound(ax + dx * exit), endZ = bound(az + dz * exit);
  let column = Math.floor(x), row = Math.floor(z);
  const endColumn = Math.floor(endX), endRow = Math.floor(endZ);
  const stepX = Math.sign(dx), stepZ = Math.sign(dz);
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx), deltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
  let nextX = dx === 0 ? Infinity : enter + ((stepX > 0 ? column + 1 : column) - x) / dx;
  let nextZ = dz === 0 ? Infinity : enter + ((stepZ > 0 ? row + 1 : row) - z) / dz;
  const cells: number[] = [];
  for (let count = 0; count <= GRID_SIZE * 2; count++) {
    if (column < 0 || column >= GRID_SIZE || row < 0 || row >= GRID_SIZE) break;
    cells.push(row * GRID_SIZE + column);
    if (column === endColumn && row === endRow) break;
    const tie = Math.abs(nextX - nextZ) <= 1e-12;
    if (tie) { column += stepX; row += stepZ; nextX += deltaX; nextZ += deltaZ; }
    else if (nextX < nextZ) { column += stepX; nextX += deltaX; }
    else { row += stepZ; nextZ += deltaZ; }
  }
  return cells;
}

export function openGridCells(world:WorldGeometry):ReadonlySet<number>{
  const cells=new Set<number>();
  for(let row=0;row<GRID_SIZE;row++)for(let col=0;col<GRID_SIZE;col++){
    const x=(col-(GRID_SIZE-1)/2)*TILE_SIZE,z=(row-(GRID_SIZE-1)/2)*TILE_SIZE;
    if(!world.walls.some(w=>x>=w.minX&&x<=w.maxX&&z>=w.minZ&&z<=w.maxZ))cells.add(row*GRID_SIZE+col);
  }
  return cells;
}
