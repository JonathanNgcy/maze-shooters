import * as THREE from 'three';
import { PROJECTILE_RADIUS, PROJECTILE_Y, SIM_HZ, WALL_HEIGHT } from '../shared/config';
import { clamp, forward } from '../shared/math';
import type { MatchState, PlayerId, ProjectileState, ShotResult, Wall, WorldGeometry } from '../shared/types';

/** Cosmetic resources only. None of these objects participate in collision. */
export function createMissile() {
  const root = new THREE.Group(); root.name = 'missile';
  root.userData = { radiusEnvelope: PROJECTILE_RADIUS, length: PROJECTILE_RADIUS * 2, noseAxis: '-Z' };
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const r = PROJECTILE_RADIUS;
  function add(name: string, geometry: THREE.BufferGeometry, material: THREE.Material) {
    geometries.add(geometry); materials.add(material);
    const part = new THREE.Mesh(geometry, material); part.name = name; root.add(part); return part;
  }
  const shell = new THREE.MeshStandardMaterial({ color: 0xe6eadc, metalness: 0.45, roughness: 0.44 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263d45, metalness: 0.5, roughness: 0.5 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xdda34c, metalness: 0.25, roughness: 0.4 });
  const engineMaterial = new THREE.MeshStandardMaterial({ color: 0xffe9a3, emissive: 0xffa23c, emissiveIntensity: 2.4, roughness: 0.4 });
  const body = add('missile-body', new THREE.CylinderGeometry(r * .31, r * .31, r, 10), shell);
  body.rotation.x = Math.PI / 2; body.position.z = r * .12;
  const nose = add('missile-nose', new THREE.ConeGeometry(r * .31, r * .62, 10), noseMaterial);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -r * .69;
  const collar = add('missile-collar', new THREE.CylinderGeometry(r * .33, r * .33, r * .12, 10), dark);
  collar.rotation.x = Math.PI / 2; collar.position.z = r * .60;
  const engine = add('missile-engine', new THREE.CylinderGeometry(r * .18, r * .22, r * .19, 8), engineMaterial);
  engine.rotation.x = Math.PI / 2; engine.position.z = r * .79;
  const finGeometry = new THREE.BufferGeometry();
  finGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, r * .28, r * .11, 0, r * .70, r * .65, 0, r * .28, r * .70,
  ], 3));
  finGeometry.computeVertexNormals();
  const finMaterial = new THREE.MeshStandardMaterial({ color: 0x3c6570, metalness: .35, roughness: .55, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const fin = add(`missile-fin-${i}`, finGeometry, finMaterial); fin.rotation.z = i * Math.PI / 2;
  }
  root.visible = false;
  let disposed = false;
  return { root, dispose() {
    if (disposed) return;
    disposed = true; geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
  } };
}

const MARK_CAPACITY = 32;
const SMOKE_CAPACITY = 24;
const SMOKE_INTERVAL = 6;
const SMOKE_LIFE = Math.round(SIM_HZ * .48);
const PAINT_RADIUS = .31;
const PAINT_OFFSET = .004;
type Point = { u: number; v: number };
type Face = { axis: 'x' | 'z'; coordinate: number; normal: number; center: number; min: number; max: number };

function impactFace(wall: Wall, result: ShotResult): Face {
  const { x, z } = result.endpoint;
  const nearestX = clamp(x, wall.minX, wall.maxX), nearestZ = clamp(z, wall.minZ, wall.maxZ);
  const dx = x - nearestX, dz = z - nearestZ;
  if (Math.abs(dx) > 1e-9 || Math.abs(dz) > 1e-9) {
    if (Math.abs(dx) >= Math.abs(dz)) return { axis: 'x', coordinate: dx < 0 ? wall.minX : wall.maxX, normal: Math.sign(dx), center: nearestZ, min: wall.minZ, max: wall.maxZ };
    return { axis: 'z', coordinate: dz < 0 ? wall.minZ : wall.maxZ, normal: Math.sign(dz), center: nearestX, min: wall.minX, max: wall.maxX };
  }
  // Initial overlap is legal collision behavior; choose the nearest original face.
  const options: (Face & { distance: number })[] = [
    { axis: 'x', coordinate: wall.minX, normal: -1, center: nearestZ, min: wall.minZ, max: wall.maxZ, distance: Math.abs(x - wall.minX) },
    { axis: 'x', coordinate: wall.maxX, normal: 1, center: nearestZ, min: wall.minZ, max: wall.maxZ, distance: Math.abs(x - wall.maxX) },
    { axis: 'z', coordinate: wall.minZ, normal: -1, center: nearestX, min: wall.minX, max: wall.maxX, distance: Math.abs(z - wall.minZ) },
    { axis: 'z', coordinate: wall.maxZ, normal: 1, center: nearestX, min: wall.minX, max: wall.maxX, distance: Math.abs(z - wall.maxZ) },
  ];
  options.sort((a, b) => a.distance - b.distance);
  return options[0];
}

function clipPolygon(points: Point[], axis: 'u' | 'v', bound: number, keepAbove: boolean): Point[] {
  const output: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const aInside = keepAbove ? a[axis] >= bound : a[axis] <= bound;
    const bInside = keepAbove ? b[axis] >= bound : b[axis] <= bound;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      output.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return output;
}

/** Every vertex is clipped to the authoritative rectangle's selected face. */
function paintGeometry(wall: Wall, result: ShotResult): THREE.BufferGeometry {
  const face = impactFace(wall, result);
  let points: Point[] = Array.from({ length: 24 }, (_, i) => {
    const angle = i / 24 * Math.PI * 2;
    const radius = PAINT_RADIUS * (.78 + .16 * Math.sin(i * 2.4 + result.shotId * .7) + .06 * Math.cos(i * 4.1));
    return { u: face.center + Math.cos(angle) * radius, v: PROJECTILE_Y + Math.sin(angle) * radius };
  });
  points = clipPolygon(points, 'u', face.min, true);
  points = clipPolygon(points, 'u', face.max, false);
  points = clipPolygon(points, 'v', 0, true);
  points = clipPolygon(points, 'v', WALL_HEIGHT, false);
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const p of points) {
    if (face.axis === 'x') vertices.push(face.coordinate + face.normal * PAINT_OFFSET, p.v, p.u);
    else vertices.push(p.u, p.v, face.coordinate + face.normal * PAINT_OFFSET);
  }
  for (let i = 1; i + 1 < points.length; i++) indices.push(0, i, i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createFlightEffects(scene: THREE.Scene, world: WorldGeometry) {
  const marks = { p1: new THREE.Group(), p2: new THREE.Group() };
  for (const playerId of ['p1', 'p2'] as const) {
    marks[playerId].name = `impacts-${playerId}`;
    marks[playerId].userData = { playerId, capacity: MARK_CAPACITY, count: 0, privateToSeat: true };
    scene.add(marks[playerId]);
  }
  const paint = {
    p1: new THREE.MeshBasicMaterial({ color: 0x14bfd7, opacity: .80, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    p2: new THREE.MeshBasicMaterial({ color: 0xed9c24, opacity: .82, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  const smoke = new THREE.Group(); smoke.name = 'smoke-pool'; smoke.userData = { capacity: SMOKE_CAPACITY, activeCount: 0, clockTicks: 0, reducedMotion: false };
  scene.add(smoke);
  const smokeGeometry = new THREE.IcosahedronGeometry(1, 0);
  const puffs = Array.from({ length: SMOKE_CAPACITY }, (_, index) => {
    const material = new THREE.MeshBasicMaterial({ color: 0xcbd2c8, transparent: true, opacity: 0, depthTest: true, depthWrite: false });
    const mesh = new THREE.Mesh(smokeGeometry, material); mesh.name = `smoke-${index}`; mesh.visible = false;
    smoke.add(mesh);
    return { mesh, material, born: -SMOKE_LIFE, x: 0, y: PROJECTILE_Y, z: 0 };
  });
  let cursor = 0;
  let clock = 0;
  let lastShot = -1;
  let lastAge = -1;
  let matchId: string | null = null;
  let lastTick = 0;
  let lastPhase: MatchState['phase'] = 'handoff';
  let lastMarkedShot = -1;
  let disposed = false;
  const preference = typeof window === 'undefined' || !window.matchMedia ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = preference?.matches ?? false;
  const clearSmoke = () => {
    puffs.forEach((p) => { p.born = -SMOKE_LIFE; p.mesh.visible = false; });
    cursor = 0; smoke.userData.activeCount = 0;
  };
  const preferenceChanged = () => {
    reducedMotion = preference?.matches ?? false;
    smoke.userData.reducedMotion = reducedMotion;
    if (reducedMotion) clearSmoke();
  };
  preferenceChanged(); preference?.addEventListener('change', preferenceChanged);
  function clearMarks() {
    for (const group of Object.values(marks)) {
      for (const mark of [...group.children]) { (mark as THREE.Mesh).geometry.dispose(); group.remove(mark); }
      group.userData.count = 0;
    }
  }
  function renderSmoke() {
    let activeCount = 0;
    for (const p of puffs) {
      const age = clock - p.born;
      p.mesh.visible = !reducedMotion && age >= 0 && age < SMOKE_LIFE;
      if (!p.mesh.visible) continue;
      activeCount++;
      const t = age / SMOKE_LIFE;
      p.mesh.position.set(p.x, p.y + t * .10, p.z);
      p.mesh.scale.setScalar(.018 + t * .055);
      p.material.opacity = .24 * (1 - t) * (1 - t);
    }
    smoke.userData.activeCount = activeCount; smoke.userData.clockTicks = clock;
  }
  function emit(p: ProjectileState) {
    if (reducedMotion) return;
    const f = forward(p.heading);
    const puff = puffs[cursor]; cursor = (cursor + 1) % SMOKE_CAPACITY;
    puff.born = clock; puff.x = p.position.x - f.x * PROJECTILE_RADIUS;
    puff.z = p.position.z - f.z * PROJECTILE_RADIUS; puff.y = PROJECTILE_Y;
  }
  function observe(state: MatchState) {
    if (disposed) return;
    if (matchId !== state.matchId) {
      matchId = state.matchId; clearMarks(); clearSmoke(); lastMarkedShot = -1;
      lastShot = -1; lastAge = -1; clock = 0; lastPhase = 'handoff'; lastTick = state.tick;
    }
    for (const id of ['p1', 'p2'] as const) marks[id].visible = state.activePlayer === id;
    const result = state.result;
    if (result?.reason === 'wall' && result.shotId > lastMarkedShot) {
      // IDs are monotonic within a match; one integer deduplicates without an unbounded seen set.
      lastMarkedShot = result.shotId;
      const wall = world.walls.find((w) => w.id === result.colliderId);
      if (wall) {
        const group = marks[result.shooter];
        if (group.children.length === MARK_CAPACITY) {
          const oldest = group.children[0] as THREE.Mesh; oldest.geometry.dispose(); group.remove(oldest);
        }
        const mark = new THREE.Mesh(paintGeometry(wall, result), paint[result.shooter]);
        mark.name = `impact-${result.shooter}-${result.shotId}`;
        mark.userData = { matchId, shotId: result.shotId, playerId: result.shooter, colliderId: result.colliderId };
        group.add(mark); group.userData.count = group.children.length;
      }
    }
    const p = state.projectile;
    if (state.phase === 'flight' && p) {
      if (lastShot !== p.shotId) { clearSmoke(); lastShot = p.shotId; lastAge = -1; clock = p.ageTicks; }
      if (p.ageTicks !== lastAge) {
        clock = p.ageTicks;
        if (p.ageTicks % SMOKE_INTERVAL === 0) emit(p);
        lastAge = p.ageTicks;
      }
    } else if (state.phase === 'resolve' && lastPhase === 'flight') {
      clock += Math.max(0, state.tick - lastTick);
    } else if (state.phase === 'handoff' || state.phase === 'ready') {
      clearSmoke();
    }
    lastPhase = state.phase; lastTick = state.tick;
    renderSmoke();
  }
  return {
    observe,
    dispose() {
      if (disposed) return;
      disposed = true; preference?.removeEventListener('change', preferenceChanged);
      clearMarks(); paint.p1.dispose(); paint.p2.dispose();
      smokeGeometry.dispose(); puffs.forEach((p) => p.material.dispose());
      scene.remove(marks.p1, marks.p2, smoke);
    },
  };
}

export type RealtimeEffectsView = Readonly<{
  matchId: string;
  seat: PlayerId;
  tick: number;
  projectiles: readonly ProjectileState[];
  phases: Readonly<Record<PlayerId, 'ready' | 'flight' | 'resolve'>>;
  history: readonly ShotResult[];
}>;

/** Two bounded cosmetic trails plus only this seat's server-supplied impact history. */
export function createRealtimeEffects(scene: THREE.Scene, world: WorldGeometry) {
  const impactRoot = new THREE.Group(); impactRoot.name = 'online-impacts'; scene.add(impactRoot);
  const paint = new THREE.MeshBasicMaterial({ color: 0x14bfd7, opacity: .8, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
  const smokeGeometry = new THREE.IcosahedronGeometry(1, 0);
  const makePool = (seat: PlayerId) => {
    const group = new THREE.Group(); group.name = `online-smoke-${seat}`; group.userData = { capacity: SMOKE_CAPACITY, activeCount: 0 };
    scene.add(group);
    const puffs = Array.from({ length: SMOKE_CAPACITY }, (_, index) => {
      const material = new THREE.MeshBasicMaterial({ color: 0xcbd2c8, transparent: true, opacity: 0, depthTest: true, depthWrite: false });
      const mesh = new THREE.Mesh(smokeGeometry, material); mesh.visible = false; mesh.name = `online-smoke-${seat}-${index}`; group.add(mesh);
      return { mesh, material, born: -SMOKE_LIFE, position: new THREE.Vector3() };
    });
    return { group, puffs, clock: 0, cursor: 0, shotId: -1, age: -1 };
  };
  const pools = { p1: makePool('p1'), p2: makePool('p2') };
  let matchId: string | null = null, historyKey = '';
  let disposed = false;
  const preference = typeof window === 'undefined' || !window.matchMedia ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = preference?.matches ?? false;
  function clearPool(pool: typeof pools.p1) {
    pool.puffs.forEach((p) => { p.born = -SMOKE_LIFE; p.mesh.visible = false; });
    pool.clock = 0; pool.cursor = 0; pool.shotId = -1; pool.age = -1; pool.group.userData.activeCount = 0;
  }
  const preferenceChanged = () => { reduced = preference?.matches ?? false; if (reduced) Object.values(pools).forEach(clearPool); };
  preference?.addEventListener('change', preferenceChanged);
  function clearImpacts() { for (const mark of [...impactRoot.children]) { (mark as THREE.Mesh).geometry.dispose(); impactRoot.remove(mark); } }
  return {
    observe(view: RealtimeEffectsView) {
      if (disposed) return;
      if (matchId !== view.matchId) {
        matchId = view.matchId; historyKey = ''; clearImpacts(); Object.values(pools).forEach(clearPool);
      }
      const ownHistory = view.history.filter((r) => r.shooter === view.seat && r.reason === 'wall').slice(-MARK_CAPACITY);
      const nextHistory = `${view.seat}/${ownHistory.map((r) => `${r.shotId}:${r.colliderId}`).join(',')}`;
      if (nextHistory !== historyKey) {
        historyKey = nextHistory; clearImpacts(); paint.color.setHex(view.seat === 'p1' ? 0x14bfd7 : 0xed9c24);
        impactRoot.name = `online-impacts-${view.seat}`; impactRoot.userData = { playerId: view.seat, privateToSeat: true, capacity: MARK_CAPACITY };
        for (const result of ownHistory) {
          const wall = world.walls.find((w) => w.id === result.colliderId);
          if (!wall) continue;
          const mark = new THREE.Mesh(paintGeometry(wall, result), paint);
          mark.name = `online-impact-${view.seat}-${result.shotId}`;
          mark.userData = { shotId: result.shotId, colliderId: result.colliderId, playerId: view.seat };
          impactRoot.add(mark);
        }
      }
      for (const seat of ['p1', 'p2'] as const) {
        const pool = pools[seat], p = view.projectiles.find((sample) => sample.owner === seat);
        if (view.phases[seat] === 'ready') clearPool(pool);
        if (p && (p.ageTicks !== pool.age || p.shotId !== pool.shotId)) {
          if (p.shotId !== pool.shotId) { clearPool(pool); pool.shotId = p.shotId; }
          pool.clock = p.ageTicks;
          if (!reduced && (pool.age < 0 || Math.floor(p.ageTicks / SMOKE_INTERVAL) > Math.floor(pool.age / SMOKE_INTERVAL))) {
            const f = forward(p.heading), puff = pool.puffs[pool.cursor]; pool.cursor = (pool.cursor + 1) % SMOKE_CAPACITY;
            puff.born = pool.clock; puff.position.set(p.position.x - f.x * PROJECTILE_RADIUS, PROJECTILE_Y, p.position.z - f.z * PROJECTILE_RADIUS);
          }
          pool.age = p.ageTicks;
        }
        let count = 0;
        for (const puff of pool.puffs) {
          const age = pool.clock - puff.born;
          puff.mesh.visible = !reduced && age >= 0 && age < SMOKE_LIFE;
          if (!puff.mesh.visible) continue;
          count++; const t = age / SMOKE_LIFE;
          puff.mesh.position.copy(puff.position); puff.mesh.position.y += .1 * t;
          puff.mesh.scale.setScalar(.018 + t * .055); puff.material.opacity = .24 * (1 - t) ** 2;
        }
        pool.group.userData.activeCount = count; pool.group.userData.clockTicks = pool.clock;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      preference?.removeEventListener('change', preferenceChanged); clearImpacts(); paint.dispose(); smokeGeometry.dispose();
      for (const pool of Object.values(pools)) { pool.puffs.forEach((p) => p.material.dispose()); scene.remove(pool.group); }
      scene.remove(impactRoot);
    },
  };
}
