/** Canonical authored maze-01, mapVersion 2. Changes require a spec/version update. */
export const MAZE_ROWS: readonly string[] = Object.freeze([
  '#########',
  '#1......#',
  '###.#.#.#',
  '#...#...#',
  '#.#.#.#.#',
  '#...#...#',
  '#.#.#.###',
  '#......2#',
  '#########',
]);

export const SPAWN_CELLS = Object.freeze({
  p1: Object.freeze({ column: 1, row: 1, heading: Math.PI / 2 }),
  p2: Object.freeze({ column: 7, row: 7, heading: -Math.PI / 2 }),
});
