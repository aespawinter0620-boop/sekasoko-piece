'use strict';

/*
 * VER.007 independent inventory/state audit, captured from the inline read-only
 * audit. Writes no files and performs no Git or network operations.
 *
 * Run from the repository root:
 *   npm run test:inventory
 * Or supply the engine source path as argv[2].
 *
 * Reproduction conditions (unchanged from the original successful audit):
 * - LCG seed 7008, update (imul(seed, 1664525) + 1013904223) >>> 0.
 * - 80 independent Engine.createRun() 1F battles, at most 700 actions each.
 * - Both sides use the same synthetic stochastic policy; this does NOT call AI.
 * - Build legal attacks and moves in current units-array/helper-return order.
 * - Build legal deployments in current-side hand order, then deploymentSquares
 *   order. No sorting or board alteration is applied to those candidate lists.
 * - If attacks exist, choose the attack list with probability 0.75. Otherwise,
 *   if deployments exist, choose that list with probability 0.70. Otherwise use
 *   moves, then attacks, then deployments, or wait if all three lists are empty.
 *   JavaScript's short-circuit conditional evaluation controls RNG consumption.
 * - Uniformly select one action from the selected list using the next RNG call.
 * - After every legal action, independently check identity/provenance/location,
 *   occupancy, board caps, original roster retention, and (at termination)
 *   ownership-based reward and return invariants.
 * - Hand HP is zero during active battle. End-of-battle returns may retain
 *   positive HP when an originally owned unit was on the enemy board; such a
 *   returned hand must remain inactive and preserve its actual residual HP.
 * - Original successful result: 6,268 actions, 977 captures, 217 deployments,
 *   all 80 battles ended, 880 return events; zero invariant failures.
 *
 * These are synthetic policies and invariant checks. The run does not establish
 * balance, human playability, AI strength, runtime benchmarks, or device results.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const enginePath = process.argv[2] || path.join(__dirname, '..', 'src', 'engine.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(enginePath, 'utf8'), context);
const E = context.Sekasoko.Engine;

let seed = 7008;
const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
let actions = 0, captures = 0, deployments = 0, ends = 0, returns = 0;

for (let game = 0; game < 80; game++) {
  const s = E.createRun();
  const initial = new Map(s.units.map(p => [p.id, {
    originSide: p.originSide, rosterId: p.rosterId, type: p.type
  }]));
  const roster = s.roster.map(p => p.id);

  for (let step = 0; step < 700 && ['player', 'enemy'].includes(s.phase); step++) {
    const attack = [], deploy = [], move = [];
    for (const p of s.units.filter(p => p.side === s.phase)) {
      for (const t of E.targets(s, p.id)) {
        attack.push({ type: 'attack', unitId: p.id, targetId: t.id });
      }
      for (const m of E.moves(s, p.id)) {
        move.push({ type: 'move', unitId: p.id, x: m.x, y: m.y });
      }
    }
    for (const p of s.hands[s.phase]) {
      for (const q of E.deploymentSquares(s, p.id)) {
        deploy.push({ type: 'deploy', unitId: p.id, x: q.x, y: q.y });
      }
    }
    const pool = attack.length && rnd() < .75 ? attack
      : deploy.length && rnd() < .7 ? deploy
        : move.length ? move
          : attack.length ? attack
            : deploy.length ? deploy
              : [{ type: 'wait' }];
    const action = pick(pool), out = E.act(s, action);
    assert.equal(out.ok, true);
    actions++;
    captures += out.events.filter(e => e.type === 'capture').length;
    deployments += out.events.filter(e => e.type === 'deploy').length;
    returns += out.events.filter(e => e.type === 'return').length;

    const terminal = !['player', 'enemy'].includes(s.phase);
    const all = [...s.units, ...s.hands.player, ...s.hands.enemy];
    assert.equal(new Set(all.map(p => p.id)).size, all.length);
    for (const p of all) {
      const orig = initial.get(p.id);
      assert.ok(orig);
      assert.equal(p.originSide, orig.originSide);
      assert.equal(p.rosterId, orig.rosterId);
      assert.equal(p.type, orig.type);
      assert.equal(p.side, p.currentSide);
      if (s.units.includes(p)) {
        assert.equal(p.location, 'board');
        assert.ok(p.hp > 0);
        assert.ok(p.x >= 0 && p.x < 7 && p.y >= 0 && p.y < 5);
      } else {
        assert.equal(p.location, 'hand');
        assert.ok(p.hp >= 0 && p.hp <= p.maxHp);
        if (!terminal) assert.equal(p.hp, 0);
        assert.equal(p.x, null);
        assert.equal(p.y, null);
        assert.ok(s.hands[p.side].includes(p));
        assert.notEqual(p.type, 'king');
      }
    }
    assert.equal(new Set(s.units.map(p => p.x + ',' + p.y)).size, s.units.length);
    for (const side of ['player', 'enemy']) {
      assert.ok(s.units.filter(p => p.side === side).length <= 12);
    }
    for (const id of roster) assert.equal(s.roster.filter(p => p.id === id).length, 1);
    assert.equal(all.length, 24 - (terminal ? 1 : 0));
    if (action.type === 'deploy') {
      const deployed = s.units.find(p => p.id === action.unitId);
      assert.equal(deployed.hp, deployed.maxHp);
    }
    if (terminal) {
      ends++;
      const gained = all.filter(p => p.type !== 'king' && p.originSide === 'enemy'
        && p.currentSide === 'player').map(p => p.id).sort();
      const expected = s.phase === 'defeat' ? [] : gained;
      assert.deepEqual(Array.from(s.lastRewardDetails, p => p.unitId).sort(), expected);
      assert.equal(s.roster.length, 11 + expected.length);
      for (const p of all.filter(p => p.originSide === 'player' && p.type !== 'king')) {
        assert.equal(p.currentSide, 'player');
      }
    }
  }
}

console.log(JSON.stringify({
  seedStart: 7008, games: 80, actionLimit: 700, actions, captures, deployments,
  ended: ends, returnEvents: returns,
  result: 'identity, provenance, occupancy, board caps, roster preservation and settlement invariants passed'
}, null, 2));
