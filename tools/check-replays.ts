import {readFileSync} from 'node:fs';
import {buildWorld} from '../src/maze/build';
import {createMatch,applyCommand,stepMatch} from '../src/sim';
import type {Replay} from '../src/shared/types';
const world=buildWorld();
for(const seat of ['p1','p2']){
 const r=JSON.parse(readFileSync(`tests/replays/${seat}-win.json`,'utf8')) as Replay;
 let s=createMatch(world,{matchId:'replay',matchNumber:1,opener:r.shooter});
 for(const type of ['ready','fire'] as const)s=applyCommand(s,world,{type,matchId:s.matchId,turnId:1,playerId:r.shooter}).state;
 let ticks=0;
 for(const run of r.runs)for(let i=0;i<run.ticks;i++){if(s.phase!=='flight')throw new Error('Replay continues after termination');s=stepMatch(s,world,run.mask);ticks++;}
 console.log(seat,ticks,s.phase,s.result);
 if(s.result?.reason!=='hit'||s.result.victim===seat)throw new Error('Replay did not win');
}
