'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const artifacts=path.join(__dirname,'..','artifacts');fs.mkdirSync(artifacts,{recursive:true});
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
// Only the in-memory test document exposes a mutable state fixture; production stays untouched.
const qaHTML=html.replace('let state = Engine.createRun(), selectedId','let state = (globalThis.__qaState = Engine.createRun()), selectedId').replace('state=Engine.createRun();','state=(globalThis.__qaState=Engine.createRun());');
assert.notEqual(qaHTML,html);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:844,height:390},reducedMotion:'reduce',deviceScaleFactor:1});
 const errors=[],requests=[];let passed=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
 async function load(classic=true){await page.goto('about:blank');await page.setContent(qaHTML,{waitUntil:'load'});await page.waitForSelector('.unit');if(classic)await sparseBattle();}
 async function sparseBattle(){
   const anchor=await page.evaluate(()=>{
     const s=__qaState,id=s.units.find(u=>u.side==='player'&&u.type==='king').id;
     s.roster=['knight','archer','slime'].map(type=>s.roster.find(p=>p.type===type));s.formation=s.roster.map(p=>p.id);
     const defs=[['king','player',0,2],['knight','player',1,1],['archer','player',0,4],['slime','player',1,4],['king','enemy',6,2],['slime','enemy',5,1],['goblin','enemy',5,2],['slime','enemy',5,3]];
     s.units=defs.map(([type,side,x,y],i)=>({id:i?`qa-sparse-${i}`:id,type,side,x,y,hp:Sekasoko.MASTER[type].hp,maxHp:Sekasoko.MASTER[type].hp}));s.history={};return id;
   });await page.locator(`[data-unit-id="${anchor}"]`).click();await page.locator(`[data-unit-id="${anchor}"]`).click();
 }
 async function state(){return await page.evaluate(()=>Sekasoko.inspect());}
 async function ready(){await page.waitForFunction(()=>Sekasoko.inspect().phase==='player'&&!document.querySelector('#waitBtn').disabled);}
 async function select(type='knight',side='player'){const id=await page.evaluate(({type,side})=>__qaState.units.find(u=>u.type===type&&u.side===side).id,{type,side});await page.locator(`[data-unit-id="${id}"]`).click();return id;}
 async function rect(selector='#board'){return await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});}
 async function fixed(before){assert.deepEqual(await rect(),before);}
 async function mode(){return await page.locator('#normalAttackBtn').getAttribute('aria-pressed')==='true';}
 async function ranged(){await page.evaluate(()=>{const s=__qaState,a=s.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;const slimes=s.units.filter(u=>u.side==='enemy'&&u.type==='slime');slimes[0].x=4;slimes[0].y=2;slimes[1].x=4;slimes[1].y=1;s.units.find(u=>u.type==='goblin'&&u.side==='enemy').x=6;s.units.find(u=>u.type==='goblin'&&u.side==='enemy').y=4;});}
 async function installUnits(defs){
   const anchor=await page.evaluate(defs=>{const s=__qaState,id=s.units.find(u=>u.side==='player'&&u.type==='king').id;s.units=defs.map((d,i)=>({...d,id:i===0?id:d.id,hp:d.hp??Sekasoko.MASTER[d.type].hp,maxHp:Sekasoko.MASTER[d.type].hp}));s.history={};return id;},defs);await page.locator(`[data-unit-id="${anchor}"]`).click();await page.locator(`[data-unit-id="${anchor}"]`).click();
 }
 async function observePassives(){await page.evaluate(()=>{
   globalThis.__qaVisuals={damage:[],cues:[],candidates:[]};
   new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes){if(!(node instanceof Element))continue;if(node.matches('.floating-damage'))__qaVisuals.damage.push({recipient:node.dataset.recipientId,original:node.dataset.originalTargetId,text:node.textContent,hp:document.querySelector(`[data-unit-id="${node.dataset.recipientId}"] .hp`)?.textContent,left:parseFloat(node.style.left),top:parseFloat(node.style.top)});if(node.matches('.passive-cue'))__qaVisuals.cues.push({source:node.dataset.sourceId,effect:node.dataset.effect,text:node.textContent});}}).observe(document.querySelector('#pieceLayer'),{childList:true});
   new MutationObserver(()=>{if(document.querySelector('#toast').textContent.startsWith('駒入手！'))__qaVisuals.candidates.push(document.querySelector('#toast').textContent);}).observe(document.querySelector('#toast'),{childList:true});
 });}
 async function supportFixture(royal=false){
   await load();const defs=[{id:'qa-passive-pk',type:'king',side:'player',x:0,y:2},{id:'qa-passive-orc',type:'orc',side:'player',x:3,y:2},{id:'qa-support-a1',type:'archer',side:'player',x:2,y:2},{id:'qa-support-a2',type:'archer',side:'player',x:3,y:0},{id:'qa-passive-guard',type:'golem',side:'enemy',x:4,y:1,hp:3}];
   if(royal)defs.push({id:'qa-passive-ek',type:'king',side:'enemy',x:4,y:2,hp:3},{id:'qa-support-a3',type:'archer',side:'player',x:3,y:3});else defs.push({id:'qa-passive-target',type:'goblin',side:'enemy',x:4,y:2,hp:5},{id:'qa-passive-ek',type:'king',side:'enemy',x:6,y:2});
   await installUnits(defs);return{actor:'qa-passive-orc',target:royal?'qa-passive-ek':'qa-passive-target',guard:'qa-passive-guard'};
 }
 async function openMenu(){await page.locator('#menuBtn').click();await page.waitForSelector('#menuPanel',{state:'visible'});}
 async function win(floor=1){await page.evaluate(floor=>{const s=__qaState;s.floor=floor;const a=s.units.find(u=>u.side==='player'&&u.type==='archer');a.x=3;a.y=2;const k=s.units.find(u=>u.side==='enemy'&&u.type==='king');k.x=6;k.y=2;k.hp=1;},floor);await select('archer');const king=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='king').id);await page.locator(`[data-unit-id="${king}"]`).click();}
 try{
  await load(false);
  await check('Offline VER.006 initializes true24 units,11 companions per side,cost23 and no permanent loot panel',async()=>{
    assert.equal(await page.locator('.cell').count(),35);assert.equal(await page.locator('.unit').count(),24);const s=await state();assert.equal(s.floor,1);assert.equal(s.phase,'player');assert.equal(s.roster.length,11);assert.equal(s.formation.length,11);assert.equal(s.roster.reduce((sum,p)=>sum+({knight:3,archer:2,slime:1}[p.type]),0),23);assert.equal(s.units.filter(u=>u.side==='player').length,12);assert.equal(s.units.filter(u=>u.side==='enemy').length,12);assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,24);assert.equal(s.roster.filter(p=>p.type==='knight').length,4);assert.equal(s.roster.filter(p=>p.type==='archer').length,4);assert.equal(s.roster.filter(p=>p.type==='slime').length,3);assert.equal(s.units.filter(u=>u.side==='enemy'&&u.type==='slime').length,7);assert.equal(s.units.filter(u=>u.side==='enemy'&&u.type==='goblin').length,4);assert.ok(s.units.every(u=>u.hp===u.maxHp));
    assert.equal(await page.locator('#board .unit-name').evaluateAll(es=>es.every(e=>!e.checkVisibility({checkVisibilityCSS:true}))),true);assert.match(await page.locator('.unit.player').first().getAttribute('aria-label'),/王/);assert.equal(await page.locator('#menuPanel').isVisible(),false);assert.equal(await page.locator('#logPanel').isVisible(),false);assert.equal(await page.locator('#lootList,#lootCount').count(),0);
  });
  await check('Ally selection shows art, stats and three action buttons without moving the board',async()=>{
    await load();const b=await rect();await select();await fixed(b);assert.match(await page.locator('#inspectorBody').textContent(),/騎士/);
    assert.ok(await page.locator('#inspectorBody .portrait').isVisible());assert.equal(await page.locator('#skillActions button').count(),3);
    assert.equal(await page.locator('#normalAttackBtn').isVisible(),true);assert.equal(await page.locator('#uniqueSkillBtn').isDisabled(),true);assert.equal(await page.locator('#ultimateSkillBtn').isDisabled(),true);
    const id=await page.locator('.unit.is-selected').getAttribute('data-unit-id');
    const expected=await page.evaluate(id=>Sekasoko.Engine.moves(__qaState,id).map(p=>`${p.x},${p.y}`).sort(),id);
    assert.deepEqual(await page.locator('.cell.legal').evaluateAll(es=>es.map(e=>`${e.dataset.x},${e.dataset.y}`).sort()),expected);
  });
  await check('Enemy selection and deselection retain fixed status region and hide ally-only actions',async()=>{
    const b=await rect(),status=await rect('.inspector'),before=await state();await select('goblin','enemy');await fixed(b);assert.deepEqual(await rect('.inspector'),status);
    assert.match(await page.locator('#inspectorBody').textContent(),/ゴブリン/);assert.equal(await page.locator('#skillActions').isVisible(),false);
    await page.locator('.unit.is-selected').click();await fixed(b);assert.deepEqual(await rect('.inspector'),status);assert.equal(await page.locator('#skillActions').isVisible(),false);assert.equal(await page.locator('.unit.is-selected').count(),0);assert.equal(await page.locator('#inspectorBody').isVisible(),false);assert.equal(await page.locator('#inspectorBody').getAttribute('aria-hidden'),'true');assert.deepEqual(await state(),before);
    const bg=await page.locator('.inspector').evaluate(e=>{const c=getComputedStyle(e);return[c.backgroundColor,c.backgroundImage];});assert.ok(bg[0]!=='rgba(0, 0, 0, 0)'||bg[1]!=='none');
  });
  await check('Normal attack is disabled without targets and unimplemented skills cannot consume a turn',async()=>{
    await select();assert.equal(await page.locator('#normalAttackBtn').isDisabled(),true);const before=await state();
    for(const [id,label] of [['uniqueSkillBtn','固有技'],['ultimateSkillBtn','必殺技']]){assert.equal(await page.locator(`#${id}`).evaluate(e=>e.firstChild.textContent.trim()),label);assert.equal(await page.locator(`#${id}`).isDisabled(),true);assert.match(await page.locator(`#${id}`).textContent(),/未実装/);await page.locator(`#${id}`).evaluate(e=>e.click());}
    assert.deepEqual(await state(),before);assert.equal(await mode(),false);
  });
  await check('Attack-target mode costs no action, cancels explicitly and clears on selection changes',async()=>{
    await load();await ranged();await select('archer');const b=await rect(),before=await state();assert.equal(await page.locator('#normalAttackBtn').isDisabled(),false);
    await page.locator('#normalAttackBtn').click();assert.equal(await mode(),true);await fixed(b);assert.deepEqual(await state(),before);
    await page.locator('#cancelAttackBtn').click();assert.equal(await mode(),false);assert.deepEqual(await state(),before);await fixed(b);
    await page.locator('#normalAttackBtn').click();await select('knight');assert.equal(await mode(),false);assert.deepEqual(await state(),before);await fixed(b);
    await select('archer');await page.locator('#normalAttackBtn').click();await select('goblin','enemy');assert.equal(await mode(),false);assert.deepEqual(await state(),before);await fixed(b);
  });
  await check('Direct blue movement still consumes one action and gets exactly one AI response',async()=>{
    await load();const b=await rect();await select();const before=await state();await page.locator('.cell[data-x="2"][data-y="1"]').click();await ready();
    const after=await state();assert.equal(after.totalActions,before.totalActions+2);assert.equal(after.turn,before.turn+2);const n=after.units.find(u=>u.type==='knight'&&u.side==='player');assert.deepEqual([n.x,n.y],[2,1]);await fixed(b);
    await page.waitForTimeout(150);assert.deepEqual(await state(),after);
  });
  await check('Wait works unselected and clears attack mode without adding extra actions',async()=>{
    const before=await state();assert.equal(await page.locator('.unit.is-selected').count(),0);await page.locator('#waitBtn').click();await ready();assert.equal((await state()).totalActions,before.totalActions+2);
    await load();await ranged();await select('archer');await page.locator('#normalAttackBtn').click();const attacking=await state();await page.locator('#waitBtn').click();await ready();assert.equal(await mode(),false);assert.equal((await state()).totalActions,attacking.totalActions+2);
  });
  await check('Battle log opens existing history, closes by Escape/outside, and permits board selection without resizing',async()=>{
    await load();await page.evaluate(()=>{__qaState.log=Array.from({length:60},(_,i)=>`保存ログ ${60-i}`);});const painted=await select();await page.locator(`[data-unit-id="${painted}"]`).click();const before=await state(),b=await rect();await page.locator('#logBtn').click();assert.equal(await page.locator('#logPanel').isVisible(),true);assert.ok((await page.locator('#logList').textContent()).includes(before.log[0]));assert.equal(await page.locator('#logList li').count(),60);await fixed(b);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#logPanel').isVisible(),false);await fixed(b);
    await page.locator('#logBtn').click();await select();assert.equal(await page.locator('.unit.is-selected').count(),1);assert.equal(await page.locator('#logPanel').isVisible(),false);await fixed(b);assert.deepEqual(await state(),before);
  });
  await check('Menu exposes help and restart; help lists all ten master characters and returns to the board',async()=>{
    const b=await rect();await openMenu();await fixed(b);assert.equal(await page.locator('#helpBtn').isVisible(),true);assert.equal(await page.locator('#restartBtn').isVisible(),true);
    await page.locator('#helpBtn').click();assert.equal(await page.locator('.master-table tbody tr').count(),10);assert.match(await page.locator('.rules-grid').textContent(),/最大11体/);assert.match(await page.locator('.rules-grid').textContent(),/35以内/);assert.equal(await page.locator('#overlay').isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#overlay').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'menuBtn');await fixed(b);
    await openMenu();await page.locator('#closeMenuBtn').click();assert.equal(await page.locator('#menuPanel').isVisible(),false);await fixed(b);
  });
  await check('Restart cancellation preserves progress and confirmation restores the initial party',async()=>{
    const before=await state();await openMenu();await page.locator('#restartBtn').click();await page.locator('#cancelRestartBtn').click();assert.deepEqual(await state(),before);
    await openMenu();await page.locator('#restartBtn').click();await page.locator('#confirmRestartBtn').click();await ready();const s=await state();assert.equal(s.floor,1);assert.equal(s.turn,1);assert.equal(s.totalActions,0);assert.equal(s.roster.length,11);assert.equal(s.units.length,24);
  });
  await check('A real kill shows a nonmodal auto-hiding acquisition popup while ownership waits for victory',async()=>{
    await load();await ranged();await page.evaluate(()=>{__qaState.roster.push({id:'qa-dragon',type:'dragon'},{id:'qa-mage',type:'mage'});__qaState.units.filter(u=>u.side==='enemy'&&u.type==='slime').forEach(u=>u.hp=1);});
    const b=await rect();await select('archer');const target=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='slime').id);await page.locator(`[data-unit-id="${target}"]`).click();await ready();
    assert.deepEqual((await state()).candidates,['slime']);assert.equal((await state()).roster.length,5);assert.match(await page.locator('#toast').textContent(),/駒入手！/);assert.match(await page.locator('#toast').textContent(),/スライム/);assert.match(await page.locator('#toast').textContent(),/💧/);assert.equal(await page.locator('#overlay').isVisible(),false);await fixed(b);
    await select('knight');assert.equal(await page.locator('.unit.is-selected').count(),1);await fixed(b);
    await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('show'),null,{timeout:5000});await fixed(b);assert.deepEqual((await state()).candidates,['slime']);
  });
  await check('Duplicate real kills remain provisional; king victory commits them once and lists both rewards',async()=>{
    await select('archer');await page.locator('#normalAttackBtn').click();assert.equal(await mode(),true);const slime=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='slime').id);await page.locator(`[data-unit-id="${slime}"]`).click();await ready();assert.deepEqual((await state()).candidates,['slime','slime']);assert.equal((await state()).roster.length,5);
    // Controlled king HP/position makes the result transition deterministic after the real captures.
    await page.evaluate(()=>{const k=__qaState.units.find(u=>u.type==='king'&&u.side==='enemy');k.x=6;k.y=2;k.hp=1;});await select('archer');const k=await page.evaluate(()=>__qaState.units.find(u=>u.type==='king'&&u.side==='enemy').id);await page.locator(`[data-unit-id="${k}"]`).click();await page.waitForSelector('#nextFloorBtn');
    const s=await state();assert.equal(s.phase,'victory');assert.deepEqual(s.lastRewards,['slime','slime']);assert.equal(s.roster.length,7);assert.equal(s.roster.filter(u=>u.type==='king').length,0);assert.equal(s.roster.filter(u=>u.type==='goblin').length,0);assert.equal(await mode(),false);
    assert.equal(await page.locator('.rewards .loot-chip').count(),2);assert.match(await page.locator('.rewards').textContent(),/スライム/);assert.equal(await page.locator('#nextFloorBtn').count(),1);
  });
  await check('Formation accepts11 individual companions at cost35, rejects a twelfth and cost40, and deploys all chosen pieces',async()=>{
    const previous=await state();
    const cap=await page.evaluate(()=>{
      const list=[...Array.from({length:7},(_,i)=>({id:`qa-cap-golem-${i}`,type:'golem'})),...Array.from({length:3},(_,i)=>({id:`qa-cap-archer-${i}`,type:'archer'})),{id:'qa-cap-slime',type:'slime'}];
      __qaState.roster.push(...list,{id:'qa-cap-extra',type:'slime'},{id:'qa-cap-dragon',type:'dragon'});return list.map(p=>p.id);
    });
    // One genuine selection change refreshes the already-open formation with the larger owned inventory.
    await page.locator(`[data-roster="${previous.formation[0]}"]`).click();
    for(const id of (await state()).formation)await page.locator(`[data-roster="${id}"]`).click();
    for(const id of cap)await page.locator(`[data-roster="${id}"]`).click();
    let selected=await state();assert.equal(selected.formation.length,11);assert.match(await page.locator('.formation-count').textContent(),/11\s*\/\s*11/);assert.match(await page.locator('.formation-count').textContent(),/35\s*\/\s*35/);
    assert.equal(selected.formation.filter(id=>selected.roster.find(p=>p.id===id).type==='golem').length,7);assert.equal(new Set(selected.formation).size,11);
    const full=[...selected.formation];await page.locator('[data-roster="qa-cap-extra"]').click();assert.deepEqual((await state()).formation,full);assert.match(await page.locator('#toast').textContent(),/最大11体/);
    await page.locator('[data-roster="qa-cap-slime"]').click();const ten=[...(await state()).formation];await page.locator('[data-roster="qa-cap-dragon"]').click();assert.deepEqual((await state()).formation,ten);assert.match(await page.locator('#toast').textContent(),/35/);
    await page.locator('[data-roster="qa-cap-slime"]').click();const inventory=(await state()).roster.length;
    await page.locator('#nextFloorBtn').click();await ready();const next=await state();assert.equal(next.floor,2);assert.equal(next.turn,1);assert.equal(next.units.filter(u=>u.side==='player').length,12);assert.equal(next.units.filter(u=>u.side==='enemy').length,12);assert.equal(next.units.filter(u=>u.side==='player'&&u.type==='golem').length,7);assert.equal(next.units.filter(u=>u.side==='player'&&u.type==='archer').length,3);assert.ok(next.units.every(u=>u.hp===u.maxHp));assert.equal(next.roster.length,inventory);
    await page.screenshot({path:path.join(artifacts,'ver005-max-formation-battle.png')});
  });
  await check('Zero-companion UI formation is valid and the next floor deploys the mandatory king alone',async()=>{
    await load();await win();await page.waitForSelector('#nextFloorBtn');for(const id of (await state()).formation)await page.locator(`[data-roster="${id}"]`).click();assert.equal((await state()).formation.length,0);assert.match(await page.locator('.formation-count').textContent(),/0\s*\/\s*11/);
    await page.locator('#nextFloorBtn').click();await ready();const s=await state();assert.equal(s.floor,2);assert.deepEqual(s.units.filter(u=>u.side==='player').map(u=>u.type),['king']);assert.equal(s.units.filter(u=>u.side==='enemy').length,12);assert.equal(s.formation.length,0);
  });
  await check('Defeat loses provisional rewards and retry clears transient UI and restarts',async()=>{
    await load();await page.evaluate(()=>{const s=__qaState,k=s.units.find(u=>u.side==='player'&&u.type==='king');k.x=4;k.y=2;k.hp=1;s.candidates=['slime','slime'];});await page.locator('#waitBtn').click();await page.waitForSelector('#retryBtn');
    const s=await state();assert.equal(s.phase,'defeat');assert.equal(s.candidates.length,0);assert.equal(s.roster.length,3);await page.locator('#retryBtn').click();await ready();assert.equal((await state()).floor,1);assert.equal((await state()).totalActions,0);assert.equal(await mode(),false);assert.equal(await page.locator('#logPanel').isVisible(),false);
  });
  await check('10F clear lists acquired rewards and retry starts a fresh run',async()=>{
    await load();await page.evaluate(()=>{__qaState.candidates=['dragon','slime'];});await win(10);await page.waitForSelector('#retryBtn');assert.equal((await state()).phase,'clear');assert.match(await page.locator('#modal').textContent(),/10F/);assert.equal(await page.locator('.rewards .loot-chip').count(),2);
    await page.locator('#retryBtn').click();await ready();const s=await state();assert.equal(s.floor,1);assert.equal(s.roster.length,11);assert.equal(s.units.length,24);assert.equal(s.candidates.length,0);
  });
  await check('Both sides expose shared passive descriptions, live base/effective ATK and current guardian without resizing',async()=>{
    await load();await installUnits([{id:'qa-status-pk',type:'king',side:'player',x:0,y:2},{id:'qa-status-orc',type:'orc',side:'player',x:2,y:2},{id:'qa-status-k1',type:'knight',side:'player',x:2,y:1},{id:'qa-status-k2',type:'knight',side:'player',x:1,y:2},{id:'qa-status-golem',type:'golem',side:'player',x:2,y:3},{id:'qa-status-archer',type:'archer',side:'player',x:0,y:4},{id:'qa-status-ek',type:'king',side:'enemy',x:6,y:2},{id:'qa-status-enemy-orc',type:'orc',side:'enemy',x:4,y:2},{id:'qa-status-enemy-knight',type:'knight',side:'enemy',x:4,y:1},{id:'qa-status-enemy-golem',type:'golem',side:'enemy',x:4,y:3},{id:'qa-status-enemy-archer',type:'archer',side:'enemy',x:5,y:0}]);
    const b=await rect();await page.locator('[data-unit-id="qa-status-orc"]').click();assert.equal((await page.locator('.effective-atk').textContent()).trim(),'6');assert.equal((await page.locator('.atk-breakdown').textContent()).replace(/\s/g,''),'基礎3＋3');assert.match(await page.locator('#protectionInfo').textContent(),/ゴーレム.*14/);await fixed(b);
    for(const [id,type,name]of [['qa-status-archer','archer','支援射撃'],['qa-status-k1','knight','鼓舞'],['qa-status-golem','golem','守護の石壁'],['qa-status-enemy-archer','archer','支援射撃']]){await page.locator(`[data-unit-id="${id}"]`).click();const description=await page.evaluate(type=>Sekasoko.Engine.passivesFor(type)[0].description,type);await page.locator('#passiveInfo').scrollIntoViewIfNeeded();assert.ok((await page.locator('#passiveInfo').textContent()).includes(name));assert.ok((await page.locator('#passiveInfo').textContent()).includes(description));if(id.includes('enemy'))assert.equal(await page.locator('#skillActions').isVisible(),false);await fixed(b);}
    await page.locator('[data-unit-id="qa-status-enemy-orc"]').click();assert.equal((await page.locator('.effective-atk').textContent()).trim(),'4');assert.equal((await page.locator('.atk-breakdown').textContent()).replace(/\s/g,''),'基礎3＋1');assert.match(await page.locator('#protectionInfo').textContent(),/ゴーレム.*14/);assert.equal(await page.locator('#skillActions').isVisible(),false);
    await page.locator('[data-unit-id="qa-status-k1"]').click();const before=await state();await page.locator('.cell[data-x="3"][data-y="1"]').click();await ready();assert.equal((await state()).totalActions,before.totalActions+2);await page.locator('[data-unit-id="qa-status-orc"]').click();assert.equal((await page.locator('.effective-atk').textContent()).trim(),'4');assert.equal((await page.locator('.atk-breakdown').textContent()).replace(/\s/g,''),'基礎3＋1');await fixed(b);
  });
  await check('Guard and two supports display damage on actual recipients with intermediate HP and one candidate/AI reply',async()=>{
    const ids=await supportFixture();await page.locator(`[data-unit-id="${ids.target}"]`).click();assert.match(await page.locator('#protectionInfo').textContent(),/ゴーレム.*3/);await page.locator(`[data-unit-id="${ids.actor}"]`).click();const before=await state(),b=await rect();await observePassives();await page.locator(`[data-unit-id="${ids.target}"]`).click();await ready();
    const after=await state(),visuals=await page.evaluate(()=>__qaVisuals);assert.equal(after.totalActions,before.totalActions+2);assert.equal(after.turn,before.turn+2);assert.equal(after.units.find(u=>u.id===ids.target).hp,1);assert.equal(after.units.find(u=>u.id===ids.actor).hp,7);assert.ok(!after.units.some(u=>u.id===ids.guard));assert.deepEqual(after.candidates,['golem']);assert.equal(after.roster.length,before.roster.length);
    assert.deepEqual(visuals.damage.slice(0,3).map(d=>[d.recipient,d.original,d.text,d.hp]),[[ids.guard,ids.target,'−3','0'],[ids.target,ids.target,'−2','3'],[ids.target,ids.target,'−2','1']]);assert.deepEqual(visuals.cues.map(c=>[c.effect,c.source]),[['guard',ids.guard],['support','qa-support-a1'],['support','qa-support-a2']]);assert.equal(visuals.candidates.length,1);assert.match(visuals.candidates[0],/ゴーレム/);assert.ok(after.log.some(t=>t.includes('ゴーレム')&&t.includes('ゴブリン')&&t.includes('肩代わり')));assert.ok(after.log.some(t=>t.includes('支援射撃')));await fixed(b);
    for(const [d,x,y]of [[visuals.damage[0],4,1],[visuals.damage[1],4,2],[visuals.damage[2],4,2]]){assert.ok(Math.abs(d.left-(x+.5)/7*100)<.1);assert.ok(Math.abs(d.top-(y+.35)/5*100)<.1);}
    await page.waitForTimeout(750);assert.equal(await page.locator('#board .passive-cue').count(),0);assert.deepEqual(await state(),after);await page.screenshot({path:path.join(artifacts,'ver006-guard-support-result.png')});
  });
  await check('A guarded king dies to ordered support, cancels later archers and awards guard exactly once without an AI turn',async()=>{
    const ids=await supportFixture(true);await page.locator(`[data-unit-id="${ids.actor}"]`).click();const before=await state();await observePassives();await page.locator(`[data-unit-id="${ids.target}"]`).click();await page.waitForSelector('#nextFloorBtn');const after=await state(),visuals=await page.evaluate(()=>__qaVisuals);assert.equal(after.phase,'victory');assert.equal(after.totalActions,before.totalActions+1);assert.equal(after.turn,before.turn);assert.equal(after.roster.length,before.roster.length+1);assert.deepEqual(after.lastRewards,['golem']);assert.deepEqual(after.candidates,[]);assert.deepEqual(visuals.cues.filter(c=>c.effect==='support').map(c=>c.source),['qa-support-a1','qa-support-a2']);assert.equal(visuals.damage.length,3);assert.equal(visuals.candidates.length,1);assert.equal(await page.locator('.rewards .loot-chip').count(),1);assert.match(await page.locator('.rewards').textContent(),/ゴーレム/);await page.waitForTimeout(150);assert.deepEqual(await state(),after);
  });
  await check('Maximum legal king plus11 archers renders12 guarded/support strikes as one action and one AI reply',async()=>{
    await page.emulateMedia({reducedMotion:'no-preference'});await load();const slots=[[0,2],[1,1],[1,2],[1,3],[2,0],[2,1],[2,3],[2,4],[3,0],[3,1],[3,3]];
    const defs=[{id:'qa-max-pk',type:'king',side:'player',x:2,y:2},...slots.map(([x,y],i)=>({id:`qa-max-support-${String(i+1).padStart(2,'0')}`,type:'archer',side:'player',x,y})),{id:'qa-max-target',type:'golem',side:'enemy',x:3,y:2},{id:'qa-max-guard',type:'golem',side:'enemy',x:4,y:2},{id:'qa-max-ek',type:'king',side:'enemy',x:6,y:4}];
    await installUnits(defs);await page.evaluate(()=>{__qaState.roster=Array.from({length:11},(_,i)=>({id:`qa-max-roster-${i}`,type:'archer'}));__qaState.formation=__qaState.roster.map(p=>p.id);});const king=(await state()).units.find(u=>u.type==='king'&&u.side==='player');await page.locator(`[data-unit-id="${king.id}"]`).click();const before=await state(),b=await rect();await observePassives();const start=Date.now();await page.locator('[data-unit-id="qa-max-target"]').click();await ready();const elapsed=Date.now()-start,after=await state(),visuals=await page.evaluate(()=>__qaVisuals);
    assert.equal(after.totalActions,before.totalActions+2);assert.equal(after.turn,before.turn+2);assert.equal(after.units.find(u=>u.id==='qa-max-target').hp,4);assert.ok(!after.units.some(u=>u.id==='qa-max-guard'));assert.deepEqual(after.candidates,['golem']);assert.equal(after.roster.length,11);assert.equal(after.units.length,14);assert.equal(visuals.candidates.length,1);
    const hits=visuals.damage.slice(0,12);assert.equal(hits.length,12);assert.deepEqual(hits.map(d=>d.recipient),[...Array(7).fill('qa-max-guard'),...Array(5).fill('qa-max-target')]);assert.deepEqual(hits.map(d=>d.hp),['12','10','8','6','4','2','0','12','10','8','6','4']);assert.ok(hits.every(d=>d.text==='−2'));assert.deepEqual(visuals.cues.filter(c=>c.effect==='support').map(c=>c.source),slots.map((_,i)=>`qa-max-support-${String(i+1).padStart(2,'0')}`));assert.equal(visuals.cues.filter(c=>c.effect==='guard').length,7);
    assert.equal(await page.locator('#board .passive-cue').count(),0);assert.equal(await page.locator('#board').getAttribute('data-animation'),null);for(const u of after.units)assert.equal(await page.locator(`[data-unit-id="${u.id}"] .hp`).textContent(),String(u.hp));await fixed(b);console.log(`OBSERVE max-support browser walltime ${elapsed}ms (synthetic Chromium run; not a device-speed guarantee)`);await page.screenshot({path:path.join(artifacts,'ver006-max11-support-result.png')});await page.emulateMedia({reducedMotion:'reduce'});
  });
  await check('UI flows produce no browser errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);});
  console.log(`\n${passed}/${passed} browser UI checks passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
