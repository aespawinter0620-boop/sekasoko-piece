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
 async function load(){await page.goto('about:blank');await page.setContent(qaHTML,{waitUntil:'load'});await page.waitForSelector('.unit');}
 async function state(){return await page.evaluate(()=>Sekasoko.inspect());}
 async function ready(){await page.waitForFunction(()=>Sekasoko.inspect().phase==='player'&&!document.querySelector('#waitBtn').disabled);}
 async function select(type='knight',side='player'){const id=await page.evaluate(({type,side})=>__qaState.units.find(u=>u.type===type&&u.side===side).id,{type,side});await page.locator(`[data-unit-id="${id}"]`).click();return id;}
 async function rect(selector='#board'){return await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});}
 async function fixed(before){assert.deepEqual(await rect(),before);}
 async function mode(){return await page.locator('#normalAttackBtn').getAttribute('aria-pressed')==='true';}
 async function ranged(){await page.evaluate(()=>{const s=__qaState,a=s.units.find(u=>u.type==='archer'&&u.side==='player');a.x=3;a.y=2;const slimes=s.units.filter(u=>u.side==='enemy'&&u.type==='slime');slimes[0].x=4;slimes[0].y=2;slimes[1].x=4;slimes[1].y=1;s.units.find(u=>u.type==='goblin'&&u.side==='enemy').x=6;s.units.find(u=>u.type==='goblin'&&u.side==='enemy').y=4;});}
 async function openMenu(){await page.locator('#menuBtn').click();await page.waitForSelector('#menuPanel',{state:'visible'});}
 async function win(floor=1){await page.evaluate(floor=>{const s=__qaState;s.floor=floor;const a=s.units.find(u=>u.side==='player'&&u.type==='archer');a.x=3;a.y=2;const k=s.units.find(u=>u.side==='enemy'&&u.type==='king');k.x=6;k.y=2;k.hp=1;},floor);await select('archer');const king=await page.evaluate(()=>__qaState.units.find(u=>u.side==='enemy'&&u.type==='king').id);await page.locator(`[data-unit-id="${king}"]`).click();}
 try{
  await load();
  await check('Offline VER.004 initializes 35 cells, eight units, closed menu/log and no permanent loot panel',async()=>{
    assert.equal(await page.locator('.cell').count(),35);assert.equal(await page.locator('.unit').count(),8);const s=await state();assert.equal(s.floor,1);assert.equal(s.phase,'player');
    assert.equal(await page.locator('#board .unit-name').evaluateAll(es=>es.every(e=>!e.checkVisibility({checkVisibilityCSS:true}))),true);assert.match(await page.locator('.unit.player').first().getAttribute('aria-label'),/王/);assert.equal(await page.locator('#menuPanel').isVisible(),false);assert.equal(await page.locator('#logPanel').isVisible(),false);assert.equal(await page.locator('#lootList,#lootCount').count(),0);
  });
  await check('Ally selection shows art, stats and three action buttons without moving the board',async()=>{
    const b=await rect();await select();await fixed(b);assert.match(await page.locator('#inspectorBody').textContent(),/騎士/);
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
    await page.locator('#helpBtn').click();assert.equal(await page.locator('.master-table tbody tr').count(),10);assert.equal(await page.locator('#overlay').isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#overlay').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'menuBtn');await fixed(b);
    await openMenu();await page.locator('#closeMenuBtn').click();assert.equal(await page.locator('#menuPanel').isVisible(),false);await fixed(b);
  });
  await check('Restart cancellation preserves progress and confirmation restores the initial party',async()=>{
    const before=await state();await openMenu();await page.locator('#restartBtn').click();await page.locator('#cancelRestartBtn').click();assert.deepEqual(await state(),before);
    await openMenu();await page.locator('#restartBtn').click();await page.locator('#confirmRestartBtn').click();await ready();const s=await state();assert.equal(s.floor,1);assert.equal(s.turn,1);assert.equal(s.totalActions,0);assert.equal(s.roster.length,3);
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
  await check('Victory formation preserves inventory and validates slot, cost and duplicate deployment',async()=>{
    const before=await state();await page.waitForSelector('#nextFloorBtn');assert.equal((await state()).roster.length,before.roster.length);
    const s=await state(),acquired=s.roster.at(-1).id,knight=s.roster.find(u=>u.type==='knight').id,originalSlime=s.roster.find(u=>u.type==='slime').id;
    await page.locator(`[data-roster="${acquired}"]`).click();assert.equal((await state()).formation.length,3);assert.match(await page.locator('#toast').textContent(),/最大3体/);
    await page.locator(`[data-roster="${knight}"]`).click();await page.locator(`[data-roster="${originalSlime}"]`).click();await page.locator('[data-roster="qa-dragon"]').click();
    await page.locator('[data-roster="qa-mage"]').click();assert.match(await page.locator('#toast').textContent(),/10/);assert.equal((await state()).formation.length,2);
    await page.locator('[data-roster="qa-dragon"]').click();await page.locator(`[data-roster="${originalSlime}"]`).click();await page.locator(`[data-roster="${acquired}"]`).click();
    const chosen=await state();assert.equal(chosen.formation.filter(id=>chosen.roster.find(u=>u.id===id).type==='slime').length,2);
    await page.locator('#nextFloorBtn').click();await ready();const next=await state();assert.equal(next.floor,2);assert.equal(next.turn,1);assert.equal(next.units.filter(u=>u.side==='player'&&u.type==='slime').length,2);assert.ok(next.units.every(u=>u.hp===u.maxHp));assert.equal(next.roster.length,before.roster.length);
    await page.screenshot({path:path.join(artifacts,'ver003-battle.png')});
  });
  await check('Defeat loses provisional rewards and retry clears transient UI and restarts',async()=>{
    await load();await page.evaluate(()=>{const s=__qaState,k=s.units.find(u=>u.side==='player'&&u.type==='king');k.x=4;k.y=2;k.hp=1;s.candidates=['slime','slime'];});await page.locator('#waitBtn').click();await page.waitForSelector('#retryBtn');
    const s=await state();assert.equal(s.phase,'defeat');assert.equal(s.candidates.length,0);assert.equal(s.roster.length,3);await page.locator('#retryBtn').click();await ready();assert.equal((await state()).floor,1);assert.equal((await state()).totalActions,0);assert.equal(await mode(),false);assert.equal(await page.locator('#logPanel').isVisible(),false);
  });
  await check('10F clear lists acquired rewards and retry starts a fresh run',async()=>{
    await load();await page.evaluate(()=>{__qaState.candidates=['dragon','slime'];});await win(10);await page.waitForSelector('#retryBtn');assert.equal((await state()).phase,'clear');assert.match(await page.locator('#modal').textContent(),/10F/);assert.equal(await page.locator('.rewards .loot-chip').count(),2);
    await page.locator('#retryBtn').click();await ready();const s=await state();assert.equal(s.floor,1);assert.equal(s.roster.length,3);assert.equal(s.candidates.length,0);
  });
  await check('UI flows produce no browser errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);});
  console.log(`\n${passed}/${passed} browser UI checks passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
