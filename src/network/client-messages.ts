import { FLIGHT_TICKS, GRID_SIZE, MAP_ID, MAP_VERSION } from '../shared/config';
import { REALTIME_RULES_VERSION } from '../shared/realtime';
import type { ServerMessage } from '../shared/realtime';
import type { WorldGeometry } from '../shared/types';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const seat=(v:unknown)=>v==='p1'||v==='p2';
const text=(v:unknown,max=256)=>typeof v==='string'&&v.length<=max;
const point=(v:unknown):v is {x:number;z:number}=>record(v)&&finite(v.x)&&finite(v.z);
const result=(v:unknown):boolean=>record(v)&&['wall','timeout','hit'].includes(v.reason as string)&&integer(v.shotId,1)&&seat(v.shooter)&&point(v.endpoint)&&(v.victim===null||seat(v.victim))&&(v.colliderId===null||text(v.colliderId,128))&&(v.reason!=='hit'||seat(v.victim));
const projectile=(v:unknown):boolean=>record(v)&&integer(v.shotId,1)&&seat(v.owner)&&point(v.position)&&point(v.velocity)&&finite(v.heading)&&finite(v.angularVelocity)&&integer(v.ageTicks)&&Number(v.ageTicks)<=FLIGHT_TICKS;
const outcome=(v:unknown):boolean=>v===null||(record(v)&&(
 (v.cause==='draw'&&v.winner===null&&v.loser===null&&v.detail==='simultaneous_hits')||
 (['hit','forfeit'].includes(v.cause as string)&&seat(v.winner)&&seat(v.loser)&&v.winner!==v.loser&&['hit','self_hit','disconnect','leave','ready_deadline'].includes(v.detail as string))));
function compatibleWorld(value:unknown,expected:WorldGeometry):boolean{
 if(!record(value)||value.mapId!==MAP_ID||value.mapVersion!==MAP_VERSION||!Array.isArray(value.walls)||!Array.isArray(value.spawns)||value.walls.length!==expected.walls.length||value.spawns.length!==2)return false;
 return value.walls.every((w,i)=>record(w)&&Object.entries(expected.walls[i]).every(([k,v])=>w[k]===v))&&value.spawns.every((s,i)=>record(s)&&s.id===expected.spawns[i].id&&s.heading===expected.spawns[i].heading&&point(s.position)&&s.position.x===expected.spawns[i].position.x&&s.position.z===expected.spawns[i].position.z);
}
/** Validate snapshots before they can reach cameras or HUD; values remain server-authored. */
export function parseServerMessage(raw:unknown,world:WorldGeometry):ServerMessage|null{
 if(typeof raw!=='string'||raw.length>262144)return null;
 let v:unknown;try{v=JSON.parse(raw);}catch{return null;}
 if(!record(v)||v.v!==2)return null;
 if(v.type==='welcome')return text(v.requestId,64)&&text(v.roomId,128)&&text(v.code,16)&&seat(v.seat)&&text(v.token,256)&&integer(v.generation,1)&&v.rulesVersion===REALTIME_RULES_VERSION&&compatibleWorld(v.world,world)?v as unknown as ServerMessage:null;
 if(v.type==='ack')return integer(v.seq,1)&&typeof v.accepted==='boolean'&&(v.code===undefined||text(v.code,64))?v as unknown as ServerMessage:null;
 if(v.type==='error')return text(v.code,64)&&text(v.message,512)?v as unknown as ServerMessage:null;
 if(v.type==='pong')return finite(v.clientTimeMs)&&finite(v.serverTimeMs)?v as unknown as ServerMessage:null;
 if(v.type!=='snapshot'||!record(v.room))return null;
 const r=v.room;
 if(!text(r.roomId,128)||!text(r.code,16)||!integer(r.revision)||!integer(r.eventId)||!finite(r.serverTimeMs)||!['waiting','playing','ended','abandoned','error'].includes(r.status as string)||!integer(r.lastProcessedSeq)||!outcome(r.outcome)||!record(r.seats))return null;
 for(const id of ['p1','p2']){const s=r.seats[id];if(!record(s)||!['connected','compatible','ready','rematch'].every(k=>typeof s[k]==='boolean')||![s.readyDeadlineMs,s.disconnectDeadlineMs].every(t=>t===null||finite(t)))return null;}
 if(!Array.isArray(r.explored)||r.explored.length>GRID_SIZE*GRID_SIZE||!r.explored.every(c=>integer(c)&&c<GRID_SIZE*GRID_SIZE)||!Array.isArray(r.history)||r.history.length>32||!r.history.every(result))return null;
 if(r.state!==null){
  const s=r.state;
  if(!record(s)||!text(s.matchId,128)||!integer(s.matchNumber,1)||!integer(s.tick)||!integer(s.nextShotId,1)||!['playing','resolve','gameOver'].includes(s.phase as string)||!integer(s.resolveTicksRemaining)||!outcome(s.outcome)||!record(s.shots))return null;
  for(const id of ['p1','p2']){const p=s.shots[id];if(!record(p)||!['ready','flight','resolve'].includes(p.phase as string)||!integer(p.resolveTicksRemaining)||(p.projectile!==null&&!projectile(p.projectile))||(p.result!==null&&!result(p.result))||(p.phase==='flight'&&p.projectile===null))return null;}
 }
 return v as unknown as ServerMessage;
}
