'use strict';
// Offline interaction and geometry checks. State fixtures exist only in this test's in-memory HTML.
const { chromium }=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const artifacts=path.join(__dirname,'..','artifacts','responsive');
fs.mkdirSync(artifacts,{recursive:true});
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const qaHTML=html.replace('let state = Engine.createRun(), selectedId','let state = (globalThis.__qaState = Engine.createRun()), selectedId')
  .replace('state=Engine.createRun();','state=(globalThis.__qaState=Engine.createRun());');
assert.notEqual(qaHTML,html,'The test-only state capture must match the UI entry point.');
const PORTRAIT={width:390,height:844}, LANDSCAPE={width:844,height:390};
const viewports=[PORTRAIT,{width:375,height:667},{width:320,height:568},LANDSCAPE,{width:667,height:375},{width:812,height:375},{width:844,height:330},{width:1440,height:1000}];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:PORTRAIT,deviceScaleFactor:1});
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 let passed=0;
 async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
 async function load(viewport=PORTRAIT){await page.setViewportSize(viewport);await page.goto('about:blank');await page.setContent(qaHTML,{waitUntil:'load'});await page.waitForSelector('.unit');}
 async function snapshot(){return await page.evaluate(()=>Sekasoko.inspect());}
 async function ready(){await page.waitForFunction(()=>Sekasoko.inspect().phase==='player'&&!document.querySelector('#waitBtn').disabled);}
 async function select(type='knight'){
   const id=await page.evaluate(type=>__qaState.units.find(u=>u.type===type&&u.side==='player').id,type);
   await page.locator(`[data-unit-id="${id}"]`).click();return id;
 }
 async function selectedPresentation(){return {
   text:await page.locator('#inspectorBody').textContent(),
   selection:await page.locator('.unit.is-selected').getAttribute('data-unit-id'),
   moves:await page.locator('.cell.legal').evaluateAll(es=>es.map(e=>`${e.dataset.x},${e.dataset.y}`).sort()),
   targets:await page.locator('.unit.is-target').evaluateAll(es=>es.map(e=>e.dataset.unitId).sort())
 };}
 async function fixture(){
   await page.evaluate(()=>{
     const s=__qaState;s.turn=17;s.totalActions=16;s.candidates=['slime','goblin','slime'];
     s.roster.push({id:'qa-owned-slime',type:'slime'});
     s.units.find(u=>u.type==='knight'&&u.side==='player').hp=2;
     s.units.find(u=>u.type==='king'&&u.side==='player').hp=9;
     s.log.unshift('回転検証：獲得候補と残りHPを保持。');
   });
 }
 async function assertLayout(bottomInset=0){
   const report=await page.evaluate(bottomInset=>{
     const issues=[];const b=document.querySelector('#board').getBoundingClientRect();
     const rect=e=>e.getBoundingClientRect();
     const inside=r=>r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
     const cells=[...document.querySelectorAll('.cell')];
     if(document.documentElement.scrollWidth>innerWidth+1)issues.push('horizontal document overflow');
     if(!inside(b))issues.push(`board outside viewport ${JSON.stringify(b.toJSON())}`);
     if(b.bottom>innerHeight-bottomInset+1)issues.push('board overlaps the bottom safe area');
     if(innerHeight-b.bottom>48+bottomInset)issues.push(`board is not bottom anchored (${innerHeight-b.bottom}px gap)`);
     if(cells.length!==35)issues.push(`cell count ${cells.length}`);
     const first=rect(cells[0]);
     if(first.height>=first.width)issues.push(`cells are not vertically compressed (${first.width}×${first.height})`);
     for(const cell of cells){
       const r=rect(cell),x=+cell.dataset.x,y=+cell.dataset.y;
       if(Math.abs(r.width-first.width)>1||Math.abs(r.height-first.height)>1)issues.push(`unequal cell ${x},${y}`);
       if(Math.abs(r.left-(first.left+x*first.width))>1||Math.abs(r.top-(first.top+y*first.height))>1)issues.push(`misaligned cell ${x},${y}`);
       const cx=r.left+r.width/2,cy=r.top+r.height/2;
       if(cx<0||cx>innerWidth||cy<0||cy>innerHeight)issues.push(`cell center outside viewport ${x},${y}`);
       const occupied=Sekasoko.inspect().units.find(u=>u.x===x&&u.y===y);
       const hit=document.elementFromPoint(cx,cy);
       if(occupied ? hit?.closest('[data-unit-id]')?.dataset.unitId!==occupied.id : hit?.closest('.cell')!==cell)issues.push(`wrong hit layer at ${x},${y}`);
     }
     for(const selector of ['.topbar','#floorNum','#turnNum','#phaseBadge','#inspectorBody','#lootList','#logList','#waitBtn']){
       const e=document.querySelector(selector),r=rect(e);
       if(!e.checkVisibility()||r.width<=0||r.height<=0)issues.push(`hidden information ${selector}`);
       if(!inside(r))issues.push(`information outside viewport ${selector}`);
       if(r.bottom>b.top+1)issues.push(`information below board ${selector}`);
     }
     for(const e of document.querySelectorAll('[data-unit-id]')){
       const r=rect(e),hp=e.querySelector('.hp'),h=rect(hp),cx=r.left+r.width/2,cy=r.top+r.height/2;
       if(!inside(r)||!hp.checkVisibility()||!inside(h)||!/^\d+$/.test(hp.textContent))issues.push(`unit/HP not visible ${e.dataset.unitId}`);
       if(document.elementFromPoint(cx,cy)?.closest('[data-unit-id]')!==e)issues.push(`unit center blocked ${e.dataset.unitId}`);
     }
     return {issues,viewport:[innerWidth,innerHeight],board:b.toJSON(),cell:[first.width,first.height]};
   },bottomInset);
   assert.deepEqual(report.issues,[],JSON.stringify(report));
 }
 async function assertCTA(selector){
   const button=page.locator(selector);await button.scrollIntoViewIfNeeded();
   const report=await button.evaluate(e=>{
     const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),m=document.querySelector('#modal'),mr=m.getBoundingClientRect();
     return {visible:e.checkVisibility(),enabled:!e.disabled,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:hit===e||e.contains(hit),modalInside:mr.left>=0&&mr.top>=0&&mr.right<=innerWidth+1&&mr.bottom<=innerHeight+1,overflow:m.scrollWidth-m.clientWidth};
   });
   assert.deepEqual(report,{visible:true,enabled:true,inside:true,hit:true,modalInside:true,overflow:0});
 }
 async function rotateModal(selector){
   const before=await snapshot();
   for(const viewport of [PORTRAIT,LANDSCAPE,PORTRAIT]){
     await page.setViewportSize(viewport);await assertCTA(selector);assert.deepEqual(await snapshot(),before);
   }
 }
 async function attackKing(floor=1){
   await page.evaluate(floor=>{
     const s=__qaState;s.floor=floor;s.candidates=['slime','goblin'];
     const a=s.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;
     s.units.find(u=>u.type==='king'&&u.side==='enemy').hp=1;
   },floor);
   await select('archer');const id=await page.evaluate(()=>__qaState.units.find(u=>u.type==='king'&&u.side==='enemy').id);
   await page.locator(`[data-unit-id="${id}"]`).click();
 }
 try{
   for(const viewport of viewports)await check(`${viewport.width}×${viewport.height}: all information above the visible 7×5 board, HP and hit targets`,async()=>{
     await load(viewport);await select();await assertLayout();
     await page.screenshot({path:path.join(artifacts,`${viewport.width}x${viewport.height}.png`)});
   });
   await check('Portrait→landscape→portrait retains selected stats, exact highlights, damaged HP, candidates and full state',async()=>{
     await load();await fixture();await select();
     const before=await snapshot(),presentation=await selectedPresentation();
     assert.match(presentation.text,/騎士/);assert.match(presentation.text,/2/);
     for(const viewport of [LANDSCAPE,PORTRAIT]){
       await page.setViewportSize(viewport);await assertLayout();
       assert.deepEqual(await snapshot(),before);assert.deepEqual(await selectedPresentation(),presentation);
       assert.equal(await page.locator('#lootList .loot-chip').count(),3);
     }
   });
   await check('Ranged red targets survive rotation and a real target click deals damage followed by one AI response',async()=>{
     await load();await page.evaluate(()=>{
       const s=__qaState,a=s.units.find(u=>u.side==='player'&&u.type==='archer');a.x=3;a.y=2;
       const target=s.units.find(u=>u.side==='enemy'&&u.type==='slime');target.x=4;target.y=2;
     });
     const archer=await select('archer'),before=await snapshot(),presentation=await selectedPresentation();
     assert.ok(presentation.targets.length>0,'ranged fixture must expose red enemy targets');
     assert.ok(await page.locator('.cell.attackable').count()>0);
     for(const viewport of [LANDSCAPE,PORTRAIT]){
       await page.setViewportSize(viewport);await assertLayout();
       assert.deepEqual(await snapshot(),before);assert.deepEqual(await selectedPresentation(),presentation);
     }
     const target=before.units.find(u=>u.side==='enemy'&&u.type==='slime'&&u.x===4&&u.y===2);
     await page.locator(`[data-unit-id="${target.id}"]`).click();await ready();
     const after=await snapshot();assert.equal(after.units.find(u=>u.id===target.id).hp,target.hp-2);
     assert.equal(after.totalActions,before.totalActions+2);assert.equal(after.turn,before.turn+2);
     assert.ok(after.units.some(u=>u.id===archer));
     await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);
   });
   await check('Rotation during a player move animation preserves the action and produces exactly one AI response',async()=>{
     async function perform(rotating){
       await load();await fixture();await select();const before=await snapshot();
       await page.locator('.cell[data-x="3"][data-y="1"]').click();
       if(rotating){
         await page.waitForFunction(()=>document.querySelector('#board').getAnimations({subtree:true}).some(a=>a.playState==='running'));
         const inFlight=await snapshot();assert.equal(inFlight.totalActions,before.totalActions+1);
         await page.setViewportSize(LANDSCAPE);assert.deepEqual(await snapshot(),inFlight);
         await page.setViewportSize(PORTRAIT);
       }
       await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+2);
       await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);return after;
     }
     const control=await perform(false),rotated=await perform(true);assert.deepEqual(rotated,control);await assertLayout();
   });
   await check('Rotation while the enemy is thinking preserves candidates, roster, log and schedules one AI action',async()=>{
     async function perform(rotating){
       await load();await fixture();await select();const before=await snapshot();
       await page.locator('#waitBtn').click();
       if(rotating){
         await page.waitForFunction(()=>Sekasoko.inspect().phase==='enemy'&&document.querySelector('#waitBtn').disabled);
         const waiting=await snapshot();assert.equal(waiting.totalActions,before.totalActions+1);
         await page.setViewportSize(LANDSCAPE);assert.deepEqual(await snapshot(),waiting);
         await page.setViewportSize(PORTRAIT);
       }
       await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+2);
       await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);return after;
     }
     assert.deepEqual(await perform(true),await perform(false));await assertLayout();
   });
   await check('Help dialog survives both orientations and its return CTA remains scroll accessible',async()=>{
     await load();await page.locator('#helpBtn').click();assert.equal(await page.locator('.master-table tbody tr').count(),10);
     await rotateModal('#backToBoardBtn');await page.locator('#backToBoardBtn').click();assert.equal(await page.locator('#overlay').isVisible(),false);
   });
   await check('Large acquired-piece formation survives rotation and its next-floor CTA deploys the chosen team',async()=>{
     await load();await page.evaluate(()=>{
       for(let i=0;i<12;i++)__qaState.roster.push({id:`qa-spare-${i}`,type:i%2?'slime':'goblin'});
     });
     await attackKing();await page.waitForSelector('#nextFloorBtn');
     assert.equal((await snapshot()).phase,'victory');await rotateModal('#nextFloorBtn');
     await page.locator('#nextFloorBtn').click();await ready();assert.equal((await snapshot()).floor,2);await assertLayout();
   });
   await check('Defeat dialog preserves its state through rotation and retry is reachable in both orientations',async()=>{
     await load();await page.evaluate(()=>{
       const k=__qaState.units.find(u=>u.type==='king'&&u.side==='player');k.x=4;k.y=2;k.hp=1;__qaState.candidates=['slime'];
     });
     await page.locator('#waitBtn').click();await page.waitForSelector('#retryBtn');assert.equal((await snapshot()).phase,'defeat');
     await rotateModal('#retryBtn');await page.locator('#retryBtn').click();await ready();assert.equal((await snapshot()).floor,1);
   });
   await check('10F clear dialog preserves completion through rotation and retry is reachable in both orientations',async()=>{
     await load();await attackKing(10);await page.waitForSelector('#retryBtn');assert.equal((await snapshot()).phase,'clear');
     await rotateModal('#retryBtn');await page.locator('#retryBtn').click();await ready();assert.equal((await snapshot()).floor,1);
   });
   await check('Chromium safe-area override keeps controls, board, HP and hit targets clear of side notches and home indicator',async()=>{
     await load(LANDSCAPE);await select();const before=await snapshot();
     const cdp=await page.context().newCDPSession(page);
     try{
       await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:47,bottom:21,right:47}});
       const report=await page.evaluate(()=>{
         const probe=document.createElement('div');probe.style.cssText='position:fixed;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';document.body.appendChild(probe);
         const c=getComputedStyle(probe),insets=[c.paddingTop,c.paddingRight,c.paddingBottom,c.paddingLeft];probe.remove();
         const selectors=['.topbar','#board','#inspectorBody','#lootList','#logList','#waitBtn','[data-unit-id] .hp'];
         const violations=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>{
           const r=e.getBoundingClientRect();return r.left<46||r.right>innerWidth-46||r.bottom>innerHeight-20||r.top<0;
         }).map(()=>selector));
         return {insets,violations};
       });
       assert.deepEqual(report.insets,['0px','47px','21px','47px']);assert.deepEqual(report.violations,[]);
       await assertLayout(21);assert.deepEqual(await snapshot(),before);
       await page.screenshot({path:path.join(artifacts,'844x390-safe-area.png')});
     }finally{await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,bottom:0,right:0}});await cdp.detach();}
   });
   await check('Responsive and rotation flows produce no browser errors or external requests',async()=>{
     assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
   });
   console.log(`\n${passed}/${passed} responsive checks passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
