import { test, expect, type Page } from '@playwright/test';
import type { MatchState } from '../../src/shared/types';

interface Hook { state():MatchState; advance(ticks:number):void; paused():boolean }
type TestWindow=Window & {__MAZE_TEST__:Hook; __arrowEvents?:{code:string;prevented:boolean}[]};
const state=(page:Page)=>page.evaluate(()=>(window as unknown as TestWindow).__MAZE_TEST__.state());
const advance=(page:Page,ticks=1)=>page.evaluate(n=>(window as unknown as TestWindow).__MAZE_TEST__.advance(n),ticks);
const paint=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
async function open(page:Page,fixture='arena'){
 await page.goto(`/?test=1&manual=1${fixture?`&fixture=${fixture}`:''}`);
 await page.waitForFunction(()=>Boolean((window as unknown as TestWindow).__MAZE_TEST__));
 await expect(page.getByRole('button',{name:/^Ready/})).toBeVisible();
}
async function ready(page:Page){await page.getByRole('button',{name:/^Ready/}).click();await advance(page);}
async function fire(page:Page){await page.keyboard.press('Space');await advance(page);expect((await state(page)).projectile?.ageTicks).toBe(0);}
async function launch(page:Page){await open(page);await ready(page);await fire(page);}

// Compare full trajectories across fresh sessions rather than inspecting the input adapter's mask.
test('arrows reproduce the WASD trajectory through the real keyboard adapter',async({page})=>{
 const play=async(keys:string[])=>{
  await launch(page);
  await page.keyboard.down(keys[0]);await advance(page,40);await page.keyboard.up(keys[0]);
  await page.keyboard.down(keys[1]);await advance(page,25);await page.keyboard.up(keys[1]);
  await page.keyboard.down(keys[2]);await advance(page,20);await page.keyboard.up(keys[2]);
  await page.keyboard.down(keys[3]);await advance(page,25);await page.keyboard.up(keys[3]);
  await advance(page,20);return(await state(page)).projectile;
 };
 const wasd=await play(['w','d','s','a']);
 const arrows=await play(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft']);
 expect(arrows).toEqual(wasd);
});

test('overlapping aliases survive one key release and opposing arrow yaw cancels',async({page})=>{
 await launch(page);
 await page.keyboard.down('w');await page.keyboard.down('ArrowUp');await advance(page,10);
 const before=(await state(page)).projectile!;
 await page.keyboard.up('w');await advance(page,20);
 const retained=(await state(page)).projectile!;
 expect(retained.velocity.x).toBeGreaterThan(before.velocity.x);
 await page.keyboard.up('ArrowUp');await advance(page,20);
 const released=(await state(page)).projectile!;
 expect(released.velocity.x).toBeLessThan(retained.velocity.x);
 await page.keyboard.down('ArrowLeft');await page.keyboard.down('ArrowRight');await advance(page,25);
 const cancelled=(await state(page)).projectile!;
 expect(cancelled.heading).toBeCloseTo(released.heading,12);expect(cancelled.angularVelocity).toBe(0);
 await page.keyboard.up('ArrowLeft');await advance(page,20);
 expect((await state(page)).projectile!.heading).toBeGreaterThan(cancelled.heading);
 await page.keyboard.up('ArrowRight');
});

test('arrows held before launch or pause require a fresh release and press',async({page})=>{
 await open(page);await ready(page);
 await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowRight');await fire(page);
 await advance(page,30);
 const coast=(await state(page)).projectile!;
 expect(coast.heading).toBeCloseTo(Math.PI/2,12);expect(coast.velocity.x).toBeLessThan(5);
 await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowRight');await advance(page,15);
 expect((await state(page)).projectile!.angularVelocity).toBe(0);
 await page.keyboard.up('ArrowUp');await page.keyboard.up('ArrowRight');
 await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowRight');await advance(page,20);
 const steering=(await state(page)).projectile!;
 expect(steering.angularVelocity).toBeGreaterThan(0);expect(steering.velocity.x).toBeGreaterThan(coast.velocity.x);
 await page.keyboard.press('Escape');const frozen=await state(page);await advance(page,100);expect(await state(page)).toEqual(frozen);
 await page.getByRole('button',{name:/^Resume/}).click();
 await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowRight');await advance(page,20);
 const resumed=(await state(page)).projectile!;
 expect(Math.hypot(resumed.velocity.x,resumed.velocity.z)).toBeLessThan(Math.hypot(steering.velocity.x,steering.velocity.z));
 expect(resumed.angularVelocity).toBeLessThan(steering.angularVelocity);
 await page.keyboard.up('ArrowUp');await page.keyboard.up('ArrowRight');
 await page.keyboard.down('ArrowRight');await advance(page,10);await page.keyboard.up('ArrowRight');
 expect((await state(page)).projectile!.angularVelocity).toBeGreaterThan(resumed.angularVelocity);
});

test('arrow scrolling is captured only on the active game surface in flight',async({page})=>{
 await open(page);await ready(page);
 // The observer runs after the game listener and records defaultPrevented on genuine keyboard events.
 await page.evaluate(()=>{
  (window as unknown as TestWindow).__arrowEvents=[];
  window.addEventListener('keydown',event=>{if(event.code.startsWith('Arrow'))(window as unknown as TestWindow).__arrowEvents!.push({code:event.code,prevented:event.defaultPrevented});});
 });
 await page.keyboard.press('ArrowUp');
 expect(await page.evaluate(()=>(window as unknown as TestWindow).__arrowEvents!.at(-1)?.prevented)).toBe(false);
 await fire(page);await page.keyboard.press('ArrowUp');
 expect(await page.evaluate(()=>(window as unknown as TestWindow).__arrowEvents!.at(-1)?.prevented)).toBe(true);
 await page.keyboard.down('ArrowUp');await advance(page,10);
 const before=(await state(page)).projectile!;
 await page.evaluate(()=>{const editor=document.createElement('input');editor.setAttribute('aria-label','Arrow input check');document.querySelector('#app')!.append(editor);editor.focus();});
 await page.keyboard.down('ArrowUp');await page.keyboard.down('ArrowRight');await advance(page,20);
 await page.keyboard.up('ArrowRight');
 const after=(await state(page)).projectile!;
 expect(after.heading).toBeCloseTo(before.heading,12);expect(after.velocity.x).toBeLessThan(before.velocity.x);
 expect(await page.evaluate(()=>(window as unknown as TestWindow).__arrowEvents!.slice(-2).every(e=>!e.prevented))).toBe(true);
 await page.locator('#app').focus();await page.keyboard.down('ArrowUp');await advance(page,10);
 const blocked=(await state(page)).projectile!;expect(blocked.velocity.x).toBeLessThan(after.velocity.x);
 await page.keyboard.up('ArrowUp');await page.keyboard.down('ArrowUp');await advance(page,10);await page.keyboard.up('ArrowUp');
 expect((await state(page)).projectile!.velocity.x).toBeGreaterThan(blocked.velocity.x);
 await page.keyboard.press('Escape');await page.keyboard.press('ArrowUp');
 expect(await page.evaluate(()=>(window as unknown as TestWindow).__arrowEvents!.at(-1)?.prevented)).toBe(false);
});

test('wall splashes persist privately across turns, deduplicate results, cap memory and reset on rematch',async({page})=>{
 await open(page,'');
 const result=await page.evaluate(async()=>{
  const effectsPath='/src/client/effects.ts',threePath='/tests/e2e/three-fixture.ts';
  const worldPath='/src/maze/build.ts',simPath='/src/sim/index.ts';
  const [{createFlightEffects},THREE,{buildWorld},sim]=await Promise.all([import(effectsPath),import(threePath),import(worldPath),import(simPath)]);
  const world=buildWorld();const worldBefore=JSON.stringify(world);const scene=new THREE.Scene();const effects=createFlightEffects(scene,world);
  let match=sim.createMatch(world,{matchId:'visual-history',matchNumber:1,opener:'p1'});
  const marks1=scene.getObjectByName('impacts-p1'),marks2=scene.getObjectByName('impacts-p2');
  const observe=()=>effects.observe(match);
  const command=(type:string)=>{match=sim.applyCommand(match,world,{type,matchId:match.matchId,turnId:match.turnId,playerId:match.activePlayer}).state;observe();};
  const miss=()=>{command('ready');command('fire');for(let i=0;i<2160&&match.phase==='flight';i++){match=sim.stepMatch(match,world,0);observe();}if(match.result?.reason!=='wall')throw new Error('Expected ordinary canonical wall impact');};
  observe();miss();const firstResult=match.result;
  const retainedMatch=match;const immutableBefore=JSON.stringify(match);
  for(let i=0;i<100;i++)observe();
  const dedupCount=marks1.children.length;
  const originalMark=marks1.children[0];let oldMarkDisposals=0;originalMark.geometry.addEventListener('dispose',()=>oldMarkDisposals++);
  for(let i=0;i<90;i++){match=sim.stepMatch(match,world,0);observe();}
  const opponentTurn={p1Count:marks1.children.length,p1Visible:marks1.visible,p2Visible:marks2.visible};
  miss();for(let i=0;i<90;i++){match=sim.stepMatch(match,world,0);observe();}
  const ownReturn={p1Count:marks1.children.length,p2Count:marks2.children.length,p1Visible:marks1.visible,p2Visible:marks2.visible};
  const colors={p1:marks1.children[0].material.color.getHexString(),p2:marks2.children[0].material.color.getHexString()};
  const depthTest=marks1.children[0].material.depthTest&&marks2.children[0].material.depthTest;
  const wall=world.walls.find((w:any)=>w.id===firstResult.colliderId);
  const positions=originalMark.geometry.getAttribute('position');
  let clipped=true;
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
   // Paint may be offset slightly toward the corridor, but cannot extend beyond the wall-face bounds.
   const onX=Math.min(Math.abs(x-wall.minX),Math.abs(x-wall.maxX))<.006;
   const onZ=Math.min(Math.abs(z-wall.minZ),Math.abs(z-wall.maxZ))<.006;
   clipped&&=y>=0&&y<=3&&((onX&&z>=wall.minZ-1e-6&&z<=wall.maxZ+1e-6)||(onZ&&x>=wall.minX-1e-6&&x<=wall.maxX+1e-6));
  }
  // Feed presentation snapshots for a long history without inventing shots in the live game.
  for(let shot=3;shot<=75;shot++)effects.observe({...match,phase:'resolve',activePlayer:shot%2?'p1':'p2',result:{...firstResult,shotId:shot,shooter:shot%2?'p1':'p2'}});
  const bounded={p1:marks1.children.length,p2:marks2.children.length,oldMarkDisposals};
  effects.observe({...match,matchId:'visual-rematch',matchNumber:2,opener:'p2',activePlayer:'p2'});
  const reset={p1:marks1.children.length,p2:marks2.children.length};
  const immutable=JSON.stringify(world)===worldBefore&&JSON.stringify(retainedMatch)===immutableBefore;
  // Retained authoritative result values were never altered by presentation.
  const originalResultPreserved=firstResult.shotId===1&&firstResult.shooter==='p1';
  effects.dispose();effects.dispose();
  return{dedupCount,opponentTurn,ownReturn,colors,depthTest,clipped,bounded,reset,immutable,originalResultPreserved,groupsRemoved:!scene.getObjectByName('impacts-p1')&&!scene.getObjectByName('smoke-pool')};
 });
 expect(result.dedupCount).toBe(1);
 expect(result.opponentTurn).toEqual({p1Count:1,p1Visible:false,p2Visible:true});
 expect(result.ownReturn).toEqual({p1Count:1,p2Count:1,p1Visible:true,p2Visible:false});
 expect(result.colors.p1).not.toBe(result.colors.p2);expect(result.depthTest).toBe(true);expect(result.clipped).toBe(true);
 expect(result.bounded).toEqual({p1:32,p2:32,oldMarkDisposals:1});expect(result.reset).toEqual({p1:0,p2:0});
 expect(result.immutable).toBe(true);expect(result.originalResultPreserved).toBe(true);expect(result.groupsRemoved).toBe(true);
});

test('smoke stays bounded, freezes with paused snapshots, clears between shots and honors reduced motion',async({page})=>{
 await open(page,'');
 const result=await page.evaluate(async()=>{
  const effectsPath='/src/client/effects.ts',threePath='/tests/e2e/three-fixture.ts';
  const simPath='/src/sim/index.ts';
  const [{createFlightEffects},THREE,sim]=await Promise.all([import(effectsPath),import(threePath),import(simPath)]);
  const scene=new THREE.Scene();const world={mapId:'smoke-arena',mapVersion:1,walls:[],spawns:[{id:'p1',position:{x:0,z:0},heading:Math.PI/2},{id:'p2',position:{x:100,z:100},heading:-Math.PI/2}]};
  const effects=createFlightEffects(scene,world);const smoke=scene.getObjectByName('smoke-pool');
  let match=sim.createMatch(world,{matchId:'smoke-check',matchNumber:1,opener:'p1'});
  for(const type of ['ready','fire'])match=sim.applyCommand(match,world,{type,matchId:match.matchId,turnId:1,playerId:'p1'}).state;
  let maxVisible=0;const snapshot=()=>smoke.children.map((p:any)=>({visible:p.visible,position:p.position.toArray(),scale:p.scale.toArray(),opacity:p.material.opacity}));
  const beforeSimulation=JSON.stringify(match);
  effects.observe(match);const immutableLaunch=JSON.stringify(match)===beforeSimulation;
  for(let tick=0;tick<600;tick++){match=sim.stepMatch(match,world,1);effects.observe(match);maxVisible=Math.max(maxVisible,smoke.children.filter((p:any)=>p.visible).length);}
  const liveVisible=smoke.children.filter((p:any)=>p.visible).length;const frozen=JSON.stringify(snapshot());
  for(let frame=0;frame<120;frame++)effects.observe(match);
  const pauseFrozen=JSON.stringify(snapshot())===frozen;
  const terminal={...match,tick:match.tick+1,phase:'resolve',projectile:null,result:{reason:'timeout',shotId:1,shooter:'p1',endpoint:match.projectile.position,victim:null,colliderId:null},resolveTicksRemaining:90};
  effects.observe(terminal);const resultFrozen=JSON.stringify(snapshot());
  effects.observe({...terminal,tick:terminal.tick+89,resolveTicksRemaining:1});
  const resolveFrozen=JSON.stringify(snapshot())===resultFrozen;
  effects.observe({...terminal,phase:'handoff',activePlayer:'p2',result:null,resolveTicksRemaining:0});
  const cleared=smoke.children.every((p:any)=>!p.visible);
  const capacity=smoke.children.length;
  effects.dispose();
  return{capacity,maxVisible,liveVisible,pauseFrozen,resolveFrozen,cleared,immutableLaunch};
 });
 expect(result.capacity).toBeLessThanOrEqual(24);expect(result.maxVisible).toBeGreaterThan(0);expect(result.maxVisible).toBeLessThanOrEqual(24);
 expect(result.liveVisible).toBeGreaterThan(0);expect(result.pauseFrozen).toBe(true);expect(result.resolveFrozen).toBe(true);expect(result.cleared).toBe(true);expect(result.immutableLaunch).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});
 const reduced=await page.evaluate(async()=>{
  const effectsPath='/src/client/effects.ts',threePath='/tests/e2e/three-fixture.ts';
  const [{createFlightEffects},THREE]=await Promise.all([import(effectsPath),import(threePath)]);
  const scene=new THREE.Scene();const effects=createFlightEffects(scene,{mapId:'reduced',mapVersion:1,walls:[],spawns:[]});
  for(let age=0;age<120;age++)effects.observe({matchId:'reduced',tick:age,phase:'flight',activePlayer:'p1',projectile:{shotId:1,owner:'p1',position:{x:age/120,z:0},velocity:{x:1,z:0},heading:Math.PI/2,angularVelocity:0,ageTicks:age},result:null});
  const smoke=scene.getObjectByName('smoke-pool');const visible=smoke.children.filter((p:any)=>p.visible).length;effects.dispose();return visible;
 });
 expect(reduced).toBe(0);
});

test('missile geometry fits its collision envelope and its rendered nose follows heading without changing physics',async({page})=>{
 await open(page,'');
 const result=await page.evaluate(async()=>{
  const effectsPath='/src/client/effects.ts',threePath='/tests/e2e/three-fixture.ts',scenePath='/src/client/scene.ts',worldPath='/src/maze/build.ts',simPath='/src/sim/index.ts';
  const [{createMissile},THREE,{createScene},{buildWorld},sim]=await Promise.all([import(effectsPath),import(threePath),import(scenePath),import(worldPath),import(simPath)]);
  const missile=createMissile();missile.root.updateMatrixWorld(true);let maxRadius=0;let resources=0;let disposed=0;
  const geometries=new Set<any>(),materials=new Set<any>();
  missile.root.traverse((part:any)=>{if(!part.isMesh)return;const positions=part.geometry.getAttribute('position');for(let i=0;i<positions.count;i++){const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(part.matrixWorld);maxRadius=Math.max(maxRadius,p.length());}geometries.add(part.geometry);materials.add(part.material);});
  for(const resource of [...geometries,...materials]){resources++;resource.addEventListener('dispose',()=>disposed++);}
  const names=missile.root.children.map((part:any)=>part.name);
  missile.dispose();
  const world=buildWorld();const canvas=document.createElement('canvas');const rendered=createScene(canvas,world);
  let match=sim.createMatch(world,{matchId:'missile-heading',matchNumber:1,opener:'p1'});
  for(const type of ['ready','fire'])match=sim.applyCommand(match,world,{type,matchId:match.matchId,turnId:1,playerId:'p1'}).state;
  for(let i=0;i<20;i++)match=sim.stepMatch(match,world,8);
  const snapshot=JSON.stringify(match);rendered.update(match,match.projectile,false);rendered.scene.updateMatrixWorld(true);
  const nose=rendered.scene.getObjectByName('missile-nose').getWorldPosition(new THREE.Vector3());
  const engine=rendered.scene.getObjectByName('missile-engine').getWorldPosition(new THREE.Vector3());
  const axis=nose.sub(engine).normalize();const heading=match.projectile.heading;
  const aligned=axis.dot(new THREE.Vector3(Math.sin(heading),0,-Math.cos(heading)));
  const visible=rendered.scene.getObjectByName('missile').visible;
  rendered.update(match,match.projectile,true);const noseViewHidden=!rendered.scene.getObjectByName('missile').visible;
  const unchanged=JSON.stringify(match)===snapshot;
  rendered.dispose();
  return{maxRadius,names,resources,disposed,aligned,visible,noseViewHidden,unchanged};
 });
 expect(result.maxRadius).toBeLessThanOrEqual(.1200001);
 expect(result.names).toEqual(expect.arrayContaining(['missile-body','missile-nose','missile-engine','missile-fin-0','missile-fin-3']));
 expect(result.disposed).toBe(result.resources);expect(result.aligned).toBeGreaterThan(.999999);expect(result.visible).toBe(true);expect(result.noseViewHidden).toBe(true);expect(result.unchanged).toBe(true);
});

test('canonical flight and private impact render without browser errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await open(page,'');await ready(page);await fire(page);
 await page.keyboard.down('ArrowUp');await advance(page,12);await page.keyboard.up('ArrowUp');
 await advance(page,90);await paint(page);
 await page.screenshot({path:'artifacts/polish-flight.png'});
 // Advance in small rendered chunks so the frozen impact view retains the actual chase approach.
 for(let i=0;i<100&&(await state(page)).phase==='flight';i++){await advance(page,5);await paint(page);}
 expect((await state(page)).result?.reason).toBe('wall');
 await page.screenshot({path:'artifacts/polish-impact.png'});
 expect(errors).toEqual([]);
});

test('the actual app records an impact whose complete resolve passes between render frames',async({page})=>{
 await open(page,'');
 const result=await page.evaluate(async()=>{
  const appPath='/src/client/app.ts',threePath='/tests/e2e/three-fixture.ts',worldPath='/src/maze/build.ts',sessionPath='/src/local/session.ts';
  const [{createApp},THREE,{buildWorld},{LocalSession}]=await Promise.all([import(appPath),import(threePath),import(worldPath),import(sessionPath)]);
  const session=new LocalSession(buildWorld());session.frame=()=>{};
  const root=document.createElement('section');root.tabIndex=0;root.style.cssText='position:fixed;width:1280px;height:720px;visibility:hidden';document.body.append(root);
  const originalAdd=THREE.Object3D.prototype.add;let scene:any=null;
  THREE.Object3D.prototype.add=function(...objects:any[]){if(objects.some(o=>o.name==='smoke-pool'))scene=this;return originalAdd.apply(this,objects);};
  let app:any;
  try{app=createApp(root,session);}finally{THREE.Object3D.prototype.add=originalAdd;}
  session.command('ready');session.step();session.command('fire');session.step();
  // This synchronous block provides no requestAnimationFrame opportunity at the impact/result boundary.
  for(let tick=0;tick<1000&&session.current.phase!=='handoff';tick++)session.step();
  const group=scene.getObjectByName('impacts-p1');
  const observed={phase:session.current.phase,activePlayer:session.current.activePlayer,count:group.children.length,visible:group.visible,shotId:group.children[0]?.userData.shotId};
  app.dispose();session.dispose();root.remove();return observed;
 });
 expect(result).toEqual({phase:'handoff',activePlayer:'p2',count:1,visible:false,shotId:1});
});
