import { describe,it,expect } from 'vitest';
import {LocalSession,tickMatch} from '../../src/local/session';
import {buildWorld} from '../../src/maze/build';
import {DT} from '../../src/shared/config';
import type {MatchCommand,WorldGeometry} from '../../src/shared/types';
const arena:WorldGeometry={mapId:'arena',mapVersion:1,walls:[],spawns:[{id:'p1',position:{x:0,z:0},heading:Math.PI/2},{id:'p2',position:{x:100,z:100},heading:-Math.PI/2}]};
const launch=()=>{const s=new LocalSession(arena);s.command('ready');s.step();s.command('fire');s.step();return s;};
describe('local tick authority',()=>{
 it('accepts at most one phase command, drops extras and launches at age zero',()=>{
  const s=new LocalSession(buildWorld());s.command('ready');s.command('fire');s.step();expect(s.current.phase).toBe('ready');expect(s.current.tick).toBe(1);
  s.step();expect(s.current.phase).toBe('ready');s.command('fire');s.step();expect(s.current.projectile?.ageTicks).toBe(0);expect(s.current.tick).toBe(3);
  const old=s.current;s.step();expect(s.current.projectile?.ageTicks).toBe(1);expect(old.projectile?.ageTicks).toBe(0);expect(Object.isFrozen(old)).toBe(true);
 });
 it('stale/invalid commands never stall physics',()=>{
  const s=launch();const bad:MatchCommand={type:'fire',matchId:'old',turnId:1,playerId:'p2'};
  const next=tickMatch(s.current,arena,[bad],0);expect(next.projectile?.ageTicks).toBe(1);expect(next.tick).toBe(s.current.tick+1);
 });
 it('pause freezes flight/result; resume clears old input and clock backlog',()=>{
  const s=launch();s.setControls(1);s.step();s.pause('window lost focus');const frozen=s.current;s.frame(100);s.frame(200000);s.command('fire');s.step();expect(s.current).toBe(frozen);
  s.resume();s.frame(999999);expect(s.current).toBe(frozen);s.frame(999999+DT*1000);expect(s.current.projectile?.ageTicks).toBe(frozen.projectile!.ageTicks+1);expect(s.current.projectile!.velocity.x).toBeLessThan(frozen.projectile!.velocity.x);
 });
 it('caps a stalled frame at twelve steps, retaining no whole backlog',()=>{
  const s=launch();s.frame(0);s.frame(10000);expect(s.current.projectile?.ageTicks).toBe(12);expect(s.alpha).toBeLessThan(1);expect(s.droppedFrames).toBe(1);
 });
 it('equal simulated time at 30/60/144 Hz yields equal flight state',()=>{
  const states=[30,60,144].map(hz=>{const s=launch();s.frame(0);for(let i=1;i<=hz*2;i++)s.frame(i*1000/hz);return s.current;});
  expect(states[0]).toEqual(states[1]);expect(states[0]).toEqual(states[2]);expect(states[0].projectile?.ageTicks).toBe(240);
 });
 it('rejects corrupt masks at boundary',()=>{const s=launch();expect(()=>s.setControls(NaN)).toThrow();expect(()=>tickMatch(s.current,arena,[],16)).toThrow();});
});
