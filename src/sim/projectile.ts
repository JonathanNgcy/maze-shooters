import { ANGULAR_DRAG, DT, FORWARD_ACCEL, KEY, LAUNCH_SPEED, LINEAR_DRAG, MAX_SPEED, MAX_YAW_RATE, MUZZLE_OFFSET, REVERSE_ACCEL, YAW_ACCEL } from '../shared/config';
import { clamp, forward, validMask, wrapAngle } from '../shared/math';
import type { KeyMask, PlayerSpawn, ProjectileState } from '../shared/types';

export function launchProjectile(spawn: PlayerSpawn, shotId: number): ProjectileState {
  const f = forward(spawn.heading);
  return {
    shotId, owner: spawn.id,
    position: { x: spawn.position.x + f.x * MUZZLE_OFFSET, z: spawn.position.z + f.z * MUZZLE_OFFSET },
    velocity: { x: f.x * LAUNCH_SPEED, z: f.z * LAUNCH_SPEED },
    heading: spawn.heading, angularVelocity: 0, ageTicks: 0,
  };
}

/** One dynamics step, independent of contacts and match state. Never mutates its sample. */
export function integrateProjectile(p: ProjectileState, mask: KeyMask): ProjectileState {
  if (!validMask(mask)) throw new Error('Invalid control mask: expected integer 0..15');
  const values = [p.position.x, p.position.z, p.velocity.x, p.velocity.z, p.heading, p.angularVelocity];
  if (!values.every(Number.isFinite)) throw new Error('Non-finite projectile state');
  const yaw = Number(Boolean(mask & KEY.D)) - Number(Boolean(mask & KEY.A));
  const w = Boolean(mask & KEY.W), s = Boolean(mask & KEY.S);
  const thrust = w === s ? 0 : w ? FORWARD_ACCEL : -REVERSE_ACCEL;
  const angularVelocity = clamp((p.angularVelocity + yaw * YAW_ACCEL * DT) * Math.exp(-ANGULAR_DRAG * DT), -MAX_YAW_RATE, MAX_YAW_RATE);
  const heading = wrapAngle(p.heading + angularVelocity * DT);
  const f = forward(heading), damping = Math.exp(-LINEAR_DRAG * DT);
  let vx = (p.velocity.x + f.x * thrust * DT) * damping;
  let vz = (p.velocity.z + f.z * thrust * DT) * damping;
  const speed = Math.hypot(vx, vz);
  if (speed > MAX_SPEED) { vx *= MAX_SPEED / speed; vz *= MAX_SPEED / speed; }
  const next = {
    ...p, angularVelocity, heading, velocity: { x: vx, z: vz },
    position: { x: p.position.x + vx * DT, z: p.position.z + vz * DT }, ageTicks: p.ageTicks + 1,
  };
  if (![next.position.x, next.position.z, vx, vz].every(Number.isFinite)) throw new Error('Non-finite integrated projectile');
  return next;
}
