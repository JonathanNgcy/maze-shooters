import {afterEach,describe,expect,it} from 'vitest';
import {WebSocket} from 'ws';
import {createDuelServer} from '../../server/index';
import type {ServerMessage} from '../../src/shared/realtime';

const running:Awaited<ReturnType<typeof createDuelServer>>[]=[];
const clients:WebSocket[]=[];
afterEach(async()=>{for(const client of clients.splice(0))client.terminate();for(const server of running.splice(0))await server.close();});
async function client(url:string,options:import('ws').ClientOptions={}){
 const socket=new WebSocket(url,options);clients.push(socket);
 const messages:ServerMessage[]=[];const listeners=new Set<()=>void>();
 socket.on('message',data=>{messages.push(JSON.parse(data.toString()) as ServerMessage);for(const listener of listeners)listener();});
 await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 function wait<T extends ServerMessage['type']>(type:T,predicate:(message:Extract<ServerMessage,{type:T}>)=>boolean=()=>true):Promise<Extract<ServerMessage,{type:T}>>{
  return new Promise((resolve,reject)=>{
   const check=()=>{const found=messages.find(message=>message.type===type&&predicate(message as Extract<ServerMessage,{type:T}>));if(found){clearTimeout(timer);listeners.delete(check);resolve(found as Extract<ServerMessage,{type:T}>);}};
   const timer=setTimeout(()=>{listeners.delete(check);reject(new Error(`Timed out waiting for ${type}`));},3000);listeners.add(check);check();
  });
 }
 return{socket,messages,wait,send:(message:object)=>socket.send(JSON.stringify({v:2,...message}))};
}

describe('actual WebSocket private-room transport',()=>{
 it('hosts health and intent-only two-seat matches, projects privacy and rotates reconnect credentials',async()=>{
  let now=0;const server=await createDuelServer({port:0,autoTick:false,now:()=>now});running.push(server);
  expect(await (await fetch(`http://${server.address.host}:${server.address.port}/health`)).json()).toEqual({status:'ok'});
  expect((await fetch(`http://${server.address.host}:${server.address.port}/reset`)).status).toBe(404);
  const one=await client(server.address.url),two=await client(server.address.url),third=await client(server.address.url);
  one.send({type:'create',requestId:'create'});const first=await one.wait('welcome');
  two.send({type:'join',requestId:'join',code:first.code});const second=await two.wait('welcome');
  expect(first.seat).toBe('p1');expect(second.seat).toBe('p2');expect(first.token).not.toBe(second.token);
  third.send({type:'join',requestId:'third',code:first.code});expect(await third.wait('error')).toMatchObject({code:'ROOM_FULL'});
  for(const current of [one,two]){current.send({type:'compatible',seq:1,rulesVersion:2,mapId:first.world.mapId,mapVersion:first.world.mapVersion});await current.wait('ack',message=>message.seq===1);current.send({type:'ready',seq:2});await current.wait('ack',message=>message.seq===2);}
  const playing=await one.wait('snapshot',message=>message.room.status==='playing');const matchId=playing.room.state!.matchId;
  one.send({type:'fire',seq:3,matchId});two.send({type:'fire',seq:3,matchId});
  await Promise.all([one.wait('ack',m=>m.seq===3),two.wait('ack',m=>m.seq===3)]);now+=1000/120;server.authority.step();
  const fired=await one.wait('snapshot',m=>m.room.state?.shots.p1.phase==='flight');
  expect(fired.room.state!.shots.p2.projectile?.ageTicks).toBe(0);expect(fired.room.explored.length).toBeGreaterThan(0);
  expect(fired.room.state).not.toHaveProperty('explored');expect(fired.room.state).not.toHaveProperty('history');
  const shotId=fired.room.state!.shots.p1.projectile!.shotId;
  // A peer may name another projectile, but its socket remains bound to its own seat.
  two.send({type:'input',seq:4,matchId,shotId,mask:1});expect(await two.wait('ack',m=>m.seq===4)).toMatchObject({accepted:false,code:'STALE_CONTEXT'});
  one.send({type:'input',seq:4,matchId,shotId,mask:1,playerId:'p2'});expect(await one.wait('error')).toMatchObject({code:'BAD_MESSAGE'});
  one.send({type:'input',seq:4,matchId,shotId,mask:1});expect(await one.wait('ack',m=>m.seq===4)).toMatchObject({accepted:true});
  const resumed=await client(server.address.url);resumed.send({type:'resume',requestId:'resume',token:first.token});const replacement=await resumed.wait('welcome');
  expect(replacement).toMatchObject({seat:'p1',generation:2});expect(replacement.token).not.toBe(first.token);
  const recovered=await resumed.wait('snapshot');expect(recovered.room.state!.matchId).toBe(matchId);expect(recovered.room.explored).toEqual(fired.room.explored);expect(recovered.room.lastProcessedSeq).toBe(0);
  const stale=await client(server.address.url);stale.send({type:'resume',requestId:'stale',token:first.token});expect(await stale.wait('error')).toMatchObject({code:'INVALID_TOKEN'});
 });
 it('rejects malformed/binary messages and closes oversized WebSocket payloads',async()=>{
  const server=await createDuelServer({port:0,autoTick:false});running.push(server);
  const malformed=await client(server.address.url);malformed.socket.send('{');expect(await malformed.wait('error')).toMatchObject({code:'BAD_MESSAGE'});
  const binary=await client(server.address.url);binary.socket.send(new Uint8Array([1,2]));expect(await binary.wait('error')).toMatchObject({code:'BAD_MESSAGE'});
  const large=await client(server.address.url);const closed=new Promise<number>(resolve=>large.socket.once('close',code=>resolve(code)));large.socket.send('x'.repeat(1025));expect(await closed).toBe(1009);
 });
 it('handles oversized frames from a capacity-rejected socket without an uncaught transport error',async()=>{
  const server=await createDuelServer({port:0,autoTick:false,maxConnections:1});running.push(server);
  const accepted=await client(server.address.url);
  const rejected=new WebSocket(server.address.url);clients.push(rejected);
  rejected.on('error',()=>{});
  const closed=new Promise<number>(resolve=>rejected.once('close',code=>resolve(code)));
  rejected.once('open',()=>rejected.send('x'.repeat(1025)));
  expect([1009,1013]).toContain(await closed);
  expect(server.authority.connectionCount).toBe(1);
  accepted.send({type:'create',requestId:'still-alive'});expect((await accepted.wait('welcome')).seat).toBe('p1');
 });
 it('uses protocol ping/pong to remove a dead peer, clear input and start normal disconnect grace',async()=>{
  let now=100;const server=await createDuelServer({port:0,autoTick:false,now:()=>now,heartbeatIntervalMs:150});running.push(server);
  const one=await client(server.address.url,{autoPong:false}),two=await client(server.address.url);
  one.send({type:'create',requestId:'create'});const welcome=await one.wait('welcome');two.send({type:'join',requestId:'join',code:welcome.code});await two.wait('welcome');
  for(const current of [one,two]){current.send({type:'compatible',seq:1,rulesVersion:2,mapId:welcome.world.mapId,mapVersion:welcome.world.mapVersion});await current.wait('ack',m=>m.seq===1);current.send({type:'ready',seq:2});await current.wait('ack',m=>m.seq===2);}
  const playing=await one.wait('snapshot',m=>m.room.status==='playing'),matchId=playing.room.state!.matchId;
  one.send({type:'fire',seq:3,matchId});await one.wait('ack',m=>m.seq===3);server.authority.step();
  const fired=await one.wait('snapshot',m=>m.room.state?.shots.p1.phase==='flight');
  one.send({type:'input',seq:4,matchId,shotId:fired.room.state!.shots.p1.projectile!.shotId,mask:1});await one.wait('ack',m=>m.seq===4);
  const closed=new Promise<number>(resolve=>one.socket.once('close',code=>resolve(code)));
  expect(await closed).toBe(1006);
  const disconnected=await two.wait('snapshot',m=>!m.room.seats.p1.connected);
  expect(disconnected.room.seats.p1.disconnectDeadlineMs).toBe(30_100);expect(disconnected.room.status).toBe('playing');expect(server.authority.connectionCount).toBe(1);
  const before=disconnected.room.state!.shots.p1.projectile!;server.authority.step();two.send({type:'compatible',seq:3,rulesVersion:2,mapId:welcome.world.mapId,mapVersion:welcome.world.mapVersion});await two.wait('ack',m=>m.seq===3);
  const coasting=await two.wait('snapshot',m=>m.room.state?.tick===2);expect(coasting.room.state!.shots.p1.projectile!.velocity.x).toBeLessThan(before.velocity.x);
  now=30_100;server.authority.checkDeadlines();expect(await two.wait('snapshot',m=>m.room.status==='ended')).toMatchObject({room:{outcome:{cause:'forfeit',winner:'p2',loser:'p1',detail:'disconnect'}}});
 });
 it('keeps pong-responsive sockets alive across heartbeat cycles and closes cleanly',async()=>{
  const server=await createDuelServer({port:0,autoTick:false,heartbeatIntervalMs:20});running.push(server);const peer=await client(server.address.url);
  await new Promise<void>(resolve=>{let count=0;peer.socket.on('ping',()=>{if(++count===3)resolve();});});
  expect(peer.socket.readyState).toBe(WebSocket.OPEN);expect(server.authority.connectionCount).toBe(1);
  await server.close();expect(server.authority.connectionCount).toBe(0);
 });
 it('uses the monotonic driver and errors instead of silently dropping more than thirty catch-up ticks',async()=>{
  let now=0;const server=await createDuelServer({port:0,now:()=>now});running.push(server);
  const one=await client(server.address.url),two=await client(server.address.url);one.send({type:'create',requestId:'create'});const welcome=await one.wait('welcome');two.send({type:'join',requestId:'join',code:welcome.code});await two.wait('welcome');
  for(const current of [one,two]){current.send({type:'compatible',seq:1,rulesVersion:2,mapId:welcome.world.mapId,mapVersion:welcome.world.mapVersion});await current.wait('ack',m=>m.seq===1);current.send({type:'ready',seq:2});await current.wait('ack',m=>m.seq===2);}
  await one.wait('snapshot',m=>m.room.status==='playing');now=50;
  const six=await one.wait('snapshot',m=>m.room.state?.tick===6);expect(six.room.status).toBe('playing');now+=259;
  const failed=await one.wait('snapshot',m=>m.room.status==='error');expect(failed.room.state!.tick).toBe(6);expect(failed.room.outcome).toBeNull();
 });
});
