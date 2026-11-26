'use strict';
// VER.005 synthetic observations. No timing threshold, balance claim, or game-rule adjustment.
// Repeat with: npm run observe:army. JSON is written under ignored artifacts/.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8');
const FLOOR_SAMPLE = [1, 5, 10];
const SEEDS = [0x5eca5001, 0x5eca5002, 0x5eca5003];
const ACTION_CAP = 600;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}
function loadEngine(seed) {
  const math = Object.create(Math);
  math.random = seededRandom(seed);
  const context = vm.createContext({Math: math});
  vm.runInContext(source, context);
  return context.Sekasoko;
}
function summary(values) {
  if (!values.length) return {samples: 0, medianMs: null, p95Ms: null, maxMs: null};
  const sorted = [...values].sort((a,b) => a-b);
  const round = value => Number(value.toFixed(4));
  const middle = Math.floor(sorted.length / 2);
  return {
    samples: sorted.length,
    medianMs: round(sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2),
    p95Ms: round(sorted[Math.ceil(sorted.length * .95) - 1]),
    maxMs: round(sorted[sorted.length-1])
  };
}
function mirroredPlayerAction(engine, state) {
  // Reuse the unchanged enemy policy as a synthetic player. IDs and move history survive the clone;
  // sides swap so chooseAI sees the original player as its enemy-side actors.
  const mirrored = JSON.parse(JSON.stringify(state));
  mirrored.phase = 'enemy';
  for (const piece of mirrored.units) piece.side = piece.side === 'player' ? 'enemy' : 'player';
  return engine.chooseAI(mirrored);
}
function layoutKey(state) {
  // Deliberately excludes turn, log, and AI history: a repeated layout is an observation, not proof of a cycle.
  return `${state.phase}|${[...state.units].sort((a,b) => a.id.localeCompare(b.id))
    .map(u => `${u.id}:${u.side}:${u.type}:${u.x},${u.y}:${u.hp}`).join('|')}`;
}
function positionKey(piece) { return `${piece.x},${piece.y}`; }
function fight(floor, seed, policy, enemyTimings) {
  const {Engine: engine, MASTER} = loadEngine(seed);
  const state = engine.createRun();
  if (floor !== 1) { state.floor = floor; engine.startBattle(state); }
  const initialEnemyTypes = [...state.units.filter(u => u.side === 'enemy').map(u => u.type)];
  const timings = [];
  const count = {
    plies: 0, invalidActions: 0, invalidBoardStates: 0,
    player: {move: 0, attack: 0, wait: 0, captures: 0, reversals: 0},
    enemy: {move: 0, attack: 0, wait: 0, captures: 0, reversals: 0},
    longestNoDamagePlies: 0, longestEnemyWaitStreak: 0,
    repeatedLayoutAndHp: 0, maxLayoutAndHpVisits: 1
  };
  let noDamage = 0, enemyWaitStreak = 0;
  const positions = new Map(state.units.map(u => [u.id, [positionKey(u)]]));
  const layouts = new Map([[layoutKey(state), 1]]);
  let invalidAction = null;
  while (count.plies < ACTION_CAP && ['player', 'enemy'].includes(state.phase)) {
    const side = state.phase;
    let selected;
    if (side === 'enemy') {
      const before = performance.now();
      selected = engine.chooseAI(state);
      const elapsed = performance.now() - before;
      timings.push(elapsed); enemyTimings.push(elapsed);
    } else selected = policy === 'wait-only' ? {type: 'wait'} : mirroredPlayerAction(engine, state);
    const result = engine.act(state, selected);
    if (!result.ok) {
      count.invalidActions++;
      invalidAction = {side, action: selected, error: result.error};
      break;
    }
    count.plies++;
    count[side][selected.type]++;
    if (side === 'enemy') {
      enemyWaitStreak = selected.type === 'wait' ? enemyWaitStreak + 1 : 0;
      count.longestEnemyWaitStreak = Math.max(count.longestEnemyWaitStreak, enemyWaitStreak);
    }
    let damage = false;
    for (const event of result.events) {
      if (event.type === 'attack' && event.damage > 0) damage = true;
      if (event.type === 'death') count[side].captures++;
      if (event.type === 'move') {
        const history = positions.get(event.unitId) || [];
        const destination = positionKey(event.to);
        if (history.length >= 2 && history[history.length - 2] === destination) count[side].reversals++;
        history.push(destination);
        positions.set(event.unitId, history.slice(-2));
      }
    }
    noDamage = damage ? 0 : noDamage + 1;
    count.longestNoDamagePlies = Math.max(count.longestNoDamagePlies, noDamage);
    const valid = new Set(state.units.map(positionKey)).size === state.units.length &&
      new Set(state.units.map(u => u.id)).size === state.units.length &&
      state.units.every(u => Number.isInteger(u.x) && Number.isInteger(u.y) && u.x >= 0 && u.x < 7 && u.y >= 0 && u.y < 5 &&
        u.hp > 0 && u.hp <= MASTER[u.type].hp);
    if (!valid) { count.invalidBoardStates++; break; }
    const key = layoutKey(state), visits = (layouts.get(key) || 0) + 1;
    layouts.set(key, visits);
    if (visits > 1) count.repeatedLayoutAndHp++;
    count.maxLayoutAndHpVisits = Math.max(count.maxLayoutAndHpVisits, visits);
  }
  return {
    floor, seed, policy, initialEnemyTypes,
    ended: invalidAction ? 'invalid-action' : count.invalidBoardStates ? 'invalid-board' :
      ['player', 'enemy'].includes(state.phase) ? 'action-cap' : state.phase,
    ...count,
    endingNoDamagePlies: noDamage,
    remainingPlayerUnits: state.units.filter(u => u.side === 'player').length,
    remainingEnemyUnits: state.units.filter(u => u.side === 'enemy').length,
    rewardsCommitted: state.lastRewards.length,
    finalUnits: [...state.units].map(({id,type,side,x,y,hp}) => ({id,type,side,x,y,hp})),
    chooseAI: summary(timings),
    ...(invalidAction ? {invalidAction} : {})
  };
}

const started = performance.now();
const allTimings = [], fights = [];
for (const floor of FLOOR_SAMPLE) for (const seed of SEEDS) for (const policy of ['wait-only', 'mirrored-ai']) {
  fights.push(fight(floor, seed, policy, allTimings));
}
const sum = (key, side) => fights.reduce((total, f) => total + (side ? f[side][key] : f[key]), 0);
const outcomes = Object.fromEntries([...new Set(fights.map(f => f.ended))].map(ended => [ended, fights.filter(f => f.ended === ended).length]));
const report = {
  version: 'VER.005',
  purpose: 'Repeatable synthetic observations of the unchanged AI on 12-versus-12 armies; timing has no pass/fail threshold.',
  generatedAt: new Date().toISOString(),
  engineSha256: crypto.createHash('sha256').update(source).digest('hex'),
  environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || 'unknown'},
  config: {
    floors: FLOOR_SAMPLE, seeds: SEEDS, actionCap: ACTION_CAP,
    random: '32-bit LCG: state = (1664525 * state + 1013904223) mod 2^32; random = state / 2^32',
    playerArmy: 'Unchanged initial 4 knights, 4 archers, 3 slimes plus king at all sampled floors; no reward-based optimization.',
    policies: {
      'wait-only': 'Player always waits. This is an intentionally passive control, not representative human play.',
      'mirrored-ai': 'Player uses chooseAI on a cloned state with side labels swapped; no production behavior changes.'
    },
    timingScope: 'Only original enemy chooseAI calls; VM startup, mirrored-player decisions, engine.act, rendering and animation excluded.',
    progress: 'No-damage plies count consecutive successful actions without damage; a capture also deals damage.',
    captures: 'Count successful death events, including kings; rewardsCommitted counts only acquired nonking enemies.',
    reversal: 'A moving piece returns to its previous occupied square on its next move, regardless of intervening actors.',
    repeatedLayout: 'Side-to-move plus unit IDs/types/sides/positions/HP repeated; excludes AI history, so repetition alone is not a proven cycle.'
  },
  total: {
    fights: fights.length, plies: sum('plies'), outcomes,
    invalidActions: sum('invalidActions'), invalidBoardStates: sum('invalidBoardStates'),
    enemyWaits: sum('wait','enemy'), enemyReversals: sum('reversals','enemy'),
    longestNoDamagePlies: Math.max(...fights.map(f => f.longestNoDamagePlies)),
    longestEnemyWaitStreak: Math.max(...fights.map(f => f.longestEnemyWaitStreak)),
    chooseAI: summary(allTimings), elapsedMs: Number((performance.now()-started).toFixed(2))
  },
  limitations: [
    'Synthetic Node simulations do not establish human difficulty, overall balance, animation feel, or iPhone performance.',
    'Clock timing, generatedAt, and environment vary between machines and runs; fixed seeds reproduce compositions and actions for the same engine.',
    'Floors 1, 5 and 10 sample only three seeds and two fixed player policies. Floor 1 has a fixed enemy army, so its seeds repeat the same logical fight.',
    'Observed waiting, reversals, or action-cap endings are reported without changing AI, turn timing, combat, or encounter weights.'
  ],
  fights
};
const output = path.join(root, 'artifacts', 'ver005-army-observation.json');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`VER.005 synthetic army observations (${report.total.fights} fights, cap ${ACTION_CAP} actions/fight)`);
console.log(`Outcomes: ${JSON.stringify(outcomes)}; actions ${report.total.plies}; invalid actions ${report.total.invalidActions}; invalid board states ${report.total.invalidBoardStates}`);
console.log(`Enemy chooseAI: ${JSON.stringify(report.total.chooseAI)} (Node only; no timing threshold)`);
console.log(`Enemy waits ${report.total.enemyWaits}; reversals ${report.total.enemyReversals}; longest no-damage sequence ${report.total.longestNoDamagePlies} actions`);
for (const f of fights) console.log(`  ${f.floor}F seed=${f.seed} ${f.policy}: ${f.ended}, ${f.plies} actions, captures=${f.player.captures}/${f.enemy.captures} (player/enemy), enemy waits=${f.enemy.wait}, reversals=${f.enemy.reversals}, longest no-damage=${f.longestNoDamagePlies}`);
console.log(`Observation JSON: ${output}`);
if (report.total.invalidActions || report.total.invalidBoardStates) process.exitCode = 1;
