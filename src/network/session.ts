import { buildWorld } from '../maze/build';
import { MAP_ID, MAP_VERSION } from '../shared/config';
import { clamp, lerp, lerpAngle, validMask } from '../shared/math';
import { INPUT_HEARTBEAT_MS, INTERPOLATION_DELAY_MS, REALTIME_RULES_VERSION } from '../shared/realtime';
import type { ClientMessage, RealtimeSessionAPI, RoomSnapshot } from '../shared/realtime';
import type { KeyMask, PlayerId, ProjectileState, WorldGeometry } from '../shared/types';
import { parseServerMessage } from './client-messages';

const RESUME_STORAGE_KEY='maze-shooters.online-seat.v2';
type Intent = ClientMessage extends infer M ? M extends {seq:number} ? Omit<M,'seq'> : never : never;
type SessionOptions={url?:string;socketFactory?:(url:string)=>WebSocket;now?:()=>number;autoResume?:boolean};
type Sample={time:number;room:RoomSnapshot};
function defaultUrl():string{const url=new URL('/duel',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';return url.href;}
function frozen<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}

/** Transport and interpolation only: this client never steps simulation or assigns outcomes. */
export class RealtimeSession implements RealtimeSessionAPI {
 readonly world:WorldGeometry;
 seat:PlayerId|null=null;
 snapshot:RoomSnapshot|null=null;
 connection:RealtimeSessionAPI['connection']='idle';
 message='Create a private room or enter a friend’s room code.';
 controlsSuspended=false;
 projectiles:readonly ProjectileState[]=[];
 private socket:WebSocket|null=null;
 private listeners=new Set<()=>void>();
 private seq=0;
 private epoch=0;
 private token:string|null=null;
 private roomId:string|null=null;
 private roomCode='';
 private held:KeyMask=0;
 private lastInput=-Infinity;
 private samples:Sample[]=[];
 private signature='';
 private retry:ReturnType<typeof setTimeout>|null=null;
 private disposed=false;
 private requestSerial=0;
 private readonly url:string;
 private readonly factory:(url:string)=>WebSocket;
 private readonly now:()=>number;
 constructor(world:WorldGeometry=buildWorld(),options:SessionOptions={}){
  this.world=world;this.url=options.url??defaultUrl();this.factory=options.socketFactory??(url=>new WebSocket(url));this.now=options.now??(()=>performance.now());
  if(options.autoResume!==false){try{const saved=JSON.parse(sessionStorage.getItem(RESUME_STORAGE_KEY)??'null');if(saved&&typeof saved.token==='string'&&/^[A-Za-z0-9_-]{32}$/.test(saved.token)){this.token=saved.token;this.roomCode=typeof saved.code==='string'?saved.code:'';this.reconnect();}}catch{/* Online reconnect is still available in memory when storage is blocked. */}}
 }
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 private notify():void{if(!this.disposed)for(const listener of this.listeners)listener();}
 private remember():void{try{if(this.token)sessionStorage.setItem(RESUME_STORAGE_KEY,JSON.stringify({token:this.token,code:this.roomCode}));else sessionStorage.removeItem(RESUME_STORAGE_KEY);}catch{/* No storage permission is required for this duel. */}}
 private send(message:ClientMessage):boolean{if(this.socket?.readyState!==1)return false;try{this.socket.send(JSON.stringify(message));return true;}catch{return false;}}
 private intent(message:Intent):void{this.send({...message,seq:++this.seq} as ClientMessage);}
 private terminal(message:string):void{this.cancelRetry();this.held=0;this.samples=[];this.projectiles=[];this.epoch++;this.socket?.close();this.socket=null;this.token=null;this.snapshot=null;this.seat=null;this.roomId=null;this.signature='';this.controlsSuspended=false;this.remember();this.connection='error';this.message=message;this.notify();}
 private cancelRetry():void{if(this.retry!==null){clearTimeout(this.retry);this.retry=null;}}
 private connect(first:ClientMessage,resuming:boolean):void{
  if(this.disposed)return;
  this.cancelRetry();const epoch=++this.epoch;this.socket?.close();this.socket=null;this.seq=0;this.held=0;this.lastInput=-Infinity;
  this.connection=resuming?'reconnecting':'connecting';this.message=resuming?'Reconnecting to your seat…':'Connecting…';this.notify();
  let socket:WebSocket;
  try{socket=this.factory(this.url);}catch{this.connection='error';this.message='Could not connect. Please try again shortly.';this.notify();return;}
  this.socket=socket;
  socket.onopen=()=>{if(this.epoch===epoch&&!this.disposed)this.send(first);};
  socket.onmessage=event=>{
   if(this.epoch!==epoch||this.disposed)return;
   const message=parseServerMessage(event.data,this.world);
   if(!message){this.terminal('The server sent incompatible game data. Refresh both players to the same version.');return;}
   if(message.type==='welcome'){
    this.seat=message.seat;this.token=message.token;this.roomId=message.roomId;this.roomCode=message.code;this.remember();
    this.connection='connected';this.message='Connected';this.seq=0;this.samples=[];
    this.intent({v:2,type:'compatible',rulesVersion:REALTIME_RULES_VERSION,mapId:MAP_ID,mapVersion:MAP_VERSION});this.notify();
   }else if(message.type==='snapshot'){
    const room=message.room;if(room.roomId!==this.roomId||(this.snapshot?.roomId===room.roomId&&room.revision<this.snapshot.revision))return;
    this.snapshot=frozen(room);this.connection='connected';
    const own=this.seat&&room.state?.shots[this.seat];
    const signature=`${room.state?.matchId}/${room.status}/${room.state?.phase}/${own?.phase}/${own?.projectile?.shotId}`;
    if(signature!==this.signature){this.signature=signature;this.held=0;this.lastInput=-Infinity;}
    const time=this.now();this.samples.push({time,room});if(this.samples.length>32)this.samples.shift();
    this.updateSamples(time);this.notify();
   }else if(message.type==='error'){
    this.message=message.message;
    if(['INVALID_TOKEN','EXPIRED_TOKEN','RESUME_EXPIRED','ROOM_NOT_FOUND','ROOM_FULL','ROOM_LIMIT','INCOMPATIBLE','BAD_MESSAGE','TOO_LARGE'].includes(message.code)){this.terminal(message.message);return;}
    this.notify();
   }else if(message.type==='ack'&&!message.accepted){this.message=message.code==='WRONG_PHASE'?'Wait for your missile to finish before firing again.':`Action not accepted: ${message.code??'try again'}`;this.notify();}
  };
  socket.onerror=()=>{if(this.epoch===epoch&&!this.disposed){this.message='Connection unavailable. Please try again shortly.';this.notify();}};
  socket.onclose=()=>{
   if(this.epoch!==epoch||this.disposed)return;
   this.socket=null;this.held=0;this.samples=[];this.projectiles=[];
   if(this.token){this.connection='reconnecting';this.message='Connection lost. Reconnecting…';this.retry=setTimeout(()=>{this.retry=null;this.reconnect();},1000);}
   else{this.connection='error';this.message='Connection closed. Create or join a room to try again.';}
   this.notify();
  };
 }
 createRoom():void{if(this.snapshot?.status==='playing')return;this.token=null;this.remember();this.snapshot=null;this.seat=null;this.roomId=null;this.connect({v:2,type:'create',requestId:`create-${++this.requestSerial}`},false);}
 joinRoom(code:string):void{if(this.snapshot?.status==='playing')return;code=code.trim().toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code)){this.terminal('Enter the six-character room code using letters and digits 2–9.');return;}this.token=null;this.remember();this.snapshot=null;this.seat=null;this.roomId=null;this.connect({v:2,type:'join',requestId:`join-${++this.requestSerial}`,code:code.trim().toUpperCase()},false);}
 reconnect():void{if(this.token)this.connect({v:2,type:'resume',requestId:`resume-${++this.requestSerial}`,token:this.token},true);else{this.connection='idle';this.message='Create or join a private room.';this.notify();}}
 ready():void{if(this.connection==='connected'&&this.snapshot?.status==='waiting')this.intent({v:2,type:'ready'});}
 fire():void{const r=this.snapshot,s=this.seat&&r?.state?.shots[this.seat];if(this.connection==='connected'&&!this.controlsSuspended&&r?.status==='playing'&&r.state?.phase==='playing'&&s?.phase==='ready')this.intent({v:2,type:'fire',matchId:r.state.matchId});}
 setControls(mask:KeyMask):void{if(!validMask(mask))throw new Error('Invalid input mask');this.held=this.controlsSuspended?0:mask;this.sendInput();}
 private sendInput():void{const r=this.snapshot,s=this.seat&&r?.state?.shots[this.seat];if(this.connection==='connected'&&r?.status==='playing'&&r.state?.phase==='playing'&&s?.phase==='flight'&&s.projectile){this.intent({v:2,type:'input',matchId:r.state.matchId,shotId:s.projectile.shotId,mask:this.controlsSuspended?0:this.held});this.lastInput=this.now();}}
 suspendControls():void{this.controlsSuspended=true;this.held=0;this.sendInput();this.notify();}
 resumeControls():void{this.controlsSuspended=false;this.held=0;this.lastInput=-Infinity;this.notify();}
 rematch():void{const r=this.snapshot;if(this.connection==='connected'&&r?.status==='ended'&&r.state)this.intent({v:2,type:'rematch',matchId:r.state.matchId});}
 leave():void{this.held=0;this.sendInput();this.intent({v:2,type:'leave'});this.cancelRetry();this.epoch++;this.socket?.close();this.socket=null;this.token=null;this.roomId=null;this.seat=null;this.snapshot=null;this.samples=[];this.projectiles=[];this.connection='idle';this.controlsSuspended=false;this.message='Create or join a private room.';this.remember();this.notify();}
 private updateSamples(time:number):void{
  const latest=this.snapshot;
  if(latest?.status!=='playing'||latest.state?.phase!=='playing'){this.projectiles=[];return;}
  const current=Object.values(latest.state.shots).flatMap(s=>s.projectile?[s.projectile]:[]);
  const samples=this.samples.filter(s=>s.room.state?.matchId===latest.state!.matchId&&s.room.state?.phase==='playing');
  if(!samples.length){this.projectiles=current;return;}
  const target=time-INTERPOLATION_DELAY_MS;
  let a=samples[0],b=samples[0];
  for(const sample of samples){if(sample.time<=target)a=sample;if(sample.time>=target){b=sample;break;}b=sample;}
  const t=b.time>a.time?clamp((target-a.time)/(b.time-a.time),0,1):1;
  this.projectiles=current.map(p=>{
   const pa=a.room.state?.shots[p.owner].projectile,pb=b.room.state?.shots[p.owner].projectile;
   if(!pa||!pb||pa.shotId!==p.shotId||pb.shotId!==p.shotId)return p;
   return {...p,position:{x:lerp(pa.position.x,pb.position.x,t),z:lerp(pa.position.z,pb.position.z,t)},heading:lerpAngle(pa.heading,pb.heading,t)};
  });
 }
 frame(timeMs:number):void{if(this.disposed)return;this.updateSamples(timeMs);if(this.now()-this.lastInput>=INPUT_HEARTBEAT_MS)this.sendInput();}
 dispose():void{if(this.disposed)return;this.held=0;this.sendInput();this.disposed=true;this.cancelRetry();this.epoch++;this.socket?.close();this.socket=null;this.samples=[];this.listeners.clear();}
}
