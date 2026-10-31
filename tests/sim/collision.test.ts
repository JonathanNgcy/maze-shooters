import { describe,expect,it } from 'vitest';
import { CONTACT_EPS, PLAYER_RADIUS, PROJECTILE_RADIUS, TOI_EPS } from '../../src/shared/config';
import type { Wall, WorldGeometry } from '../../src/shared/types';
import { findCollision, sweepCircle, sweepWall } from '../../src/sim';
const wall:Wall={id:'wall:2:3',minX:0,maxX:2,minZ:0,maxZ:2};
const world=(walls:readonly Wall[]=[],spawns:WorldGeometry['spawns']=[]):WorldGeometry=>({mapId:'test',mapVersion:1,walls,spawns});

describe('continuous circles',()=>{
  it('finds analytic near root, endpoint, tangent, initial and stationary contacts',()=>{
    expect(sweepCircle({x:-3,z:0},{x:3,z:0},{x:0,z:0},1)).toBeCloseTo(1/3,12);
    expect(sweepCircle({x:-3,z:0},{x:-1,z:0},{x:0,z:0},1)).toBe(1);
    expect(sweepCircle({x:-3,z:1},{x:3,z:1},{x:0,z:0},1)).toBe(0.5);
    expect(sweepCircle({x:0,z:0},{x:3,z:0},{x:0,z:0},1)).toBe(0);
    expect(sweepCircle({x:1,z:0},{x:1,z:0},{x:0,z:0},1)).toBe(0);
    expect(sweepCircle({x:2,z:0},{x:2,z:0},{x:0,z:0},1)).toBeNull();
  });
  it('distinguishes both sides of a tangent and tolerates only microscopic initial contact',()=>{
    expect(sweepCircle({x:-3,z:1-1e-6},{x:3,z:1-1e-6},{x:0,z:0},1)).not.toBeNull();
    expect(sweepCircle({x:-3,z:1+1e-6},{x:3,z:1+1e-6},{x:0,z:0},1)).toBeNull();
    expect(sweepCircle({x:1+CONTACT_EPS/2,z:0},{x:2,z:0},{x:0,z:0},1)).toBe(0);
    expect(sweepCircle({x:1+CONTACT_EPS*2,z:0},{x:2,z:0},{x:0,z:0},1)).toBeNull();
    expect(sweepCircle({x:-1e-9,z:1+1e-6},{x:1e-9,z:1+1e-6},{x:0,z:0},1)).toBeNull();
  });
});
describe('exact rounded wall sweep',()=>{
  it('finds near faces across a long segment even when neither endpoint overlaps',()=>{
    expect(sweepWall({x:-100,z:1},{x:100,z:1},wall,0.12)).toBeCloseTo(99.88/200,12);
    expect(sweepWall({x:1,z:-3},{x:1,z:3},wall,0.12)).toBeCloseTo(2.88/6,12);
    expect(sweepWall({x:3,z:1},{x:-3,z:1},wall,0.12)).toBeCloseTo(0.88/6,12);
    expect(sweepWall({x:1,z:3},{x:1,z:-3},wall,0.12)).toBeCloseTo(0.88/6,12);
  });
  it('rejects the expanded-AABB square corner; detects true arc tangent',()=>{
    expect(sweepWall({x:-0.11,z:-0.11},{x:-0.11,z:-0.11},wall,0.12)).toBeNull();
    const r=0.12, a=r/Math.sqrt(2), d=0.04;
    const start={x:-a-d,z:-a+d},end={x:-a+d,z:-a-d};
    expect(sweepWall(start,end,wall,r)).toBeCloseTo(0.5,7);
    expect(sweepWall({x:start.x-1e-5,z:start.z-1e-5},{x:end.x-1e-5,z:end.z-1e-5},wall,r)).toBeNull();
    expect(sweepWall({x:start.x+1e-5,z:start.z+1e-5},{x:end.x+1e-5,z:end.z+1e-5},wall,r)).not.toBeNull();
  });
  it('handles overlap, zero-length and closed face endpoints',()=>{
    expect(sweepWall({x:1,z:1},{x:1,z:1},wall,0.12)).toBe(0);
    expect(sweepWall({x:-1,z:1},{x:-1,z:1},wall,0.12)).toBeNull();
    expect(sweepWall({x:-1,z:1},{x:-0.12,z:1},wall,0.12)).toBe(1);
  });
});
describe('authoritative earliest contact and tie order',()=>{
  it('wall blocks a target behind it',()=>{
    const w=world([wall],[{id:'p2',position:{x:1,z:1},heading:0}]);
    const c=findCollision({x:-3,z:1},{x:3,z:1},w);
    expect(c?.reason).toBe('wall');expect(c?.colliderId).toBe(wall.id);
  });
  it('ties choose wall, numeric row-major wall ID, then player ID irrespective of array order',()=>{
    const r=PLAYER_RADIUS+PROJECTILE_RADIUS;
    const a={...wall,id:'wall:10:1'},b={...wall,id:'wall:2:10'},c={...wall,id:'wall:2:2'};
    const targets:WorldGeometry['spawns']=[{id:'p2',position:{x:r-PROJECTILE_RADIUS,z:1},heading:0},{id:'p1',position:{x:r-PROJECTILE_RADIUS,z:1},heading:0}];
    expect(findCollision({x:-1,z:1},{x:1,z:1},world([a,b,c],targets))?.colliderId).toBe('wall:2:2');
    expect(findCollision({x:-1,z:1},{x:1,z:1},world([],targets))?.victim).toBe('p1');
  });
  it('selects the true earlier contact outside TOI_EPS and priority inside the tie window',()=>{
    const delta=TOI_EPS*2;
    const late={...wall,id:'wall:0:0',minX:delta,maxX:2+delta};
    const early={...wall,id:'wall:10:10'};
    expect(findCollision({x:-1,z:1},{x:0,z:1},world([late,early]))?.colliderId).toBe(early.id);
    const tied={...late,minX:TOI_EPS/2};
    expect(findCollision({x:-1,z:1},{x:0,z:1},world([early,tied]))?.colliderId).toBe(late.id);
  });
});
