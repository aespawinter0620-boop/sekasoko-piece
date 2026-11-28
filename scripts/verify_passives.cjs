'use strict';

/*
 * VER.007 independent passive-resolution and capture oracle, captured from the original
 * read-only audit, adapted for VER.007 capture/return bookkeeping. The original
 * damage/adjacency/support/guard expectations and random generation stay unchanged.
 * No production code, repository state, or network is changed.
 *
 * Run from the repository root:
 *   npm run test:oracle
 * Or supply the exact engine source path as argv[2].
 *
 * Reproduction conditions, preserved from the original inline Node execution:
 * - LCG seed 6007; update (imul(seed, 1664525) + 1013904223) >>> 0.
 * - 500 boards. Each board starts with Engine.createRun(), then replaces units.
 * - Randomly choose active side before shuffling all 35 logical cells with
 *   descending Fisher-Yates, then use the first 24 distinct cells.
 * - Exactly 12 units per side, alternating player/enemy by index.
 * - Indices 0 and 1 are the two kings. Remaining types are independently drawn
 *   from Object.keys(MASTER).slice(1), retaining MASTER's insertion order.
 * - Each unit's current HP is independently uniform from 1 to its master HP.
 * - IDs u1..u24; support and guard ties use JavaScript string ordering.
 * - For every currently legal attack of every active-side unit, compare one
 *   prediction from the unchanged original board with a separate oracle clone.
 *   Attacks are not accumulated between predictions, and no random call occurs
 *   in the oracle or predictor.
 * - Compare every hit's actor, actual recipient, original target, nominal
 *   damage, follow-up flag, HP before/after; then death order, all survivor HP, capture events, and complete individual
 *   allegiance/origin/container metadata (including terminal original-owner returns). Compare complete input JSON before/after every prediction.
 * - Original result: 500 boards, 13,264 legal-attack predictions, zero failures.
 *
 * This independently checks passive-resolution semantics, not balance,
 * performance, device behavior, or the production resolver's internal design.
 * The two deterministic AI movement counterexamples below additionally check
 * candidate-board guard adjacency and support-inclusive king danger.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const enginePath = process.argv[2] || path.join(__dirname, '..', 'src', 'engine.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(enginePath, 'utf8'), context);
const { Engine, MASTER } = context.Sekasoko;

let seed = 6007;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
const types = Object.keys(MASTER);
const clone = x => JSON.parse(JSON.stringify(x));
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cmp = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Independent from Engine.act/Engine.predictAttack and all production helpers.
// Only the shared base character values are read from MASTER.
function reference(source, actorId, targetId) {
  const s = clone(source), hits = [], deaths = [], captures = [];
  s.hands = clone(source.hands || {player:[],enemy:[]});
  let ended = false;
  const get = id => s.units.find(p => p.id === id);
  // Extend the existing oracle for immediate growth; keep its original boards and attack cases.
  const rankCost = { king:100, slime:100, hamster:100, goblin:200, knight:300, archer:300, orc:300, mage:400, golem:500, dragon:1000 };
  s.defeatedForEXP ||= []; s.damageContributors ||= {};
  function award(target, killer) {
    if (s.defeatedForEXP.includes(target.id)) return;
    s.defeatedForEXP.push(target.id);
    const ids = new Set(s.damageContributors[target.id] || []); ids.add(killer.id);
    for (const p of [...s.units,...s.hands.player,...s.hands.enemy]) {
      if (p.side !== killer.side || !ids.has(p.id)) continue;
      const previous = p.level || 1; p.level = previous;
      p.exp = (p.exp || 0) + (target.level || 1) * (p.id === killer.id ? 50 : 25);
      while (p.exp >= p.level * rankCost[p.type]) { p.exp -= p.level * rankCost[p.type]; p.level++; }
      const delta = MASTER[p.type].hp * (p.level - previous);
      p.maxHp = MASTER[p.type].hp * p.level;
      if (p.hp > 0) p.hp += delta;
    }
  }
  function strike(id, follow) {
    const attacker = get(id), original = get(targetId);
    if (ended || !attacker || !original) return;
    const boost = s.units.filter(p => p.hp > 0 && p.type === 'knight'
      && p.side === attacker.side && dist(p, attacker) === 1).length;
    const damage = Math.floor(MASTER[attacker.type].atk * (attacker.level || 1) * (1 + boost * .5));
    const guard = s.units.filter(p => p.hp > 0 && p.type === 'golem'
      && p.side === original.side && dist(p, original) === 1)
      .sort((a, b) => b.hp - a.hp || cmp(a, b))[0];
    const target = guard || original;
    const before = target.hp;
    const contributors = s.damageContributors[target.id] ||= [];
    if (!contributors.includes(attacker.id)) contributors.push(attacker.id);
    target.hp = Math.max(0, target.hp - damage);
    hits.push([id, target.id, targetId, damage, follow, before, target.hp]);
    if (!target.hp) {
      award(target, attacker);
      deaths.push(target.id);
      s.units = s.units.filter(p => p.id !== target.id);
      if (target.type === 'king') ended = true;
      else {
        captures.push([target.id,target.type,attacker.side,target.side,target.originSide,target.rosterId,{x:target.x,y:target.y}]);
        target.side=attacker.side; target.currentSide=attacker.side; target.location='hand'; target.x=null; target.y=null;
        s.hands[attacker.side].push(target);
      }
    }
  }
  strike(actorId, false);
  const origin = get(actorId);
  for (const a of s.units.filter(p => p.type === 'archer' && p.side === origin.side
    && p.id !== actorId && p.hp > 0).sort(cmp)) {
    if (ended || !get(targetId)) break;
    if (dist(a, get(targetId)) <= MASTER.archer.range) strike(a.id, true);
  }
  // Settlement returns original owned individuals without changing their HP or original identity.
  if (ended) for (const p of [...s.units,...s.hands.player,...s.hands.enemy]) {
    if (p.type==='king'||p.originSide!=='player'||p.rosterId==null||p.currentSide==='player') continue;
    s.units=s.units.filter(u=>u.id!==p.id);
    s.hands.player=s.hands.player.filter(u=>u.id!==p.id); s.hands.enemy=s.hands.enemy.filter(u=>u.id!==p.id);
    p.side='player'; p.currentSide='player'; p.location='hand'; p.x=null; p.y=null; s.hands.player.push(p);
  }
  return { hits, deaths, captures, hp: s.units.map(p => [p.id, p.hp]).sort(), individuals: individualState(s) };
}

function individualState(s) {
  const all=[...s.units,...s.hands.player,...s.hands.enemy];
  assert.equal(new Set(all.map(p=>p.id)).size,all.length,'one individual appears in only one container');
  for(const p of s.units) assert.equal(p.location,'board');
  for(const side of ['player','enemy']) for(const p of s.hands[side]) {
    assert.equal(p.location,'hand'); assert.equal(p.currentSide,side); assert.equal(p.side,side);
    assert.equal(p.x,null); assert.equal(p.y,null); assert.notEqual(p.type,'king');
  }
  return all.sort(cmp).map(p=>[p.id,p.type,p.side,p.currentSide,p.originSide,p.rosterId,p.location,p.x,p.y,p.hp,p.maxHp]);
}

let cases = 0;
for (let game = 0; game < 500; game++) {
  const s = Engine.createRun();
  s.units = [];
  s.phase = random() < .5 ? 'player' : 'enemy';
  const cells = Array.from({ length: 35 }, (_, i) => ({ x: i % 7, y: Math.floor(i / 7) }));
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (let i = 0; i < 24; i++) {
    const type = i < 2 ? 'king' : types[1 + Math.floor(random() * (types.length - 1))];
    const side = i % 2 ? 'enemy' : 'player';
    s.units.push({
      id: 'u' + (i + 1), type, side, currentSide:side, originSide:side, rosterId:side==='player'&&type!=='king'?`owned-u${i+1}`:null, location:'board', ...cells[i],
      hp: 1 + Math.floor(random() * MASTER[type].hp), maxHp: MASTER[type].hp
    });
  }
  s.roster=s.units.filter(p=>p.rosterId!=null).map(p=>({id:p.rosterId,type:p.type}));
  s.formation=s.roster.map(p=>p.id);
  for (const actor of s.units.filter(p => p.side === s.phase)) {
    for (const target of Engine.targets(s, actor.id)) {
      const before = JSON.stringify(s);
      const expected = reference(s, actor.id, target.id);
      const result = Engine.predictAttack(s, actor.id, target.id);
      const actual = {
        hits: result.events.filter(e => e.type === 'attack').map(e => [
          e.unitId, e.targetId, e.originalTargetId, e.damage, e.followUp, e.hpBefore, e.hpAfter
        ]),
        deaths: result.killedIds,
        captures: result.events.filter(e=>e.type==='capture').map(e=>[e.unitId,e.unitType,e.side,e.fromSide,e.originSide,e.rosterId,{x:e.from.x,y:e.from.y}]),
        hp: result.state.units.map(p => [p.id, p.hp]).sort(),
        individuals: individualState(result.state)
      };
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw Error('Mismatch ' + JSON.stringify({ game, actor, target, expected, actual }));
      }
      if (JSON.stringify(s) !== before) throw Error('Mutation');
      cases++;
    }
  }
}
assert.equal(cases, 13264, 'The original generation sequence must remain reproducible.');

const piece = (id, type, side, x, y, hp = MASTER[type].hp) =>
  ({ id, type, side, currentSide:side, originSide:side, rosterId:side==='player'&&type!=='king'?`owned-${id}`:null, location:'board', x, y, hp, maxHp: MASTER[type].hp });
function fixture(units) {
  const s = Engine.createRun();
  s.units = units;
  s.roster=units.filter(p=>p.rosterId!=null).map(p=>({id:p.rosterId,type:p.type})); s.formation=s.roster.map(p=>p.id);
  s.phase = 'enemy';
  return s;
}

// Counterexample 1: advancing the golem to (4,2) looks aggressive but removes
// the king's only guard. The player archer would then kill its HP2 king.
const guardBoard = fixture([
  piece('eK', 'king', 'enemy', 6, 2, 2),
  piece('eG', 'golem', 'enemy', 5, 2, 14),
  piece('eS', 'slime', 'enemy', 4, 4),
  piece('pA', 'archer', 'player', 3, 2),
  piece('pK', 'king', 'player', 0, 4)
]);
const guardBefore = JSON.stringify(guardBoard);
const guardAction = Engine.chooseAI(guardBoard);
assert.equal(JSON.stringify(guardBoard), guardBefore);
const guardChosen = clone(guardBoard), guardBad = clone(guardBoard);
assert.equal(Engine.act(guardChosen, guardAction).ok, true);
assert.equal(Engine.act(guardBad, { type: 'move', unitId: 'eG', x: 4, y: 2 }).ok, true);
const guardChosenThreat = Engine.predictAttack(guardChosen, 'pA', 'eK');
const guardBadThreat = Engine.predictAttack(guardBad, 'pA', 'eK');
assert.equal(guardChosenThreat.kingKilledId, null);
assert.equal(guardBadThreat.kingKilledId, 'eK');

// Counterexample 2: king (5,2)->(4,2) enters the goblin's range. Its normal
// damage is only 2, but the archer at (5,0) supplies another 2, killing HP4.
const supportBoard = fixture([
  piece('eK', 'king', 'enemy', 5, 2, 4),
  piece('pG', 'goblin', 'player', 3, 2),
  piece('pA', 'archer', 'player', 5, 0),
  piece('pK', 'king', 'player', 0, 4)
]);
const supportBefore = JSON.stringify(supportBoard);
const supportAction = Engine.chooseAI(supportBoard);
assert.equal(JSON.stringify(supportBoard), supportBefore);
const supportChosen = clone(supportBoard), supportBad = clone(supportBoard);
assert.equal(Engine.act(supportChosen, supportAction).ok, true);
assert.equal(Engine.act(supportBad, { type: 'move', unitId: 'eK', x: 4, y: 2 }).ok, true);
const chosenThreats = supportChosen.units.filter(p => p.side === 'player').flatMap(p =>
  Engine.targets(supportChosen, p.id).filter(t => t.id === 'eK').map(t =>
    Engine.predictAttack(supportChosen, p.id, t.id)));
const supportBadThreat = Engine.predictAttack(supportBad, 'pG', 'eK');
assert.equal(chosenThreats.some(p => p.kingKilledId === 'eK'), false);
assert.equal(supportBadThreat.kingKilledId, 'eK');
assert.deepEqual(Array.from(supportBadThreat.events.filter(e => e.type === 'attack'), e =>
  [e.unitId, e.damage, e.followUp]), [['pG', 2, false], ['pA', 2, true]]);

console.log(JSON.stringify({
  seedStart: 6007,
  randomBoards: 500,
  legalAttackPredictions: cases,
  result: 'oracle hit sequence/HP/death/capture/individual-container comparison and input preservation passed',
  aiMovementCounterexamples: {
    count: 2,
    guardDeparture: { action: guardAction, chosenKingKilled: guardChosenThreat.kingKilledId,
      temptingGuardDepartureKingKilled: guardBadThreat.kingKilledId },
    supportKingThreat: { action: supportAction,
      chosenKingKillThreat: chosenThreats.some(p => p.kingKilledId === 'eK'),
      temptingKingAdvanceKills: supportBadThreat.kingKilledId }
  }
}, null, 2));
