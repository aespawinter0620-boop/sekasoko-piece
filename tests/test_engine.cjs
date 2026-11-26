'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8');
const context = vm.createContext({console, Math, setTimeout, clearTimeout});
vm.runInContext(source, context);
const {MASTER, ARMY_RULES, Engine: E} = context.Sekasoko;
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

test('VER.004 battle, AI, and encounter algorithms remain byte-identical', () => {
  // Issue #6 requires preserving these algorithms. Hashes avoid relying on Git tags in shallow CI checkouts.
  const expected={
    moves:'6246ca1e52a3bcc23db2312c55cdd5ab016f7162bdcbe95e75616d65b5a2ff06',
    targets:'32f35fba40c33dccea6e79d212c2ea80393b446155b4dcff84e418bbcd799338',
    act:'91afd8e1e28c734689c4f9c93846738a8b09b0abedc0707b014f456911948a4c',
    chooseAI:'fc75f8708061dd3a7756e960f69a360077c647326d9f250b0c9c4f33d0deb15d',
    setFormation:'3fedf476a2f64b7aa6e7cb2989abfc019485c9caf23c7af7cacd6baf8668815d',
    advance:'0b4e563559f45dbbab7dee1392b92d11c61e0fa85968183d38b03eab52d9f03b'
  };
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  for(const [name,fingerprint] of Object.entries(expected)) assert.equal(hash(E[name].toString()),fingerprint,name);
  const privateFunctions=[
    ['weightedEnemy','startBattle','3af526ced85b06af60cd0a581b506c3e0b0fdded31f757b2fd05a8503c6d89c1'],
    ['threatAt','firingDistance','a6dc4b1abbadd44bd2b7792c21493029af544cfc612c8311dfb95b89bcfe29e2'],
    ['firingDistance','chooseAI','69028d30187a02e4c432c42666f60f9263fc0b33a24ce2ecc0bd8670bca14781']
  ];
  for(const [name,next,fingerprint] of privateFunctions) {
    const start=source.indexOf(`  function ${name}(`), end=source.indexOf(`  function ${next}(`,start);
    assert.ok(start>=0&&end>start,name); assert.equal(hash(source.slice(start,end)),fingerprint,name);
  }
});

let failed=0;
for(const [name,fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); }
  catch(error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`\n${tests.length-failed}/${tests.length} tests passed`);
process.exitCode=failed?1:0;
