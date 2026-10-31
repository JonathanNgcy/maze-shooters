import { test, expect, type Browser, type BrowserContext, type CDPSession, type Page, type WebSocketRoute } from '@playwright/test';
import type { RoomSnapshot } from '../../src/shared/realtime';
import type { PlayerId, ProjectileState } from '../../src/shared/types';

type Inspection=Window&{__MAZE_ONLINE_TEST__:{snapshot():RoomSnapshot|null;seat():PlayerId|null;connection():string}};
type Viewport={width:number;height:number};
type TouchPoint={x:number;y:number;id:number;radiusX:number;radiusY:number;force:number};
const portrait={width:390,height:844},landscape={width:844,height:390};
const poll={timeout:7000,intervals:[40,80,120]};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as Inspection).__MAZE_ONLINE_TEST__.snapshot());
const own=(page:Page,seat:PlayerId='p1')=>snapshot(page).then(room=>room?.state?.shots[seat].projectile??null);
const pad=(page:Page,control:string)=>page.locator(`[data-online-control="${control}"]`);
const speed=(projectile:ProjectileState)=>Math.hypot(projectile.velocity.x,projectile.velocity.z);
const phase=(page:Page,seat:PlayerId='p1')=>snapshot(page).then(room=>room?.state?.shots[seat].phase);
type ObservedInput={seq:number;mask:number;shotId:number};
interface PhoneDuel{p1:Page;p2:Page;contexts:BrowserContext[];touch:CDPSession;errors:string[];inputs:ObservedInput[];accepted:Set<number>;disconnect():Promise<void>;close():Promise<void>}

async function openPhone(page:Page,origin:string,inspection:boolean){
 await page.goto(`${origin}/?online=1&test=1`);
 await expect(page.locator('.online-create')).toBeVisible();
 if(inspection)await page.waitForFunction(()=>Boolean((window as unknown as Inspection).__MAZE_ONLINE_TEST__));
 await expect(page.locator('.online-graphics-error')).toBeHidden();
}
async function phoneDuel(browser:Browser,viewport:Viewport=portrait,origin='http://127.0.0.1:5173',inspection=true):Promise<PhoneDuel>{
 const contexts=await Promise.all([browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1}),browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1})]);
 let socket:WebSocketRoute|null=null;
 const inputs:ObservedInput[]=[],accepted=new Set<number>();
 await contexts[0].routeWebSocket(/\/duel$/,client=>{
  socket=client;inputs.length=0;accepted.clear();const server=client.connectToServer();
  client.onMessage(payload=>{
   try{const message=JSON.parse(payload.toString());if(message.type==='input')inputs.push({seq:message.seq,mask:message.mask,shotId:message.shotId});}catch{/* Forward every payload unchanged to the actual authority. */}
   server.send(payload);
  });
  server.onMessage(payload=>{
   try{const message=JSON.parse(payload.toString());if(message.type==='ack'&&message.accepted)accepted.add(message.seq);}catch{/* The real client still validates the server response. */}
   client.send(payload);
  });
 });
 const[p1,p2]=await Promise.all(contexts.map(context=>context.newPage()));
 const errors:string[]=[];for(const page of[p1,p2])page.on('pageerror',error=>errors.push(error.message));
 const touch=await contexts[0].newCDPSession(p1);
 await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 try{
  await Promise.all([openPhone(p1,origin,inspection),openPhone(p2,origin,inspection)]);
  await p1.locator('.online-create').tap();await expect(p1.locator('.online-room-code')).toHaveText(/^[A-Z2-9]{6}$/);
  const code=(await p1.locator('.online-room-code').textContent())!.trim();
  await p2.locator('.online-join-code').fill(code);await p2.locator('.online-join').tap();
  await expect(p2.locator('.online-room-code')).toHaveText(code);
  for(const page of[p1,p2])await expect(page.locator('.online-ready')).toBeEnabled();
  await p1.locator('.online-ready').tap();await p2.locator('.online-ready').tap();
  await expect(p1.locator('.online-fire')).toBeVisible();await expect(p2.locator('.online-fire')).toBeVisible();
  return{p1,p2,contexts,touch,errors,inputs,accepted,disconnect:async()=>{if(!socket)throw new Error('No real duel socket to close');await socket.close({code:1012,reason:'Mobile acceptance reconnect'});},close:async()=>{await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}).catch(()=>{});await Promise.all(contexts.map(context=>context.close()));}};
 }catch(error){await Promise.all(contexts.map(context=>context.close()));throw error;}
}
async function points(page:Page,controls:string[]):Promise<TouchPoint[]>{
 return Promise.all(controls.map(async(control,index)=>{const box=await pad(page,control).boundingBox();if(!box)throw new Error(`Touch control ${control} is not visible`);return{x:box.x+box.width/2,y:box.y+box.height/2,id:index+1,radiusX:7,radiusY:7,force:1};}));
}
async function hold(duel:PhoneDuel,controls:string[]){await duel.touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:await points(duel.p1,controls)});}
async function release(duel:PhoneDuel,cancel=false){await duel.touch.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}
async function fire(page:Page,seat:PlayerId='p1'){
 await page.locator('.online-fire').tap();await expect.poll(()=>phase(page,seat),poll).toBe('flight');
}
async function ageAfter(page:Page,age:number){await expect.poll(async()=>(await own(page))?.ageTicks??0,poll).toBeGreaterThanOrEqual(age);}
async function clearButtons(page:Page){for(const control of['forward','reverse','left','right'])await expect(pad(page,control)).toHaveAttribute('aria-pressed','false');}
async function coastAfterAcceptedStop(duel:PhoneDuel,fromIndex:number):Promise<ProjectileState>{
 let zero:ObservedInput|undefined;
 await expect.poll(()=>{zero=duel.inputs.slice(fromIndex).find(input=>input.mask===0);return zero?duel.accepted.has(zero.seq):false;},poll).toBe(true);
 await expect.poll(async()=>(await snapshot(duel.p1))?.lastProcessedSeq??0,poll).toBeGreaterThanOrEqual(zero!.seq);
 const before=(await own(duel.p1))!;expect(before.shotId).toBe(zero!.shotId);
 await ageAfter(duel.p1,before.ageTicks+18);const after=(await own(duel.p1))!;
 expect(after.shotId).toBe(before.shotId);
 expect(speed(after)).toBeLessThan(speed(before));expect(Math.abs(after.angularVelocity)).toBeLessThan(Math.abs(before.angularVelocity));
 expect(duel.inputs.filter(input=>input.seq>zero!.seq&&input.shotId===zero!.shotId&&input.mask!==0)).toEqual([]);
 return after;
}
async function phoneLayout(page:Page){
 const viewport=page.viewportSize()!;
 const overflow=await page.evaluate(()=>({width:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 expect(overflow.html).toBeLessThanOrEqual(overflow.width);expect(overflow.body).toBeLessThanOrEqual(overflow.width);
 const selectors=['.online-menu','.online-pilot','.online-telemetry','.exploration-map','[data-online-control="forward"]','[data-online-control="reverse"]','[data-online-control="left"]','[data-online-control="right"]'];
 const boxes:{selector:string;x:number;y:number;width:number;height:number}[]=[];
 for(const selector of selectors){const locator=page.locator(selector);if(!await locator.isVisible())continue;const box=(await locator.boundingBox())!;
  expect(box.x,selector).toBeGreaterThanOrEqual(0);expect(box.y,selector).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width,selector).toBeLessThanOrEqual(viewport.width+1);expect(box.y+box.height,selector).toBeLessThanOrEqual(viewport.height+1);
  if(selector.includes('data-online-control')||selector==='.online-menu'){expect(box.width,selector).toBeGreaterThanOrEqual(44);expect(box.height,selector).toBeGreaterThanOrEqual(44);expect(await locator.evaluate(element=>{const b=element.getBoundingClientRect(),top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return top===element||element.contains(top);})).toBe(true);}
  boxes.push({selector,...box});
 }
 const map=boxes.find(box=>box.selector==='.exploration-map');
 if(map)for(const other of boxes.filter(box=>box!==map)){const overlap=Math.max(0,Math.min(map.x+map.width,other.x+other.width)-Math.max(map.x,other.x))*Math.max(0,Math.min(map.y+map.height,other.y+other.height)-Math.max(map.y,other.y));expect(overlap,`map overlaps ${other.selector}`).toBe(0);}
}

for(const viewport of[portrait,landscape]){
 test(`phone ${viewport.width}x${viewport.height} supports simultaneous fire and held multi-touch thrust/yaw without covering the HUD`,async({browser})=>{
  const duel=await phoneDuel(browser,viewport);const{p1,p2}=duel;
  try{
   await phoneLayout(p1);await p2.locator('.online-fire').tap();await fire(p1);
   await expect.poll(async()=>{const state=(await snapshot(p1))?.state;return state?.shots.p1.phase==='flight'&&state.shots.p2.phase==='flight';},poll).toBe(true);
   await phoneLayout(p1);await hold(duel,['forward','right']);
   await expect(pad(p1,'forward')).toHaveAttribute('aria-pressed','true');await expect(pad(p1,'right')).toHaveAttribute('aria-pressed','true');
   await expect.poll(async()=>(await own(p1))?.heading??0,poll).toBeGreaterThan(Math.PI/2+.10);
   const piloted=(await own(p1))!;expect(speed(piloted)).toBeGreaterThan(5);
   // Native touch cancellation must release every independently captured finger.
   const stopIndex=duel.inputs.length;await release(duel,true);await clearButtons(p1);
   await coastAfterAcceptedStop(duel,stopIndex);
   expect((await own(p2,'p2'))?.heading).toBeCloseTo(-Math.PI/2,9);
   await phoneLayout(p1);expect(duel.errors).toEqual([]);
   await p2.context().close();
   if((await phase(p1))!=='ready')await expect.poll(()=>phase(p1),poll).toBe('ready');
   await fire(p1);await ageAfter(p1,30);await p1.screenshot({path:`artifacts/mobile-${viewport.width}x${viewport.height}.png`,timeout:10000});
  }finally{await duel.close();}
 });
}

test('touch menu suspension clears captured fingers and requires a new touch after Resume',async({browser})=>{
 const duel=await phoneDuel(browser);const{p1}=duel;
 try{
  await fire(p1);await hold(duel,['reverse']);
  await expect.poll(async()=>(await own(p1))?.velocity.x??Infinity,poll).toBeLessThan(2);
  await release(duel);await hold(duel,['forward','right']);
  await expect.poll(async()=>(await own(p1))?.angularVelocity??0,poll).toBeGreaterThan(.3);
  const stopIndex=duel.inputs.length;
  await p1.locator('.online-menu').click();await expect(p1.locator('.online-suspend')).toBeVisible();await clearButtons(p1);
  await coastAfterAcceptedStop(duel,stopIndex);
  const resumeIndex=duel.inputs.length;
  await p1.locator('.online-resume').click();await expect(p1.locator('.online-suspend')).toBeHidden();await clearButtons(p1);
  const still=await coastAfterAcceptedStop(duel,resumeIndex);
  await release(duel);await hold(duel,['forward']);await expect(pad(p1,'forward')).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>{const p=await own(p1);return p?speed(p):0;},poll).toBeGreaterThan(speed(still)+.4);
  await release(duel);expect(duel.errors).toEqual([]);
 }finally{await duel.close();}
});

test('shot transitions and a real socket reconnect clear held touch controls',async({browser})=>{
 const duel=await phoneDuel(browser);const{p1}=duel;
 try{
  await fire(p1);await hold(duel,['forward','right']);
  await expect(pad(p1,'forward')).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>phase(p1),poll).toBe('ready');await clearButtons(p1);await release(duel);
  await fire(p1);await ageAfter(p1,18);const fresh=(await own(p1))!;
  expect(fresh.angularVelocity).toBe(0);expect(speed(fresh)).toBeLessThan(5);
  await hold(duel,['right']);await expect.poll(async()=>(await own(p1))?.angularVelocity??0,poll).toBeGreaterThan(.3);
  const before=(await snapshot(p1))!;await duel.disconnect();await clearButtons(p1);
  await expect.poll(()=>p1.evaluate(()=>(window as unknown as Inspection).__MAZE_ONLINE_TEST__.connection()),poll).toBe('connected');
  const resumed=(await snapshot(p1))!;expect(resumed.state?.matchId).toBe(before.state?.matchId);expect(resumed.state?.shots.p1.projectile?.shotId).toBe(before.state?.shots.p1.projectile?.shotId);
  const sample=resumed.state!.shots.p1.projectile!;await ageAfter(p1,sample.ageTicks+18);const coast=(await own(p1))!;
  expect(coast.angularVelocity).toBeLessThan(sample.angularVelocity);await clearButtons(p1);
  await release(duel);await hold(duel,['right']);await expect.poll(async()=>(await own(p1))?.angularVelocity??0,poll).toBeGreaterThan(coast.angularVelocity+.15);
  await release(duel);expect(duel.errors).toEqual([]);
 }finally{await duel.close();}
});

test('production Node serves the phone game and WebSocket duel from one HTTP origin without development hooks',async({browser,request})=>{
 const origin='http://127.0.0.1:4174';
 const root=await request.get(origin,{maxRedirects:0});expect(root.status()).toBe(302);expect(root.headers().location).toBe('/?online=1');
 const duel=await phoneDuel(browser,portrait,origin,false);const{p1,p2}=duel;
 try{
  for(const page of[p1,p2])expect(await page.evaluate(()=>({online:'__MAZE_ONLINE_TEST__'in window,offline:'__MAZE_TEST__'in window}))).toEqual({online:false,offline:false});
  await p2.locator('.online-fire').tap();await p1.locator('.online-fire').tap();await expect(p1.locator('.online-phase')).toHaveText('Your missile in flight');await expect(p2.locator('.online-phase')).toHaveText('Your missile in flight');
  await hold(duel,['forward','right']);await expect(pad(p1,'forward')).toHaveAttribute('aria-pressed','true');await expect(pad(p1,'right')).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>Number.parseFloat((await p1.locator('.online-speed').textContent())??'0'),poll).toBeGreaterThan(5.5);
  await release(duel,true);await clearButtons(p1);await phoneLayout(p1);expect(duel.errors).toEqual([]);
 }finally{await duel.close();}
});
