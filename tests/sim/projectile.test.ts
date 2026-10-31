import { describe, expect, it } from 'vitest';
import { FLIGHT_TICKS, MAX_SPEED, MAX_YAW_RATE } from '../../src/shared/config';
import type { ProjectileState } from '../../src/shared/types';
import { integrateProjectile, launchProjectile } from '../../src/sim';

const launch = (heading = 0) => launchProjectile({ id:'p1', position:{x:0,z:0}, heading }, 1);
const steps = (p:ProjectileState, n:number, mask:number) => { for(let i=0;i<n;i++) p=integrateProjectile(p,mask); return p; };

describe('specified rocket dynamics', () => {
  it('launches both opposite muzzles without movement or age', () => {
    const a=launchProjectile({id:'p1',position:{x:-12.5,z:-12.5},heading:Math.PI/2},3);
    const b=launchProjectile({id:'p2',position:{x:12.5,z:12.5},heading:-Math.PI/2},8);
    expect(a.position.x).toBe(-11.85); expect(a.position.z).toBe(-12.5);
    expect(b.position.x).toBe(11.85); expect(b.position.z).toBe(12.5);
    expect(a.velocity.x).toBe(5); expect(b.velocity.x).toBe(-5);
    expect(a.ageTicks).toBe(0); expect(a.angularVelocity).toBe(0);
    expect(a.shotId).toBe(3); expect(b.shotId).toBe(8);
  });
  it('matches analytic coast speed and geometric-series displacement after one second', () => {
    const p=steps(launch(),120,0), q=Math.exp(-0.18/120);
    expect(Math.hypot(p.velocity.x,p.velocity.z)).toBeCloseTo(5*Math.exp(-0.18),10);
    const displacement=5/120*q*(1-q**120)/(1-q);
    expect(p.position.z).toBeCloseTo(-0.65-displacement,9); expect(p.heading).toBe(0);
  });
  it('thrust accelerates to vector cap; reverse thrust takes time then reverses', () => {
    const first=integrateProjectile(launch(),4);
    expect(first.velocity.z).toBeLessThan(0); expect(first.velocity.z).toBeGreaterThan(-5);
    const reverse=steps(launch(),180,4); expect(reverse.velocity.z).toBeGreaterThan(0);
    const full=steps(launch(),240,1); expect(Math.hypot(full.velocity.x,full.velocity.z)).toBeCloseTo(MAX_SPEED,12);
  });
  it('yaw turns the nose while old velocity keeps direction; released spin decays', () => {
    const left=steps(launch(),60,2),right=steps(launch(),60,8);
    expect(left.heading).toBeLessThan(0);expect(right.heading).toBeGreaterThan(0);
    expect(left.heading).toBeCloseTo(-right.heading,12);
    expect(right.velocity.x).toBe(0);expect(right.velocity.z).toBeLessThan(0);
    expect(steps(right,60,0).angularVelocity).toBeLessThan(right.angularVelocity);
  });
  it('opposing controls cancel without erasing existing momentum or spin', () => {
    const spinning=steps(launch(),25,9);
    expect(steps(spinning,80,15)).toEqual(steps(spinning,80,0));
  });
  it('updates angular velocity before heading, and heading before thrust', () => {
    const p=integrateProjectile(launch(),9);
    expect(p.angularVelocity).toBeGreaterThan(0);expect(p.heading).toBeGreaterThan(0);
    expect(p.velocity.x).toBeGreaterThan(0); // old heading has zero X: proves updated heading drives thrust
    expect(p.velocity.z).toBeLessThan(-5);
  });
  it('remains finite, planar, wrapped and capped through long combined input', () => {
    const p=steps(launch(),FLIGHT_TICKS,9);
    expect(Object.hasOwn(p.position,'y')).toBe(false);
    expect(Math.hypot(p.velocity.x,p.velocity.z)).toBeLessThanOrEqual(MAX_SPEED+1e-12);
    expect(Math.abs(p.angularVelocity)).toBeLessThanOrEqual(MAX_YAW_RATE);
    expect(p.heading).toBeGreaterThanOrEqual(-Math.PI);expect(p.heading).toBeLessThan(Math.PI);
    expect([p.position.x,p.position.z,p.velocity.x,p.velocity.z,p.heading].every(Number.isFinite)).toBe(true);
  });
  it('rejects malformed controls and non-finite state', () => {
    for(const mask of [-1,16,1.2,NaN,Infinity]) expect(()=>integrateProjectile(launch(),mask)).toThrow(/mask/);
    expect(()=>integrateProjectile({...launch(),heading:NaN},0)).toThrow(/Non-finite/);
  });
});
