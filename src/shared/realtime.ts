import type { KeyMask, PlayerId, ProjectileState, ShotResult, WorldGeometry } from './types';

/** The simultaneous online mode is distinct from offline rulesVersion 1. */
export const REALTIME_PROTOCOL = 2;
export const REALTIME_RULES_VERSION = 2;
export const SNAPSHOT_INTERVAL_TICKS = 6;
export const INPUT_EXPIRY_TICKS = 12;
export const INPUT_HEARTBEAT_MS = 1000 / 30;
export const INTERPOLATION_DELAY_MS = 100;
export const DISCONNECT_GRACE_MS = 30_000;
export const READY_DEADLINE_MS = 30_000;
export const WAITING_ROOM_EXPIRY_MS = 120_000;
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
export const SHOT_HISTORY_LIMIT = 32;
export const MAX_SERVER_CATCHUP_TICKS = 30;
export const PLAYERS: readonly PlayerId[] = ['p1', 'p2'];

export type RealtimeShot = Readonly<{
  phase: 'ready' | 'flight' | 'resolve';
  projectile: ProjectileState | null;
  result: ShotResult | null;
  resolveTicksRemaining: number;
}>;
export type HitOutcome = Readonly<{ cause:'hit'; winner:PlayerId; loser:PlayerId; detail:'hit'|'self_hit' }>;
export type DrawOutcome = Readonly<{ cause:'draw'; winner:null; loser:null; detail:'simultaneous_hits' }>;
export type DuelOutcome = HitOutcome | DrawOutcome;
export type RoomOutcome = DuelOutcome | Readonly<{
  cause:'forfeit'; winner:PlayerId; loser:PlayerId; detail:'disconnect'|'leave'|'ready_deadline';
}>;
export type RealtimeMatchState = Readonly<{
  matchId:string;
  matchNumber:number;
  tick:number;
  phase:'playing'|'resolve'|'gameOver';
  nextShotId:number;
  shots:Readonly<Record<PlayerId, RealtimeShot>>;
  outcome:DuelOutcome|null;
  resolveTicksRemaining:number;
  explored:Readonly<Record<PlayerId, readonly number[]>>;
  history:Readonly<Record<PlayerId, readonly ShotResult[]>>;
}>;
export type RealtimePublicState = Omit<RealtimeMatchState,'explored'|'history'>;
export type RealtimeFire = Readonly<{ type:'fire'; matchId:string; playerId:PlayerId }>;
export type RealtimeControls = Readonly<Record<PlayerId,KeyMask>>;
export type RealtimeSeatStatus = Readonly<{
  connected:boolean; compatible:boolean; ready:boolean; rematch:boolean;
  readyDeadlineMs:number|null; disconnectDeadlineMs:number|null;
}>;
export type RoomSnapshot = Readonly<{
  roomId:string; code:string; revision:number; eventId:number; serverTimeMs:number;
  status:'waiting'|'playing'|'ended'|'abandoned'|'error';
  seats:Readonly<Record<PlayerId,RealtimeSeatStatus>>;
  state:RealtimePublicState|null;
  outcome:RoomOutcome|null;
  /** Only the receiving seat's complete exploration and result history. */
  explored:readonly number[];
  history:readonly ShotResult[];
  lastProcessedSeq:number;
}>;
export type ClientMessage =
  | Readonly<{v:2;type:'create';requestId:string}>
  | Readonly<{v:2;type:'join';requestId:string;code:string}>
  | Readonly<{v:2;type:'resume';requestId:string;token:string}>
  | Readonly<{v:2;type:'compatible';seq:number;rulesVersion:number;mapId:string;mapVersion:number}>
  | Readonly<{v:2;type:'ready';seq:number}>
  | Readonly<{v:2;type:'fire';seq:number;matchId:string}>
  | Readonly<{v:2;type:'input';seq:number;matchId:string;shotId:number;mask:KeyMask}>
  | Readonly<{v:2;type:'rematch';seq:number;matchId:string}>
  | Readonly<{v:2;type:'leave';seq:number}>
  | Readonly<{v:2;type:'ping';seq:number;clientTimeMs:number}>;
export type ServerMessage =
  | Readonly<{v:2;type:'welcome';requestId:string;roomId:string;code:string;seat:PlayerId;token:string;generation:number;rulesVersion:number;world:WorldGeometry}>
  | Readonly<{v:2;type:'snapshot';room:RoomSnapshot}>
  | Readonly<{v:2;type:'ack';seq:number;accepted:boolean;code?:string}>
  | Readonly<{v:2;type:'error';code:string;message:string}>
  | Readonly<{v:2;type:'pong';clientTimeMs:number;serverTimeMs:number}>;

/** A seat-specific presentation/intent interface, never a projected fake MatchState. */
export interface RealtimeSessionAPI {
  readonly world:WorldGeometry;
  readonly seat:PlayerId|null;
  readonly snapshot:RoomSnapshot|null;
  readonly connection:'idle'|'connecting'|'connected'|'reconnecting'|'closed'|'error';
  readonly message:string;
  readonly controlsSuspended:boolean;
  readonly projectiles:readonly ProjectileState[];
  createRoom():void;
  joinRoom(code:string):void;
  ready():void;
  fire():void;
  setControls(mask:KeyMask):void;
  suspendControls():void;
  resumeControls():void;
  rematch():void;
  leave():void;
  reconnect():void;
  frame(timeMs:number):void;
  subscribe(listener:()=>void):()=>void;
  dispose():void;
}
