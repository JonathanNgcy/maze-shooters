import { DT, MAX_FRAME_SECONDS, MAX_FRAME_STEPS } from '../shared/config';
import { validMask } from '../shared/math';
import type { KeyMask, MatchCommand, MatchState, PlayerId, SessionAPI, WorldGeometry } from '../shared/types';
import { createMatch, applyCommand, stepMatch, createRematch } from '../sim';

/** One authority boundary: successful commands consume the tick, invalid ones never stall flight. */
export function tickMatch(state:MatchState,world:WorldGeometry,commands:readonly MatchCommand[],mask:KeyMask):MatchState {
  if(!validMask(mask)) throw new Error('Invalid control mask');
  if(state.phase==='gameOver') return state;
  for(const command of commands){
    const applied=applyCommand(state,world,command);
    if(applied.accepted) return {...applied.state,tick:state.tick+1};
  }
  return stepMatch(state,world,mask);
}
function freezeSnapshot(state:MatchState):MatchState {
  if(state.projectile){Object.freeze(state.projectile.position);Object.freeze(state.projectile.velocity);Object.freeze(state.projectile);}
  if(state.result){Object.freeze(state.result.endpoint);Object.freeze(state.result);}
  return Object.freeze(state);
}
export class LocalSession implements SessionAPI {
  readonly world:WorldGeometry;
  current:MatchState;
  previous:MatchState;
  paused=false;
  pauseReason='';
  private remainder=0;
  private timeOrigin:number|null=null;
  private controls:KeyMask=0;
  private commands:MatchCommand[]=[];
  private listeners=new Set<()=>void>();
  private serial=1;
  /** Local diagnostic, never presented as match state or included in production globals. */
  droppedFrames=0;
  get alpha():number{return this.remainder/DT;}
  constructor(world:WorldGeometry,opener:PlayerId='p1'){
    this.world=world;
    this.current=freezeSnapshot(createMatch(world,{matchId:'local-1',matchNumber:1,opener}));
    this.previous=this.current;
  }
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  private notify():void {for(const listener of this.listeners) listener();}
  command(type:'ready'|'fire'):void {
    if(this.paused) return;
    const {matchId,turnId,activePlayer:playerId}=this.current;
    this.commands.push({type,matchId,turnId,playerId});
  }
  /** Also used by headless acceptance to exercise rejection of stale contexts. */
  enqueue(command:MatchCommand):void{if(!this.paused)this.commands.push({...command});}
  setControls(mask:KeyMask):void {
    if(!validMask(mask)) throw new Error('Invalid control mask');
    this.controls=!this.paused&&this.current.phase==='flight'?mask:0;
  }
  private resetClock():void {this.remainder=0;this.timeOrigin=null;this.previous=this.current;}
  private clearIntent():void {this.controls=0;this.commands=[];}
  pause(reason='Paused'):void {
    if(this.current.phase==='gameOver'||this.paused)return;
    this.paused=true;this.pauseReason=reason;this.clearIntent();this.resetClock();this.notify();
  }
  resume():void {
    if(!this.paused)return;
    this.paused=false;this.pauseReason='';this.clearIntent();this.resetClock();this.notify();
  }
  rematch():void {
    if(this.current.phase!=='gameOver')return;
    this.current=freezeSnapshot(createRematch(this.current,this.world,`local-${++this.serial}`));
    this.paused=false;this.pauseReason='';this.clearIntent();this.resetClock();this.notify();
  }
  step():void {
    if(this.paused)return;
    const old=this.current;
    const queue=this.commands;this.commands=[];
    this.current=freezeSnapshot(tickMatch(old,this.world,queue,this.controls));
    const boundary=old.phase!==this.current.phase||old.matchId!==this.current.matchId;
    this.previous=boundary?this.current:old;
    if(boundary)this.clearIntent();
    if(old!==this.current)this.notify();
  }
  frame(timeMs:number):void {
    if(!Number.isFinite(timeMs))return;
    if(this.paused){this.timeOrigin=null;return;}
    if(this.timeOrigin===null){this.timeOrigin=timeMs;return;}
    const raw=Math.max(0,(timeMs-this.timeOrigin)/1000);this.timeOrigin=timeMs;
    if(raw>MAX_FRAME_SECONDS)this.droppedFrames++;
    this.remainder+=Math.min(raw,MAX_FRAME_SECONDS);
    let steps=0;
    while(this.remainder+1e-12>=DT&&steps<MAX_FRAME_STEPS){this.remainder=Math.max(0,this.remainder-DT);this.step();steps++;}
    if(this.remainder+1e-12>=DT){this.remainder%=DT;this.droppedFrames++;}
  }
  dispose():void {this.clearIntent();this.listeners.clear();this.paused=true;this.resetClock();}
}
