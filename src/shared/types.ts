export type Vec2 = Readonly<{x:number; z:number}>;
export type PlayerId = 'p1'|'p2';
export type Phase = 'handoff'|'ready'|'flight'|'resolve'|'gameOver';
export type KeyMask = number;
export type Wall = Readonly<{id:string;minX:number;maxX:number;minZ:number;maxZ:number}>;
export type PlayerSpawn = Readonly<{id:PlayerId;position:Vec2;heading:number}>;
export type WorldGeometry = Readonly<{mapId:string;mapVersion:number;walls:readonly Wall[];spawns:readonly PlayerSpawn[]}>;
export type ProjectileState = Readonly<{shotId:number;owner:PlayerId;position:Vec2;velocity:Vec2;heading:number;angularVelocity:number;ageTicks:number}>;
export type ShotResult = Readonly<{reason:'wall'|'timeout'|'hit';shotId:number;shooter:PlayerId;endpoint:Vec2;victim:PlayerId|null;colliderId:string|null}>;
export type CommandContext = Readonly<{matchId:string;turnId:number}>;
export type MatchCommand = CommandContext & Readonly<{type:'ready'|'fire';playerId:PlayerId}>;
export type MatchState = Readonly<{matchId:string;matchNumber:number;opener:PlayerId;tick:number;phase:Phase;activePlayer:PlayerId;turnId:number;nextShotId:number;projectile:ProjectileState|null;result:ShotResult|null;resolveTicksRemaining:number;winner:PlayerId|null}>;
export type Collision = Readonly<{time:number;reason:'wall'|'hit';colliderId:string;victim:PlayerId|null}>;
export type Replay = {rulesVersion:number;mapId:string;mapVersion:number;shooter:PlayerId;runs:{ticks:number;mask:KeyMask}[]};
/** Presentation may request intent; only authority replaces snapshots. */
export interface SessionAPI {
 readonly world:WorldGeometry;
 readonly current:MatchState;
 readonly previous:MatchState;
 readonly paused:boolean;
 readonly pauseReason:string;
 readonly alpha:number;
 command(type:'ready'|'fire'):void;
 setControls(mask:KeyMask):void;
 pause(reason?:string):void;
 resume():void;
 rematch():void;
 frame(timeMs:number):void;
 subscribe(listener:()=>void):()=>void;
}
