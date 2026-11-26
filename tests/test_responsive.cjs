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
   targets:await page.locator('.unit.is-target').evaluateAll(es=>es.map(e=>e.dataset.unitId).sort()),
   attackMode:await page.locator('#normalAttackBtn').getAttribute('aria-pressed')
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
 async function boardRect(){return await page.locator('#board').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});}
 async function fixed(before){assert.deepEqual(await boardRect(),before,'board position and size must be independent of UI content');}
 async function assertLayout(bottomInset=0){
   const report=await page.evaluate(bottomInset=>{
     const issues=[],b=document.querySelector('#board').getBoundingClientRect();
     const rect=e=>e.getBoundingClientRect(),inside=r=>r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
     const contained=(r,c)=>r.left>=c.left-1&&r.top>=c.top-1&&r.right<=c.right+1&&r.bottom<=c.bottom+1;
     const cells=[...document.querySelectorAll('.cell')],units=Sekasoko.inspect().units;
     if(document.documentElement.scrollWidth>innerWidth+1)issues.push('horizontal document overflow');
     if(!inside(b)||b.bottom>innerHeight-bottomInset+1)issues.push('board outside unobscured viewport');
     if(cells.length!==35)issues.push(`cell count ${cells.length}`);
     const first=rect(cells[0]);
     if(Math.abs(first.height/first.width-.90)>.002)issues.push(`cell H/W must equal .90 (${first.width}×${first.height})`);
     for(const cell of cells){
       const r=rect(cell),x=+cell.dataset.x,y=+cell.dataset.y;
       if(Math.abs(r.width-first.width)>1||Math.abs(r.height-first.height)>1)issues.push(`unequal cell ${x},${y}`);
       if(Math.abs(r.left-(first.left+x*first.width))>1||Math.abs(r.top-(first.top+y*first.height))>1)issues.push(`misaligned cell ${x},${y}`);
       const cx=r.left+r.width/2,cy=r.top+r.height/2;if(!inside(r))issues.push(`cell outside viewport ${x},${y}`);
       const occupied=units.find(u=>u.x===x&&u.y===y),hit=document.elementFromPoint(cx,cy);
       if(occupied?hit?.closest('[data-unit-id]')?.dataset.unitId!==occupied.id:hit?.closest('.cell')!==cell)issues.push(`wrong hit layer ${x},${y}`);
     }
     for(const selector of ['.topbar','#floorNum','#turnNum','#phaseBadge','#waitBtn']){
       const e=document.querySelector(selector),r=rect(e);if(!e.checkVisibility()||!inside(r)||r.bottom>b.top+1)issues.push(`header not above visible board ${selector}`);
     }
     const status=rect(document.querySelector('.inspector'));
     if(!inside(status))issues.push('status panel outside viewport');
     if(innerWidth>innerHeight ? status.left<b.right-1 : status.bottom>b.top+1)issues.push('status is not above portrait / right of landscape board');
     const body=document.querySelector('#inspectorBody'),bodyRect=rect(body),hasSelection=!!document.querySelector('.unit.is-selected');
     if(hasSelection?(!body.checkVisibility({checkVisibilityCSS:true})||!inside(bodyRect)||!contained(bodyRect,status)):body.checkVisibility({checkVisibilityCSS:true}))issues.push('selected details visibility does not match selection');
     const ink=[];const intersects=(a,b)=>a.left<b.right-.1&&b.left<a.right-.1&&a.top<b.bottom-.1&&b.top<a.bottom-.1;
     for(const e of document.querySelectorAll('[data-unit-id]')){
       const u=units.find(u=>u.id===e.dataset.unitId),cell=document.querySelector(`.cell[data-x="${u.x}"][data-y="${u.y}"]`),c=rect(cell),r=rect(e),token=rect(e.querySelector('.token')),hp=e.querySelector('.hp'),h=rect(hp);
       if(!inside(r)||!hp.checkVisibility()||!inside(h)||!/^\d+$/.test(hp.textContent))issues.push(`unit/HP not visible ${u.id}`);
       if(!contained(r,c)||!contained(token,c)||!contained(h,c))issues.push(`piece or HP overlaps another cell ${u.id}`);
       for(const p of [r,h])if(document.elementFromPoint(p.left+p.width/2,p.top+p.height/2)?.closest('[data-unit-id]')!==e)issues.push(`unit/HP center blocked ${u.id}`);
       const textRect=node=>{const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect();};
       const nameInk=textRect(e.querySelector('.unit-name')),hpInk=textRect(hp);
       if(intersects(nameInk,hpInk))issues.push(`name and HP text overlap ${u.id}`);
       ink.push({id:u.id,rects:[nameInk,hpInk]});
     }
     for(let i=0;i<ink.length;i++)for(let j=i+1;j<ink.length;j++)if(ink[i].rects.some(a=>ink[j].rects.some(b=>intersects(a,b))))issues.push(`adjacent name/HP text overlap ${ink[i].id}/${ink[j].id}`);
     return{issues,viewport:[innerWidth,innerHeight],board:b.toJSON(),cell:[first.width,first.height]};
   },bottomInset);assert.deepEqual(report.issues,[],JSON.stringify(report));
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
   for(const viewport of viewports)await check(`${viewport.width}×${viewport.height}: .90 cells, visible HP/hit targets, portrait-above or landscape-right status and invariant board`,async()=>{
     await load(viewport);const b=await boardRect();await select();await assertLayout();await fixed(b);
     const enemy=await page.evaluate(()=>__qaState.units.find(u=>u.type==='goblin'&&u.side==='enemy').id);await page.locator(`[data-unit-id="${enemy}"]`).click();await fixed(b);await assertLayout();
     await page.locator(`[data-unit-id="${enemy}"]`).click();await fixed(b);await assertLayout();
     await page.evaluate(()=>{const a=__qaState.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;});await select('archer');await page.locator('#normalAttackBtn').click();await fixed(b);await assertLayout();
     await page.locator('#cancelAttackBtn').click();await fixed(b);
     await page.locator('#logBtn').click();await fixed(b);await page.keyboard.press('Escape');await fixed(b);
     await page.locator('#menuBtn').click();await fixed(b);await page.locator('#closeMenuBtn').click();await fixed(b);
     await page.screenshot({path:path.join(artifacts,`${viewport.width}x${viewport.height}.png`)});
     const before=await snapshot();await page.locator('.cell[data-x="3"][data-y="3"]').click();await ready();assert.equal((await snapshot()).totalActions,before.totalActions+2);await fixed(b);await assertLayout();
   });
   await check('Portrait→landscape→portrait retains selected stats, exact highlights, damaged HP, candidates and full state',async()=>{
     await load();await fixture();await select();
     const before=await snapshot(),presentation=await selectedPresentation();
     assert.match(presentation.text,/騎士/);assert.match(presentation.text,/2/);
     for(const viewport of [LANDSCAPE,PORTRAIT]){
       await page.setViewportSize(viewport);await assertLayout();
       assert.deepEqual(await snapshot(),before);assert.deepEqual(await selectedPresentation(),presentation);
       assert.deepEqual((await snapshot()).candidates,['slime','goblin','slime']);
     }
   });
   await check('Ranged red targets survive rotation and a real target click deals damage followed by one AI response',async()=>{
     await load();await page.evaluate(()=>{
       const s=__qaState,a=s.units.find(u=>u.side==='player'&&u.type==='archer');a.x=3;a.y=2;
       const target=s.units.find(u=>u.side==='enemy'&&u.type==='slime');target.x=4;target.y=2;
     });
     const archer=await select('archer');await page.locator('#normalAttackBtn').click();const before=await snapshot(),presentation=await selectedPresentation();assert.equal(presentation.attackMode,'true');
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
     await load();await page.locator('#menuBtn').click();await page.locator('#helpBtn').click();assert.equal(await page.locator('.master-table tbody tr').count(),10);
     await rotateModal('#backToBoardBtn');await page.locator('#backToBoardBtn').click();assert.equal(await page.locator('#overlay').isVisible(),false);
   });
   await check('Large acquired-piece formation survives rotation and its next-floor CTA deploys the chosen team',async()=>{
     await load();await page.evaluate(()=>{
       for(let i=0;i<12;i++)__qaState.roster.push({id:`qa-spare-${i}`,type:i%2?'slime':'goblin'});
     });
     await attackKing();await page.waitForSelector('#nextFloorBtn');const inventory=(await snapshot()).roster.length;await rotateModal('#nextFloorBtn');assert.equal((await snapshot()).roster.length,inventory);
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
         const selectors=['.topbar','#board','#inspectorBody','#waitBtn','[data-unit-id] .hp'];
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
   await check('Dense 3×3 pieces and HP badges remain separate and individually clickable in both orientations',async()=>{
     for(const viewport of [PORTRAIT,LANDSCAPE]){
       await load(viewport);await page.evaluate(()=>{
         const s=__qaState;s.units.push({id:'qa-dense-mage',type:'mage',side:'enemy',x:0,y:0,hp:4,maxHp:4});
         s.units.forEach((u,i)=>{u.x=2+i%3;u.y=1+Math.floor(i/3);});
       });
       const first=(await snapshot()).units[0].id;await page.locator(`[data-unit-id="${first}"]`).click();await page.locator(`[data-unit-id="${first}"]`).click();
       const before=await snapshot(),b=await boardRect();await assertLayout();
       for(const u of before.units){
         const token=page.locator(`[data-unit-id="${u.id}"]`),hp=token.locator('.hp');
         await token.click();assert.equal(await token.getAttribute('aria-pressed'),'true');await token.click();
         await hp.click();assert.equal(await token.getAttribute('aria-pressed'),'true');await hp.click();
         await fixed(b);assert.deepEqual(await snapshot(),before);
       }
       await page.screenshot({path:path.join(artifacts,`dense-${viewport.width}x${viewport.height}.png`)});
     }
   });
   await check('Acquisition popup does not resize either orientation and leaves board controls usable',async()=>{
     for(const viewport of [PORTRAIT,LANDSCAPE]){
       await load(viewport);await page.evaluate(()=>{const a=__qaState.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;const e=__qaState.units.find(u=>u.type==='slime'&&u.side==='enemy');e.x=4;e.y=2;e.hp=1;});
       await select('archer');const b=await boardRect(),enemy=await page.evaluate(()=>__qaState.units.find(u=>u.type==='slime'&&u.side==='enemy').id);
       await page.locator(`[data-unit-id="${enemy}"]`).click();await ready();await fixed(b);assert.match(await page.locator('#toast').textContent(),/駒入手！/);await assertLayout();
       await select();await fixed(b);assert.equal(await page.locator('.unit.is-selected').count(),1);
       const before=await snapshot();await page.locator('#waitBtn').click();await ready();assert.equal((await snapshot()).totalActions,before.totalActions+2);await fixed(b);
     }
   });
   await check('Portrait top-notch and home-indicator safe areas preserve .90 board geometry and status controls',async()=>{
     await load();await select();const before=await snapshot(),cdp=await page.context().newCDPSession(page);
     try{
       await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:44,left:0,bottom:34,right:0}});
       const violations=await page.evaluate(()=>['.topbar','#board','#inspectorBody','#waitBtn','[data-unit-id] .hp'].flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return r.top<43||r.bottom>innerHeight-33;}).map(()=>selector)));
       assert.deepEqual(violations,[]);await assertLayout(34);assert.deepEqual(await snapshot(),before);await page.screenshot({path:path.join(artifacts,'390x844-safe-area.png')});
     }finally{await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,bottom:0,right:0}});await cdp.detach();}
   });
   await check('Responsive and rotation flows produce no browser errors or external requests',async()=>{
     assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
   });
   console.log(`\n${passed}/${passed} responsive checks passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
