'use strict';
// VER.007 synthetic observations. No timing threshold, balance claim, or game-rule adjustment.
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
  // Reuse the current enemy policy as a synthetic player. IDs and move history survive the clone;
  // sides swap so chooseAI sees the original player as its enemy-side actors.
  const mirrored = JSON.parse(JSON.stringify(state));
  mirrored.phase = 'enemy';
  const playerHand=mirrored.hands.player, enemyHand=mirrored.hands.enemy;
  for (const piece of [...mirrored.units,...playerHand,...enemyHand]) {
    piece.side = piece.side === 'player' ? 'enemy' : 'player'; piece.currentSide=piece.side;
  }
  mirrored.hands.player=enemyHand; mirrored.hands.enemy=playerHand;
  return engine.chooseAI(mirrored);
}
function layoutKey(state) {
  // Deliberately excludes turn, log, and AI history: a repeated layout is an observation, not proof of a cycle.
  const board=[...state.units].sort((a,b)=>a.id.localeCompare(b.id)).map(u=>`${u.id}:${u.side}:${u.type}:${u.x},${u.y}:${u.hp}`).join('|');
  const hands=['player','enemy'].map(side=>`${side}:[${[...state.hands[side]].sort((a,b)=>a.id.localeCompare(b.id)).map(u=>`${u.id}:${u.type}:${u.originSide}:${u.rosterId}:${u.hp}`).join('|')}]`).join('|');
  return `${state.phase}|${board}|${hands}`;
}
function positionKey(piece) { return `${piece.x},${piece.y}`; }
function fight(floor, seed, policy, enemyTimings, allActTimings) {
  const {Engine: engine, MASTER} = loadEngine(seed);
  const state = engine.createRun();
  if (floor !== 1) { state.floor = floor; engine.startBattle(state); }
  const initialIdentity=new Map(state.units.map(u=>[u.id,{type:u.type,originSide:u.originSide,rosterId:u.rosterId}]));
  const initialRoster=JSON.parse(JSON.stringify(state.roster));
  const lostKings=new Set(), capturesById=new Map();
  const initialEnemyTypes = [...state.units.filter(u => u.side === 'enemy').map(u => u.type)];
  const timings = [], actionTimings = [];
  const count = {
    plies: 0, invalidActions: 0, invalidBoardStates: 0, aiStateMutations: 0,
    player: {move: 0, attack: 0, wait: 0, deploy: 0, captures: 0, recaptures: 0, defeatedKings: 0, reversals: 0, followUpHits: 0, guardActivations: 0, deploymentHpRestored: 0},
    enemy: {move: 0, attack: 0, wait: 0, deploy: 0, captures: 0, recaptures: 0, defeatedKings: 0, reversals: 0, followUpHits: 0, guardActivations: 0, deploymentHpRestored: 0},
    longestNoDamagePlies: 0, longestEnemyWaitStreak: 0, maxHitsPerAction: 0,
    repeatedLayoutAndHp: 0, maxLayoutAndHpVisits: 1, maxPlayerHandSize: 0, maxEnemyHandSize: 0
  };
  let noDamage = 0, enemyWaitStreak = 0;
  const positions = new Map(state.units.map(u => [u.id, [positionKey(u)]]));
  const layouts = new Map([[layoutKey(state), 1]]);
  let invalidAction = null;
  while (count.plies < ACTION_CAP && ['player', 'enemy'].includes(state.phase)) {
    const side = state.phase;
    let selected;
    if (side === 'enemy') {
      const beforeState = JSON.stringify(state);
      const before = performance.now();
      selected = engine.chooseAI(state);
      const elapsed = performance.now() - before;
      timings.push(elapsed); enemyTimings.push(elapsed);
      if (JSON.stringify(state) !== beforeState) {
        count.aiStateMutations++;
        invalidAction = {side, action: selected, error: 'chooseAI mutated the input state'};
        break;
      }
    } else selected = policy === 'wait-only' ? {type: 'wait'} : mirroredPlayerAction(engine, state);
    const beforeAct = performance.now();
    const result = engine.act(state, selected);
    const actElapsed = performance.now() - beforeAct;
    actionTimings.push(actElapsed); allActTimings.push(actElapsed);
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
    let damage = false, hitsThisAction = 0;
    for (const event of result.events) {
      if (event.type === 'attack') {
        hitsThisAction++;
        if (event.damage > 0) damage = true;
        if (event.followUp) count[side].followUpHits++;
      }
      if (event.type === 'guard') count[side].guardActivations++;
      if (event.type === 'capture') {
        const previous=capturesById.get(event.unitId)||0;
        count[side].captures++; if(previous) count[side].recaptures++;
        capturesById.set(event.unitId,previous+1);
      }
      if (event.type === 'death'&&event.unitType==='king') { count[side].defeatedKings++; lostKings.add(event.unitId); }
      if (event.type === 'deploy') { positions.set(event.unitId,[positionKey(event.to)]); count[side].deploymentHpRestored+=event.hpAfter; }
      if (event.type === 'move') {
        const history = positions.get(event.unitId) || [];
        const destination = positionKey(event.to);
        if (history.length >= 2 && history[history.length - 2] === destination) count[side].reversals++;
        history.push(destination);
        positions.set(event.unitId, history.slice(-2));
      }
    }
    count.maxHitsPerAction = Math.max(count.maxHitsPerAction, hitsThisAction);
    noDamage = damage ? 0 : noDamage + 1;
    count.longestNoDamagePlies = Math.max(count.longestNoDamagePlies, noDamage);
    const all=[...state.units,...state.hands.player,...state.hands.enemy];
    const terminal=!['player','enemy'].includes(state.phase);
    let valid = new Set(state.units.map(positionKey)).size===state.units.length && new Set(all.map(u=>u.id)).size===all.length &&
      all.length===initialIdentity.size-lostKings.size && all.every(u=> {
        const original=initialIdentity.get(u.id);
        return original&&!lostKings.has(u.id)&&u.type===original.type&&u.originSide===original.originSide&&u.rosterId===original.rosterId&&u.side===u.currentSide;
      }) && state.units.every(u=>u.location==='board'&&Number.isInteger(u.x)&&Number.isInteger(u.y)&&u.x>=0&&u.x<7&&u.y>=0&&u.y<5&&u.hp>0&&u.hp<=MASTER[u.type].hp);
    for(const allegiance of ['player','enemy']) {
      valid=valid&&state.units.filter(u=>u.side===allegiance).length<=12&&state.hands[allegiance].every(u=>u.type!=='king'&&u.side===allegiance&&u.currentSide===allegiance&&u.location==='hand'&&u.x===null&&u.y===null&&
        (u.hp===0||(terminal&&u.originSide==='player'&&allegiance==='player'&&u.hp>0&&u.hp<=MASTER[u.type].hp)));
    }
    valid=valid&&initialRoster.every(owned=>state.roster.filter(r=>r.id===owned.id&&r.type===owned.type).length===1);
    if(terminal) {
      const won=['victory','clear'].includes(state.phase);
      const expected=won?all.filter(u=>u.originSide==='enemy'&&u.currentSide==='player'&&u.type!=='king').map(u=>u.id).sort():[];
      valid=valid&&JSON.stringify([...state.lastRewardDetails].map(r=>r.unitId).sort())===JSON.stringify(expected)&&
        state.roster.length===initialRoster.length+expected.length&&all.filter(u=>u.originSide==='player'&&u.type!=='king').every(u=>u.currentSide==='player');
    }
    count.maxPlayerHandSize=Math.max(count.maxPlayerHandSize,state.hands.player.length);
    count.maxEnemyHandSize=Math.max(count.maxEnemyHandSize,state.hands.enemy.length);
    if (!valid) { count.invalidBoardStates++; break; }
    const key = layoutKey(state), visits = (layouts.get(key) || 0) + 1;
    layouts.set(key, visits);
    if (visits > 1) count.repeatedLayoutAndHp++;
    count.maxLayoutAndHpVisits = Math.max(count.maxLayoutAndHpVisits, visits);
  }
  return {
    floor, seed, policy, initialEnemyTypes,
    ended: count.aiStateMutations ? 'ai-mutation' : invalidAction ? 'invalid-action' : count.invalidBoardStates ? 'invalid-board' :
      ['player', 'enemy'].includes(state.phase) ? 'action-cap' : state.phase,
    ...count,
    endingNoDamagePlies: noDamage,
    remainingPlayerUnits: state.units.filter(u => u.side === 'player').length,
    remainingEnemyUnits: state.units.filter(u => u.side === 'enemy').length,
    rewardsCommitted: state.lastRewards.length,
    uniqueCapturedIndividuals: capturesById.size,
    maxCapturesOfOneIndividual: Math.max(0,...capturesById.values()),
    capturesByIndividual: Object.fromEntries([...capturesById.entries()].sort((a,b)=>a[0].localeCompare(b[0]))),
    finalHands: JSON.parse(JSON.stringify(state.hands)),
    finalUnits: [...state.units].map(({id,type,side,currentSide,originSide,rosterId,location,x,y,hp}) => ({id,type,side,currentSide,originSide,rosterId,location,x,y,hp})),
    chooseAI: summary(timings), act: summary(actionTimings),
    ...(invalidAction ? {invalidAction} : {})
  };
}

const started = performance.now();
const allTimings = [], allActTimings = [], fights = [];
for (const floor of FLOOR_SAMPLE) for (const seed of SEEDS) for (const policy of ['wait-only', 'mirrored-ai']) {
  fights.push(fight(floor, seed, policy, allTimings, allActTimings));
}
const sum = (key, side) => fights.reduce((total, f) => total + (side ? f[side][key] : f[key]), 0);
const outcomes = Object.fromEntries([...new Set(fights.map(f => f.ended))].map(ended => [ended, fights.filter(f => f.ended === ended).length]));
const report = {
  version: 'VER.007',
  purpose: 'Repeatable synthetic observations of capture, redeployment, recapture, and three passive skills on 12-versus-12 armies; timing has no pass/fail threshold.',
  generatedAt: new Date().toISOString(),
  engineSha256: crypto.createHash('sha256').update(source).digest('hex'),
  environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || 'unknown'},
  config: {
    floors: FLOOR_SAMPLE, seeds: SEEDS, actionCap: ACTION_CAP,
    random: '32-bit LCG: state = (1664525 * state + 1013904223) mod 2^32; random = state / 2^32',
    playerArmy: 'Unchanged initial 4 knights, 4 archers, 3 slimes plus king at all sampled floors; no reward-based optimization.',
    policies: {
      'wait-only': 'Player always waits. This is an intentionally passive control, not representative human play.',
      'mirrored-ai': 'Player uses chooseAI on a cloned state with current-side labels and both hand containers swapped; original-origin metadata is retained. No production behavior changes.'
    },
    timingScope: 'chooseAI measures only original enemy decisions including attack prediction. act measures each original successful/attempted action including passive resolution. VM startup, mirrored-player decisions, rendering and animation excluded.',
    passives: 'Archer supportFire, knight inspiration and golem stoneWall use production rules on both sides. No skill strengths or AI scoring are tuned by this observation script.',
    passiveCounts: 'followUpHits counts attack events with followUp=true; guardActivations counts guard events for the attacking side. maxHitsPerAction includes the normal hit and its support hits.',
    progress: 'No-damage plies count consecutive successful actions without damage; a capture also deals damage.',
    captures: 'Count nonking capture events. recaptures are subsequent captures of the same battle ID. Kings are tracked separately as defeatedKings. Unique counts are per fight; deploymentHpRestored sums full HP created by deployment.',
    identityChecks: 'After every action check board/hands ID conservation, immutable type/origin/roster linkage, current allegiance/container consistency, king exclusion from hands, board cap, original ownership, and terminal reward/return sets.',
    reversal: 'A moving piece returns to its previous occupied square on its next move, regardless of intervening actors. The observation baseline resets after deployment.',
    repeatedLayout: 'Side-to-move plus board and hand individual state repeated; excludes AI history, so repetition alone is not a proven cycle.'
  },
  total: {
    fights: fights.length, plies: sum('plies'), outcomes,
    invalidActions: sum('invalidActions'), invalidBoardStates: sum('invalidBoardStates'), aiStateMutations: sum('aiStateMutations'),
    followUpHits: sum('followUpHits','player') + sum('followUpHits','enemy'),
    guardActivations: sum('guardActivations','player') + sum('guardActivations','enemy'),
    maxHitsPerAction: Math.max(...fights.map(f => f.maxHitsPerAction)),
    deployments: sum('deploy','player')+sum('deploy','enemy'), captures: sum('captures','player')+sum('captures','enemy'),
    recaptures: sum('recaptures','player')+sum('recaptures','enemy'), uniqueCaptureIndividualsAcrossFights: sum('uniqueCapturedIndividuals'),
    maxCapturesOfOneIndividual: Math.max(...fights.map(f=>f.maxCapturesOfOneIndividual)),
    maxPlayerHandSize: Math.max(...fights.map(f=>f.maxPlayerHandSize)), maxEnemyHandSize: Math.max(...fights.map(f=>f.maxEnemyHandSize)),
    enemyWaits: sum('wait','enemy'), enemyReversals: sum('reversals','enemy'),
    longestNoDamagePlies: Math.max(...fights.map(f => f.longestNoDamagePlies)),
    longestEnemyWaitStreak: Math.max(...fights.map(f => f.longestEnemyWaitStreak)),
    chooseAI: summary(allTimings), act: summary(allActTimings), elapsedMs: Number((performance.now()-started).toFixed(2))
  },
  limitations: [
    'Synthetic Node simulations do not establish human difficulty, overall balance, animation feel, or iPhone performance.',
    'Clock timing, generatedAt, and environment vary between machines and runs; fixed seeds reproduce compositions and actions for the same engine.',
    'Floors 1, 5 and 10 sample only three seeds and two fixed player policies. Floor 1 has a fixed enemy army, so its seeds repeat the same logical fight.',
    'Observed waiting, reversals, or action-cap endings are reported without tuning AI, turn timing, passive strengths, capture/redeployment rules, combat, or encounter weights.'
  ],
  fights
};
const output = path.join(root, 'artifacts', 'ver007-army-observation.json');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`VER.007 synthetic army observations (${report.total.fights} fights, cap ${ACTION_CAP} actions/fight)`);
console.log(`Outcomes: ${JSON.stringify(outcomes)}; actions ${report.total.plies}; invalid actions ${report.total.invalidActions}; invalid board states ${report.total.invalidBoardStates}; AI input mutations ${report.total.aiStateMutations}`);
console.log(`Enemy chooseAI: ${JSON.stringify(report.total.chooseAI)} (Node only; no timing threshold)`);
console.log(`Action resolution: ${JSON.stringify(report.total.act)}; support hits ${report.total.followUpHits}; guard activations ${report.total.guardActivations}; max hits/action ${report.total.maxHitsPerAction}`);
console.log(`Deployments ${report.total.deployments}; captures ${report.total.captures}; recaptures ${report.total.recaptures}; max captures/individual ${report.total.maxCapturesOfOneIndividual}`);
console.log(`Enemy waits ${report.total.enemyWaits}; reversals ${report.total.enemyReversals}; longest no-damage sequence ${report.total.longestNoDamagePlies} actions`);
for (const f of fights) console.log(`  ${f.floor}F seed=${f.seed} ${f.policy}: ${f.ended}, ${f.plies} actions, captures=${f.player.captures}/${f.enemy.captures}, deploys=${f.player.deploy}/${f.enemy.deploy} (player/enemy), recaptures=${f.player.recaptures+f.enemy.recaptures}, enemy waits=${f.enemy.wait}, reversals=${f.enemy.reversals}, longest no-damage=${f.longestNoDamagePlies}`);
console.log(`Observation JSON: ${output}`);
if (report.total.invalidActions || report.total.invalidBoardStates || report.total.aiStateMutations) process.exitCode = 1;
