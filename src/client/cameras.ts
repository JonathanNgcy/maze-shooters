import { PerspectiveCamera, Vector3 } from 'three';
import type { MatchState, PlayerId, ProjectileState, WorldGeometry } from '../shared/types';
import { forward, lerp, lerpAngle } from '../shared/math';
import {
  CAMERA_ARM, CAMERA_FAR, CAMERA_FOV, CAMERA_HEIGHT, CAMERA_LOOK_AHEAD,
  CAMERA_MARGIN, CAMERA_MIN_ARM, CAMERA_NEAR, CAMERA_RADIUS, PROJECTILE_Y, READY_EYE_Y,
} from '../shared/config';
import { sweepWall } from '../sim/collision';

export function renderProjectile(current: MatchState, previous: MatchState, alpha: number): ProjectileState | null {
  const p = current.projectile;
  const old = previous.projectile;
  if (!p || !old || current.phase !== previous.phase || current.matchId !== previous.matchId || p.shotId !== old.shotId) return p;
  return { ...p, position: { x: lerp(old.position.x, p.position.x, alpha), z: lerp(old.position.z, p.position.z, alpha) }, heading: lerpAngle(old.heading, p.heading, alpha) };
}

export function createCameras(world: WorldGeometry) {
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.up.set(0, 1, 0);
  const look = new Vector3();
  let fallback = false;
  const readySeat = (seat: PlayerId) => {
    const spawn = world.spawns.find((p) => p.id === seat)!;
    const f = forward(spawn.heading);
    camera.position.set(spawn.position.x, READY_EYE_Y, spawn.position.z);
    camera.lookAt(look.set(spawn.position.x + 4 * f.x, PROJECTILE_Y, spawn.position.z + 4 * f.z));
    fallback = false;
  };
  return {
    camera,
    readySeat,
    get noseView() { return fallback; },
    ready(state: MatchState) { readySeat(state.activePlayer); },
    flight(p: ProjectileState) {
      const f = forward(p.heading);
      const desired = { x: p.position.x - CAMERA_ARM * f.x, z: p.position.z - CAMERA_ARM * f.z };
      let fraction = 1;
      for (const wall of world.walls) {
        const contact = sweepWall(p.position, desired, wall, CAMERA_RADIUS);
        if (contact !== null) fraction = Math.min(fraction, contact);
      }
      // The whole arm is between y=1 and 1.28, within the declared wall height.
      const armLength = Math.hypot(CAMERA_ARM, CAMERA_HEIGHT);
      const safeLength = Math.max(0, fraction * armLength - (fraction < 1 ? CAMERA_MARGIN : 0));
      fallback = safeLength < CAMERA_MIN_ARM;
      const t = fallback ? 0 : safeLength / armLength;
      camera.position.set(p.position.x - CAMERA_ARM * f.x * t, PROJECTILE_Y + (fallback ? 0.10 : CAMERA_HEIGHT * t), p.position.z - CAMERA_ARM * f.z * t);
      camera.lookAt(look.set(p.position.x + CAMERA_LOOK_AHEAD * f.x, PROJECTILE_Y, p.position.z + CAMERA_LOOK_AHEAD * f.z));
    },
    resize(width: number, height: number) { camera.aspect = width / height; camera.updateProjectionMatrix(); },
  };
}
