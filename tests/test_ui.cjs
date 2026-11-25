'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const artifacts = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(artifacts, {recursive:true});
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'),'utf8');
// Test-only closure probe. Production HTML on disk is never changed.
const qaHTML=html.replace('let state = Engine.createRun(), selectedId', 'let state = (globalThis.__qaState = Engine.createRun()), selectedId')
  .replace('state=Engine.createRun();','state=(globalThis.__qaState=Engine.createRun());');
assert.notEqual(qaHTML,html);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:844,height:390},reducedMotion:'reduce',deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 let passes=0;
 async function check(name,fn){await fn();passes++;console.log(`PASS ${name}`);}
 async function load(){await page.goto('about:blank');await page.setContent(qaHTML,{waitUntil:'load'});await page.waitForSelector('.unit');}
 async function inspect(){return await page.evaluate(()=>Sekasoko.inspect());}
 async function ready(){await page.waitForFunction(()=>Sekasoko.inspect().phase==='player'&&!document.querySelector('#waitBtn').disabled);}
 async function select(type,side='player'){
   const id=await page.evaluate(({type,side})=>__qaState.units.find(u=>u.type===type&&u.side===side).id,{type,side});
   await page.locator(`[data-unit-id="${id}"]`).click();return id;
 }
 try{
 await load();
 await check('Offline HTML initializes 35 cells, 8 pieces, and 1F player phase',async()=>{
   assert.equal(await page.locator('.cell').count(),35);assert.equal(await page.locator('.unit').count(),8);
   const s=await inspect();assert.equal(s.floor,1);assert.equal(s.phase,'player');assert.equal(await page.locator('#phaseBadge').textContent(),'あなたの手番');
 });
 await check('Real piece click highlights precisely the engine legal moves and shows status',async()=>{
   const id=await select('knight');
   const expected=await page.evaluate(id=>Sekasoko.Engine.moves(__qaState,id).map(p=>`${p.x},${p.y}`).sort(),id);
   const actual=await page.locator('.cell.legal').evaluateAll(es=>es.map(e=>`${e.dataset.x},${e.dataset.y}`).sort());
   assert.deepEqual(actual,expected);assert.equal(await page.locator('.unit.is-selected').count(),1);
   assert.match(await page.locator('#inspectorBody').textContent(),/騎士/);
 });
 await check('Real move consumes one action and AI responds exactly once',async()=>{
   const before=await inspect();
   await page.locator('.cell[data-x="2"][data-y="1"]').click();
   await ready();const after=await inspect();
   assert.equal(after.totalActions,before.totalActions+2);assert.equal(after.turn,before.turn+2);
   const n=after.units.find(u=>u.side==='player'&&u.type==='knight');assert.deepEqual([n.x,n.y],[2,1]);
   await page.waitForTimeout(150);assert.equal((await inspect()).totalActions,after.totalActions);
 });
 await check('Wait without selection ends the turn and receives one AI response',async()=>{
   const before=await inspect();assert.equal(await page.locator('.unit.is-selected').count(),0);
   await page.locator('#waitBtn').click();await ready();
   assert.equal((await inspect()).totalActions,before.totalActions+2);
 });
 await check('Help displays all ten characters, traps focus, and closes',async()=>{
   await page.locator('#helpBtn').click();assert.equal(await page.locator('.master-table tbody tr').count(),10);
   assert.equal(await page.locator('#overlay').isVisible(),true);
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'closeRulesBtn');
   await page.keyboard.press('Escape');assert.equal(await page.locator('#overlay').isVisible(),false);
 });
 await check('Restart cancel preserves progress; confirm restores initial game',async()=>{
   const before=await inspect();await page.locator('#restartBtn').click();await page.locator('#cancelRestartBtn').click();
   assert.deepEqual(await inspect(),before);
   await page.locator('#restartBtn').click();await page.locator('#confirmRestartBtn').click();
   const s=await inspect();assert.equal(s.floor,1);assert.equal(s.turn,1);assert.equal(s.totalActions,0);assert.equal(s.roster.length,3);
 });
 await check('Actual attack buttons acquire a candidate, then king kill opens formation and commits it',async()=>{
   await page.evaluate(()=>{
     const s=__qaState,a=s.units.find(u=>u.side==='player'&&u.type==='archer');a.x=3;a.y=2;
     const slime=s.units.find(u=>u.side==='enemy'&&u.type==='slime');slime.x=4;slime.y=2;slime.hp=1;
     s.units.find(u=>u.side==='enemy'&&u.type==='king').hp=1;
   });
   const id=await select('archer');
   assert.ok(await page.locator('.cell.attackable').count()>0);
   const slime=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='slime').id);
   await page.locator(`[data-unit-id="${slime}"]`).click();await ready();
   assert.deepEqual((await inspect()).candidates,['slime']);assert.equal((await inspect()).roster.length,3);
   assert.match(await page.locator('#lootList').textContent(),/スライム/);
   await page.locator(`[data-unit-id="${id}"]`).click();
   const king=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='king').id);
   await page.locator(`[data-unit-id="${king}"]`).click();await page.waitForSelector('#nextFloorBtn');
   const s=await inspect();assert.equal(s.phase,'victory');assert.deepEqual(s.lastRewards,['slime']);assert.equal(s.roster.length,4);
   assert.match(await page.locator('.rewards').textContent(),/スライム/);await page.screenshot({path:path.join(artifacts,'formation.png')});
 });
 await check('Formation buttons reject fourth piece, allow duplicate types, and deploy them healed on 2F',async()=>{
   let s=await inspect();const acquired=s.roster.at(-1).id;const knight=s.roster.find(u=>u.type==='knight').id;
   await page.locator(`[data-roster="${acquired}"]`).click();assert.equal((await inspect()).formation.length,3);
   assert.match(await page.locator('#toast').textContent(),/最大3体/);
   await page.locator(`[data-roster="${knight}"]`).click();
   await page.locator(`[data-roster="${acquired}"]`).click();
   s=await inspect();assert.equal(s.formation.length,3);
   assert.equal(s.formation.filter(id=>s.roster.find(p=>p.id===id).type==='slime').length,2);
   await page.locator('#nextFloorBtn').click();await ready();s=await inspect();
   assert.equal(s.floor,2);assert.equal(s.phase,'player');assert.equal(s.turn,1);
   assert.equal(s.units.filter(u=>u.side==='player'&&u.type==='slime').length,2);
   assert.ok(s.units.every(u=>u.hp===u.maxHp));assert.equal(await page.locator('#overlay').isVisible(),false);
 });
 await check('Enemy king-lethal response opens defeat and retry creates a fresh run',async()=>{
   await load();await page.evaluate(()=>{
     const s=__qaState,k=s.units.find(u=>u.side==='player'&&u.type==='king');k.x=4;k.y=2;k.hp=1;s.candidates=['slime'];
   });
   await page.locator('#waitBtn').click();await page.waitForSelector('#retryBtn');
   let s=await inspect();assert.equal(s.phase,'defeat');assert.equal(s.candidates.length,0);assert.equal(s.roster.length,3);
   await page.locator('#retryBtn').click();await ready();s=await inspect();assert.equal(s.floor,1);assert.equal(s.totalActions,0);
 });
 await check('10F king kill opens clear screen and retry resets the adventure',async()=>{
   await load();await page.evaluate(()=>{
     const s=__qaState;s.floor=10;
     const a=s.units.find(u=>u.side==='player'&&u.type==='archer');a.x=3;a.y=2;
     s.units.find(u=>u.side==='enemy'&&u.type==='king').hp=1;
   });
   await select('archer');const king=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='king').id);
   await page.locator(`[data-unit-id="${king}"]`).click();await page.waitForSelector('#retryBtn');
   assert.equal((await inspect()).phase,'clear');assert.match(await page.locator('#modal').textContent(),/10F踏破/);
   await page.locator('#retryBtn').click();await ready();assert.equal((await inspect()).floor,1);
 });
 for(const viewport of [{width:844,height:390},{width:667,height:375},{width:390,height:844}]){
   await check(`Responsive ${viewport.width}×${viewport.height} keeps 35 usable cells and avoids horizontal overflow`,async()=>{
     await page.setViewportSize(viewport);await load();await select('knight');
     const size=await page.evaluate(()=>{
       const b=document.querySelector('#board').getBoundingClientRect();
       return {sw:document.documentElement.scrollWidth,w:innerWidth,bw:b.width,bh:b.height};
     });
     assert.ok(size.sw<=size.w,JSON.stringify(size));assert.ok(size.bw>0&&size.bh>0,JSON.stringify(size));assert.equal(await page.locator('.cell').count(),35);
     await page.locator('#helpBtn').click();
     const modalOverflow=await page.locator('#modal').evaluate(e=>e.scrollWidth-e.clientWidth);
     assert.ok(modalOverflow<=1,`modal overflow ${modalOverflow}`);await page.locator('#closeRulesBtn').click();
   });
 }
 assert.deepEqual(errors,[]);console.log(`PASS No browser page or console errors\n\n${passes+1}/${passes+1} browser checks passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
