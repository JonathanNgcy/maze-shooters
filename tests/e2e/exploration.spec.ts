import { test, expect, type Page } from '@playwright/test';
import type { MatchState } from '../../src/shared/types';

interface Hook { state():MatchState; advance(ticks:number):void }
type TestWindow=Window & {__MAZE_TEST__:Hook};
const state=(page:Page)=>page.evaluate(()=>(window as unknown as TestWindow).__MAZE_TEST__.state());
const advance=(page:Page,ticks=1)=>page.evaluate(n=>(window as unknown as TestWindow).__MAZE_TEST__.advance(n),ticks);
const paint=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const map=(page:Page)=>page.locator('.exploration-map');
const visited=(page:Page)=>map(page).locator('.exploration-cell[data-kind="visited"]').evaluateAll(cells=>cells.map(cell=>Number((cell as HTMLElement).dataset.cell)).sort((a,b)=>a-b));
const cell=(page:Page,index:number)=>map(page).locator(`.exploration-cell[data-cell="${index}"]`);
async function open(page:Page){
 await page.goto('/?test=1&manual=1');
 await page.waitForFunction(()=>Boolean((window as unknown as TestWindow).__MAZE_TEST__));
 await expect(page.getByRole('button',{name:/^Ready/})).toBeVisible();
}
async function ready(page:Page){await page.getByRole('button',{name:/^Ready/}).click();await advance(page);}
async function fire(page:Page){await page.keyboard.press('Space');await advance(page);expect((await state(page)).projectile?.ageTicks).toBe(0);}
async function blankHandoff(page:Page){
 expect((await state(page)).phase).toBe('handoff');
 await expect(map(page)).toBeHidden();
 await expect(map(page).locator('.exploration-cell')).toHaveCount(0);
 await expect(map(page)).not.toHaveAttribute('data-seat',/./);
 await expect(map(page).locator('[data-marker="home"]')).toBeHidden();
 await expect(map(page).locator('[data-marker="projectile"]')).toBeHidden();
 expect(await map(page).locator('[data-marker]').evaluateAll(markers=>markers.every(marker=>!marker.hasAttribute('style')))).toBe(true);
}

// Canonical 9x9 north-up cells: p1 home=10; east corridor=11..16; p2 home=70.
test('real steering discovers only crossed corridors, marks own position and freezes discovery while paused',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await open(page);await blankHandoff(page);await ready(page);
 await expect(map(page)).toBeVisible();await expect(map(page)).toHaveAttribute('data-seat','p1');
 await expect(map(page).locator('.exploration-cell')).toHaveCount(81);
 const dimensions=await map(page).locator('.exploration-grid').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,rows:getComputedStyle(el).gridTemplateRows.split(' ').length}));
 expect(dimensions).toEqual({columns:9,rows:9});
 await expect(map(page).locator('[data-marker="home"]')).toBeVisible();
 await expect(map(page).locator('[data-marker="projectile"]')).toBeHidden();
 await expect(cell(page,21)).toHaveAttribute('data-kind','fog');
 await expect(cell(page,70)).toHaveAttribute('data-kind','fog');
 // A map has exactly the player's home and live missile marker, never another player marker.
 expect(await map(page).locator('[data-marker]').count()).toBe(2);
 expect(await map(page).getByLabel(/opponent/i).count()).toBe(0);
 await fire(page);await expect(map(page).locator('[data-marker="projectile"]')).toBeVisible();
 await page.keyboard.down('ArrowUp');await advance(page,60);
 await page.keyboard.down('ArrowRight');await advance(page,10);
 await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowUp');await advance(page,30);
 const flight=(await state(page)).projectile!;
 expect(flight.heading).toBeGreaterThan(Math.PI/2);
 expect(await visited(page)).toEqual([10,11,12,13]);
 // An adjacent but unflown open corridor and the far target remain hidden.
 await expect(cell(page,21)).toHaveAttribute('data-kind','fog');await expect(cell(page,70)).toHaveAttribute('data-kind','fog');
 await expect(cell(page,2)).toHaveAttribute('data-kind','wall');
 const known=await visited(page);
 await page.keyboard.press('Escape');const frozen=await state(page);await advance(page,1000);expect(await state(page)).toEqual(frozen);
 await page.getByRole('button',{name:/^Resume/}).click();expect(await visited(page)).toEqual(known);
 await paint(page);await page.screenshot({path:'artifacts/exploration-map.png'});await page.screenshot({path:'artifacts/smaller-maze.png'});
 expect(errors).toEqual([]);
});

test('each seat retains its own route across turns, including a whole shot skipped between render frames',async({page})=>{
 await open(page);await ready(page);await fire(page);
 // No RAF can run inside this synchronous advancement of flight, impact and all result ticks.
 await advance(page,1000);await blankHandoff(page);
 expect((await state(page)).activePlayer).toBe('p2');
 await ready(page);await expect(map(page)).toHaveAttribute('data-seat','p2');
 expect(await visited(page)).toEqual([]);
 for(const index of [10,11,12,13,14,15,16])await expect(cell(page,index)).toHaveAttribute('data-kind','fog');
 const home=await map(page).locator('[data-marker="home"]').evaluate(el=>({left:(el as HTMLElement).style.left,top:(el as HTMLElement).style.top}));
 expect(Number.parseFloat(home.left)).toBeCloseTo(100*7.5/9,3);expect(Number.parseFloat(home.top)).toBeCloseTo(100*7.5/9,3);
 await fire(page);await advance(page,1000);await blankHandoff(page);
 expect((await state(page)).activePlayer).toBe('p1');await ready(page);
 await expect(map(page)).toHaveAttribute('data-seat','p1');expect(await visited(page)).toEqual([10,11,12,13,14,15,16]);
 for(const index of [64,65,66,67,68,69,70])await expect(cell(page,index)).toHaveAttribute('data-kind','fog');
});

test('rematch clears both private maps and reload starts a fresh exploration session',async({page})=>{
 await open(page);await ready(page);await fire(page);
 // An ordinary reverse-thrust self-hit ends the duel after crossing the next launch tile.
 await page.keyboard.down('s');await advance(page,1000);await page.keyboard.up('s');
 expect((await state(page)).phase).toBe('gameOver');expect((await state(page)).result?.victim).toBe('p1');
 expect(await visited(page)).toContain(11);
 await page.getByRole('button',{name:/^Rematch/}).click();await blankHandoff(page);
 expect((await state(page)).activePlayer).toBe('p2');await ready(page);
 expect(await visited(page)).toEqual([]);await expect(cell(page,11)).toHaveAttribute('data-kind','fog');
 await fire(page);await advance(page,1000);await blankHandoff(page);await ready(page);
 // Player 2's new-match miss must not restore Player 1's previous-match route.
 expect((await state(page)).activePlayer).toBe('p1');expect(await visited(page)).toEqual([]);
 await expect(cell(page,11)).toHaveAttribute('data-kind','fog');
 await fire(page);await page.keyboard.down('w');await advance(page,90);await page.keyboard.up('w');
 expect((await visited(page)).length).toBeGreaterThanOrEqual(3);
 await page.reload();await page.waitForFunction(()=>Boolean((window as unknown as TestWindow).__MAZE_TEST__));
 await blankHandoff(page);await ready(page);
 expect(await visited(page)).toEqual([]);await expect(map(page)).toHaveAttribute('data-seat','p1');
 await expect(cell(page,11)).toHaveAttribute('data-kind','fog');
 await fire(page);await advance(page,1000);await blankHandoff(page);await ready(page);
 expect((await state(page)).activePlayer).toBe('p2');expect(await visited(page)).toEqual([]);
});

for(const viewport of [{width:1280,height:720},{width:1920,height:1080}]){
 test(`private map fits ${viewport.width}x${viewport.height} without overlapping HUD controls`,async({page})=>{
  await page.setViewportSize(viewport);await open(page);await ready(page);
  const noOverlap=async(selectors:string[])=>{
   const panel=await map(page).boundingBox();expect(panel).not.toBeNull();
   const current=page.viewportSize()!;
   expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.y).toBeGreaterThanOrEqual(0);
   expect(panel!.x+panel!.width).toBeLessThanOrEqual(current.width);expect(panel!.y+panel!.height).toBeLessThanOrEqual(current.height);
   for(const selector of selectors){const hud=await page.locator(selector).boundingBox();if(!hud)continue;const overlap=Math.max(0,Math.min(panel!.x+panel!.width,hud.x+hud.width)-Math.max(panel!.x,hud.x))*Math.max(0,Math.min(panel!.y+panel!.height,hud.y+hud.height)-Math.max(panel!.y,hud.y));expect(overlap,selector).toBe(0);}
  };
  await noOverlap(['.topbar','.pilot-strip','.ready-callout','.control-bar']);
  await fire(page);await advance(page,100);await noOverlap(['.topbar','.pilot-strip','.telemetry','.control-bar']);
  const cells=await visited(page);const snapshot=await state(page);
  await page.setViewportSize(viewport.width===1280?{width:1920,height:1080}:{width:1280,height:720});await paint(page);
  expect(await visited(page)).toEqual(cells);expect(await state(page)).toEqual(snapshot);
  await noOverlap(['.topbar','.pilot-strip','.telemetry','.control-bar']);
 });
}
