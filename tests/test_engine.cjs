'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8');
const context = vm.createContext({console, Math, setTimeout, clearTimeout});
vm.runInContext(source, context);
const {MASTER, ARMY_RULES, PASSIVES, PASSIVE_LOADOUTS, Engine: E} = context.Sekasoko;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function unit(id, type, side, x, y, hp = MASTER[type].hp) {
  return {id, type, side, x, y, hp, maxHp: MASTER[type].hp};
}
function setup(units, phase = 'player') {
  const s = E.createRun();
  s.units = units;
  s.phase = phase;
  s.candidates = [];
  s.lastRewards = [];
  return s;
}
function action(s, a) { const r = E.act(s, a); assert.equal(r.ok, true, r.error); return r; }
function json(v) { return JSON.parse(JSON.stringify(v)); }
function formationCost(s,ids) { return ids.reduce((sum,id)=>sum+MASTER[s.roster.find(r=>r.id===id).type].cost,0); }

test('All ten master characters match the supplied provisional values', () => {
  const expected = {
    king:[12,2,1,1,0], knight:[8,3,2,1,3], archer:[5,2,1,3,2],
    mage:[4,4,1,3,4], slime:[4,1,1,1,1], goblin:[5,2,2,1,2],
    orc:[9,3,1,1,3], golem:[14,2,1,1,4], hamster:[3,2,3,1,1], dragon:[12,5,2,2,6]
  };
  assert.equal(Object.keys(MASTER).length, 10);
  for (const [type, stats] of Object.entries(expected)) {
    const m = MASTER[type];
    assert.ok(m.name && m.icon);
    assert.deepEqual([m.hp,m.atk,m.move,m.range,m.cost], stats);
  }
});

test('New run deploys the exact 24-piece armies and initial cost 23', () => {
  const s = E.createRun();
  assert.equal(s.floor,1); assert.equal(s.turn,1); assert.equal(s.phase,'player');
  const starting = ['knight','knight','knight','knight','archer','archer','archer','archer','slime','slime','slime'];
  const enemies = ['slime','slime','slime','slime','slime','slime','slime','goblin','goblin','goblin','goblin'];
  assert.deepEqual(json(s.roster.map(r=>r.type)),starting);
  assert.deepEqual(json(s.formation),json(s.roster.map(r=>r.id)));
  assert.equal(formationCost(s,s.formation),23);
  assert.equal(s.roster.length,11); assert.equal(new Set(s.roster.map(r=>r.id)).size,11);
  for (const [side, types, slots, kingX] of [['player',starting,ARMY_RULES.playerSlots,0],['enemy',enemies,ARMY_RULES.enemySlots,6]]) {
    const army=s.units.filter(u=>u.side===side);
    assert.equal(army.length,12); assert.equal(army[0].type,'king');
    assert.deepEqual([army[0].x,army[0].y],[kingX,2]);
    assert.deepEqual(json(army.slice(1).map(u=>u.type)),types);
    assert.deepEqual(json(army.slice(1).map(({x,y})=>({x,y}))),json(slots));
  }
  assert.equal(new Set(s.units.map(u=>u.id)).size,24);
  assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,24);
  assert.ok(s.units.every(u=>u.x!==3&&u.hp===MASTER[u.type].hp));
});

test('Shared army limits and ordered slots are deeply frozen and exact', () => {
  const slots=[[2,0],[2,1],[2,2],[2,3],[2,4],[1,1],[1,3],[0,0],[0,1],[0,3],[0,4]];
  assert.equal(ARMY_RULES.maxHandPieces,11); assert.equal(ARMY_RULES.costLimit,35);
  assert.deepEqual(json(ARMY_RULES.playerSlots.map(p=>[p.x,p.y])),slots);
  assert.deepEqual(json(ARMY_RULES.enemySlots.map(p=>[p.x,p.y])),slots.map(([x,y])=>[6-x,y]));
  assert.ok(Object.isFrozen(ARMY_RULES));
  for(const value of Object.values(ARMY_RULES)) if(Array.isArray(value)) {
    assert.ok(Object.isFrozen(value));
    for(const item of value) if(typeof item==='object') assert.ok(Object.isFrozen(item));
  }
});

test('BFS movement counts steps, cannot pass through pieces, and stays on the 7x5 board', () => {
  const s = setup([unit('k','king','player',0,4), unit('h','hamster','player',0,2), unit('b','slime','player',1,2), unit('ek','king','enemy',6,2)]);
  const moves = E.moves(s,'h');
  assert.ok(!moves.some(p=>p.x===1&&p.y===2));
  assert.ok(!moves.some(p=>p.x===2&&p.y===2), 'blocked direct path requires four steps');
  assert.ok(moves.some(p=>p.x===1&&p.y===1), 'two-step route around blocker exists');
  assert.ok(moves.every(p=>p.x>=0&&p.x<7&&p.y>=0&&p.y<5));
  assert.ok(!moves.some(p=>p.x===0&&p.y===2));
  for (const dest of moves) {
    assert.ok(Array.isArray(dest.path));
    let prev = s.units.find(u=>u.id==='h');
    for (const p of dest.path) {
      // Paths may include the initial position.
      const d = Math.abs(p.x-prev.x)+Math.abs(p.y-prev.y);
      assert.ok(d===0||d===1);
      assert.ok(!s.units.some(u=>u.id!=='h'&&u.x===p.x&&u.y===p.y));
      prev=p;
    }
    assert.equal(prev.x,dest.x); assert.equal(prev.y,dest.y);
  }
  const trapped = setup([unit('p','knight','player',0,0),unit('a','slime','player',1,0),unit('b','slime','enemy',0,1),unit('ek','king','enemy',6,2)]);
  assert.equal(E.moves(trapped,'p').length,0);
});

test('Ranged targets use Manhattan distance and ignore intervening pieces', () => {
  const s = setup([unit('a','archer','player',0,2),unit('block','slime','player',1,2),unit('near','slime','enemy',3,2),unit('far','slime','enemy',2,4),unit('ek','king','enemy',6,2)]);
  const ids = E.targets(s,'a').map(u=>u.id);
  assert.ok(ids.includes('near'));
  assert.ok(!ids.includes('far')); assert.ok(!ids.includes('block'));
  const r=action(s,{type:'attack',unitId:'a',targetId:'near'});
  assert.equal(s.units.find(u=>u.id==='near').hp,2);
  assert.ok(r.events.some(e=>e.type==='attack'&&e.damage===2));
});

test('Each move or attack consumes exactly one action and alternates sides', () => {
  const s = setup([unit('k','king','player',0,2),unit('n','knight','player',1,1),unit('e','slime','enemy',3,1),unit('ek','king','enemy',6,2)]);
  const turn=s.turn;
  action(s,{type:'move',unitId:'n',x:2,y:1});
  assert.equal(s.phase,'enemy'); assert.equal(s.turn,turn+1);
  const before=json(s);
  assert.equal(E.act(s,{type:'attack',unitId:'n',targetId:'e'}).ok,false);
  assert.deepEqual(json(s),before);
  action(s,{type:'wait'});
  assert.equal(s.phase,'player'); assert.equal(s.turn,turn+2);
  action(s,{type:'attack',unitId:'n',targetId:'e'});
  assert.equal(s.phase,'enemy'); assert.equal(s.units.find(u=>u.id==='e').hp,1);
});

test('Illegal movement and attacks are rejected without changing state', () => {
  const s=E.createRun();
  const k=s.units.find(u=>u.side==='player'&&u.type==='king');
  const ally=s.units.find(u=>u.side==='player'&&u.type==='knight');
  const enemy=s.units.find(u=>u.side==='enemy');
  const invalid=[
    {type:'move',unitId:k.id,x:-1,y:2},
    {type:'move',unitId:k.id,x:6,y:0},
    {type:'move',unitId:k.id,x:ally.x,y:ally.y},
    {type:'attack',unitId:k.id,targetId:ally.id},
    {type:'attack',unitId:k.id,targetId:enemy.id},
    {type:'attack',unitId:enemy.id,targetId:k.id},
    {type:'attack',unitId:'missing',targetId:enemy.id},
    {type:'unexpected'}
  ];
  for(const a of invalid) { const before=json(s); assert.equal(E.act(s,a).ok,false); assert.deepEqual(json(s),before); }
});

test('Wait ends a turn even when the selected piece has no legal moves or attacks', () => {
  const s=setup([unit('k','king','player',0,0),unit('b1','slime','player',1,0),unit('b2','slime','player',0,1),unit('ek','king','enemy',6,2)]);
  assert.equal(E.moves(s,'k').length,0); assert.equal(E.targets(s,'k').length,0);
  action(s,{type:'wait',unitId:'k'}); assert.equal(s.phase,'enemy');
});

test('Only killed nonking enemies become candidates; victory commits all duplicates once', () => {
  const s=setup([unit('k','king','player',0,4),unit('a','archer','player',0,2),unit('s1','slime','enemy',1,2,1),unit('s2','slime','enemy',2,2,1),unit('ek','king','enemy',3,2,2),unit('survivor','goblin','enemy',6,4)]);
  const original=s.roster.length;
  action(s,{type:'attack',unitId:'a',targetId:'s1'});
  assert.deepEqual(json(s.candidates),['slime']); assert.equal(s.roster.length,original);
  s.phase='player'; action(s,{type:'attack',unitId:'a',targetId:'s2'});
  assert.deepEqual(json(s.candidates),['slime','slime']);
  s.phase='player'; action(s,{type:'attack',unitId:'a',targetId:'ek'});
  assert.equal(s.phase,'victory');
  assert.equal(s.roster.length,original+2);
  assert.equal(new Set(s.roster.map(r=>r.id)).size,s.roster.length);
  assert.deepEqual(json(s.lastRewards),['slime','slime']);
  assert.equal(s.roster.filter(r=>r.type==='king').length,0);
  assert.equal(s.roster.filter(r=>r.type==='goblin').length,0);
  assert.equal(E.act(s,{type:'wait'}).ok,false); assert.equal(s.roster.length,original+2);
});

test('Defeat discards provisional rewards and is triggered solely by friendly king HP', () => {
  const s=setup([unit('k','king','player',0,2,1),unit('n','knight','player',0,1),unit('a','archer','enemy',3,2),unit('ek','king','enemy',6,2)],'enemy');
  s.candidates=['dragon','slime']; const count=s.roster.length;
  action(s,{type:'attack',unitId:'a',targetId:'k'});
  assert.equal(s.phase,'defeat'); assert.equal(s.candidates.length,0); assert.equal(s.roster.length,count);
  assert.equal(E.advance(s).ok,false);
});

test('Normal kings move and attack, and losing a nonking does not end battle', () => {
  const s=setup([unit('k','king','player',1,2),unit('n','slime','player',1,1,1),unit('e','slime','enemy',2,1),unit('ek','king','enemy',6,2)]);
  assert.equal(E.act(s,{type:'attack',unitId:'k',targetId:'e'}).ok,false);
  action(s,{type:'move',unitId:'k',x:2,y:2});
  action(s,{type:'attack',unitId:'e',targetId:'n'});
  assert.equal(s.phase,'player'); assert.ok(!s.units.some(u=>u.id==='n'));
  action(s,{type:'attack',unitId:'k',targetId:'e'});
  assert.equal(s.units.find(u=>u.id==='e').hp,2);
});

test('Formation permits eleven distinct instances and cost 35, rejects twelve and cost 36', () => {
  const s=E.createRun(); s.phase='victory';
  s.roster.push(...Array.from({length:6},(_,i)=>({id:`dragon${i}`,type:'dragon'})),
    ...Array.from({length:12},(_,i)=>({id:`slime${i}`,type:'slime'})),
    {id:'not-handpiece',type:'king'},{id:'unknown-type',type:'missing'});
  const eleven=Array.from({length:11},(_,i)=>`slime${i}`);
  assert.equal(E.setFormation(s,eleven).ok,true);
  assert.deepEqual(json(s.formation),eleven); assert.equal(formationCost(s,s.formation),11);
  const cost35=[...Array.from({length:4},(_,i)=>`dragon${i}`),...s.roster.filter(r=>r.type==='archer').map(r=>r.id),...Array.from({length:3},(_,i)=>`slime${i}`)];
  assert.equal(cost35.length,11);
  assert.equal(formationCost(s,cost35),35); assert.equal(E.setFormation(s,cost35).ok,true);
  const invalid=[Array.from({length:12},(_,i)=>`slime${i}`),Array.from({length:6},(_,i)=>`dragon${i}`),
    ['slime0','slime0'],['missing'],['not-handpiece'],['unknown-type'],null];
  for(const ids of invalid) {
    const before=json(s.formation); assert.equal(E.setFormation(s,ids).ok,false); assert.deepEqual(json(s.formation),before);
  }
  assert.equal(E.setFormation(s,[]).ok,true);
  s.phase='player'; assert.equal(E.setFormation(s,['slime0']).ok,false);
});

test('Zero through eleven handpieces deploy into the ordered prefix with one fixed king', () => {
  for(let count=0;count<=11;count++) {
    const s=E.createRun(); s.phase='victory';
    const ids=s.roster.slice(0,count).map(r=>r.id);
    assert.equal(E.setFormation(s,ids).ok,true); assert.equal(E.advance(s).ok,true);
    const army=s.units.filter(u=>u.side==='player');
    assert.equal(army.length,count+1); assert.deepEqual([army[0].type,army[0].x,army[0].y],['king',0,2]);
    assert.deepEqual(json(army.slice(1).map(({x,y})=>({x,y}))),json(ARMY_RULES.playerSlots.slice(0,count)));
    assert.equal(s.units.filter(u=>u.side==='enemy').length,12);
    assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,s.units.length);
    assert.equal(new Set(s.units.map(u=>u.id)).size,s.units.length);
    assert.ok(s.units.every(u=>u.x!==3));
  }
});

test('Next floor restores killed allies, heals survivors, and deploys the selected instances', () => {
  const s=E.createRun();
  const initialFormation=json(s.formation);
  s.units=s.units.filter(u=>u.side==='enemy'||u.type==='king');
  s.units.find(u=>u.side==='player').hp=1;
  s.phase='victory'; s.candidates=['slime'];
  const result=E.advance(s); assert.equal(result.ok,true,result.error);
  assert.equal(s.floor,2); assert.equal(s.phase,'player'); assert.equal(s.turn,1);
  assert.deepEqual(json(s.formation),initialFormation);
  assert.equal(s.units.filter(u=>u.side==='player').length,12);
  assert.ok(s.units.every(u=>u.hp===MASTER[u.type].hp));
  assert.equal(s.candidates.length,0);
  assert.equal(s.units.filter(u=>u.side==='enemy').length,12);
});

test('AI prioritizes a lethal king attack over other captures', () => {
  const s=setup([unit('pk','king','player',2,2,2),unit('p','slime','player',3,1,1),unit('e','archer','enemy',4,2),unit('ek','king','enemy',6,2)],'enemy');
  const a=E.chooseAI(s);
  assert.equal(a.type,'attack'); assert.equal(a.targetId,'pk');
  action(s,a); assert.equal(s.phase,'defeat');
});

test('AI prefers a lethal nonking target when the friendly king cannot be killed', () => {
  const s=setup([unit('pk','king','player',2,2),unit('p','slime','player',3,1,1),unit('e','archer','enemy',4,2),unit('ek','king','enemy',6,2)],'enemy');
  const a=E.chooseAI(s); assert.equal(a.type,'attack'); assert.equal(a.targetId,'p'); action(s,a);
  assert.equal(s.phase,'player'); assert.ok(s.units.some(u=>u.id==='pk'));
});

test('A distant lone enemy king makes safe progress instead of waiting forever', () => {
  const s=setup([unit('pk','king','player',0,0),unit('ek','king','enemy',6,4)],'enemy');
  const a=E.chooseAI(s);
  assert.equal(a.type,'move'); assert.equal(a.unitId,'ek');
  assert.ok(Math.abs(a.x)+Math.abs(a.y)<10);
  action(s,a);
});

test('Enemy king does not use the progress fallback to enter lethal attack range', () => {
  const s=setup([unit('pk','king','player',0,0),unit('pa','archer','player',3,3),unit('ek','king','enemy',6,4,2)],'enemy');
  const a=E.chooseAI(s);
  assert.equal(a.type,'wait');
  action(s,a);
});

test('AI returns legal actions across a reproducible sample of fight sequences', () => {
  for(let trial=0;trial<20;trial++) {
    const s=E.createRun();
    for(let step=0;step<180&&(s.phase==='player'||s.phase==='enemy');step++) {
      if(s.phase==='player') {
        const all=s.units.filter(u=>u.side==='player');
        const attacks=all.flatMap(u=>E.targets(s,u.id).map(t=>({type:'attack',unitId:u.id,targetId:t.id})));
        const moves=all.flatMap(u=>E.moves(s,u.id).map(p=>({type:'move',unitId:u.id,x:p.x,y:p.y})));
        const options=attacks.length?attacks:moves.length?moves:[{type:'wait'}];
        action(s,options[(step*7+trial*11)%options.length]);
      } else action(s,E.chooseAI(s));
      assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,s.units.length);
      assert.ok(s.units.every(u=>u.x>=0&&u.x<7&&u.y>=0&&u.y<5&&u.hp>0));
    }
  }
});

test('All ten floors can be cleared consecutively with valid twelve-unit deployment and capped progression', () => {
  const s=E.createRun();
  for(let floor=1;floor<=10;floor++) {
    assert.equal(s.floor,floor);
    assert.equal(s.units.filter(u=>u.side==='enemy').length,12);
    assert.equal(s.units.filter(u=>u.side==='player').length,12);
    assert.ok(s.units.every(u=>u.hp===MASTER[u.type].hp));
    const actor=s.units.find(u=>u.side==='player'&&u.type==='archer');
    const king=s.units.find(u=>u.side==='enemy'&&u.type==='king');
    // Isolate progression from protection: deployment was checked above; guard behavior has dedicated fixtures.
    s.units=s.units.filter(u=>!(u.side==='enemy'&&u.type==='golem'));
    actor.x=3;actor.y=2;king.hp=1;
    action(s,{type:'attack',unitId:actor.id,targetId:king.id});
    assert.equal(s.phase,floor===10?'clear':'victory');
    if(floor<10) { assert.equal(E.setFormation(s,json(s.formation)).ok,true);assert.equal(E.advance(s).ok,true); }
  }
  assert.equal(E.advance(s).ok,false);assert.equal(s.floor,10);
});

test('10F victory clears the prototype and a new run fully resets it', () => {
  const s=setup([unit('k','king','player',0,2),unit('a','archer','player',3,2),unit('ek','king','enemy',6,2,1)]);
  s.floor=10; s.candidates=['dragon'];
  action(s,{type:'attack',unitId:'a',targetId:'ek'});
  assert.equal(s.phase,'clear'); assert.deepEqual(json(s.lastRewards),['dragon']);
  assert.equal(E.advance(s).ok,false);
  const fresh=E.createRun(); assert.equal(fresh.floor,1); assert.equal(fresh.phase,'player'); assert.equal(fresh.roster.length,11); assert.equal(fresh.candidates.length,0);
});


test('Eleven defeated enemies are committed once, with duplicate types and unique owned IDs', () => {
  const positions=[];
  for(let y=0;y<5;y++) for(let x=0;x<7;x++) if(Math.abs(x-3)+Math.abs(y-2)<=2&&!(x===3&&y===2)) positions.push({x,y});
  const types=['slime','slime','slime','slime','slime','slime','slime','goblin','goblin','goblin','goblin'];
  const defeated=types.map((type,i)=>unit(`capture${i}`,type,'enemy',positions[i].x,positions[i].y,1));
  const s=setup([unit('pk','king','player',0,4),unit('dragon','dragon','player',3,2),...defeated,
    unit('ek','king','enemy',6,2,1)]);
  const initial=s.roster.length;
  for(const enemy of defeated) {
    s.phase='player'; action(s,{type:'attack',unitId:'dragon',targetId:enemy.id});
    assert.equal(s.roster.length,initial);
  }
  assert.deepEqual(json(s.candidates),types); assert.equal(s.candidates.length,11);
  const actor=s.units.find(u=>u.id==='dragon'); actor.x=4; actor.y=2; s.phase='player';
  action(s,{type:'attack',unitId:'dragon',targetId:'ek'});
  assert.equal(s.phase,'victory'); assert.deepEqual(json(s.lastRewards),types);
  assert.equal(s.roster.length,initial+11); assert.equal(s.candidates.length,0);
  assert.deepEqual(json(s.roster.slice(initial).map(r=>r.type)),types);
  assert.equal(new Set(s.roster.map(r=>r.id)).size,s.roster.length);
  assert.equal(s.roster.slice(initial).some(r=>r.type==='king'||r.type==='mage'),false);
  const before=json(s); assert.equal(E.act(s,{type:'wait'}).ok,false); assert.deepEqual(json(s),before);
});

test('Defeat discards all eleven candidates without adding owned instances', () => {
  const s=setup([unit('pk','king','player',0,2,1),unit('a','archer','enemy',3,2),unit('ek','king','enemy',6,2)],'enemy');
  s.candidates=json(ARMY_RULES.firstFloorEnemyTypes); const ids=json(s.roster);
  action(s,{type:'attack',unitId:'a',targetId:'pk'});
  assert.equal(s.phase,'defeat'); assert.deepEqual(json(s.roster),ids);
  assert.equal(s.candidates.length,0); assert.equal(s.lastRewards.length,0);
});

test('Dense initial-board BFS paths avoid all 23 blockers and freed squares become usable', () => {
  const s=E.createRun();
  for(const actor of s.units) for(const move of E.moves(s,actor.id)) {
    let previous=actor;
    assert.ok(move.path.length<=MASTER[actor.type].move);
    for(const p of move.path) {
      assert.equal(Math.abs(p.x-previous.x)+Math.abs(p.y-previous.y),1);
      assert.ok(!s.units.some(u=>u.id!==actor.id&&u.x===p.x&&u.y===p.y)); previous=p;
    }
    assert.deepEqual([previous.x,previous.y],[move.x,move.y]);
  }
  const king=s.units.find(u=>u.side==='player'&&u.type==='king');
  assert.deepEqual(json(E.moves(s,king.id).map(({x,y})=>({x,y}))),[{x:1,y:2}]);
  const front=s.units.find(u=>u.side==='player'&&u.x===2&&u.y===0);
  assert.ok(E.moves(s,front.id).some(m=>m.x===3&&m.y===0));
  assert.ok(!E.moves(s,front.id).some(m=>m.x===4&&m.y===0));
  const fixture=setup([unit('pk','king','player',0,2),unit('n','knight','player',1,2),
    unit('a','archer','player',1,1),unit('block','slime','enemy',2,2,1),unit('ek','king','enemy',6,2)]);
  assert.ok(!E.moves(fixture,'n').some(m=>m.x===2&&m.y===2));
  action(fixture,{type:'attack',unitId:'a',targetId:'block'});
  assert.ok(E.moves(fixture,'n').some(m=>m.x===2&&m.y===2));
});

test('Floors 2–10 use exactly eleven unchanged weighted draws with fixed encounter samples', () => {
  // These samples were recorded from v0.0.4 weightedEnemy with the same rolls.
  const expected={
    2:['slime','slime','slime','slime','goblin','goblin','hamster','hamster','archer','knight','golem'],
    3:['slime','slime','slime','slime','goblin','hamster','hamster','archer','knight','orc','golem'],
    4:['slime','slime','slime','goblin','goblin','hamster','archer','knight','orc','mage','dragon'],
    5:['slime','slime','slime','goblin','hamster','hamster','archer','knight','orc','mage','dragon'],
    6:['slime','slime','slime','goblin','hamster','archer','knight','knight','orc','mage','dragon'],
    7:['slime','slime','slime','goblin','archer','archer','knight','orc','mage','golem','dragon'],
    8:['slime','slime','goblin','goblin','archer','knight','knight','orc','mage','golem','dragon'],
    9:['slime','slime','goblin','hamster','archer','knight','orc','orc','mage','golem','dragon'],
    10:['slime','slime','goblin','archer','knight','knight','orc','mage','mage','golem','dragon']
  };
  const rolls=[0,.01,.1,.25,.4,.5,.6,.7,.8,.9,.999999];
  for(let floor=2;floor<=10;floor++) {
    let calls=0; const math=Object.create(Math); math.random=()=>rolls[calls++];
    const c=vm.createContext({Math:math}); vm.runInContext(source,c);
    const e=c.Sekasoko.Engine, s=e.createRun(); assert.equal(calls,0);
    s.floor=floor; assert.equal(e.startBattle(s).ok,true); assert.equal(calls,11);
    const army=s.units.filter(u=>u.side==='enemy'); assert.equal(army.length,12);
    assert.deepEqual(json(army.slice(1).map(u=>u.type)),expected[floor]);
    assert.deepEqual(json(army.slice(1).map(({x,y})=>({x,y}))),json(ARMY_RULES.enemySlots));
    assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,24);
    assert.equal(new Set(s.units.map(u=>u.id)).size,24); assert.ok(s.units.every(u=>u.x!==3));
  }
});

test('Unchanged master, army, movement, targeting, and encounter rules retain their baseline source', () => {
  // Issue #7 changes attack/AI resolution, while these established rules stay unchanged. No Git dependency in shallow CI.
  const expected={
    moves:'6246ca1e52a3bcc23db2312c55cdd5ab016f7162bdcbe95e75616d65b5a2ff06',
    targets:'32f35fba40c33dccea6e79d212c2ea80393b446155b4dcff84e418bbcd799338',
    setFormation:'3fedf476a2f64b7aa6e7cb2989abfc019485c9caf23c7af7cacd6baf8668815d',
    advance:'0b4e563559f45dbbab7dee1392b92d11c61e0fa85968183d38b03eab52d9f03b'
  };
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  for(const [name,fingerprint] of Object.entries(expected)) assert.equal(hash(E[name].toString()),fingerprint,name);
  for(const [name,fingerprint] of Object.entries({MASTER:'6292c5c24edb8bdfa09e180277b74fc21ceb0e3df521895937dde47e27d19500',ARMY_RULES:'e9be58ab164271c0216a977542deb0e10983643358e2972b04aad0d8286224b7'})) {
    const start=source.indexOf(`const ${name} =`),end=source.indexOf('\n\n',start);
    assert.equal(hash(source.slice(start,end)),fingerprint,name);
  }
  const privateFunctions=[
    ['weightedEnemy','startBattle','3af526ced85b06af60cd0a581b506c3e0b0fdded31f757b2fd05a8503c6d89c1']
  ];
  for(const [name,next,fingerprint] of privateFunctions) {
    const start=source.indexOf(`  function ${name}(`), end=source.indexOf(`  function ${next}(`,start);
    assert.ok(start>=0&&end>start,name); assert.equal(hash(source.slice(start,end)),fingerprint,name);
  }
});

function hits(result) { return result.events.filter(e=>e.type==='attack'); }
function guards(result) { return result.events.filter(e=>e.type==='guard'); }
function hp(s,id) { return s.units.find(u=>u.id===id)?.hp ?? 0; }
function predictMatchesAct(s,actorId,targetId) {
  const before=json(s), prediction=E.predictAttack(s,actorId,targetId);
  assert.deepEqual(json(s),before,'prediction must preserve every field of the input state');
  assert.notEqual(prediction.state,s); assert.notEqual(prediction.state.units,s.units);
  const actualState=json(s), actual=E.act(actualState,{type:'attack',unitId:actorId,targetId});
  assert.equal(prediction.ok,actual.ok);
  if(!actual.ok) assert.equal(prediction.error,actual.error);
  assert.deepEqual(json(prediction.events),json(actual.events),'ordered event stream');
  assert.deepEqual(json(prediction.state),json(actualState),'entire resulting state including IDs, history, logs and counters');
  const damage={};
  for(const u of before.units) {
    const dealt=u.hp-hp(actualState,u.id); if(dealt>0) damage[u.id]=dealt;
  }
  assert.deepEqual(json(prediction.damageById),damage,'actual HP loss, excluding overkill');
  const deaths=json(actual.events).filter(e=>e.type==='death');
  assert.deepEqual(json(prediction.killedIds),deaths.map(e=>e.unitId));
  assert.equal(prediction.kingKilledId,deaths.find(e=>e.unitType==='king')?.unitId ?? null);
  assert.equal(prediction.terminal,['victory','defeat','clear'].includes(actualState.phase));
  return prediction;
}

test('Exactly three passive descriptors and character loadouts are immutable common data', () => {
  assert.deepEqual(Object.keys(PASSIVES).sort(),['inspiration','stoneWall','supportFire']);
  assert.deepEqual(json(PASSIVE_LOADOUTS),{archer:['supportFire'],knight:['inspiration'],golem:['stoneWall']});
  assert.ok(Object.isFrozen(PASSIVES)); assert.ok(Object.isFrozen(PASSIVE_LOADOUTS));
  const names={supportFire:'支援射撃',inspiration:'鼓舞',stoneWall:'守護の石壁'};
  for(const [id,descriptor] of Object.entries(PASSIVES)) {
    assert.equal(descriptor.id,id); assert.equal(descriptor.name,names[id]);
    assert.ok(descriptor.description); assert.ok(Object.isFrozen(descriptor));
  }
  for(const [type,ids] of Object.entries(PASSIVE_LOADOUTS)) {
    assert.ok(Object.isFrozen(ids)); assert.deepEqual(json(E.passivesFor(type).map(p=>p.id)),json(ids));
  }
  for(const type of ['king','mage','slime','goblin','orc','hamster','dragon','missing']) assert.deepEqual(json(E.passivesFor(type)),[]);
});

test('Inspiration adds zero to four orthogonal friendly knights before flooring on either side', () => {
  const adjacent=[[2,2],[4,2],[3,1],[3,3]], expected=[3,4,6,7,9];
  for(const side of ['player','enemy']) for(let n=0;n<=4;n++) {
    const other=side==='player'?'enemy':'player';
    const s=setup([unit('actor','knight',side,3,2),
      ...adjacent.slice(0,n).map(([x,y],i)=>unit(`knight${i}`,'knight',side,x,y)),
      unit('sameKing','king',side,0,4),unit('otherKing','king',other,6,4)],side);
    const info=E.combatInfo(s,'actor');
    assert.equal(info.baseAtk,3); assert.equal(info.atk,expected[n]); assert.equal(info.bonusAtk,expected[n]-3);
    assert.deepEqual(json(info.knightIds),Array.from({length:n},(_,i)=>`knight${i}`));
    assert.equal(info.passives[0].id,'inspiration');
  }
});

test('Inspiration excludes self, diagonal, hostile and dead knights and can strengthen kings', () => {
  const s=setup([unit('actor','orc','player',3,2),unit('diagonal','knight','player',2,1),
    unit('dead','knight','player',3,1,0),unit('hostile','knight','enemy',4,2),
    unit('pk','king','player',0,4),unit('ek','king','enemy',6,4)]);
  assert.equal(E.combatInfo(s,'actor').atk,3); assert.deepEqual(json(E.combatInfo(s,'actor').knightIds),[]);
  assert.equal(E.combatInfo(s,'diagonal').atk,3); assert.equal(E.combatInfo(s,'dead'),null); assert.equal(E.combatInfo(s,'missing'),null);
  s.units.push(unit('kingKnight','knight','player',0,3));
  assert.equal(E.combatInfo(s,'pk').atk,3);
});

test('Inspiration updates immediately after a knight moves adjacent and is then defeated', () => {
  const s=setup([unit('actor','orc','player',3,2),unit('n','knight','player',1,2,1),
    unit('a','archer','enemy',3,0),unit('pk','king','player',0,4),unit('ek','king','enemy',6,4)]);
  assert.equal(E.combatInfo(s,'actor').atk,3);
  action(s,{type:'move',unitId:'n',x:2,y:2}); assert.equal(E.combatInfo(s,'actor').atk,4);
  action(s,{type:'attack',unitId:'a',targetId:'n'});
  assert.equal(hp(s,'n'),0); assert.equal(E.combatInfo(s,'actor').atk,3); assert.deepEqual(json(E.combatInfo(s,'actor').knightIds),[]);
});

test('Every in-range supporting archer fires once in lexical ID order with no follow-up chain', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','orc','player',2,2),
    unit('u2','archer','player',1,2),unit('u10','archer','player',3,0),unit('outside','archer','player',6,4),
    unit('dead','archer','player',2,0,0),unit('target','golem','enemy',3,2),unit('ek','king','enemy',6,0)]);
  const beforeActions=s.totalActions, beforeTurn=s.turn;
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.deepEqual(json(hits(r).map(e=>[e.unitId,e.targetId,e.originalTargetId,e.followUp,e.damage])),
    [['actor','target','target',false,3],['u10','target','target',true,2],['u2','target','target',true,2]]);
  assert.equal(hp(s,'target'),7); assert.equal(s.totalActions,beforeActions+1); assert.equal(s.turn,beforeTurn+1); assert.equal(s.phase,'enemy');
});

test('An archer initiating an attack excludes itself from support fire and does not start support chains', () => {
  const s=setup([unit('pk','king','player',0,4),unit('starter','archer','player',2,2),
    unit('supporter','archer','player',1,2),unit('target','golem','enemy',3,2),unit('ek','king','enemy',6,4)]);
  const r=action(s,{type:'attack',unitId:'starter',targetId:'target'});
  assert.deepEqual(json(hits(r).map(e=>[e.unitId,e.followUp])),[['starter',false],['supporter',true]]);
  assert.equal(hp(s,'target'),10);
});

test('Support fire uses its own current inspired ATK at one hundred percent', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','orc','player',2,2),
    unit('archer','archer','player',0,2),unit('knight','knight','player',0,1),
    unit('target','golem','enemy',3,2),unit('ek','king','enemy',6,4)]);
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.deepEqual(json(hits(r).map(e=>e.damage)),[3,3]); assert.equal(hp(s,'target'),8);
});

test('A protected original target stays the range reference even after its first guard dies', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','orc','player',2,2),
    unit('support','archer','player',0,2),unit('target','slime','enemy',3,2),
    unit('guard','golem','enemy',4,2,1),unit('ek','king','enemy',6,4)]);
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.deepEqual(json(hits(r).map(e=>[e.unitId,e.targetId,e.originalTargetId,e.damage])),
    [['actor','guard','target',3],['support','target','target',2]]);
  assert.equal(hp(s,'guard'),0); assert.equal(hp(s,'target'),2);
  assert.deepEqual(json(s.candidates),['golem']);
});

test('An archer in range of only the guard does not support an out-of-range original target', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','orc','player',4,1),
    unit('support','archer','player',0,2),unit('target','slime','enemy',4,2),
    unit('guard','golem','enemy',3,2),unit('ek','king','enemy',6,4)]);
  // Guard is distance three from the archer; the original target is distance four.
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.equal(hits(r).length,1); assert.equal(hits(r)[0].targetId,'guard'); assert.equal(hp(s,'target'),4);
});

test('Support stops immediately when a normal hit or a follow-up defeats the original nonking', () => {
  for(const normalKill of [true,false]) {
    const s=setup([unit('pk','king','player',0,4),unit('actor',normalKill?'dragon':'slime','player',2,2),
      unit('a','archer','player',1,2),unit('z','archer','player',3,0),
      unit('target','slime','enemy',3,2,normalKill?4:3),unit('ek','king','enemy',6,4)]);
    const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
    assert.deepEqual(json(hits(r).map(e=>e.unitId)),normalKill?['actor']:['actor','a']);
    assert.equal(hp(s,'target'),0); assert.deepEqual(json(s.candidates),['slime']);
    assert.equal(r.events.filter(e=>e.type==='death').length,1); assert.equal(s.totalActions,1);
  }
});

test('A guard protects a king and absorbs overkill without overflow to the original target on both sides', () => {
  for(const side of ['player','enemy']) {
    const other=side==='player'?'enemy':'player';
    const s=setup([unit('ownKing','king',side,0,4),unit('actor','dragon',side,2,2),
      unit('target','king',other,3,2,1),unit('guard','golem',other,4,2,1)],side);
    assert.equal(E.combatInfo(s,'target').guardId,'guard');
    const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
    assert.equal(hp(s,'target'),1); assert.equal(hp(s,'guard'),0); assert.equal(s.phase,other);
    assert.deepEqual(json(guards(r)),[{type:'guard',unitId:'guard',protectedId:'target',attackerId:'actor',damage:5}]);
    assert.deepEqual([hits(r)[0].hpBefore,hits(r)[0].hpAfter,hits(r)[0].damage],[1,0,5]);
    assert.equal(E.combatInfo(s,'target').guardId,null);
  }
});

test('Guard priority uses current HP descending and then lexical ID order, excluding self and diagonal enemies', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','archer','player',0,2),
    unit('target','slime','enemy',3,2),unit('u2','golem','enemy',4,2,5),unit('u10','golem','enemy',3,1,5),
    unit('lower','golem','enemy',2,2,3),unit('diagonal','golem','enemy',4,3),
    unit('hostile','golem','player',3,3),unit('ek','king','enemy',6,4)]);
  assert.deepEqual(json(E.combatInfo(s,'target').guardIds),['u10','u2','lower']);
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.equal(guards(r)[0].unitId,'u10'); assert.equal(hp(s,'u10'),3); assert.equal(hp(s,'u2'),5);
  assert.equal(E.combatInfo(s,'target').guardId,'u2');
  const lone=setup([unit('target','golem','enemy',3,2),unit('pk','king','player',0,4),unit('ek','king','enemy',6,4)]);
  assert.equal(E.combatInfo(lone,'target').guardId,null);
});

test('Guard selection is recalculated before every hit even while all guards survive', () => {
  const s=setup([unit('pk','king','player',0,4),unit('starter','archer','player',0,2),
    unit('a','archer','player',1,2),unit('b','archer','player',3,4),unit('target','slime','enemy',3,2),
    unit('gA','golem','enemy',3,1,6),unit('gB','golem','enemy',4,2,5),unit('ek','king','enemy',6,4)]);
  const r=action(s,{type:'attack',unitId:'starter',targetId:'target'});
  assert.deepEqual(json(guards(r).map(e=>e.unitId)),['gA','gB','gA']);
  assert.deepEqual([hp(s,'gA'),hp(s,'gB'),hp(s,'target')],[2,3,4]);
});

test('A redirected hit never redirects recursively to a second golem', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','archer','player',0,2),
    unit('target','golem','enemy',3,2),unit('guard','golem','enemy',4,2),unit('recursive','golem','enemy',5,2),
    unit('ek','king','enemy',6,4)]);
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.equal(guards(r).length,1); assert.equal(guards(r)[0].unitId,'guard');
  assert.deepEqual([hp(s,'target'),hp(s,'guard'),hp(s,'recursive')],[14,12,14]);
});

test('Dead or distant golems never protect, while a defeated selected guard is removed immediately', () => {
  const s=setup([unit('pk','king','player',0,4),unit('actor','orc','player',2,2),
    unit('target','slime','enemy',3,2),unit('dead','golem','enemy',4,2,0),
    unit('diagonal','golem','enemy',4,3),unit('ek','king','enemy',6,4)]);
  assert.equal(E.combatInfo(s,'target').guardId,null);
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.equal(guards(r).length,0); assert.equal(hp(s,'target'),1);
});

function guardedKingFinish(side='player',floor=1) {
  const other=side==='player'?'enemy':'player';
  const s=setup([unit('ownKing','king',side,0,4),unit('actor','dragon',side,2,2),
    unit('a','archer',side,1,2),unit('z','archer',side,3,0),
    unit('target','king',other,3,2,2),unit('guard','golem',other,4,2,1)],side);
  s.floor=floor; s.candidates=['orc','orc']; return s;
}

test('Guard death permits support to finish the king, then victory/10F rewards commit once and remaining support stops', () => {
  for(const floor of [1,10]) {
    const s=guardedKingFinish('player',floor), count=s.roster.length, turn=s.turn;
    const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
    assert.equal(s.phase,floor===10?'clear':'victory');
    assert.deepEqual(json(hits(r).map(e=>[e.unitId,e.targetId])),[['actor','guard'],['a','target']]);
    assert.deepEqual(json(s.lastRewards),['orc','orc','golem']); assert.equal(s.candidates.length,0);
    assert.equal(s.roster.length,count+3); assert.equal(new Set(s.roster.map(r=>r.id)).size,s.roster.length);
    assert.equal(s.totalActions,1); assert.equal(s.turn,turn);
    assert.deepEqual(json(r.events.filter(e=>e.type==='death').map(e=>e.unitId)),['guard','target']);
    const before=json(s); assert.equal(E.act(s,{type:'attack',unitId:'z',targetId:'target'}).ok,false); assert.deepEqual(json(s),before);
  }
});

test('A follow-up killing the friendly king discards provisional rewards and completes only one action', () => {
  const s=guardedKingFinish('enemy'), count=s.roster.length, turn=s.turn;
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.equal(s.phase,'defeat'); assert.equal(s.candidates.length,0); assert.equal(s.lastRewards.length,0);
  assert.equal(s.roster.length,count); assert.equal(s.totalActions,1); assert.equal(s.turn,turn);
  assert.deepEqual(json(hits(r).map(e=>e.unitId)),['actor','a']);
});

test('Full attack prediction matches ordered events, actual HP loss, rewards, counters and outcome without mutation', () => {
  for(const side of ['player','enemy']) for(const floor of [1,10]) {
    const s=guardedKingFinish(side,floor); s.history={actor:[{x:1,y:2}]}; s.log=['prediction sentinel'];
    const p=predictMatchesAct(s,'actor','target');
    assert.equal(p.damageById.guard,1); assert.equal(p.damageById.target,2);
    assert.deepEqual(json(p.killedIds),['guard','target']); assert.equal(p.kingKilledId,'target'); assert.equal(p.terminal,true);
  }
});

test('Nonterminal prediction includes dynamic guard reselection and inspired support on either side', () => {
  for(const side of ['player','enemy']) {
    const other=side==='player'?'enemy':'player';
    const s=setup([unit('pk','king',side,0,4),unit('actor','archer',side,0,2),
      unit('a','archer',side,1,2),unit('b','archer',side,3,4),unit('n','knight',side,3,3),
      unit('target','slime',other,3,2),unit('gA','golem',other,3,1,6),
      unit('gB','golem',other,4,2,5),unit('ek','king',other,6,4)],side);
    const p=predictMatchesAct(s,'actor','target');
    assert.equal(p.terminal,false); assert.equal(p.kingKilledId,null);
    assert.deepEqual(json(p.damageById),{gA:5,gB:2}); assert.equal(hp(p.state,'target'),4);
  }
});

test('Invalid predictions and actions preserve all state even when passives are available', () => {
  const s=guardedKingFinish();
  for(const [actor,target] of [['missing','target'],['actor','missing'],['actor','a'],['target','actor'],['z','ownKing']]) {
    const p=predictMatchesAct(s,actor,target); assert.equal(p.ok,false);
  }
  s.phase='victory'; assert.equal(predictMatchesAct(s,'actor','target').ok,false);
});

test('Prediction stays exact and non-destructive throughout seeded passive fights for both active sides', () => {
  for(let trial=0;trial<4;trial++) {
    const math=Object.create(Math); let seed=0x600000+trial;
    math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/0x100000000);
    const c=vm.createContext({Math:math}); vm.runInContext(source,c); const engine=c.Sekasoko.Engine;
    const s=engine.createRun(); s.floor=trial%2?5:10; engine.startBattle(s);
    for(let step=0;step<100&&['player','enemy'].includes(s.phase);step++) {
      const actors=s.units.filter(u=>u.side===s.phase);
      const options=actors.flatMap(u=>engine.targets(s,u.id).map(t=>[u.id,t.id]));
      if(options.length) {
        const [actor,target]=options[(step*7+trial)%options.length]; predictMatchesAct(s,actor,target);
        action(s,{type:'attack',unitId:actor,targetId:target});
      } else {
        const moves=actors.flatMap(u=>engine.moves(s,u.id).map(p=>({type:'move',unitId:u.id,x:p.x,y:p.y})));
        action(s,moves.length?moves[(step*3+trial)%moves.length]:{type:'wait'});
      }
    }
  }
});

test('AI recognizes a king kill supplied by inspired and supporting damage rather than base ATK', () => {
  const s=setup([unit('pk','king','player',3,2,5),unit('other','slime','player',4,0,1),
    unit('actor','slime','enemy',2,2),unit('support','archer','enemy',3,4),
    unit('n','knight','enemy',2,4),unit('ek','king','enemy',6,4)],'enemy');
  // Slime 1 + inspired archer 3 is not lethal at HP5; archer's own 3 + no self-support is also not lethal.
  // Add a second archer so a real sequence kills the king although no base attack does.
  s.units.push(unit('support2','archer','enemy',5,2));
  const before=json(s), selected=E.chooseAI(s); assert.deepEqual(json(s),before,'AI selection itself is non-destructive');
  assert.equal(selected.type,'attack'); assert.equal(selected.targetId,'pk');
  const prediction=predictMatchesAct(s,selected.unitId,selected.targetId);
  assert.equal(prediction.kingKilledId,'pk'); action(s,selected); assert.equal(s.phase,'defeat');
});

test('AI does not mistake a guarded low-HP king for an immediate kill and chooses a real capture', () => {
  const s=setup([unit('pk','king','player',3,2,1),unit('guard','golem','player',4,2),
    unit('victim','slime','player',3,0,1),unit('actor','archer','enemy',2,1),unit('ek','king','enemy',6,4)],'enemy');
  const p=E.predictAttack(s,'actor','pk'); assert.equal(p.kingKilledId,null); assert.equal(p.damageById.pk,undefined);
  const selected=E.chooseAI(s); assert.equal(selected.type,'attack'); assert.equal(selected.targetId,'victim');
  action(s,selected); assert.equal(s.phase,'player'); assert.equal(hp(s,'pk'),1); assert.equal(hp(s,'victim'),0);
});


test('AI resolves a guard death followed by inspired support before choosing a king kill over another capture', () => {
  const s=setup([unit('pk','king','player',3,2,3),unit('guard','golem','player',4,2,1),
    unit('victim','slime','player',3,0,1),unit('actor','archer','enemy',2,1),
    unit('support','archer','enemy',1,2),unit('n','knight','enemy',1,3),unit('ek','king','enemy',6,4)],'enemy');
  const selected=E.chooseAI(s); assert.equal(selected.type,'attack'); assert.equal(selected.targetId,'pk');
  const p=predictMatchesAct(s,selected.unitId,selected.targetId);
  assert.equal(p.kingKilledId,'pk'); assert.deepEqual(json(p.killedIds),['guard','pk']);
  action(s,selected); assert.equal(s.phase,'defeat'); assert.equal(hp(s,'victim'),1);
});


function assertNoImmediateKingKill(s,kingId) {
  for(const actor of s.units.filter(u=>u.side===s.phase)) for(const target of E.targets(s,actor.id)) {
    const p=E.predictAttack(s,actor.id,target.id);
    assert.notEqual(p.kingKilledId,kingId,`${actor.id} can defeat ${kingId} by attacking ${target.id}`);
  }
}

test('AI evaluates guard protection on the candidate move state and does not expose its king to a one-action kill', () => {
  const s=setup([unit('eK','king','enemy',6,2,2),unit('eG','golem','enemy',5,2),
    unit('eS','slime','enemy',4,4),unit('pA','archer','player',3,2),unit('pK','king','player',0,4)],'enemy');
  const unsafe=json(s); action(unsafe,{type:'move',unitId:'eG',x:4,y:2});
  assert.equal(E.predictAttack(unsafe,'pA','eK').kingKilledId,'eK','withdrawing this guard really exposes the king');
  const before=json(s), selected=E.chooseAI(s); assert.deepEqual(json(s),before);
  action(s,selected); assertNoImmediateKingKill(s,'eK'); assert.equal(hp(s,'eK'),2);
});

test('AI includes enemy support fire when predicting the king danger after its own move', () => {
  const s=setup([unit('eK','king','enemy',5,2,4),unit('pG','goblin','player',3,2),
    unit('pA','archer','player',5,0),unit('pK','king','player',0,4)],'enemy');
  const unsafe=json(s); action(unsafe,{type:'move',unitId:'eK',x:4,y:2});
  const threat=E.predictAttack(unsafe,'pG','eK');
  assert.equal(threat.kingKilledId,'eK'); assert.deepEqual(json(hits(threat).map(e=>e.damage)),[2,2]);
  const before=json(s), selected=E.chooseAI(s); assert.deepEqual(json(s),before);
  action(s,selected); assertNoImmediateKingKill(s,'eK'); assert.equal(hp(s,'eK'),4);
});


test('A legal king plus eleven archers resolves all twelve hits once with full guard absorption and exact prediction', () => {
  const occupied=new Set(['2,2','3,2','4,2','6,4']), positions=[];
  for(let y=0;y<5;y++) for(let x=0;x<7;x++) {
    if(Math.abs(x-3)+Math.abs(y-2)<=3&&!occupied.has(`${x},${y}`)) positions.push({x,y});
  }
  const archerIds=Array.from({length:11},(_,i)=>`a${String(i).padStart(2,'0')}`);
  const s=setup([unit('actor','king','player',2,2),
    ...archerIds.map((id,i)=>unit(id,'archer','player',positions[i].x,positions[i].y)),
    unit('target','golem','enemy',3,2),unit('guard','golem','enemy',4,2),unit('ek','king','enemy',6,4)]);
  s.roster=archerIds.map((id,i)=>({id:`owned${i}`,type:'archer'})); s.formation=s.roster.map(r=>r.id);
  assert.equal(s.units.filter(u=>u.side==='player').length,12); assert.equal(formationCost(s,s.formation),22);
  assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,s.units.length);
  const p=predictMatchesAct(s,'actor','target'); assert.deepEqual(json(p.damageById),{guard:14,target:10});
  const beforeTurn=s.turn, beforeActions=s.totalActions;
  const r=action(s,{type:'attack',unitId:'actor',targetId:'target'});
  assert.equal(hits(r).length,12); assert.deepEqual(json(hits(r).map(e=>e.unitId)),['actor',...archerIds]);
  assert.deepEqual(json(hits(r).map(e=>e.followUp)),[false,...Array(11).fill(true)]);
  assert.ok(hits(r).every(e=>e.damage===2&&e.originalTargetId==='target'));
  assert.deepEqual(json(hits(r).map(e=>e.targetId)),[...Array(7).fill('guard'),...Array(5).fill('target')]);
  assert.equal(guards(r).length,7); assert.deepEqual(json(s.candidates),['golem']);
  assert.equal(r.events.filter(e=>e.type==='death'&&e.unitId==='guard').length,1);
  assert.equal(hp(s,'guard'),0); assert.equal(hp(s,'target'),4); assert.equal(s.phase,'enemy');
  assert.equal(s.totalActions,beforeActions+1); assert.equal(s.turn,beforeTurn+1);
});

let failed=0;
for(const [name,fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); }
  catch(error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`\n${tests.length-failed}/${tests.length} tests passed`);
process.exitCode=failed?1:0;
