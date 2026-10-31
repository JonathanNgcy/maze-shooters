import { CONTACT_EPS, PLAYER_RADIUS, PROJECTILE_RADIUS, TOI_EPS } from '../shared/config';
import { clamp } from '../shared/math';
import type { Collision, Vec2, Wall, WorldGeometry } from '../shared/types';

function checkInputs(start: Vec2, end: Vec2, radius: number): void {
  if (![start.x, start.z, end.x, end.z, radius].every(Number.isFinite) || radius < 0) throw new Error('Non-finite or negative sweep geometry');
}

/** Earliest closed contact of a segment and circle. Initial contact includes CONTACT_EPS. */
export function sweepCircle(start: Vec2, end: Vec2, center: Vec2, radius: number): number | null {
  checkInputs(start, end, radius);
  if (![center.x, center.z].every(Number.isFinite)) throw new Error('Non-finite target center');
  const ox = start.x - center.x, oz = start.z - center.z;
  if (Math.hypot(ox, oz) <= radius + CONTACT_EPS) return 0;
  const dx = end.x - start.x, dz = end.z - start.z;
  const a = dx * dx + dz * dz;
  if (a === 0) return null;
  const b = ox * dx + oz * dz, c = ox * ox + oz * oz - radius * radius;
  if (b > 0) return null;
  let disc = b * b - a * c;
  // Roundoff tolerance only, rather than an inflated collision circle.
  const rounding = Number.EPSILON * 16 * Math.max(Number.MIN_VALUE, Math.abs(b * b), Math.abs(a * c));
  if (disc < -rounding) return null;
  disc = Math.max(0, disc);
  const u = (-b - Math.sqrt(disc)) / a;
  const rangeEps = CONTACT_EPS / Math.sqrt(a);
  return u >= -rangeEps && u <= 1 + rangeEps ? clamp(u, 0, 1) : null;
}

/** Exact Minkowski sum: rectangle faces plus four circular exterior quadrants. */
export function sweepWall(start: Vec2, end: Vec2, wall: Wall, radius: number): number | null {
  checkInputs(start, end, radius);
  if (![wall.minX, wall.maxX, wall.minZ, wall.maxZ].every(Number.isFinite) || wall.minX > wall.maxX || wall.minZ > wall.maxZ) throw new Error('Invalid wall rectangle');
  const nx = clamp(start.x, wall.minX, wall.maxX), nz = clamp(start.z, wall.minZ, wall.maxZ);
  if (Math.hypot(start.x - nx, start.z - nz) <= radius + CONTACT_EPS) return 0;
  const dx = end.x - start.x, dz = end.z - start.z;
  if (dx === 0 && dz === 0) return null;
  const candidates: number[] = [];
  const rangeEps = CONTACT_EPS / Math.hypot(dx, dz);
  const accept = (u: number, coordinate: number, lo: number, hi: number): void => {
    if (u >= -rangeEps && u <= 1 + rangeEps && coordinate >= lo - CONTACT_EPS && coordinate <= hi + CONTACT_EPS) candidates.push(clamp(u, 0, 1));
  };
  if (dx > 0) {
    const u = (wall.minX - radius - start.x) / dx;
    accept(u, start.z + dz * u, wall.minZ, wall.maxZ);
  } else if (dx < 0) {
    const u = (wall.maxX + radius - start.x) / dx;
    accept(u, start.z + dz * u, wall.minZ, wall.maxZ);
  }
  if (dz > 0) {
    const u = (wall.minZ - radius - start.z) / dz;
    accept(u, start.x + dx * u, wall.minX, wall.maxX);
  } else if (dz < 0) {
    const u = (wall.maxZ + radius - start.z) / dz;
    accept(u, start.x + dx * u, wall.minX, wall.maxX);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const corner = { x: sx < 0 ? wall.minX : wall.maxX, z: sz < 0 ? wall.minZ : wall.maxZ };
    const u = sweepCircle(start, end, corner, radius);
    if (u === null) continue;
    const x = start.x + dx * u, z = start.z + dz * u;
    if ((x - corner.x) * sx >= -CONTACT_EPS && (z - corner.z) * sz >= -CONTACT_EPS) candidates.push(u);
  }
  return candidates.length ? Math.min(...candidates) : null;
}

function wallOrder(id: string): readonly [number, number, string] {
  const m = /^wall:(\d+):(\d+)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2]), id] : [Infinity, Infinity, id];
}
function priority(a: Collision, b: Collision): number {
  if (a.reason !== b.reason) return a.reason === 'wall' ? -1 : 1;
  if (a.reason === 'hit') return a.victim === b.victim ? 0 : a.victim === 'p1' ? -1 : 1;
  const aw = wallOrder(a.colliderId), bw = wallOrder(b.colliderId);
  if (aw[0] !== bw[0]) return aw[0] < bw[0] ? -1 : 1;
  if (aw[1] !== bw[1]) return aw[1] < bw[1] ? -1 : 1;
  return aw[2] < bw[2] ? -1 : aw[2] > bw[2] ? 1 : 0;
}

/** Evaluates all candidates before resolving time ties; array/hash iteration is irrelevant. */
export function findCollision(start: Vec2, end: Vec2, world: WorldGeometry, radius = PROJECTILE_RADIUS): Collision | null {
  const candidates: Collision[] = [];
  for (const wall of world.walls) {
    const time = sweepWall(start, end, wall, radius);
    if (time !== null) candidates.push({ time, reason: 'wall', colliderId: wall.id, victim: null });
  }
  for (const spawn of world.spawns) {
    const time = sweepCircle(start, end, spawn.position, PLAYER_RADIUS + radius);
    if (time !== null) candidates.push({ time, reason: 'hit', colliderId: spawn.id, victim: spawn.id });
  }
  if (!candidates.length) return null;
  const earliest = Math.min(...candidates.map(c => c.time));
  return candidates.filter(c => c.time <= earliest + TOI_EPS).sort(priority)[0];
}
