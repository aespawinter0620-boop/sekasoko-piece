'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const context = vm.createContext({console, Math, setTimeout, clearTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8'), context);
const {MASTER, Engine: E} = context.Sekasoko;
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
function sorted(v) { return [...v].sort(); }

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

test('New run starts at 1F with four units per side and the required roster', () => {
  const s = E.createRun();
  assert.equal(s.floor,1); assert.equal(s.turn,1); assert.equal(s.phase,'player');
  assert.deepEqual(sorted(s.roster.map(r=>r.type)), sorted(['knight','archer','slime']));
  assert.equal(s.formation.length,3);
  assert.deepEqual(sorted(s.units.filter(u=>u.side==='player').map(u=>u.type)), sorted(['king','knight','archer','slime']));
  assert.deepEqual(sorted(s.units.filter(u=>u.side==='enemy').map(u=>u.type)), sorted(['king','slime','goblin','slime']));
  assert.equal(new Set(s.units.map(u=>`${u.x},${u.y}`)).size,8);
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

test('Formation enforces ownership, distinct instances, three slots, and cost 10', () => {
  const s=E.createRun(); s.phase='victory';
  s.roster.push({id:'d1',type:'dragon'},{id:'d2',type:'dragon'},{id:'s1',type:'slime'},{id:'s2',type:'slime'});
  const knight=s.roster.find(r=>r.type==='knight').id;
  assert.equal(E.setFormation(s,['s1','s2',knight]).ok,true);
  assert.deepEqual(json(s.formation),['s1','s2',knight]);
  for(const ids of [['s1','s1'],['d1','d2'],['s1','s2',knight,'d1'],['missing']]) {
    const before=json(s.formation); assert.equal(E.setFormation(s,ids).ok,false); assert.deepEqual(json(s.formation),before);
  }
  assert.equal(E.setFormation(s,[]).ok,true);
  s.phase='player'; assert.equal(E.setFormation(s,['s1']).ok,false);
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
  assert.equal(s.units.filter(u=>u.side==='player').length,4);
  assert.ok(s.units.every(u=>u.hp===MASTER[u.type].hp));
  assert.equal(s.candidates.length,0);
  assert.equal(s.units.filter(u=>u.side==='enemy').length,4);
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

test('AI returns legal actions across a reproducible sample of complete fights', () => {
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

test('All ten floors can be cleared consecutively with valid four-unit deployment and capped progression', () => {
  const s=E.createRun();
  for(let floor=1;floor<=10;floor++) {
    assert.equal(s.floor,floor);
    assert.equal(s.units.filter(u=>u.side==='enemy').length,4);
    assert.equal(s.units.filter(u=>u.side==='player').length,4);
    assert.ok(s.units.every(u=>u.hp===MASTER[u.type].hp));
    const actor=s.units.find(u=>u.side==='player'&&u.type==='archer');
    const king=s.units.find(u=>u.side==='enemy'&&u.type==='king');
    actor.x=3;actor.y=0;king.x=6;king.y=0;king.hp=1;
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
  const fresh=E.createRun(); assert.equal(fresh.floor,1); assert.equal(fresh.phase,'player'); assert.equal(fresh.roster.length,3); assert.equal(fresh.candidates.length,0);
});

let failed=0;
for(const [name,fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); }
  catch(error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`\n${tests.length-failed}/${tests.length} tests passed`);
process.exitCode=failed?1:0;
