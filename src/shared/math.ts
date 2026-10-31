import type { Vec2, PlayerId } from './types';
export const clamp = (n:number,lo:number,hi:number):number => Math.max(lo,Math.min(hi,n));
export const wrapAngle = (n:number):number => ((n+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
export const forward = (heading:number):Vec2 => ({x:Math.sin(heading),z:-Math.cos(heading)});
export const otherPlayer = (id:PlayerId):PlayerId => id==='p1'?'p2':'p1';
export const validMask = (mask:number):boolean => Number.isInteger(mask)&&mask>=0&&mask<=15;
export const lerp = (a:number,b:number,t:number):number => a+(b-a)*t;
export const lerpAngle = (a:number,b:number,t:number):number => a+wrapAngle(b-a)*t;
