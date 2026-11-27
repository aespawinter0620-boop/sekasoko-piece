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
// Captured before VER.004 from the verified VER.003 HTML; keeps CI comparison independent of ignored artifacts.
const BASELINE003={"390x844":{"width":339.984375,"height":218.546875},"375x667":{"width":324.984375,"height":208.90625},"320x568":{"width":280,"height":180},"844x390":{"width":437.109375,"height":280.984375},"667x375":{"width":390,"height":250.703125},"812x375":{"width":413.765625,"height":265.984375},"844x330":{"width":365.546875,"height":234.984375},"1440x1000":{"width":1043,"height":670.5}};
// Recorded VER.004 geometry: army scaling must preserve the accepted UI layout.
const BASELINE004={"390x844":{"board":{"x":24,"y":381.09375,"width":342,"height":430.90625},"frame":{"x":14,"y":371.09375,"width":362,"height":450.90625},"hud":{"x":14,"y":8,"width":362,"height":61},"status":{"x":14,"y":77,"width":362,"height":177.59375}},"375x667":{"board":{"x":33.9296875,"y":248.015625,"width":307.140625,"height":386.984375},"frame":{"x":23.9296875,"y":238.015625,"width":327.140625,"height":406.984375},"hud":{"x":14,"y":8,"width":347,"height":61},"status":{"x":14,"y":77,"width":347,"height":151}},"320x568":{"board":{"x":42.546875,"y":243.03125,"width":234.90625,"height":295.96875},"frame":{"x":33.546875,"y":234.03125,"width":252.90625,"height":313.96875},"hud":{"x":11,"y":6,"width":298,"height":57},"status":{"x":11,"y":70,"width":298,"height":156}},"844x390":{"board":{"x":27,"y":17,"width":532,"height":342},"frame":{"x":17,"y":7,"width":552,"height":362},"hud":{"x":582,"y":7,"width":245,"height":91},"status":{"x":582,"y":106,"width":245,"height":271}},"667x375":{"board":{"x":27,"y":80.4375,"width":410,"height":263.5625},"frame":{"x":17,"y":70.4375,"width":430,"height":283.5625},"hud":{"x":460,"y":7,"width":190,"height":91},"status":{"x":460,"y":106,"width":190,"height":256}},"812x375":{"board":{"x":27,"y":17.015625,"width":508.65625,"height":326.984375},"frame":{"x":17,"y":7.015625,"width":528.65625,"height":346.984375},"hud":{"x":558.65625,"y":7,"width":236.34375,"height":91},"status":{"x":558.65625,"y":106,"width":236.34375,"height":256}},"844x330":{"board":{"x":23,"y":14.015625,"width":446.4375,"height":286.984375},"frame":{"x":14,"y":5.015625,"width":464.4375,"height":304.984375},"hud":{"x":488.4375,"y":5,"width":341.5625,"height":81},"status":{"x":488.4375,"y":92,"width":341.5625,"height":226}},"1440x1000":{"board":{"x":27,"y":266.359375,"width":1093,"height":702.640625},"frame":{"x":17,"y":256.359375,"width":1113,"height":722.640625},"hud":{"x":1143,"y":7,"width":280,"height":91},"status":{"x":1143,"y":106,"width":280,"height":881}}};
const PORTRAIT={width:390,height:844}, LANDSCAPE={width:844,height:390};
const viewports=[PORTRAIT,{width:375,height:667},{width:320,height:568},LANDSCAPE,{width:667,height:375},{width:812,height:375},{width:844,height:330},{width:1440,height:1000}];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:PORTRAIT,deviceScaleFactor:1});
 const errors=[],requests=[],comparisons=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 let passed=0;
 async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
 async function resize(viewport){await page.setViewportSize(viewport);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
 async function load(viewport=PORTRAIT,classic=true){await resize(viewport);await page.goto('about:blank');await page.setContent(qaHTML,{waitUntil:'load'});await page.waitForSelector('.unit');if(classic)await sparseBattle();}
 async function sparseBattle(){
   const anchor=await page.evaluate(()=>{
     const s=__qaState,id=s.units.find(u=>u.side==='player'&&u.type==='king').id;s.roster=['knight','archer','slime'].map(type=>s.roster.find(p=>p.type===type));s.formation=s.roster.map(p=>p.id);
     const defs=[['king','player',0,2],['knight','player',1,1],['archer','player',0,4],['slime','player',1,4],['king','enemy',6,2],['slime','enemy',5,1],['goblin','enemy',5,2],['slime','enemy',5,3]];
     s.units=defs.map(([type,side,x,y],i)=>({id:i?`qa-sparse-${i}`:id,type,side,x,y,hp:Sekasoko.MASTER[type].hp,maxHp:Sekasoko.MASTER[type].hp}));s.history={};return id;
   });await page.locator(`[data-unit-id="${anchor}"]`).click();await page.locator(`[data-unit-id="${anchor}"]`).click();
 }
 async function snapshot(){return await page.evaluate(()=>Sekasoko.inspect());}
 async function ready(){await page.waitForFunction(()=>Sekasoko.inspect().phase==='player'&&!document.querySelector('#waitBtn').disabled);}
 async function select(type='knight'){
   const id=await page.evaluate(type=>__qaState.units.find(u=>u.type===type&&u.side==='player').id,type);
   await page.locator(`[data-unit-id="${id}"]`).click();return id;
 }
 async function installUnits(defs){const anchor=await page.evaluate(defs=>{const s=__qaState,id=s.units.find(u=>u.side==='player'&&u.type==='king').id;s.units=defs.map((d,i)=>({...d,id:i===0?id:d.id,hp:d.hp??Sekasoko.MASTER[d.type].hp,maxHp:Sekasoko.MASTER[d.type].hp}));s.history={};return id;},defs);await page.locator(`[data-unit-id="${anchor}"]`).click();await page.locator(`[data-unit-id="${anchor}"]`).click();}
 async function passiveFixture(royal=false,viewport=PORTRAIT){await load(viewport);const defs=[{id:'qa-chain-pk',type:'king',side:'player',x:0,y:2},{id:'qa-chain-orc',type:'orc',side:'player',x:3,y:2},{id:'qa-chain-a1',type:'archer',side:'player',x:2,y:2},{id:'qa-chain-a2',type:'archer',side:'player',x:3,y:0},{id:'qa-chain-guard',type:'golem',side:'enemy',x:4,y:1,hp:3}];if(royal)defs.push({id:'qa-chain-target',type:'king',side:'enemy',x:4,y:2,hp:3},{id:'qa-chain-a3',type:'archer',side:'player',x:3,y:3});else defs.push({id:'qa-chain-target',type:'goblin',side:'enemy',x:4,y:2,hp:5},{id:'qa-chain-ek',type:'king',side:'enemy',x:6,y:2});await installUnits(defs);return{actor:'qa-chain-orc',target:'qa-chain-target',guard:'qa-chain-guard'};}
 async function observePassiveNotifications(){await page.evaluate(()=>{globalThis.__qaPassiveNotifications=[];globalThis.__qaPassiveCues=[];new MutationObserver(()=>{if(document.querySelector('#toast').textContent.startsWith('駒入手！'))__qaPassiveNotifications.push(document.querySelector('#toast').textContent);}).observe(document.querySelector('#toast'),{childList:true});new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n instanceof Element&&n.matches('.passive-cue'))__qaPassiveCues.push({source:n.dataset.sourceId,effect:n.dataset.effect});}).observe(document.querySelector('#pieceLayer'),{childList:true});});}
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
     const portrait=innerHeight>=innerWidth,cols=portrait?5:7,rows=portrait?7:5;
     const cells=[...document.querySelectorAll('.cell')],units=Sekasoko.inspect().units;
     if(document.documentElement.scrollWidth>innerWidth+1)issues.push('horizontal document overflow');
     if(!inside(b)||b.bottom>innerHeight-bottomInset+1)issues.push('board outside unobscured viewport');
     const frame=rect(document.querySelector('.board-wrap'));if(!inside(frame)||frame.bottom>innerHeight-bottomInset+1)issues.push('board frame clips viewport');
     if(cells.length!==35)issues.push(`cell count ${cells.length}`);
     const first=rect(cells[0]);
     if(Math.abs(first.height/first.width-.90)>.002)issues.push(`cell H/W must equal .90 (${first.width}×${first.height})`);
     if(Math.abs(b.width/b.height-(portrait?50/63:14/9))>.003)issues.push('board display aspect ratio');
     const seen=new Set();
     for(const cell of cells){
       const r=rect(cell),x=+cell.dataset.x,y=+cell.dataset.y,col=portrait?y:x,row=portrait?6-x:y;
       if(Math.abs(r.width-first.width)>1||Math.abs(r.height-first.height)>1)issues.push(`unequal cell ${x},${y}`);
       if(Math.abs(r.left-(b.left+col*b.width/cols))>1||Math.abs(r.top-(b.top+row*b.height/rows))>1)issues.push(`incorrect independent projection ${x},${y}`);
       const actualCol=Math.round((r.left-b.left)/r.width),actualRow=Math.round((r.top-b.top)/r.height);seen.add(`${actualCol},${actualRow}`);
       const cx=r.left+r.width/2,cy=r.top+r.height/2;if(!inside(r))issues.push(`cell outside viewport ${x},${y}`);
       const occupied=units.find(u=>u.x===x&&u.y===y),hit=document.elementFromPoint(cx,cy);
       if(occupied?hit?.closest('[data-unit-id]')?.dataset.unitId!==occupied.id:hit?.closest('.cell')!==cell)issues.push(`wrong hit layer ${x},${y}`);
     }
     if(seen.size!==35)issues.push('display projection is not bijective');
     const hud=rect(document.querySelector('#hud')||document.querySelector('.topbar')),status=rect(document.querySelector('.inspector'));
     if(!inside(hud)||!inside(status))issues.push('HUD/status outside viewport');
     if(portrait?status.bottom>b.top+1:(status.left<b.right-1||hud.left<b.right-1||hud.bottom>status.top+1))issues.push('portrait-above / landscape-right HUD and status layout');
     for(const selector of ['#floorNum','#turnNum','#phaseBadge','#waitBtn']){const e=document.querySelector(selector),r=rect(e);if(!e.checkVisibility({checkVisibilityCSS:true})||!inside(r)||r.left<hud.left-1||r.right>hud.right+1||r.top<hud.top-1||r.bottom>status.top+1)issues.push(`HUD control not visible ${selector}`);}
     const body=document.querySelector('#inspectorBody'),bodyRect=rect(body),hasSelection=!!document.querySelector('.unit.is-selected');
     if(hasSelection?(!body.checkVisibility({checkVisibilityCSS:true})||!inside(bodyRect)||!contained(bodyRect,status)):body.checkVisibility({checkVisibilityCSS:true}))issues.push('selected details visibility does not match selection');
     const upright=e=>{let m=new DOMMatrix();for(let n=e;n&&n!==document.body;n=n.parentElement){const t=getComputedStyle(n).transform;if(t!=='none')m=new DOMMatrix(t).multiply(m);}return Math.abs(m.b)<.001&&Math.abs(m.c)<.001&&m.a>0&&m.d>0;};
     const ink=[],intersects=(a,b)=>a.left<b.right-.1&&b.left<a.right-.1&&a.top<b.bottom-.1&&b.top<a.bottom-.1;
     for(const e of document.querySelectorAll('[data-unit-id]')){
       const u=units.find(u=>u.id===e.dataset.unitId);if(!u){issues.push('stale unit after action');continue;}
       const cell=document.querySelector(`.cell[data-x="${u.x}"][data-y="${u.y}"]`),c=rect(cell),r=rect(e),token=rect(e.querySelector('.token')),hp=e.querySelector('.hp'),h=rect(hp),emoji=e.querySelector('.emoji');
       if(!inside(r)||!hp.checkVisibility({checkVisibilityCSS:true})||!inside(h)||!/^\d+$/.test(hp.textContent)||+hp.textContent!==u.hp)issues.push(`unit/HP not visible or synchronized ${u.id}`);
       if(!contained(r,c)||!contained(token,c)||!contained(h,c))issues.push(`piece or HP overlaps another cell ${u.id}`);
       if(Math.abs((r.left+r.width/2)-(c.left+c.width/2))>1||Math.abs((r.top+r.height/2)-(c.top+c.height/2))>1)issues.push(`unit not on projected logical cell ${u.id}`);
       for(const p of [r,h])if(document.elementFromPoint(p.left+p.width/2,p.top+p.height/2)?.closest('[data-unit-id]')!==e)issues.push(`unit/HP center blocked ${u.id}`);
       if(!upright(emoji)||!upright(hp))issues.push(`icon or HP rotated ${u.id}`);
       const name=e.querySelector('.unit-name');if(name?.checkVisibility({checkVisibilityCSS:true}))issues.push(`board name should be hidden ${u.id}`);
       if(!e.getAttribute('aria-label').includes(Sekasoko.MASTER[u.type].name))issues.push(`accessible unit name missing ${u.id}`);
       const range=document.createRange();range.selectNodeContents(hp);ink.push({id:u.id,rect:range.getBoundingClientRect()});
     }
     for(let i=0;i<ink.length;i++)for(let j=i+1;j<ink.length;j++)if(intersects(ink[i].rect,ink[j].rect))issues.push(`adjacent HP text overlap ${ink[i].id}/${ink[j].id}`);
     return{issues,viewport:[innerWidth,innerHeight],board:b.toJSON(),frame:frame.toJSON(),hud:hud.toJSON(),status:status.toJSON(),cell:[first.width,first.height]};
   },bottomInset);assert.deepEqual(report.issues,[],JSON.stringify(report));return report;
 }
 async function stage(name){await page.waitForFunction(name=>document.querySelector('#board').dataset.animation===name,name);}
 async function projectedUnits(){
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const issues=await page.evaluate(()=>{
     const b=document.querySelector('#board').getBoundingClientRect(),p=innerHeight>=innerWidth,cols=p?5:7,rows=p?7:5,out=[];
     for(const u of Sekasoko.inspect().units){const e=document.querySelector(`[data-unit-id="${u.id}"]`);if(!e){out.push(`missing ${u.id}`);continue;}const r=e.getBoundingClientRect(),x=b.left+((p?u.y:u.x)+.5)*b.width/cols,y=b.top+((p?6-u.x:u.y)+.5)*b.height/rows;if(Math.abs(r.left+r.width/2-x)>1||Math.abs(r.top+r.height/2-y)>1)out.push(`stale projection ${u.id}`);if(+e.querySelector('.hp').textContent!==u.hp)out.push(`stale HP ${u.id}`);}
     return out;
   });assert.deepEqual(issues,[]);
 }
 async function moveFrames(id,path){
   const report=await page.evaluate(({id,path})=>{
     const e=document.querySelector(`[data-unit-id="${id}"]`),p=innerHeight>=innerWidth,cols=p?5:7,rows=p?7:5,b=document.querySelector('#board').getBoundingClientRect();
     const animations=e.getAnimations().filter(a=>a.effect?.target===e),frames=animations.flatMap(a=>a.effect.getKeyframes()).filter(f=>f.left!==undefined&&f.top!==undefined);
     const expected=path.map(q=>({left:(p?q.y:q.x)/cols*100,top:(p?6-q.x:q.y)/rows*100}));
     const values=frames.map(f=>({left:String(f.left).endsWith('%')?parseFloat(f.left):parseFloat(f.left)/b.width*100,top:String(f.top).endsWith('%')?parseFloat(f.top):parseFloat(f.top)/b.height*100}));return{expected,values};
   },{id,path});assert.ok(report.values.length>=2,'move must expose real projected WAAPI keyframes');for(const f of report.values)assert.ok(report.expected.some(p=>Math.abs(p.left-f.left)<.1&&Math.abs(p.top-f.top)<.1),JSON.stringify(report));
 }
 async function bumpDirection(actorId,target){
   const report=await page.evaluate(({actorId,target})=>{
     const actor=Sekasoko.inspect().units.find(u=>u.id===actorId),token=document.querySelector(`[data-unit-id="${actorId}"] .token`),b=document.querySelector('#board').getBoundingClientRect(),p=innerHeight>=innerWidth,cols=p?5:7,rows=p?7:5;
     const point=q=>({x:(p?q.y:q.x)*b.width/cols,y:(p?6-q.x:q.y)*b.height/rows}),a=point(actor),t=point(target);
     const vectors=token.getAnimations().flatMap(a=>a.effect.getKeyframes()).filter(f=>f.transform&&f.transform!=='none').map(f=>{const m=new DOMMatrix(f.transform);return[m.e,m.f];});vectors.sort((a,b)=>Math.hypot(...b)-Math.hypot(...a));return{expected:[t.x-a.x,t.y-a.y],actual:vectors[0]};
   },{actorId,target});assert.ok(report.actual&&Math.hypot(...report.actual)>1,'attack must expose a real lunge keyframe');const cosine=(report.expected[0]*report.actual[0]+report.expected[1]*report.actual[1])/(Math.hypot(...report.expected)*Math.hypot(...report.actual));assert.ok(cosine>.98,JSON.stringify(report));
 }
 async function effectAnchors(targetId,target){
   const report=await page.evaluate(({targetId,target})=>{
     const b=document.querySelector('#board').getBoundingClientRect(),p=innerHeight>=innerWidth,cols=p?5:7,rows=p?7:5,cx=b.left+((p?target.y:target.x)+.5)*b.width/cols,cy=b.top+((p?6-target.x:target.y)+.5)*b.height/rows,out=[];
     const dying=document.querySelector(`[data-unit-id="${targetId}"]`);if(dying){const r=dying.getBoundingClientRect();if(Math.hypot(r.left+r.width/2-cx,r.top+r.height/2-cy)>Math.max(22,b.width/cols*.4))out.push('dying piece retained old projection');}
     for(const e of document.querySelectorAll('.floating-damage')){const r=e.getBoundingClientRect();if(Math.abs(r.left+r.width/2-cx)>b.width/cols||Math.abs(r.top+r.height/2-cy)>b.height/rows)out.push('damage popup retained old projection');}return out;
   },{targetId,target});assert.deepEqual(report,[]);
 }
 async function assertCTA(selector){
   const button=page.locator(selector);await button.scrollIntoViewIfNeeded();
   const report=await button.evaluate(e=>{
     const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),m=document.querySelector('#modal'),mr=m.getBoundingClientRect();
     return {visible:e.checkVisibility(),enabled:!e.disabled,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:hit===e||e.contains(hit),modalInside:mr.left>=0&&mr.top>=0&&mr.right<=innerWidth+1&&mr.bottom<=innerHeight+1,overflow:m.scrollWidth-m.clientWidth};
   });
   assert.deepEqual(report,{visible:true,enabled:true,inside:true,hit:true,modalInside:true,overflow:0});
 }
 async function assertCTAForOwned(card){await card.scrollIntoViewIfNeeded();const report=await card.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e.checkVisibility({checkVisibilityCSS:true})&&r.top>=0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&(hit===e||e.contains(hit));});assert.equal(report,true,'owned piece card must remain reachable');}
 async function rotateModal(selector){
   const before=await snapshot();
   for(const viewport of [PORTRAIT,LANDSCAPE,PORTRAIT]){
     await resize(viewport);await assertCTA(selector);assert.deepEqual(await snapshot(),before);
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
   for(const viewport of viewports)await check(`${viewport.width}×${viewport.height}: true24 unit/HP taps, .90 projection and exact VER.004 layout parity`,async()=>{
     await load(viewport,false);assert.equal((await snapshot()).units.length,24);const b=await boardRect(),initialKnight=await select();const metrics=await assertLayout();await fixed(b);const parity=BASELINE004[`${viewport.width}x${viewport.height}`];for(const region of ['board','frame','hud','status'])for(const key of ['x','y','width','height'])assert.ok(Math.abs(metrics[region][key]-parity[region][key])<.02,`VER.004 layout changed: ${region}.${key}`);const old=BASELINE003[`${viewport.width}x${viewport.height}`];assert.ok(b.width*b.height>old.width*old.height,`board area must grow from VER.003 at ${viewport.width}x${viewport.height}`);comparisons.push({viewport,old,actual:metrics,areaGrowth:b.width*b.height/(old.width*old.height)});await page.screenshot({path:path.join(artifacts,`${viewport.width}x${viewport.height}-ver005-24units.png`)});
     await page.locator(`[data-unit-id="${initialKnight}"]`).click();const fullArmy=await snapshot();
     for(const u of fullArmy.units){
       const target=page.locator(`[data-unit-id="${u.id}"]`);
       for(const part of [target,target.locator('.hp')]){const r=await part.boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);assert.equal(await target.getAttribute('aria-pressed'),'true');await page.mouse.click(r.x+r.width/2,r.y+r.height/2);assert.equal(await page.locator('.unit.is-selected').count(),0);}
       assert.deepEqual(await snapshot(),fullArmy);await fixed(b);
     }
     await sparseBattle();await select();await fixed(b);
     const enemy=await page.evaluate(()=>__qaState.units.find(u=>u.type==='goblin'&&u.side==='enemy').id);await page.locator(`[data-unit-id="${enemy}"]`).click();await fixed(b);await assertLayout();
     await page.locator(`[data-unit-id="${enemy}"]`).click();await fixed(b);await assertLayout();
     await page.evaluate(()=>{const a=__qaState.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;});await select('archer');await page.locator('#normalAttackBtn').click();await fixed(b);await assertLayout();
     await page.locator('#cancelAttackBtn').click();await fixed(b);
     await page.locator('#logBtn').click();await fixed(b);await page.keyboard.press('Escape');await fixed(b);
     await page.locator('#menuBtn').click();await fixed(b);await page.locator('#closeMenuBtn').click();await fixed(b);
     await page.screenshot({path:path.join(artifacts,`${viewport.width}x${viewport.height}.png`)});
     const before=await snapshot();await page.locator('.cell[data-x="3"][data-y="3"]').click();await ready();assert.equal((await snapshot()).totalActions,before.totalActions+2);await fixed(b);await assertLayout();
   });
   await check('All 35 display centers obey the independent inverse transform and asymmetric real clicks preserve logical rules',async()=>{
     for(const viewport of [PORTRAIT,LANDSCAPE]){
       await load(viewport);const portrait=viewport.height>=viewport.width;
       const initial=await snapshot(),initialBoard=await boardRect();
       for(const [side,col,row] of portrait?[['player',2,6],['enemy',2,0]]:[['player',0,2],['enemy',6,2]]){
         const k=initial.units.find(u=>u.side===side&&u.type==='king'),r=await page.locator(`[data-unit-id="${k.id}"]`).boundingBox(),cols=portrait?5:7,rows=portrait?7:5;
         assert.ok(Math.abs(r.x+r.width/2-(initialBoard.x+(col+.5)*initialBoard.width/cols))<1);assert.ok(Math.abs(r.y+r.height/2-(initialBoard.y+(row+.5)*initialBoard.height/rows))<1);
       }
       const anchor=await page.evaluate(()=>{
         const s=__qaState,id=s.units[0].id,defs=[['king','player',0,2],['knight','player',1,0],['archer','player',2,4],['mage','player',3,0],['king','enemy',6,2],['goblin','enemy',4,1],['slime','enemy',5,3],['orc','enemy',6,4]];
         s.units=defs.map(([type,side,x,y],i)=>({id:i?`qa-asym-${i}`:id,type,side,x,y,hp:Sekasoko.MASTER[type].hp,maxHp:Sekasoko.MASTER[type].hp}));return id;
       });
       await page.locator(`[data-unit-id="${anchor}"]`).click();await page.locator(`[data-unit-id="${anchor}"]`).click();await assertLayout();
       const before=await snapshot(),b=await boardRect(),cols=portrait?5:7,rows=portrait?7:5;
       for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
         const x=portrait?6-row:col,y=portrait?col:row,px=b.x+(col+.5)*b.width/cols,py=b.y+(row+.5)*b.height/rows;
         const logical=await page.evaluate(({px,py})=>{const e=document.elementsFromPoint(px,py).find(e=>e.matches('.cell'));return e?{x:+e.dataset.x,y:+e.dataset.y}:null;},{px,py});assert.deepEqual(logical,{x,y});
         await page.mouse.click(px,py);const occupant=before.units.find(u=>u.x===x&&u.y===y);
         if(occupant){assert.equal(await page.locator('.unit.is-selected').getAttribute('data-unit-id'),occupant.id);await page.mouse.click(px,py);}else assert.equal(await page.locator('.unit.is-selected').count(),0);
         assert.deepEqual(await snapshot(),before);
       }
       const point=(x,y)=>({x:b.x+((portrait?y:x)+.5)*b.width/cols,y:b.y+((portrait?6-x:y)+.5)*b.height/rows});
       await page.mouse.click(...Object.values(point(1,0)));assert.equal(await page.locator('.unit.is-selected').getAttribute('data-unit-id'),'qa-asym-1');
       await page.mouse.click(...Object.values(point(2,1)));await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+2);assert.deepEqual([after.units.find(u=>u.id==='qa-asym-1').x,after.units.find(u=>u.id==='qa-asym-1').y],[2,1]);await assertLayout();
       await page.screenshot({path:path.join(artifacts,`asymmetric-${viewport.width}x${viewport.height}.png`)});
     }
   });
   await check('Computed team gradient is red north / blue south in portrait and blue west / red east in landscape',async()=>{
     for(const viewport of [PORTRAIT,LANDSCAPE]){
       await load(viewport);const portrait=viewport.height>=viewport.width;
       const gradients=await page.evaluate(()=>{
         const out=[];for(const e of [document.querySelector('#board'),document.querySelector('.board-skin')].filter(Boolean))for(const pseudo of [null,'::before','::after']){
           const text=getComputedStyle(e,pseudo).backgroundImage;let start=0;
           while((start=text.indexOf('linear-gradient(',start))!==-1){let depth=1,end=start+16;for(;end<text.length&&depth;end++){if(text[end]==='(')depth++;else if(text[end]===')')depth--;}out.push(text.slice(start,end));start=end;}
         }return out;
       });
       const correct=gradients.some(g=>{
         const angleMatch=g.match(/^linear-gradient\(([-\d.]+)deg/),angle=angleMatch?+angleMatch[1]:180,colors=[...g.matchAll(/rgba?\(([^)]+)\)/g)].map(m=>m[1].split(',').map(Number));if(colors.length<2)return false;
         let first=colors[0],last=colors.at(-1);const red=c=>c[0]>c[2]+5,blue=c=>c[2]>c[0]+5;
         if(portrait){if(angle===0)[first,last]=[last,first];else if(angle!==180)return false;return red(first)&&blue(last);}
         if(angle===270)[first,last]=[last,first];else if(angle!==90)return false;return blue(first)&&red(last);
       });assert.ok(correct,`team gradient did not match physical orientation: ${JSON.stringify(gradients)}`);
     }
   });
   await check('Portrait→landscape→portrait retains selected stats, exact highlights, damaged HP, candidates and full state',async()=>{
     await load(PORTRAIT,false);await fixture();await select();assert.equal((await snapshot()).units.length,24);
     const before=await snapshot(),presentation=await selectedPresentation();
     assert.match(presentation.text,/騎士/);assert.match(presentation.text,/2/);
     for(const viewport of [LANDSCAPE,PORTRAIT]){
       await resize(viewport);await assertLayout();
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
       await resize(viewport);await assertLayout();
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
         await stage('move');const actorId=before.units.find(u=>u.type==='knight'&&u.side==='player').id;await moveFrames(actorId,[{x:1,y:1},{x:2,y:1},{x:3,y:1}]);
         const inFlight=await snapshot();assert.equal(inFlight.totalActions,before.totalActions+1);
         await resize(LANDSCAPE);assert.deepEqual(await snapshot(),inFlight);await projectedUnits();
         await resize(PORTRAIT);await projectedUnits();await page.screenshot({path:path.join(artifacts,'move-rotation.png')});
       }
       await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+2);
       await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);return after;
     }
     const control=await perform(false),rotated=await perform(true);assert.deepEqual(rotated,control);await assertLayout();
   });
   for(const lethal of [false,true])await check(`${lethal?'Death':'Attack'} animation rotation reprojects effects, matches control state and runs AI once${lethal?' with one candidate notification':''}`,async()=>{
     async function perform(rotating){
       await load(rotating?PORTRAIT:LANDSCAPE);
       await page.evaluate(lethal=>{
         const s=__qaState,a=s.units.find(u=>u.type==='archer'&&u.side==='player');a.x=2;a.y=2;
         const k=s.units.find(u=>u.type==='king'&&u.side==='enemy');k.x=6;k.y=4;
         const target=s.units.find(u=>u.type==='goblin'&&u.side==='enemy');target.x=4;target.y=1;target.hp=lethal?1:5;
         const slimes=s.units.filter(u=>u.type==='slime'&&u.side==='enemy');slimes[0].x=5;slimes[0].y=0;slimes[1].x=6;slimes[1].y=3;
         globalThis.__qaCandidateNotifications=[];
         new MutationObserver(records=>{for(const record of records)if(record.type==='childList'&&document.querySelector('#toast').textContent.startsWith('駒入手！'))__qaCandidateNotifications.push(document.querySelector('#toast').textContent);}).observe(document.querySelector('#toast'),{childList:true,subtree:true});
       },lethal);
       const actor=await select('archer');await page.locator('#normalAttackBtn').click();const before=await snapshot(),target=before.units.find(u=>u.type==='goblin'&&u.side==='enemy');
       await page.locator(`[data-unit-id="${target.id}"]`).click();await stage('attack');await bumpDirection(actor,target);
       if(lethal)await stage('death');
       if(rotating){
         const inFlight=await snapshot();assert.equal(inFlight.totalActions,before.totalActions+1);
         await resize(LANDSCAPE);assert.deepEqual(await snapshot(),inFlight);await projectedUnits();if(lethal)await effectAnchors(target.id,target);
         await page.screenshot({path:path.join(artifacts,`${lethal?'death':'attack'}-rotation.png`)});
       }
       await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+2);assert.equal(after.roster.length,before.roster.length);await projectedUnits();
       if(lethal){assert.deepEqual(after.candidates,['goblin']);assert.equal(await page.locator(`[data-unit-id="${target.id}"]`).count(),0);const notifications=await page.evaluate(()=>__qaCandidateNotifications);assert.equal(notifications.length,1);assert.match(notifications[0],/ゴブリン/);}else assert.equal(after.units.find(u=>u.id===target.id).hp,target.hp-2);
       await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);return after;
     }
     const control=await perform(false),rotated=await perform(true);assert.deepEqual(rotated,control);await assertLayout();
   });
   await check('Full24-army enemy-thinking rotation preserves candidates, roster, log and schedules one AI action',async()=>{
     async function perform(rotating){
       await load(PORTRAIT,false);await fixture();await select();const before=await snapshot();
       await page.locator('#waitBtn').click();
       if(rotating){
         await page.waitForFunction(()=>Sekasoko.inspect().phase==='enemy'&&document.querySelector('#waitBtn').disabled);
         const waiting=await snapshot();assert.equal(waiting.totalActions,before.totalActions+1);
         await resize(LANDSCAPE);assert.deepEqual(await snapshot(),waiting);
         await resize(PORTRAIT);
       }
       await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+2);
       await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);return after;
     }
     assert.deepEqual(await perform(true),await perform(false));await assertLayout();
   });
   for(const interrupt of ['guard','attack','death','support'])await check(`Passive-chain ${interrupt} rotation preserves actual recipients, one candidate and ${interrupt==='support'?'one royal reward with no AI':'one AI reply'}`,async()=>{
     const royal=interrupt==='support';
     async function perform(rotating){
       const ids=await passiveFixture(royal,rotating?PORTRAIT:LANDSCAPE);await page.locator(`[data-unit-id="${ids.actor}"]`).click();await page.locator('#normalAttackBtn').click();const before=await snapshot();
       const predicted=await page.evaluate(({actor,target})=>Sekasoko.Engine.predictAttack(__qaState,actor,target),ids);assert.equal(predicted.ok,true);assert.deepEqual(await snapshot(),before);assert.equal(predicted.damageById[ids.guard],3);assert.equal(predicted.state.units.find(u=>u.id===ids.target)?.hp,royal?undefined:1);
       await observePassiveNotifications();await page.locator(`[data-unit-id="${ids.target}"]`).click();await stage(interrupt);
       if(interrupt==='attack')await bumpDirection(ids.actor,before.units.find(u=>u.id===ids.target));
       if(interrupt==='guard'||interrupt==='support'){
         const cue=page.locator(`.passive-cue[data-effect="${interrupt}"]`).first();assert.equal(await cue.isVisible(),true);const source=await cue.getAttribute('data-source-id');assert.ok(interrupt==='guard'?source===ids.guard:['qa-chain-a1','qa-chain-a2'].includes(source));
       }
       if(rotating){const inFlight=await snapshot();assert.deepEqual(inFlight,predicted.state);await resize(LANDSCAPE);assert.deepEqual(await snapshot(),inFlight);await projectedUnits();if(interrupt==='death')await effectAnchors(ids.guard,before.units.find(u=>u.id===ids.guard));await page.screenshot({path:path.join(artifacts,`ver006-${interrupt}-chain-rotation.png`)});}
       if(royal)await page.waitForSelector('#nextFloorBtn');else await ready();const after=await snapshot();assert.equal(after.totalActions,before.totalActions+(royal?1:2));assert.equal(after.turn,before.turn+(royal?0:2));assert.ok(!after.units.some(u=>u.id===ids.guard));
       const notices=await page.evaluate(()=>__qaPassiveNotifications);assert.equal(notices.length,1);assert.match(notices[0],/ゴーレム/);assert.equal(await page.locator('#board .passive-cue').count(),0);
       if(royal){assert.equal(after.phase,'victory');assert.equal(after.roster.length,before.roster.length+1);assert.deepEqual(after.lastRewards,['golem']);assert.deepEqual(after.candidates,[]);assert.equal(await page.locator('.rewards .loot-chip').count(),1);const cues=await page.evaluate(()=>__qaPassiveCues);assert.ok(!cues.some(c=>c.source==='qa-chain-a3'));await assertCTA('#nextFloorBtn');}
       else{assert.equal(after.phase,'player');assert.equal(after.units.find(u=>u.id===ids.target).hp,1);assert.equal(after.units.find(u=>u.id===ids.actor).hp,7);assert.equal(after.roster.length,before.roster.length);assert.deepEqual(after.candidates,['golem']);await projectedUnits();await assertLayout();}
       await page.waitForTimeout(750);assert.deepEqual(await snapshot(),after);return after;
     }
     const control=await perform(false),rotated=await perform(true);assert.deepEqual(rotated,control);
   });
   await check('Passive descriptions, enhanced ATK and enemy guardian details stay scroll reachable in compact panels without moving the board',async()=>{
     for(const viewport of [{width:320,height:568},PORTRAIT,{width:844,height:330},LANDSCAPE]){
       await load(viewport);await installUnits([{id:'qa-detail-pk',type:'king',side:'player',x:0,y:2},{id:'qa-detail-knight',type:'knight',side:'player',x:1,y:1},{id:'qa-detail-archer',type:'archer',side:'player',x:0,y:4},{id:'qa-detail-golem',type:'golem',side:'player',x:1,y:3},{id:'qa-detail-orc',type:'orc',side:'player',x:1,y:2},{id:'qa-detail-ek',type:'king',side:'enemy',x:6,y:2},{id:'qa-detail-enemy-orc',type:'orc',side:'enemy',x:4,y:2},{id:'qa-detail-enemy-knight',type:'knight',side:'enemy',x:4,y:1},{id:'qa-detail-enemy-golem',type:'golem',side:'enemy',x:4,y:3},{id:'qa-detail-enemy-archer',type:'archer',side:'enemy',x:5,y:0}]);
       const before=await snapshot(),b=await boardRect();
       for(const [id,name]of [['qa-detail-knight','鼓舞'],['qa-detail-archer','支援射撃'],['qa-detail-golem','守護の石壁'],['qa-detail-enemy-archer','支援射撃']]){
         await page.locator(`[data-unit-id="${id}"]`).click();assert.match(await page.locator('#passiveInfo').textContent(),new RegExp(name));const p=page.locator('#passiveInfo .passive-description p');await p.scrollIntoViewIfNeeded();const bounds=await p.evaluate(e=>{const r=e.getBoundingClientRect(),c=e.closest('.status-copy').getBoundingClientRect();return{visible:e.checkVisibility({checkVisibilityCSS:true}),top:r.top,bottom:r.bottom,containerTop:c.top,containerBottom:c.bottom};});assert.equal(bounds.visible,true);assert.ok(bounds.top>=bounds.containerTop-1&&bounds.bottom<=bounds.containerBottom+1,JSON.stringify(bounds));await fixed(b);if(id.includes('enemy'))assert.equal(await page.locator('#skillActions').isVisible(),false);
       }
       await page.locator('[data-unit-id="qa-detail-enemy-orc"]').click();assert.equal((await page.locator('.effective-atk').textContent()).trim(),'4');assert.match(await page.locator('#protectionInfo').textContent(),/ゴーレム.*14/);await page.locator('#protectionInfo').scrollIntoViewIfNeeded();const box=await page.locator('#protectionInfo').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);await fixed(b);assert.deepEqual(await snapshot(),before);await page.screenshot({path:path.join(artifacts,`ver006-passive-details-${viewport.width}x${viewport.height}.png`)});
     }
   });
   await check('Help dialog survives both orientations and its return CTA remains scroll accessible',async()=>{
     await load();await page.locator('#menuBtn').click();await page.locator('#helpBtn').click();assert.equal(await page.locator('.master-table tbody tr').count(),10);
     await rotateModal('#backToBoardBtn');await page.locator('#backToBoardBtn').click();assert.equal(await page.locator('#overlay').isVisible(),false);
   });
   await check('All11 long-name rewards and102 owned pieces remain individually reachable with next-floor CTA at small portrait and landscape',async()=>{
     const cdp=await page.context().newCDPSession(page);
     try{for(const viewport of [{width:320,height:568},LANDSCAPE,{width:844,height:330}]){
       await load(viewport,false);const notched=viewport.width===844&&viewport.height===390;await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:notched?{top:0,left:47,bottom:21,right:47}:{top:0,left:0,bottom:0,right:0}});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
       const anchor=await page.evaluate(()=>{
         const s=__qaState,types=['dragon','mage','hamster','golem','knight','archer','slime','goblin','orc'];
         for(let i=0;i<80;i++)s.roster.push({id:`qa-large-owned-${i}`,type:types[i%types.length]});
         s.candidates=Array.from({length:11},(_,i)=>types[i%types.length]);s.units=s.units.filter(u=>u.side==='player'||u.type==='king');
         const a=s.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;s.units.find(u=>u.type==='king'&&u.side==='enemy').hp=1;return a.id;
       });
       await page.locator(`[data-unit-id="${anchor}"]`).click();const king=(await snapshot()).units.find(u=>u.side==='enemy'&&u.type==='king');await page.locator(`[data-unit-id="${king.id}"]`).click();await page.waitForSelector('#nextFloorBtn');
       const won=await snapshot();assert.equal(won.phase,'victory');assert.equal(won.lastRewards.length,11);assert.equal(won.roster.length,102);assert.equal(await page.locator('.rewards .loot-chip').count(),11);assert.equal(await page.locator('[data-roster]').count(),102);
       for(const chip of await page.locator('.rewards .loot-chip').all()){await chip.scrollIntoViewIfNeeded();assert.ok(await chip.isVisible());const r=await chip.boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1);}
       for(const card of await page.locator('[data-roster]').all())await assertCTAForOwned(card);
       await assertCTA('#nextFloorBtn');if(notched){const r=await page.locator('#modal').boundingBox();assert.ok(r.x>=46&&r.x+r.width<=798&&r.y+r.height<=370,'notched formation modal must respect47px sides and21px bottom');}assert.deepEqual(await snapshot(),won);await page.screenshot({path:path.join(artifacts,`ver005-large-formation-${viewport.width}x${viewport.height}.png`)});
       await page.locator('#nextFloorBtn').click();await ready();const next=await snapshot();assert.equal(next.floor,2);assert.equal(next.units.length,24);assert.equal(next.roster.length,102);await assertLayout(notched?21:0);
     }}finally{await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,bottom:0,right:0}});await cdp.detach();}
   });
   await check('Defeat dialog preserves its state through rotation and retry is reachable in both orientations',async()=>{
     await load();await page.evaluate(()=>{
       const k=__qaState.units.find(u=>u.type==='king'&&u.side==='player');k.x=4;k.y=2;k.hp=1;__qaState.candidates=['slime'];
     });
     await page.locator('#waitBtn').click();await page.waitForSelector('#retryBtn');assert.equal((await snapshot()).phase,'defeat');
     await rotateModal('#retryBtn');await page.locator('#retryBtn').click();await ready();assert.equal((await snapshot()).floor,1);
   });
   await check('10F clear exposes all11 rewards, survives both orientations and retries to a fresh24-unit army',async()=>{
     await load(PORTRAIT,false);const anchor=await page.evaluate(()=>{const s=__qaState,types=['dragon','mage','hamster','golem','knight','archer','slime','goblin','orc'];s.floor=10;s.candidates=Array.from({length:11},(_,i)=>types[i%types.length]);s.units=s.units.filter(u=>u.side==='player'||u.type==='king');const a=s.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;s.units.find(u=>u.type==='king'&&u.side==='enemy').hp=1;return a.id;});
     await page.locator(`[data-unit-id="${anchor}"]`).click();const king=(await snapshot()).units.find(u=>u.side==='enemy'&&u.type==='king');await page.locator(`[data-unit-id="${king.id}"]`).click();await page.waitForSelector('#retryBtn');assert.equal((await snapshot()).phase,'clear');assert.equal((await snapshot()).lastRewards.length,11);assert.equal(await page.locator('.rewards .loot-chip').count(),11);
     for(const viewport of [{width:320,height:568},LANDSCAPE,{width:844,height:330}]){await resize(viewport);for(const chip of await page.locator('.rewards .loot-chip').all()){await chip.scrollIntoViewIfNeeded();const r=await chip.boundingBox();assert.ok(r.y>=0&&r.y+r.height<=viewport.height+1);}await assertCTA('#retryBtn');}
     await page.screenshot({path:path.join(artifacts,'ver005-clear11-rewards.png')});await page.locator('#retryBtn').click();await ready();const reset=await snapshot();assert.equal(reset.floor,1);assert.equal(reset.roster.length,11);assert.equal(reset.units.length,24);
   });
   await check('Chromium safe-area override keeps controls, board, HP and hit targets clear of side notches and home indicator',async()=>{
     await load(LANDSCAPE,false);await select();const before=await snapshot();assert.equal(before.units.length,24);
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
     await load(PORTRAIT,false);await select();const before=await snapshot();assert.equal(before.units.length,24);const cdp=await page.context().newCDPSession(page);
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
 }finally{fs.writeFileSync(path.join(artifacts,'ver005-comparison.json'),JSON.stringify(comparisons,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
