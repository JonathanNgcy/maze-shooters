/** Offline test tooling. No controller or route is imported by the game. */
import { writeFileSync } from 'node:fs';
import { buildWorld, tileCenter } from '../src/maze/build';
import { createMatch, applyCommand, stepMatch } from '../src/sim';
import { wrapAngle } from '../src/shared/math';
import { FLIGHT_TICKS, REVERSE_ACCEL, FORWARD_ACCEL, LINEAR_DRAG, RULES_VERSION, MAP_ID, MAP_VERSION } from '../src/shared/config';
import type { Replay } from '../src/shared/types';
const world=buildWorld();
const points=[[5,1],[5,7],[7,7]].map(([column,row])=>{const point=tileCenter(column,row);return [point.x,point.z];});
const axes=[[1,0],[0,1],[1,0]];
let state=createMatch(world,{matchId:'discovery',matchNumber:1,opener:'p1'});
for(const type of ['ready','fire'] as const)state=applyCommand(state,world,{type,matchId:state.matchId,turnId:1,playerId:'p1'}).state;
const runs:Replay['runs']=[];
let idx=0,rotating=false,ticks=0;
while(state.phase==='flight'&&ticks<FLIGHT_TICKS){
 const p=state.projectile!;
 let [tx,tz]=points[idx], [ax,az]=axes[idx];
 let dx=tx-p.position.x,dz=tz-p.position.z;
 const speed=Math.hypot(p.velocity.x,p.velocity.z);
 if(idx<points.length-1&&dx*ax+dz*az<.18&&speed<.3){idx++;[tx,tz]=points[idx];[ax,az]=axes[idx];dx=tx-p.position.x;dz=tz-p.position.z;rotating=true;}
 const remain=dx*ax+dz*az,lateral=dx*(-az)+dz*ax;
 const vlat=p.velocity.x*(-az)+p.velocity.z*ax, along=p.velocity.x*ax+p.velocity.z*az;
 const k=LINEAR_DRAG,a=REVERSE_ACCEL;
 const stopping=along/k-a/(k*k)*Math.log(1+k*Math.max(0,along)/a);
 const braking=remain<stopping+.025&&along>.02;
 const correction=Math.max(-.3,Math.min(.3,(lateral*1.5-vlat*2.5)/(braking?-REVERSE_ACCEL:FORWARD_ACCEL)));
 const aim=Math.atan2(ax,-az)+(rotating?0:correction), error=wrapAngle(aim-p.heading);
 const torque=24*error-4*p.angularVelocity;
 let mask=torque>.05?8:torque<-.05?2:0;
 if(rotating&&Math.abs(error)<.06&&Math.abs(p.angularVelocity)<.2)rotating=false;
 if(!rotating){if(braking)mask|=4;else if(Math.abs(error)<.25&&remain>.02)mask|=1;}
 const previous=runs.at(-1);if(previous?.mask===mask)previous.ticks++;else runs.push({ticks:1,mask});
 state=stepMatch(state,world,mask);ticks++;
}
if(state.result?.reason!=='hit'||state.result.victim!=='p2')throw new Error(`Discovery failed at ${ticks}: ${JSON.stringify(state.result)}`);
for(const shooter of ['p1','p2'] as const){
 const replay:Replay={rulesVersion:RULES_VERSION,mapId:MAP_ID,mapVersion:MAP_VERSION,shooter,runs};
 writeFileSync(`tests/replays/${shooter}-win.json`,JSON.stringify(replay,null,2)+'\n');
}
console.log(`Saved collision-enabled ordinary-control replays: ${ticks} ticks. Verify both with tools/check-replays.ts.`);
