import { describe,expect,it } from 'vitest';
import { FLIGHT_TICKS, PLAYER_RADIUS, PROJECTILE_RADIUS, RESOLVE_TICKS } from '../../src/shared/config';
import type { MatchState, WorldGeometry } from '../../src/shared/types';
import { applyCommand, createMatch, createRematch, integrateProjectile, stepMatch } from '../../src/sim';
const arena:WorldGeometry={mapId:'test',mapVersion:1,walls:[],spawns:[{id:'p1',position:{x:0,z:0},heading:Math.PI/2},{id:'p2',position:{x:100,z:100},heading:-Math.PI/2}]};
const initial=(world=arena)=>createMatch(world,{matchId:'m1',matchNumber:1,opener:'p1'});
const command=(s:MatchState,type:'ready'|'fire',world=arena)=>applyCommand(s,world,{type,playerId:s.activePlayer,matchId:s.matchId,turnId:s.turnId});
const flight=(world=arena)=>command(command(initial(world),'ready',world).state,'fire',world).state;
const stepN=(s:MatchState,n:number,world=arena,mask=0)=>{for(let i=0;i<n;i++)s=stepMatch(s,world,mask);return s;};

describe('match authority',()=>{
  it('acceptance launches once at age zero without incrementing time',()=>{
    const start=initial();expect(start.phase).toBe('handoff');
    const ready=command(start,'ready');expect(ready.accepted).toBe(true);expect(ready.state.tick).toBe(0);
    const fire=command(ready.state,'fire');expect(fire.accepted).toBe(true);expect(fire.state.phase).toBe('flight');
    expect(fire.state.tick).toBe(0);expect(fire.state.projectile?.ageTicks).toBe(0);expect(fire.state.projectile?.position.x).toBe(0.65);
    expect(fire.state.nextShotId).toBe(2);
    expect(command(fire.state,'fire')).toEqual({state:fire.state,accepted:false});
    const moved=stepMatch(fire.state,arena,0);expect(moved.tick).toBe(1);expect(moved.projectile?.ageTicks).toBe(1);expect(moved.projectile!.position.x).toBeGreaterThan(0.65);
  });
  it('rejects wrong seat, phase, match, turn, unknown action without altering snapshots',()=>{
    const s=initial(),base={type:'ready' as const,matchId:s.matchId,turnId:1,playerId:'p1' as const};
    for(const changed of [{playerId:'p2'},{matchId:'old'},{turnId:2},{type:'fire'},{type:'nonsense'}]) {
      const result=applyCommand(s,arena,{...base,...changed} as Parameters<typeof applyCommand>[2]);
      expect(result.accepted).toBe(false);expect(result.state).toBe(s);
    }
  });
  it('ticks handoff/ready without gameplay timers, gameOver is unchanged',()=>{
    expect(stepN(initial(),500).phase).toBe('handoff');
    expect(stepN(command(initial(),'ready').state,500).phase).toBe('ready');
    const hitWorld={...arena,spawns:[arena.spawns[0],{...arena.spawns[1],position:{x:2,z:0}}]};
    let s=flight(hitWorld);while(s.phase==='flight')s=stepMatch(s,hitWorld,0);
    s=stepN(s,90,hitWorld);expect(s.phase).toBe('gameOver');expect(stepMatch(s,hitWorld,0)).toBe(s);
  });
  it('freezes a wall miss for exactly 90 following ticks then passes once',()=>{
    const w={...arena,walls:[{id:'wall:1:1',minX:1,maxX:2,minZ:-2,maxZ:2}]};
    let s=flight(w);while(s.phase==='flight')s=stepMatch(s,w,0);
    expect(s.phase).toBe('resolve');expect(s.result?.reason).toBe('wall');expect(s.projectile).toBeNull();expect(s.resolveTicksRemaining).toBe(90);
    const endpoint=s.result?.endpoint;
    const almost=stepN(s,89,w,15);expect(almost.phase).toBe('resolve');expect(almost.resolveTicksRemaining).toBe(1);expect(almost.result?.endpoint).toBe(endpoint);
    const next=stepMatch(almost,w,15);expect(next.phase).toBe('handoff');expect(next.activePlayer).toBe('p2');expect(next.turnId).toBe(2);expect(next.result).toBeNull();
    expect(stepMatch(next,w,0).turnId).toBe(2);
  });
  it('ends at step 2160 exactly and never runs step 2161',()=>{
    const fresh=flight(),almost=stepN(fresh,FLIGHT_TICKS-1);
    expect(almost.phase).toBe('flight');expect(almost.projectile?.ageTicks).toBe(2159);
    const end=stepMatch(almost,arena,0);expect(end.phase).toBe('resolve');expect(end.result?.reason).toBe('timeout');expect(end.resolveTicksRemaining).toBe(RESOLVE_TICKS);
    const again=stepMatch(end,arena,1);expect(again.result).toBe(end.result);expect(again.projectile).toBeNull();
  });
  it('inclusive final-step player contact takes priority over expiry',()=>{
    const old=flight().projectile!;
    const p={...old,ageTicks:FLIGHT_TICKS-1,position:{x:4,z:0},velocity:{x:5,z:0}};
    const integrated=integrateProjectile(p,0),r=PLAYER_RADIUS+PROJECTILE_RADIUS;
    const w={...arena,spawns:[arena.spawns[0],{...arena.spawns[1],position:{x:integrated.position.x+r,z:0}}]};
    const s=stepMatch({...flight(),projectile:p},w,0);
    expect(s.result?.reason).toBe('hit');expect(s.result?.victim).toBe('p2');expect(s.winner).toBe('p1');expect(s.result?.endpoint.x).toBeCloseTo(integrated.position.x,10);
  });
  it('a real reverse-thrust shot returns to its owner, who loses without immunity',()=>{
    let s=flight();const snapshot=JSON.stringify(s);let ticks=0;
    while(s.phase==='flight'&&ticks++<FLIGHT_TICKS)s=stepMatch(s,arena,4);
    expect(s.result?.reason).toBe('hit');expect(s.result?.victim).toBe('p1');expect(s.result?.shooter).toBe('p1');expect(s.winner).toBe('p2');
    const resolved=stepN(s,RESOLVE_TICKS,arena,15);expect(resolved.phase).toBe('gameOver');expect(resolved.activePlayer).toBe('p1');expect(resolved.winner).toBe('p2');expect(resolved.turnId).toBe(1);
    expect(snapshot).toBe(JSON.stringify(flight()));
  });
  it('sets opponent-hit winner immediately and preserves result through gameOver',()=>{
    const w={...arena,spawns:[arena.spawns[0],{...arena.spawns[1],position:{x:2,z:0}}]};
    let s=flight(w);while(s.phase==='flight')s=stepMatch(s,w,1);
    expect(s.winner).toBe('p1');expect(s.result?.victim).toBe('p2');const result=s.result;
    s=stepN(s,RESOLVE_TICKS,w);expect(s.phase).toBe('gameOver');expect(s.result).toBe(result);
  });
  it('creates a fully isolated rematch, alternate opener, rejects stale context',()=>{
    let end=flight();while(end.phase==='flight')end=stepMatch(end,arena,4);end=stepN(end,90);
    const next=createRematch(end,arena,'m2');
    expect(next).toMatchObject({matchId:'m2',matchNumber:2,opener:'p2',activePlayer:'p2',tick:0,turnId:1,nextShotId:1,phase:'handoff',projectile:null,result:null,winner:null});
    expect(applyCommand(next,arena,{type:'ready',matchId:end.matchId,turnId:end.turnId,playerId:'p2'}).accepted).toBe(false);
    expect(()=>createRematch(initial(),arena,'x')).toThrow(/gameOver/);expect(()=>createRematch(end,arena,end.matchId)).toThrow(/new match ID/);
  });
  it('does not mutate held snapshots or world geometry; deterministic input repeats identically',()=>{
    const w=JSON.stringify(arena),before=flight(),saved=JSON.stringify(before);
    const trace=[1,9,0,2,4,15,8,5];
    const replay=()=>trace.reduce((s,m)=>stepN(s,10,arena,m),before);
    expect(replay()).toEqual(replay());expect(JSON.stringify(before)).toBe(saved);expect(JSON.stringify(arena)).toBe(w);
  });
});
