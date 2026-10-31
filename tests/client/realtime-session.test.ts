import {afterEach,describe,expect,it,vi} from 'vitest';
import {buildWorld} from '../../src/maze/build';
import {RealtimeSession} from '../../src/network/session';
import {parseServerMessage} from '../../src/network/client-messages';
import {createRealtimeMatch,stepRealtime} from '../../src/sim/realtime';
import type {RealtimeMatchState,RoomSnapshot,ServerMessage} from '../../src/shared/realtime';
const world=buildWorld();
class Socket{
 readyState=0;sent:Record<string,unknown>[]=[];onopen:(()=>void)|null=null;onmessage:((event:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
 send(raw:string){this.sent.push(JSON.parse(raw));} close(){this.readyState=3;this.onclose?.();}
 open(){this.readyState=1;this.onopen?.();} receive(message:ServerMessage){this.onmessage?.({data:JSON.stringify(message)});}
}
const status={connected:true,compatible:true,ready:true,rematch:false,readyDeadlineMs:null,disconnectDeadlineMs:null};
function room(state:RealtimeMatchState,revision=state.tick):RoomSnapshot{
 const {explored,history,...publicState}=state;
 return {roomId:'room',code:'ABC234',revision,eventId:0,serverTimeMs:0,status:'playing',seats:{p1:status,p2:status},state:publicState,outcome:state.outcome,explored:explored.p1,history:history.p1,lastProcessedSeq:0};
}
function setup(){
 const sockets:Socket[]=[];let time=0;
 const session=new RealtimeSession(world,{autoResume:false,url:'ws://localhost/duel',now:()=>time,socketFactory:()=>{const socket=new Socket();sockets.push(socket);return socket as unknown as WebSocket;}});
 session.createRoom();const socket=sockets[0];socket.open();
 socket.receive({v:2,type:'welcome',requestId:'create-1',roomId:'room',code:'ABC234',seat:'p1',token:'x'.repeat(32),generation:1,rulesVersion:2,world});
 return {session,socket,sockets,setTime:(value:number)=>{time=value;}};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('online transport authority boundary',()=>{
 it('sends seat-free intent, never advances simulation on frames, and zeros controls on suspension',()=>{
  const {session,socket,setTime}=setup();let state=createRealtimeMatch(world,{matchId:'m',matchNumber:1});socket.receive({v:2,type:'snapshot',room:room(state)});
  session.fire();expect(socket.sent.at(-1)).toMatchObject({type:'fire',matchId:'m'});expect(socket.sent.at(-1)).not.toHaveProperty('playerId');
  state=stepRealtime(state,world,[{type:'fire',matchId:'m',playerId:'p1'}],{p1:0,p2:0});socket.receive({v:2,type:'snapshot',room:room(state)});
  session.setControls(1);expect(socket.sent.at(-1)).toMatchObject({type:'input',mask:1,shotId:1});
  const snapshot=session.snapshot;setTime(500);session.frame(500);expect(session.snapshot).toBe(snapshot);expect(session.snapshot?.state?.tick).toBe(1);
  session.suspendControls();expect(socket.sent.at(-1)).toMatchObject({type:'input',mask:0});session.setControls(8);expect(socket.sent.at(-1)).toMatchObject({mask:0});
  expect(Object.isFrozen(session.snapshot?.state)).toBe(true);session.dispose();
 });
 it('interpolates only matching shots; delayed snapshots cannot restore an old missile',()=>{
  const {session,socket,setTime}=setup();let state=createRealtimeMatch(world,{matchId:'m',matchNumber:1});state=stepRealtime(state,world,[{type:'fire',matchId:'m',playerId:'p1'}],{p1:0,p2:0});
  socket.receive({v:2,type:'snapshot',room:room(state)});const start=state.shots.p1.projectile!;
  setTime(100);for(let i=0;i<12;i++)state=stepRealtime(state,world,[],{p1:0,p2:0});socket.receive({v:2,type:'snapshot',room:room(state)});
  setTime(150);session.frame(150);expect(session.projectiles[0].position.x).toBeCloseTo((start.position.x+state.shots.p1.projectile!.position.x)/2);
  const old=room(state);setTime(200);socket.receive({v:2,type:'snapshot',room:{...old,revision:100,status:'ended'}});expect(session.projectiles).toEqual([]);
  socket.receive({v:2,type:'snapshot',room:old});expect(session.snapshot?.status).toBe('ended');expect(session.projectiles).toEqual([]);session.dispose();
 });
 it('reload reconnect rotates credentials and resets sequence and held input',()=>{
  vi.useFakeTimers();const storage=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  const {session,socket,sockets}=setup();expect(storage.size).toBe(1);socket.close();expect(session.connection).toBe('reconnecting');vi.advanceTimersByTime(1000);
  const replacement=sockets[1];replacement.open();expect(replacement.sent[0]).toMatchObject({type:'resume',token:'x'.repeat(32)});
  replacement.receive({v:2,type:'welcome',requestId:'resume-2',roomId:'room',code:'ABC234',seat:'p1',token:'y'.repeat(32),generation:2,rulesVersion:2,world});expect(replacement.sent.at(-1)).toMatchObject({type:'compatible',seq:1});
  expect([...storage.values()][0]).toContain('y'.repeat(32));replacement.receive({v:2,type:'error',code:'EXPIRED_TOKEN',message:'Expired reconnect'});expect(session.connection).toBe('error');expect(storage.size).toBe(0);vi.advanceTimersByTime(5000);expect(sockets).toHaveLength(2);session.dispose();
 });
 it('returns to a usable lobby after a hosted server loses its room',()=>{
  const {session,socket,sockets}=setup();const state=createRealtimeMatch(world,{matchId:'m',matchNumber:1});socket.receive({v:2,type:'snapshot',room:room(state)});session.suspendControls();
  socket.receive({v:2,type:'error',code:'INVALID_TOKEN',message:'That reconnect session is unavailable.'});
  expect(session.snapshot).toBeNull();expect(session.seat).toBeNull();expect(session.controlsSuspended).toBe(false);expect(session.connection).toBe('error');
  session.createRoom();expect(sockets).toHaveLength(2);expect(session.connection).toBe('connecting');session.dispose();
 });
 it('keeps invalid room codes recoverable without opening a socket',()=>{
  const {session,sockets}=setup();session.joinRoom('ABC1');expect(session.connection).toBe('error');expect(session.message).toContain('six-character');expect(sockets).toHaveLength(1);session.createRoom();expect(sockets).toHaveLength(2);session.dispose();
 });
 it('rejects incompatible geometry and non-finite render data before presentation',()=>{
  const welcome:ServerMessage={v:2,type:'welcome',requestId:'x',roomId:'r',code:'ABC234',seat:'p1',token:'x'.repeat(32),generation:1,rulesVersion:2,world};
  expect(parseServerMessage(JSON.stringify(welcome),world)).not.toBeNull();expect(parseServerMessage(JSON.stringify({...welcome,world:{...world,mapVersion:1}}),world)).toBeNull();
  const state=createRealtimeMatch(world,{matchId:'m',matchNumber:1}),snapshot=room(state);expect(parseServerMessage(JSON.stringify({v:2,type:'snapshot',room:{...snapshot,explored:[999]}}),world)).toBeNull();
  const {session,socket}=setup();socket.onmessage?.({data:'{"v":2,"type":"snapshot","room":{}}'});expect(session.connection).toBe('error');expect(socket.readyState).toBe(3);session.dispose();
 });
});
