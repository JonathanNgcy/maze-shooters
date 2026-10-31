import { GRID_SIZE, MAP_ID, MAP_VERSION, TILE_SIZE } from '../shared/config';
import type { PlayerSpawn, Vec2, Wall, WorldGeometry } from '../shared/types';
import { SPAWN_CELLS } from './fixture';

export function tileCenter(column: number, row: number): Vec2 {
  return { x: (column - (GRID_SIZE - 1) / 2) * TILE_SIZE,
    z: (row - (GRID_SIZE - 1) / 2) * TILE_SIZE };
}

/** Internal conversion. Public callers should use buildWorld to validate first. */
export function geometryFromRows(rows: readonly string[]): WorldGeometry {
  const walls: Wall[] = [];
  const spawns: PlayerSpawn[] = [];
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < rows[row].length; column++) {
      const cell = rows[row][column];
      const position = tileCenter(column, row);
      if (cell === '#') {
        const half = TILE_SIZE / 2;
        walls.push(Object.freeze({ id: `wall:${row}:${column}`,
          minX: position.x - half, maxX: position.x + half,
          minZ: position.z - half, maxZ: position.z + half }));
      } else if (cell === '1' || cell === '2') {
        const id = cell === '1' ? 'p1' : 'p2';
        spawns.push(Object.freeze({ id, position: Object.freeze(position), heading: SPAWN_CELLS[id].heading }));
      }
    }
  }
  return Object.freeze({ mapId: MAP_ID, mapVersion: MAP_VERSION,
    walls: Object.freeze(walls), spawns: Object.freeze(spawns) });
}
