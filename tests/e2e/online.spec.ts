import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { RoomSnapshot } from '../../src/shared/realtime';
import type { PlayerId } from '../../src/shared/types';

interface OnlineInspection {
 snapshot():RoomSnapshot|null;
 seat():PlayerId|null;
 connection():string;
}
type OnlineWindow=Window & {__MAZE_ONLINE_TEST__:OnlineInspection;__ONLINE_QA_RESULTS__?:string[]};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as OnlineWindow).__MAZE_ONLINE_TEST__.snapshot());
const ownSeat=(page:Page)=>page.evaluate(()=>(window as unknown as OnlineWindow).__MAZE_ONLINE_TEST__.seat());
const connection=(page:Page)=>page.evaluate(()=>(window as unknown as OnlineWindow).__MAZE_ONLINE_TEST__.connection());
const paint=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
async function canvasFingerprint(page:Page):Promise<string>{
 const captured=await page.evaluate(()=>new Promise<{image:string;colors:number}>(resolve=>requestAnimationFrame(()=>{
  const canvas=document.querySelector<HTMLCanvasElement>('canvas')!;
  const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
  const ctx=copy.getContext('2d')!;ctx.drawImage(canvas,0,0);
  const colors=new Set<string>();for(const[x,y]of[[.15,.25],[.5,.5],[.5,.9],[.85,.25]])colors.add([...ctx.getImageData(Math.floor(x*copy.width),Math.floor(y*copy.height),1,1).data].join(','));
  resolve({image:copy.toDataURL('image/png'),colors:colors.size});
 })));
 expect(captured.colors).toBeGreaterThan(1);
 return createHash('sha256').update(captured.image).digest('hex');
}
const visited=(page:Page)=>page.locator('.exploration-map .exploration-cell[data-kind="visited"]').evaluateAll(cells=>cells.map(el=>Number((el as HTMLElement).dataset.cell)).sort((a,b)=>a-b));
const poll={timeout:6000,intervals:[50,100,150]};
interface DelayEvidence { forward:number[]; backward:number[]; jitter:number[] }
interface Duel { p1:Page; p2:Page; contexts:BrowserContext[]; code:string; errors:string[]; delay:DelayEvidence; received:Record<PlayerId,RoomSnapshot[]>; close():Promise<void> }

async function openOnline(page:Page,baseURL='http://127.0.0.1:5173',inspection=true){
 await page.goto(`${baseURL}/?online=1${inspection?'&test=1':''}`);
 await expect(page.locator('.online-create')).toBeVisible();
 await expect(page.locator('.online-graphics-error')).toBeHidden();
 if(inspection)await page.waitForFunction(()=>Boolean((window as unknown as OnlineWindow).__MAZE_ONLINE_TEST__));
 await page.evaluate(()=>{
  const log:string[]=[];(window as unknown as OnlineWindow).__ONLINE_QA_RESULTS__=log;
  const result=document.querySelector('.online-result')!;
  new MutationObserver(()=>{const text=result.textContent;if(text&&log.at(-1)!==text)log.push(text);}).observe(result,{childList:true,subtree:true});
 });
}
async function connectDuel(browser:Browser,baseURL='http://127.0.0.1:5173',inspection=true,roundTripDelayMs=0):Promise<Duel>{
 const delay:DelayEvidence={forward:[],backward:[],jitter:[]};
 const contexts=await Promise.all([browser.newContext({viewport:{width:1280,height:720}}),browser.newContext({viewport:{width:1280,height:720}})]);
 if(roundTripDelayMs>0)for(const context of contexts)await context.routeWebSocket(/\/duel$/,client=>{
  const server=client.connectToServer();
  const queues={forward:Promise.resolve(),backward:Promise.resolve()};
  const indices={forward:0,backward:0};
  const forward=(message:string|Buffer,toServer:boolean)=>{
   const direction=toServer?'forward':'backward',started=performance.now();
   const jitter=(indices[direction]++%3)*5;delay.jitter.push(jitter);
   const due=started+roundTripDelayMs/2+jitter;
   // Test-only delay/jitter: preserve packet order and send each original payload to the real authority.
   queues[direction]=queues[direction].then(()=>new Promise<void>(resolve=>setTimeout(()=>{
    try{(toServer?server:client).send(message);delay[direction].push(performance.now()-started);}catch{/* Context teardown may cancel an in-flight packet. */}resolve();
   },Math.max(0,due-performance.now()))));
  };
  client.onMessage(message=>forward(message,true));server.onMessage(message=>forward(message,false));
 });
 const [p1,p2]=await Promise.all(contexts.map(context=>context.newPage()));
 const errors:string[]=[];
 const received:Record<PlayerId,RoomSnapshot[]>={p1:[],p2:[]};
 for(const[seat,page]of[['p1',p1],['p2',p2]] as const){
  page.on('pageerror',error=>errors.push(error.message));
  page.on('websocket',socket=>socket.on('framereceived',frame=>{
   try{const message=JSON.parse(frame.payload.toString());if(message.type==='snapshot'&&message.room){received[seat].push(message.room as RoomSnapshot);if(received[seat].length>1000)received[seat].shift();}}catch{/* Non-JSON frames are validated by the actual client. */}
  }));
 }
 try{
  await Promise.all([openOnline(p1,baseURL,inspection),openOnline(p2,baseURL,inspection)]);
  await p1.locator('.online-create').click();
  await expect(p1.locator('.online-room-code')).toHaveText(/^[A-Z0-9]{4,8}$/);
  const code=(await p1.locator('.online-room-code').textContent())!.trim();
  await p2.locator('.online-join-code').fill(code.toLowerCase());await p2.locator('.online-join').click();
  await expect(p2.locator('.online-room-code')).toHaveText(code);
  await expect(p1.locator('.online-seat-p1')).toContainText('Player 1 · you');
  await expect(p2.locator('.online-seat-p2')).toContainText('Player 2 · you');
  await expect(p1.locator('.online-ready')).toBeEnabled();await expect(p2.locator('.online-ready')).toBeEnabled();
  if(inspection){expect(await ownSeat(p1)).toBe('p1');expect(await ownSeat(p2)).toBe('p2');}
  await p1.locator('.online-ready').click();
  await expect(p1.locator('.online-ready')).toBeDisabled();
  if(inspection)expect((await snapshot(p1))?.status).toBe('waiting');
  await p2.locator('.online-ready').click();
  await expect(p1.locator('.online-fire')).toBeVisible();await expect(p2.locator('.online-fire')).toBeVisible();
  await expect(p1.locator('.online-player')).toHaveText('Player 1 · you');await expect(p2.locator('.online-player')).toHaveText('Player 2 · you');
  return{p1,p2,contexts,code,errors,delay,received,close:async()=>{await Promise.all(contexts.map(context=>context.close()));}};
 }catch(error){await Promise.all(contexts.map(context=>context.close()));throw error;}
}
const test=base.extend<{duel:Duel}>({duel:async({browser},use)=>{const duel=await connectDuel(browser);try{await use(duel);}finally{await duel.close();}}});

// This mode uses live server time. The development hook only reads snapshots; it cannot step or mutate a duel.
test('two independent seats can fire together, steer only their missile and retain their own view and exploration',async({duel})=>{
 const{p1,p2,errors}=duel;
 expect(p1.context()).not.toBe(p2.context());
 expect(await p1.evaluate(()=>Object.keys((window as unknown as OnlineWindow).__MAZE_ONLINE_TEST__).sort())).toEqual(['connection','seat','snapshot']);
 await expect(p1.locator('.exploration-map')).toHaveAttribute('data-seat','p1');await expect(p2.locator('.exploration-map')).toHaveAttribute('data-seat','p2');
 const fixedView=await canvasFingerprint(p2);
 await p1.keyboard.down('Space');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('flight');
 await expect(p2.locator('.online-phase')).toHaveText('Your gun is ready');
 expect(await canvasFingerprint(p2)).toBe(fixedView);
 await p2.locator('.online-fire').click();
 await expect.poll(async()=>{const state=(await snapshot(p1))?.state;return state?.shots.p1.phase==='flight'&&state.shots.p2.phase==='flight';},poll).toBe(true);
 const fired=(await snapshot(p1))!.state!;
 const firstId=fired.shots.p1.projectile!.shotId,secondId=fired.shots.p2.projectile!.shotId;
 expect(firstId).not.toBe(secondId);
 await p1.keyboard.down('ArrowUp');await p1.keyboard.down('ArrowRight');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.heading??0,poll).toBeGreaterThan(Math.PI/2+.10);
 await p1.keyboard.up('ArrowUp');await p1.keyboard.up('ArrowRight');
 const steered=(await snapshot(p1))!.state!;
 expect(steered.shots.p2.projectile?.heading).toBeCloseTo(-Math.PI/2,9);
 expect(steered.shots.p2.projectile?.velocity.z).toBeCloseTo(0,9);
 expect(steered.shots.p1.projectile?.shotId).toBe(firstId);expect(steered.shots.p2.projectile?.shotId).toBe(secondId);
 await p1.keyboard.down('Space');await p1.keyboard.up('Space');
 expect((await snapshot(p1))!.state!.nextShotId).toBe(fired.nextShotId);
 const own1=(await snapshot(p1))!,own2=(await snapshot(p2))!;
 expect(own1.explored).toContain(10);expect(own2.explored).toContain(70);
 expect(own1.explored.some(cell=>cell>=64&&cell<=70)).toBe(false);expect(own2.explored.some(cell=>cell>=10&&cell<=16)).toBe(false);
 expect('explored'in own1.state!).toBe(false);expect('history'in own1.state!).toBe(false);
 expect(own1.history.every(result=>result.shooter==='p1')).toBe(true);expect(own2.history.every(result=>result.shooter==='p2')).toBe(true);
 await expect(p2.locator('.exploration-map .exploration-cell[data-cell="10"]')).toHaveAttribute('data-kind','fog');
 // Capture with one software-rendering context after assertions; the authority continues through disconnect grace.
 await p2.context().close();
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('ready');
 await p1.locator('.online-fire').click();
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.ageTicks??0,poll).toBeGreaterThanOrEqual(30);
 await paint(p1);await p1.screenshot({path:'artifacts/online-duel.png',timeout:10000});
 await p1.screenshot({path:'artifacts/submission-cover.png',timeout:10000});
 expect(errors).toEqual([]);
});

test('a wall miss returns only that gun to Ready while the other missile keeps flying; held Space cannot queue another shot',async({duel})=>{
 const{p1,p2}=duel;
 await p1.keyboard.down('Space');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('flight');
 const firstId=(await snapshot(p1))!.state!.shots.p1.projectile!.shotId;
 await p1.keyboard.down('w');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.ageTicks??0,poll).toBeGreaterThanOrEqual(90);
 await p2.locator('.online-fire').click();
 await expect.poll(()=>duel.received.p1.some(room=>room.state?.shots.p1.phase==='resolve'&&room.state.shots.p1.result?.shotId===firstId),poll).toBe(true);
 await expect.poll(()=>p1.evaluate(()=>(window as unknown as OnlineWindow).__ONLINE_QA_RESULTS__??[]),poll).toContain('Wall hit. Your gun will be ready again shortly.');
 await expect.poll(()=>duel.received.p1.some(room=>room.state?.shots.p1.phase==='ready'&&room.state.shots.p2.phase==='flight'&&room.history.some(result=>result.shotId===firstId)),poll).toBe(true);
 const rearmed=duel.received.p1.find(room=>room.state?.shots.p1.phase==='ready'&&room.state.shots.p2.phase==='flight'&&room.history.some(result=>result.shotId===firstId))!;
 expect(rearmed.status).toBe('playing');expect(rearmed.state?.phase).toBe('playing');
 expect(rearmed.history).toHaveLength(1);expect(rearmed.history[0].reason).toBe('wall');expect(rearmed.history[0].shooter).toBe('p1');
 await expect(p1.locator('.online-fire')).toBeVisible();
 const current=(await snapshot(p1))!;const nextId=current.state!.nextShotId,tick=current.state!.tick;
 await p1.keyboard.down('Space');
 await expect.poll(async()=>(await snapshot(p1))?.state?.tick??0,poll).toBeGreaterThanOrEqual(tick+24);
 expect((await snapshot(p1))?.state?.shots.p1.phase).toBe('ready');expect((await snapshot(p1))?.state?.nextShotId).toBe(nextId);
 await p1.keyboard.up('Space');await p1.keyboard.up('w');await p1.locator('.online-fire').click();
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('flight');
 expect((await snapshot(p1))?.state?.shots.p1.projectile?.shotId).not.toBe(firstId);
});

test('a real reverse-thrust self-hit ends both flights consistently and rematch needs both seats before clearing private maps',async({duel})=>{
 const{p1,p2}=duel;
 await p2.locator('.online-fire').click();await p1.keyboard.press('Space');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('flight');
 await p1.keyboard.down('s');
 await expect.poll(async()=>(await snapshot(p1))?.state?.phase,poll).toBe('resolve');
 const fatal=(await snapshot(p1))!;expect(fatal.outcome??fatal.state?.outcome).toEqual({cause:'hit',winner:'p2',loser:'p1',detail:'self_hit'});
 const frozenP2Age=fatal.state?.shots.p2.projectile?.ageTicks??null;
 const remaining=fatal.state!.resolveTicksRemaining;
 await expect.poll(async()=>(await snapshot(p1))?.state?.resolveTicksRemaining??remaining,poll).toBeLessThan(remaining-12);
 const resolving=(await snapshot(p1))!;
 if(resolving.state?.phase==='resolve')expect(resolving.state.shots.p2.projectile?.ageTicks??null).toBe(frozenP2Age);
 await p1.keyboard.up('s');
 await expect.poll(async()=>(await snapshot(p1))?.status,poll).toBe('ended');await expect.poll(async()=>(await snapshot(p2))?.status,poll).toBe('ended');
 const ended=(await snapshot(p1))!,otherEnded=(await snapshot(p2))!;
 expect(ended.outcome).toEqual({cause:'hit',winner:'p2',loser:'p1',detail:'self_hit'});expect(otherEnded.outcome).toEqual(ended.outcome);
 await expect(p1.locator('.online-end-detail')).toHaveText('Player 1 hit themselves. Player 2 wins.');await expect(p2.locator('.online-end-title')).toHaveText('Player 2 wins.');
 expect(ended.explored.length).toBeGreaterThan(0);expect(otherEnded.explored.length).toBeGreaterThan(0);
 const oldMatch=ended.state!.matchId;
 await p1.locator('.online-rematch').click();
 await expect.poll(async()=>(await snapshot(p1))?.seats.p1.rematch,poll).toBe(true);
 expect((await snapshot(p1))?.state?.matchId).toBe(oldMatch);expect((await snapshot(p1))?.status).toBe('ended');
 await expect(p1.locator('.online-rematch')).toBeDisabled();
 await p2.locator('.online-rematch').click();
 await expect.poll(async()=>(await snapshot(p1))?.status,poll).toBe('playing');await expect.poll(async()=>(await snapshot(p2))?.status,poll).toBe('playing');
 for(const page of[p1,p2]){
  const room=(await snapshot(page))!;
  expect(room.state?.matchId).not.toBe(oldMatch);expect(room.state?.matchNumber).toBe(2);expect(room.state?.nextShotId).toBe(1);
  expect(room.state?.shots.p1.phase).toBe('ready');expect(room.state?.shots.p2.phase).toBe('ready');expect(room.state?.outcome).toBeNull();
  expect(room.explored).toEqual([]);expect(room.history).toEqual([]);expect(await visited(page)).toEqual([]);
  await expect(page.locator('.online-fire')).toBeVisible();
 }
});

test('Escape suspends controls while server flight time continues and requires fresh input after Resume',async({duel})=>{
 const{p1}=duel;
 await p1.keyboard.press('Space');await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('flight');
 await p1.keyboard.down('w');await p1.keyboard.down('ArrowRight');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.angularVelocity??0,poll).toBeGreaterThan(.3);
 await p1.keyboard.press('Escape');await expect(p1.locator('.online-suspend')).toBeVisible();await expect(p1.getByRole('heading',{name:'Duel continues.'})).toBeVisible();
 const before=(await snapshot(p1))!.state!.shots.p1.projectile!;
 await p1.keyboard.down('ArrowUp');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.ageTicks??0,poll).toBeGreaterThanOrEqual(before.ageTicks+24);
 const continuing=(await snapshot(p1))!.state!.shots.p1.projectile!;
 expect(Math.hypot(continuing.velocity.x,continuing.velocity.z)).toBeLessThan(Math.hypot(before.velocity.x,before.velocity.z));
 expect(continuing.angularVelocity).toBeLessThan(before.angularVelocity);
 await p1.locator('.online-resume').click();await expect(p1.locator('.online-suspend')).toBeHidden();
 await p1.keyboard.down('ArrowUp');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.ageTicks??0,poll).toBeGreaterThanOrEqual(continuing.ageTicks+18);
 const coasting=(await snapshot(p1))!.state!.shots.p1.projectile!;
 expect(Math.hypot(coasting.velocity.x,coasting.velocity.z)).toBeLessThan(Math.hypot(continuing.velocity.x,continuing.velocity.z));
 await p1.keyboard.up('w');await p1.keyboard.up('ArrowRight');await p1.keyboard.up('ArrowUp');
 const nextId=(await snapshot(p1))!.state!.nextShotId;
 await p1.keyboard.press('Space');expect((await snapshot(p1))!.state!.nextShotId).toBe(nextId);
});

test('reload reconnects the same seat and live match without buffered controls or duplicate fire',async({duel})=>{
 const{p1,p2}=duel;
 await p1.keyboard.press('Space');await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.phase,poll).toBe('flight');
 // Brake normally before reloading so the real server has a safe, slowly coasting shot throughout graphics startup.
 await p1.keyboard.down('s');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.velocity.x??Infinity,poll).toBeLessThan(1.8);
 await p1.keyboard.up('s');await p1.keyboard.down('ArrowRight');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.angularVelocity??0,poll).toBeGreaterThan(.3);
 const before=(await snapshot(p1))!;const shotId=before.state!.shots.p1.projectile!.shotId;
 await p1.reload();await p1.waitForFunction(()=>Boolean((window as unknown as OnlineWindow).__MAZE_ONLINE_TEST__));
 await expect.poll(()=>connection(p1),poll).toBe('connected');expect(await ownSeat(p1)).toBe('p1');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.shotId,poll).toBe(shotId);
 const resumed=(await snapshot(p1))!;expect(resumed.roomId).toBe(before.roomId);expect(resumed.state?.matchId).toBe(before.state?.matchId);
 expect(resumed.state!.shots.p1.projectile!.ageTicks).toBeGreaterThan(before.state!.shots.p1.projectile!.ageTicks);
 await p1.keyboard.down('ArrowRight');await p1.keyboard.press('Space');
 const sample=(await snapshot(p1))!.state!.shots.p1.projectile!;
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.ageTicks??0,poll).toBeGreaterThanOrEqual(sample.ageTicks+24);
 const coast=(await snapshot(p1))!.state!.shots.p1.projectile!;
 expect(coast.angularVelocity).toBeLessThan(sample.angularVelocity);
 expect(Math.hypot(coast.velocity.x,coast.velocity.z)).toBeLessThan(Math.hypot(sample.velocity.x,sample.velocity.z));
 expect((await snapshot(p1))!.state!.nextShotId).toBe(before.state!.nextShotId);expect((await snapshot(p2))!.seats.p1.connected).toBe(true);
 await p1.keyboard.up('ArrowRight');await p1.keyboard.down('ArrowRight');
 await expect.poll(async()=>(await snapshot(p1))?.state?.shots.p1.projectile?.angularVelocity??0,poll).toBeGreaterThan(coast.angularVelocity+.15);
 await p1.keyboard.up('ArrowRight');
});

test('a third independent client cannot acquire a seat in an occupied room',async({duel,browser})=>{
 const third=await browser.newContext({viewport:{width:1280,height:720}});const page=await third.newPage();
 try{
  await openOnline(page);await page.locator('.online-join-code').fill(duel.code);await page.locator('.online-join').click();
  await expect.poll(()=>connection(page),poll).toBe('error');expect(await ownSeat(page)).toBeNull();expect(await snapshot(page)).toBeNull();
  await expect(page.locator('.online-network-message')).toContainText(/full|occupied|two players|unavailable/i);
  expect((await snapshot(duel.p1))?.seats.p1.connected).toBe(true);expect((await snapshot(duel.p2))?.seats.p2.connected).toBe(true);
  expect((await snapshot(duel.p1))?.status).toBe('playing');
 }finally{await third.close();}
});

base('production online mode connects through its proxy, accepts real inputs and exposes no development globals',async({browser})=>{
 const duel=await connectDuel(browser,'http://127.0.0.1:4173',false);
 try{
  for(const page of[duel.p1,duel.p2])expect(await page.evaluate(()=>({offline:'__MAZE_TEST__'in window,online:'__MAZE_ONLINE_TEST__'in window}))).toEqual({offline:false,online:false});
  await duel.p1.keyboard.press('Space');await expect(duel.p1.locator('.online-phase')).toHaveText('Your missile in flight');
  await expect(duel.p2.locator('.online-phase')).toHaveText('Your gun is ready');
  await duel.p1.keyboard.down('ArrowUp');await expect(duel.p1.locator('.online-speed')).not.toHaveText('5.0m/s');await duel.p1.keyboard.up('ArrowUp');
  await duel.p2.locator('.online-fire').click();await expect(duel.p2.locator('.online-phase')).toHaveText('Your missile in flight');
  await duel.p1.keyboard.press('Escape');await expect(duel.p1.locator('.online-suspend')).toBeVisible();
  expect(duel.errors).toEqual([]);
 }finally{await duel.close();}
});


for(const roundTripDelayMs of[100,250]){
 base(`real server clients agree on a self-hit and winner under ${roundTripDelayMs} ms round-trip WebSocket delay with ordered jitter`,async({browser})=>{
  const duel=await connectDuel(browser,'http://127.0.0.1:5173',true,roundTripDelayMs);
  try{
   await duel.p2.locator('.online-fire').click();await duel.p1.keyboard.press('Space');
   await expect.poll(async()=>(await snapshot(duel.p1))?.state?.shots.p1.phase,poll).toBe('flight');
   await duel.p1.keyboard.down('s');
   await expect.poll(async()=>(await snapshot(duel.p1))?.status,{...poll,timeout:10000}).toBe('ended');
   await expect.poll(async()=>(await snapshot(duel.p2))?.status,{...poll,timeout:10000}).toBe('ended');
   await duel.p1.keyboard.up('s');
   const a=(await snapshot(duel.p1))!,b=(await snapshot(duel.p2))!;
   expect(a.state?.matchId).toBe(b.state?.matchId);expect(a.state?.phase).toBe('gameOver');expect(b.state?.phase).toBe('gameOver');
   expect(a.outcome).toEqual({cause:'hit',winner:'p2',loser:'p1',detail:'self_hit'});expect(b.outcome).toEqual(a.outcome);
   expect(a.state?.nextShotId).toBe(3);expect(b.state?.nextShotId).toBe(3);
   expect(new Set(duel.delay.jitter).size).toBe(3);
   expect(duel.delay.forward.length).toBeGreaterThan(10);expect(duel.delay.backward.length).toBeGreaterThan(10);
   expect(Math.min(...duel.delay.forward)).toBeGreaterThanOrEqual(roundTripDelayMs/2-5);
   expect(Math.min(...duel.delay.backward)).toBeGreaterThanOrEqual(roundTripDelayMs/2-5);
   expect(duel.errors).toEqual([]);
  }finally{await duel.close();}
 });
}


base('an invalid room code leaves Create and Join available for correction',async({page})=>{
 await openOnline(page);await page.locator('.online-join-code').fill('!');await page.locator('.online-join').click();
 await expect(page.locator('.online-network-message')).toContainText(/code|six|6/i);
 await expect(page.locator('.online-create')).toBeEnabled();await expect(page.locator('.online-join')).toBeEnabled();
 expect(await ownSeat(page)).toBeNull();expect(await snapshot(page)).toBeNull();
 await page.locator('.online-create').click();await expect(page.locator('.online-room-code')).toHaveText(/^[A-Z2-9]{6}$/);
 await expect(page.locator('.online-ready')).toBeEnabled();
});
