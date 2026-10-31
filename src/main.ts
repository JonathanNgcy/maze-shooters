import {buildWorld} from './maze/build';
import {LocalSession} from './local/session';
import {createApp} from './client/app';
import './client/styles.css';
const root=document.querySelector<HTMLElement>('#app')!;
async function start():Promise<void>{
 try{
  const world=buildWorld();
  const query=new URLSearchParams(location.search);
  if(query.has('online')){
   document.title='Maze Shooters — Online Duel';
   const [{RealtimeSession},{createOnlineApp}]=await Promise.all([import('./network/session'),import('./client/online-app')]);
   const session=new RealtimeSession(world),app=createOnlineApp(root,session);
   if(import.meta.env.DEV&&query.has('test'))Object.defineProperty(window,'__MAZE_ONLINE_TEST__',{configurable:true,value:Object.freeze({snapshot:()=>session.snapshot,seat:()=>session.seat,connection:()=>session.connection})});
   const dispose=()=>{app.dispose();session.dispose();};
   window.addEventListener('pagehide',dispose,{once:true});
   if(import.meta.hot)import.meta.hot.dispose(()=>{window.removeEventListener('pagehide',dispose);dispose();delete (window as unknown as Record<string,unknown>).__MAZE_ONLINE_TEST__;});
   return;
  }
  const session=import.meta.env.DEV&&new URLSearchParams(location.search).has('test')
   ?(await import('./local/development')).developmentSession(world):new LocalSession(world);
  const app=createApp(root,session);
  const dispose=()=>{app.dispose();session.dispose();};
  window.addEventListener('pagehide',dispose,{once:true});
  if(import.meta.hot)import.meta.hot.dispose(()=>{window.removeEventListener('pagehide',dispose);dispose();});
 }catch(error){root.replaceChildren();const title=document.createElement('h1');title.textContent='Maze Shooters could not start';const message=document.createElement('p');message.textContent=error instanceof Error?error.message:String(error);root.append(title,message);}
}
void start();
