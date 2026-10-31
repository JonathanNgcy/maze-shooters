import type { WorldGeometry } from '../shared/types';
import { MAZE_ROWS } from './fixture';
import { geometryFromRows } from './geometry';
import { validateMaze } from './validate';

/** Validate before exposing one immutable geometry source to both physics and presentation. */
export function buildWorld(rows: readonly string[] = MAZE_ROWS): WorldGeometry {
  validateMaze(rows);
  return geometryFromRows(rows);
}

export { tileCenter } from './geometry';
