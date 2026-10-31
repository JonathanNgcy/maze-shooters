/** Excluded from production by import.meta.env.DEV in main. Named fixtures keep collision enabled. */
import { LocalSession } from './session';
import type { WorldGeometry } from '../shared/types';
export function developmentSession(world:WorldGeometry):LocalSession {
 const query=new URLSearchParams(location.search);
 const fixture=query.get('fixture');
 const selected:WorldGeometry=fixture==='duel'?{mapId:'test-duel',mapVersion:1,walls:[],spawns:[{id:'p1',position:{x:0,z:0},heading:Math.PI/2},{id:'p2',position:{x:3,z:0},heading:-Math.PI/2}]}:fixture==='arena'?{mapId:'test-arena',mapVersion:1,walls:[],spawns:[{id:'p1',position:{x:0,z:0},heading:Math.PI/2},{id:'p2',position:{x:100,z:100},heading:-Math.PI/2}]}:world;
 const session=new LocalSession(selected);
 let manual=query.get('manual')==='1';
 const frame=session.frame.bind(session);
 session.frame=(time:number)=>{if(!manual)frame(time);};
 Object.defineProperty(window,'__MAZE_TEST__',{configurable:true,value:{
  state:()=>structuredClone(session.current),
  paused:()=>session.paused,
  advance:(ticks:number)=>{if(!Number.isInteger(ticks)||ticks<0||ticks>5000)throw new Error('Invalid test ticks');for(let i=0;i<ticks;i++)session.step();},
  manual:(value:boolean)=>{session.pause();session.resume();manual=value;},
  diagnostics:()=>({droppedFrames:session.droppedFrames,canvasCount:document.querySelectorAll('canvas').length})
 }});
 return session;
}
