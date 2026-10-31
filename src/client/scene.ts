import * as THREE from 'three';
import type { MatchState, PlayerId, ProjectileState, WorldGeometry } from '../shared/types';
import { createFlightEffects, createMissile, createRealtimeEffects, type RealtimeEffectsView } from './effects';
import { GRID_SIZE, MUZZLE_OFFSET, PLAYER_HEIGHT, PLAYER_RADIUS, PROJECTILE_RADIUS, PROJECTILE_Y, WALL_HEIGHT, WORLD_EXTENT, TILE_SIZE } from '../shared/config';

export type OnlineSceneView = RealtimeEffectsView & Readonly<{
  stationary: boolean;
  hideOwnProjectile: boolean;
  results: readonly import('../shared/types').ShotResult[];
}>;

export function createScene(canvas: HTMLCanvasElement, world: WorldGeometry) {
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!context) throw new Error('WebGL 2 is unavailable. Use a desktop browser with hardware graphics enabled, then reload.');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x253943);
  scene.fog = new THREE.Fog(0x253943, 12, 44);
  scene.add(new THREE.HemisphereLight(0xdaeef3, 0x36414a, 2.3));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
  sun.position.set(-6, 14, -5);
  scene.add(sun);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = scene) {
    geometries.add(geometry); materials.add(material);
    const object = new THREE.Mesh(geometry, material); parent.add(object); return object;
  }
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xc1cac4, roughness: 0.92, metalness: 0.02 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x647b7e, roughness: 0.8 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x354b51, roughness: 0.95 });
  const floor = mesh(new THREE.BoxGeometry(WORLD_EXTENT * 2, 0.10, WORLD_EXTENT * 2), floorMaterial);
  floor.position.y = -0.05;
  const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const wall of world.walls) {
    const width = wall.maxX - wall.minX, depth = wall.maxZ - wall.minZ;
    const x = (wall.maxX + wall.minX) / 2, z = (wall.maxZ + wall.minZ) / 2;
    const wallMesh = mesh(wallGeometry, wallMaterial);
    wallMesh.position.set(x, WALL_HEIGHT / 2, z); wallMesh.scale.set(width, WALL_HEIGHT, depth);
    // Neutral construction bands are part of the opaque wall's visual surface.
    const trim = mesh(wallGeometry, trimMaterial);
    trim.position.set(x, 0.13, z); trim.scale.set(width + 0.001, 0.17, depth + 0.001);
    const top = mesh(wallGeometry, trimMaterial);
    top.position.set(x, WALL_HEIGHT - 0.09, z); top.scale.set(width + 0.001, 0.10, depth + 0.001);
  }
  const grid = new THREE.GridHelper(WORLD_EXTENT * 2, GRID_SIZE * 2, 0x5f7477, 0x486065);
  grid.position.y = 0.002;
  scene.add(grid); geometries.add(grid.geometry);
  if (Array.isArray(grid.material)) grid.material.forEach((m) => materials.add(m)); else materials.add(grid.material);

  // Local region seams supply memory cues without indicating a route or target.
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0x7e8d89, roughness: 1 });
  for (let z = -WORLD_EXTENT + TILE_SIZE; z < WORLD_EXTENT; z += TILE_SIZE * 4) {
    const stripe = mesh(new THREE.BoxGeometry(WORLD_EXTENT * 2, 0.003, 0.035), stripeMaterial);
    stripe.position.set(0, 0.004, z);
  }

  const bodies = new Map<PlayerId, THREE.Group>();
  const bodyColors: Record<PlayerId, number> = { p1: 0x39d7ec, p2: 0xf6b34c };
  const dark = new THREE.MeshStandardMaterial({ color: 0x21333b, metalness: 0.3, roughness: 0.55 });
  for (const spawn of world.spawns) {
    const body = new THREE.Group();
    body.position.set(spawn.position.x, 0, spawn.position.z); body.rotation.y = -spawn.heading;
    scene.add(body); bodies.set(spawn.id, body);
    const colored = new THREE.MeshStandardMaterial({ color: bodyColors[spawn.id], roughness: 0.6, metalness: 0.12 });
    // The marked cylinder exactly matches the target collider footprint and height.
    const target = mesh(new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 20), colored, body);
    target.position.y = PLAYER_HEIGHT / 2;
    const band = mesh(new THREE.CylinderGeometry(PLAYER_RADIUS + 0.001, PLAYER_RADIUS + 0.001, 0.13, 20), dark, body);
    band.position.y = 1.44;
    const base = mesh(new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, 0.09, 20), dark, body);
    base.position.y = 0.045;
    const gunRoot = new THREE.Group();
    gunRoot.position.set(spawn.position.x, PROJECTILE_Y, spawn.position.z); gunRoot.rotation.y = -spawn.heading;
    scene.add(gunRoot);
    const barrel = mesh(new THREE.CylinderGeometry(0.065, 0.08, MUZZLE_OFFSET, 12), dark, gunRoot);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = -MUZZLE_OFFSET / 2;
    const ring = mesh(new THREE.TorusGeometry(0.065, 0.018, 6, 16), colored, gunRoot);
    ring.position.z = -MUZZLE_OFFSET;
  }
  const missile = createMissile();
  const projectile = missile.root;
  scene.add(projectile);
  const effects = createFlightEffects(scene, world);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf8dba1, wireframe: true });
  const marker = mesh(new THREE.SphereGeometry(PROJECTILE_RADIUS * 1.5, 12, 8), markerMaterial);
  marker.visible = false;
  let onlineEffects: ReturnType<typeof createRealtimeEffects> | null = null;
  let otherMissile: ReturnType<typeof createMissile> | null = null;
  const ensureOnline = () => {
    if (!onlineEffects) {
      effects.dispose(); onlineEffects = createRealtimeEffects(scene, world);
      otherMissile = createMissile(); otherMissile.root.name = 'online-missile-other'; scene.add(otherMissile.root);
      projectile.name = 'online-missile-own';
    }
    return onlineEffects;
  };
  return {
    renderer, scene,
    prepareOnline(camera: THREE.Camera) { ensureOnline(); renderer.compile(scene, camera); },
    observe: effects.observe,
    observeOnline(view: RealtimeEffectsView) { ensureOnline().observe(view); },
    updateOnline(view: OnlineSceneView) {
      ensureOnline().observe(view);
      for (const [id, body] of bodies) body.visible = !view.stationary || id !== view.seat;
      const own = view.projectiles.find((p) => p.owner === view.seat);
      const other = view.projectiles.find((p) => p.owner !== view.seat);
      projectile.visible = !!own && !view.hideOwnProjectile;
      otherMissile!.root.visible = !!other;
      for (const [object, sample] of [[projectile, own], [otherMissile!.root, other]] as const) {
        if (!sample) continue;
        object.position.set(sample.position.x, PROJECTILE_Y, sample.position.z); object.rotation.y = -sample.heading;
        object.userData.owner = sample.owner; object.userData.shotId = sample.shotId;
      }
      const result = view.results.find((r) => r.shooter === view.seat && r.reason !== 'wall');
      marker.visible = !!result;
      if (result) marker.position.set(result.endpoint.x, PROJECTILE_Y, result.endpoint.z);
    },
    update(state: MatchState, sample: ProjectileState | null, noseView: boolean) {
      effects.observe(state);
      for (const [id, body] of bodies) body.visible = state.phase !== 'ready' || id !== state.activePlayer;
      projectile.visible = sample !== null && !noseView;
      if (sample) {
        projectile.position.set(sample.position.x, PROJECTILE_Y, sample.position.z);
        projectile.rotation.y = -sample.heading;
      }
      // The persistent wall splash is the wall-impact cue; keep it unobscured.
      marker.visible = state.result !== null && state.result.reason !== 'wall';
      if (state.result) marker.position.set(state.result.endpoint.x, PROJECTILE_Y, state.result.endpoint.z);
    },
    resize(width: number, height: number) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false); },
    dispose() { onlineEffects?.dispose(); otherMissile?.dispose(); effects.dispose(); missile.dispose(); geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); renderer.dispose(); },
  };
}
