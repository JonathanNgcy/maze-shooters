import {describe,expect,it} from 'vitest';
import {createDuelAuthority} from '../../server/authority';
import type {RoomSnapshot,ServerMessage} from '../../src/shared/realtime';

function harness(){
 let time=0; const authority=createDuelAuthority({now:()=>time});
 const peers=new Map<string,{messages:ServerMessage[];seq:number;closed:boolean}>();
 function peer(id:string){
  const value={messages:[] as ServerMessage[],seq:0,closed:false};peers.set(id,value);
  authority.connect({id,send(message){value.messages.push(JSON.parse(JSON.stringify(message)));},close(){value.closed=true;authority.disconnect(id);}});
  return value;
 }
 function send(id:string,message:Record<string,unknown>){authority.receive(id,JSON.stringify({v:2,...message}));}
 function action(id:string,message:Record<string,unknown>){send(id,{...message,seq:++peers.get(id)!.seq});}
 function welcome(id:string){const message=peers.get(id)!.messages.find(m=>m.type==='welcome');if(!message||message.type!=='welcome')throw new Error('no welcome');return message;}
 function room(id:string):RoomSnapshot{const message=peers.get(id)!.messages.filter(m=>m.type==='snapshot').at(-1);if(!message||message.type!=='snapshot')throw new Error('no snapshot');return message.room;}
 function lastAck(id:string){return peers.get(id)!.messages.filter(m=>m.type==='ack').at(-1);}
 function compatible(id:string){action(id,{type:'compatible',rulesVersion:2,mapId:'maze-01',mapVersion:2});}
 function start(){peer('one');send('one',{type:'create',requestId:'create'});peer('two');send('two',{type:'join',requestId:'join',code:welcome('one').code});compatible('one');compatible('two');action('one',{type:'ready'});action('two',{type:'ready'});}
 function advance(ticks:number,heartbeat?:()=>void){for(let i=0;i<ticks;i++){time+=1000/120;heartbeat?.();authority.step();}}
 return{authority,peers,peer,send,action,welcome,room,lastAck,compatible,start,advance,setTime:(value:number)=>{time=value;},get time(){return time;}};
}
describe('private realtime room authority',()=>{
 it('binds two compatible ready seats, rejects a third and launches both shots on one boundary at age zero',()=>{
  const h=harness();h.start();const initial=h.room('one');expect(initial.status).toBe('playing');expect(initial.state?.tick).toBe(0);
  h.peer('third');h.send('third',{type:'join',requestId:'third',code:h.welcome('one').code});expect(h.peers.get('third')!.messages.at(-1)).toMatchObject({type:'error'});
  for(const id of ['one','two'])h.action(id,{type:'fire',matchId:initial.state!.matchId});
  h.action('one',{type:'fire',matchId:initial.state!.matchId});expect(h.lastAck('one')).toMatchObject({accepted:false,code:'DUPLICATE_ACTION'});
  h.advance(1);const fired=h.room('one').state!;
  expect(fired.shots.p1.projectile?.ageTicks).toBe(0);expect(fired.shots.p2.projectile?.ageTicks).toBe(0);
  expect(fired.shots.p1.projectile?.shotId).not.toBe(fired.shots.p2.projectile?.shotId);
  expect('explored' in fired).toBe(false);expect('history' in fired).toBe(false);
 });
 it('rejects forged fields, incompatible versions, stale contexts and steering another seat',()=>{
  const h=harness();h.start();const matchId=h.room('one').state!.matchId;
  h.action('one',{type:'fire',matchId:'m_stale'});expect(h.lastAck('one')).toMatchObject({accepted:false,code:'STALE_CONTEXT'});
  h.action('one',{type:'fire',matchId});h.advance(1);const shotId=h.room('one').state!.shots.p1.projectile!.shotId;
  h.action('two',{type:'input',matchId,shotId,mask:1});expect(h.lastAck('two')).toMatchObject({accepted:false,code:'WRONG_PHASE'});
  h.send('one',{type:'input',seq:100,matchId,shotId,mask:1,playerId:'p2'});expect(h.peers.get('one')!.messages.at(-1)).toMatchObject({type:'error',code:'BAD_MESSAGE'});
  h.action('one',{type:'input',matchId,shotId:shotId+1,mask:1});expect(h.lastAck('one')).toMatchObject({accepted:false,code:'STALE_CONTEXT'});
  h.action('one',{type:'compatible',rulesVersion:1,mapId:'maze-01',mapVersion:2});expect(h.lastAck('one')).toMatchObject({accepted:false,code:'INCOMPATIBLE'});
 });
 it('expires controls after twelve ticks; duplicate packets cannot refresh them',()=>{
  const h=harness();h.start();const matchId=h.room('one').state!.matchId;
  h.action('one',{type:'fire',matchId});h.advance(1);const shotId=h.room('one').state!.shots.p1.projectile!.shotId;
  h.action('one',{type:'input',matchId,shotId,mask:1});const seq=h.peers.get('one')!.seq;
  h.advance(10);h.send('one',{type:'input',seq,matchId,shotId,mask:1});expect(h.lastAck('one')).toMatchObject({accepted:false,code:'DUPLICATE'});
  h.advance(2);const accelerated=h.room('one').state!.shots.p1.projectile!;
  // Explicitly publish a snapshot without advancing simulation so the final expiry tick is observable.
  h.action('two',{type:'compatible',rulesVersion:2,mapId:'maze-01',mapVersion:2});const before=h.room('one').state!.shots.p1.projectile!;
  expect(before.ageTicks).toBe(12);expect(before.velocity.x).toBeGreaterThan(5);
  h.advance(1);h.action('two',{type:'compatible',rulesVersion:2,mapId:'maze-01',mapVersion:2});
  const after=h.room('one').state!.shots.p1.projectile!;expect(after.ageTicks).toBe(13);expect(after.velocity.x).toBeLessThan(before.velocity.x);expect(accelerated.ageTicks).toBeLessThanOrEqual(before.ageTicks);
 });
 it('handles delayed out-of-order controls without refreshing expiry and clears input on reconnect',()=>{
  const h=harness();h.start();const matchId=h.room('one').state!.matchId;h.action('one',{type:'fire',matchId});h.advance(1);const shotId=h.room('one').state!.shots.p1.projectile!.shotId;
  h.action('one',{type:'input',matchId,shotId,mask:1});const delayed=h.peers.get('one')!.seq;h.advance(4);
  h.action('one',{type:'input',matchId,shotId,mask:8});h.advance(7);
  // A packet delayed across a newer heartbeat cannot replace that newer mask.
  h.send('one',{type:'input',seq:delayed,matchId,shotId,mask:1});expect(h.lastAck('one')).toMatchObject({accepted:false,code:'DUPLICATE'});
  h.advance(5);h.compatible('two');const before=h.room('one').state!.shots.p1.projectile!;
  expect(before.angularVelocity).toBeGreaterThan(0);h.advance(1);h.compatible('two');expect(h.room('one').state!.shots.p1.projectile!.angularVelocity).toBeLessThan(before.angularVelocity);
  h.action('one',{type:'input',matchId,shotId,mask:1});const token=h.welcome('one').token;
  h.peer('replacement');h.send('replacement',{type:'resume',requestId:'replace',token});const velocity=h.room('replacement').state!.shots.p1.projectile!.velocity.x;
  h.advance(1);h.compatible('replacement');expect(h.room('replacement').state!.shots.p1.projectile!.velocity.x).toBeLessThan(velocity);
 });
 it('projects only each receiving seat discovery/history and restores it on reconnect',()=>{
  const h=harness();h.start();const matchId=h.room('one').state!.matchId;
  h.action('one',{type:'fire',matchId});h.advance(100);
  expect(h.room('one').explored.length).toBeGreaterThan(1);expect(h.room('two').explored).toEqual([]);
  const token=h.welcome('one').token, discovery=h.room('one').explored;
  h.authority.disconnect('one');h.peer('resumed');h.send('resumed',{type:'resume',requestId:'resume',token});
  expect(h.welcome('resumed').seat).toBe('p1');expect(h.welcome('resumed').generation).toBe(2);expect(h.welcome('resumed').token).not.toBe(token);
  expect(h.room('resumed').explored).toEqual(discovery);expect(h.room('resumed').state!.matchId).toBe(matchId);expect(h.room('resumed').lastProcessedSeq).toBe(0);
  h.peer('old-token');h.send('old-token',{type:'resume',requestId:'old',token});expect(h.peers.get('old-token')!.messages.at(-1)).toMatchObject({type:'error',code:'INVALID_TOKEN'});
 });
 it('invalidates replaced socket generation immediately and clears old intent',()=>{
  const h=harness();h.start();const oldWelcome=h.welcome('one'),matchId=h.room('one').state!.matchId;
  h.action('one',{type:'fire',matchId});
  h.peer('replacement');h.send('replacement',{type:'resume',requestId:'replace',token:oldWelcome.token});
  expect(h.peers.get('one')!.closed).toBe(true);h.advance(1);
  h.compatible('replacement');expect(h.room('replacement').state!.shots.p1.phase).toBe('ready');
  h.send('one',{type:'fire',seq:999,matchId});h.advance(1);
  expect(h.room('replacement').state!.shots.p1.phase).toBe('ready');
 });
 it('uses room-level disconnect outcomes, preserves hit wins and abandons equal expiries',()=>{
  const h=harness();h.start();h.authority.disconnect('one');h.setTime(30_000);h.authority.checkDeadlines();
  expect(h.room('two')).toMatchObject({status:'ended',outcome:{cause:'forfeit',winner:'p2',loser:'p1',detail:'disconnect'}});
  expect(h.room('two').state?.outcome).toBeNull();
  const both=harness();both.start();both.authority.disconnect('one');both.authority.disconnect('two');both.setTime(30_000);both.authority.checkDeadlines();
  // Resume cannot resurrect the abandoned room.
  both.peer('resume');both.send('resume',{type:'resume',requestId:'resume',token:both.welcome('one').token});expect(both.peers.get('resume')!.messages.at(-1)).toMatchObject({type:'error',code:'INVALID_TOKEN'});
 });
 it('enforces Ready/waiting deadlines and does not start from one Ready',()=>{
  const h=harness();h.peer('one');h.send('one',{type:'create',requestId:'create'});h.peer('two');h.send('two',{type:'join',requestId:'join',code:h.welcome('one').code});h.compatible('one');h.compatible('two');h.action('one',{type:'ready'});
  expect(h.room('one').status).toBe('waiting');h.setTime(30_000);h.authority.checkDeadlines();expect(h.room('one')).toMatchObject({status:'ended',outcome:{cause:'forfeit',winner:'p1',loser:'p2',detail:'ready_deadline'}});
  expect(h.room('one').state).toMatchObject({tick:0,phase:'playing',outcome:null});
  const matchId=h.room('one').state!.matchId;h.action('one',{type:'rematch',matchId});h.action('two',{type:'rematch',matchId});expect(h.room('one').status).toBe('playing');
  const waiting=harness();waiting.peer('one');waiting.send('one',{type:'create',requestId:'create'});waiting.setTime(120_000);waiting.authority.checkDeadlines();expect(waiting.authority.roomCount).toBe(0);
 });
 it('abandons an unjoined creator on grace expiry instead of inventing a second-seat winner',()=>{
  const h=harness();h.peer('one');h.send('one',{type:'create',requestId:'create'});h.authority.disconnect('one');h.setTime(30_000);h.authority.checkDeadlines();expect(h.authority.roomCount).toBe(0);
 });
 it('rejects a Ready arriving at its deadline and cleans empty error rooms after grace',()=>{
  const h=harness();h.peer('one');h.send('one',{type:'create',requestId:'create'});h.peer('two');h.send('two',{type:'join',requestId:'join',code:h.welcome('one').code});h.compatible('one');h.compatible('two');h.action('one',{type:'ready'});
  h.setTime(30_000);h.action('two',{type:'ready'});expect(h.lastAck('two')).toMatchObject({accepted:false,code:'READY_DEADLINE'});expect(h.room('one').status).toBe('ended');
  const failed=harness();failed.start();failed.authority.failOverload();failed.authority.disconnect('one');failed.authority.disconnect('two');failed.setTime(30_000);failed.authority.checkDeadlines();expect(failed.authority.roomCount).toBe(0);
 });
 it('preserves an already determined self-hit over a subsequent disconnect deadline',()=>{
  const h=harness();h.start();const matchId=h.room('one').state!.matchId;h.action('one',{type:'fire',matchId});h.advance(1);const shotId=h.room('one').state!.shots.p1.projectile!.shotId;
  for(let i=0;i<500&&h.room('one').outcome===null;i++){if(i%4===0)h.action('one',{type:'input',matchId,shotId,mask:4});h.advance(1);}
  expect(h.room('one').outcome).toEqual({cause:'hit',winner:'p2',loser:'p1',detail:'self_hit'});expect(h.room('one').history[0].victim).toBe('p1');expect(h.room('two').history).toEqual([]);
  h.authority.disconnect('two');h.setTime(h.time+30_000);h.advance(90);expect(h.room('one')).toMatchObject({status:'ended',outcome:{cause:'hit',winner:'p2',loser:'p1',detail:'self_hit'}});
 });
 it('requires both rematch requests, resets private state and rejects old match commands',()=>{
  const h=harness();h.start();const matchId=h.room('one').state!.matchId;
  h.action('one',{type:'leave'});expect(h.room('two').status).toBe('ended');
  const token=h.welcome('one').token;h.peer('back');h.send('back',{type:'resume',requestId:'back',token});h.compatible('back');
  h.setTime(1200);h.action('two',{type:'rematch',matchId});expect(h.room('two').state!.matchId).toBe(matchId);
  h.action('back',{type:'rematch',matchId});const next=h.room('two');expect(next.status).toBe('playing');expect(next.state!.matchId).not.toBe(matchId);expect(next.state!.tick).toBe(0);expect(next.state!.matchNumber).toBe(2);expect(next.explored).toEqual([]);expect(next.history).toEqual([]);
  h.action('two',{type:'fire',matchId});expect(h.lastAck('two')).toMatchObject({accepted:false,code:'STALE_CONTEXT'});
 });
 it('rejects excess input/action rates and reports server overload as an error',()=>{
  const h=harness();h.start();for(let i=0;i<10;i++)h.action('one',{type:'ready'});expect(h.peers.get('one')!.closed).toBe(true);
  const overloaded=harness();overloaded.start();overloaded.authority.failOverload();expect(overloaded.room('one').status).toBe('error');expect(overloaded.room('one').outcome).toBeNull();
  const inputs=harness();inputs.start();const matchId=inputs.room('one').state!.matchId;inputs.action('one',{type:'fire',matchId});inputs.advance(1);const shotId=inputs.room('one').state!.shots.p1.projectile!.shotId;
  for(let i=0;i<63;i++)inputs.action('one',{type:'input',matchId,shotId,mask:1});expect(inputs.peers.get('one')!.closed).toBe(true);
 });
});
