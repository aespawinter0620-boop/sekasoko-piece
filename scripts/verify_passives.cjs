'use strict';

/*
 * VER.006 independent passive-resolution oracle, captured from the original
 * read-only audit. No production code, repository state, or network is changed.
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
 *   damage, follow-up flag, HP before/after; then death order and all survivor
 *   HP. Compare complete input JSON before/after every prediction.
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
  const s = clone(source), hits = [], deaths = [];
  let ended = false;
  const get = id => s.units.find(p => p.id === id);
  function strike(id, follow) {
    const attacker = get(id), original = get(targetId);
    if (ended || !attacker || !original) return;
    const boost = s.units.filter(p => p.hp > 0 && p.type === 'knight'
      && p.side === attacker.side && dist(p, attacker) === 1).length;
    const damage = Math.floor(MASTER[attacker.type].atk * (1 + boost * .5));
    const guard = s.units.filter(p => p.hp > 0 && p.type === 'golem'
      && p.side === original.side && dist(p, original) === 1)
      .sort((a, b) => b.hp - a.hp || cmp(a, b))[0];
    const target = guard || original;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    hits.push([id, target.id, targetId, damage, follow, before, target.hp]);
    if (!target.hp) {
      deaths.push(target.id);
      s.units = s.units.filter(p => p.id !== target.id);
      if (target.type === 'king') ended = true;
    }
  }
  strike(actorId, false);
  const origin = get(actorId);
  for (const a of s.units.filter(p => p.type === 'archer' && p.side === origin.side
    && p.id !== actorId && p.hp > 0).sort(cmp)) {
    if (ended || !get(targetId)) break;
    if (dist(a, get(targetId)) <= MASTER.archer.range) strike(a.id, true);
  }
  return { hits, deaths, hp: s.units.map(p => [p.id, p.hp]).sort() };
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
      id: 'u' + (i + 1), type, side, ...cells[i],
      hp: 1 + Math.floor(random() * MASTER[type].hp), maxHp: MASTER[type].hp
    });
  }
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
        hp: result.state.units.map(p => [p.id, p.hp]).sort()
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
  ({ id, type, side, x, y, hp, maxHp: MASTER[type].hp });
function fixture(units) {
  const s = Engine.createRun();
  s.units = units;
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
  result: 'oracle hit sequence/HP/death comparison and input preservation passed',
  aiMovementCounterexamples: {
    count: 2,
    guardDeparture: { action: guardAction, chosenKingKilled: guardChosenThreat.kingKilledId,
      temptingGuardDepartureKingKilled: guardBadThreat.kingKilledId },
    supportKingThreat: { action: supportAction,
      chosenKingKillThreat: chosenThreats.some(p => p.kingKilledId === 'eK'),
      temptingKingAdvanceKills: supportBadThreat.kingKilledId }
  }
}, null, 2));
