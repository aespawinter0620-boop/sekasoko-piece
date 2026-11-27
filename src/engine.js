/* セカソコ！ 手駒編 VER.001 — common character master (all prototype values). */
const MASTER = Object.freeze({
  king: Object.freeze({ name: '王', icon: '♚︎', hp: 12, atk: 2, move: 1, range: 1, cost: 0 }),
  knight: Object.freeze({ name: '騎士', icon: '♞︎', hp: 8, atk: 3, move: 2, range: 1, cost: 3 }),
  archer: Object.freeze({ name: '弓兵', icon: '🏹', hp: 5, atk: 2, move: 1, range: 3, cost: 2 }),
  mage: Object.freeze({ name: '魔法使い', icon: '🔮', hp: 4, atk: 4, move: 1, range: 3, cost: 4 }),
  slime: Object.freeze({ name: 'スライム', icon: '💧', hp: 4, atk: 1, move: 1, range: 1, cost: 1 }),
  goblin: Object.freeze({ name: 'ゴブリン', icon: '👺', hp: 5, atk: 2, move: 2, range: 1, cost: 2 }),
  orc: Object.freeze({ name: 'オーク', icon: '🪓', hp: 9, atk: 3, move: 1, range: 1, cost: 3 }),
  golem: Object.freeze({ name: 'ゴーレム', icon: '🗿', hp: 14, atk: 2, move: 1, range: 1, cost: 4 }),
  hamster: Object.freeze({ name: 'ハムスター', icon: '🐹', hp: 3, atk: 2, move: 3, range: 1, cost: 1 }),
  dragon: Object.freeze({ name: 'ドラゴン', icon: '🐉', hp: 12, atk: 5, move: 2, range: 2, cost: 6 })
});

/* VER.005 army scale. Character values and battle algorithms stay independent. */
const ARMY_RULES = Object.freeze({
  maxHandPieces: 11,
  costLimit: 35,
  startingTypes: Object.freeze([
    'knight', 'knight', 'knight', 'knight',
    'archer', 'archer', 'archer', 'archer',
    'slime', 'slime', 'slime'
  ]),
  firstFloorEnemyTypes: Object.freeze([
    'slime', 'slime', 'slime', 'slime', 'slime', 'slime', 'slime',
    'goblin', 'goblin', 'goblin', 'goblin'
  ]),
  playerSlots: Object.freeze([
    [2,0], [2,1], [2,2], [2,3], [2,4], [1,1], [1,3],
    [0,0], [0,1], [0,3], [0,4]
  ].map(([x,y]) => Object.freeze({x,y}))),
  enemySlots: Object.freeze([
    [4,0], [4,1], [4,2], [4,3], [4,4], [5,1], [5,3],
    [6,0], [6,1], [6,3], [6,4]
  ].map(([x,y]) => Object.freeze({x,y})))
});

/* VER.006 passive definitions and character loadouts share one extensible registry. */
const PASSIVES = Object.freeze({
  supportFire: Object.freeze({
    id: 'supportFire', name: '支援射撃', trigger: 'allyNormalAttack', damageMultiplier: 1,
    description: '味方が通常攻撃した敵が射程内にいると、実効ATK100%で1回追撃。自身の攻撃と追撃からは発動しない。'
  }),
  inspiration: Object.freeze({
    id: 'inspiration', name: '鼓舞', trigger: 'adjacentAllyAttack', bonusMultiplier: 0.5,
    description: '上下左右に隣接する味方のATKを基礎値の50%強化。複数の騎士の効果は加算し、最後に端数切り捨て。'
  }),
  stoneWall: Object.freeze({
    id: 'stoneWall', name: '守護の石壁', trigger: 'adjacentAllyHit', damageShare: 1,
    description: '上下左右に隣接する味方へのダメージを全て肩代わり。現在HP最大、同値なら個体ID順。超過ダメージや身代わりは連鎖しない。'
  })
});
const PASSIVE_LOADOUTS = Object.freeze({
  archer: Object.freeze(['supportFire']),
  knight: Object.freeze(['inspiration']),
  golem: Object.freeze(['stoneWall'])
});

/* Pure battle rules. UI and animation are deliberately outside this module. */
const Engine = (() => {
  const WIDTH = 7, HEIGHT = 5;
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const inside = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
  const find = (state, id) => state.units.find(unit => unit.id === id);
  const active = state => state.phase === 'player' || state.phase === 'enemy';
  const append = (state, message) => {
    state.log.unshift(message);
    state.log.length = Math.min(state.log.length, 60);
  };
  const nextID = (state, prefix) => prefix + state.nextId++;
  const rosterPiece = (state, type) => ({ id: nextID(state, 'r'), type });
  const unit = (state, type, side, x, y) => ({
    id: nextID(state, 'u'), type, side, x, y, hp: MASTER[type].hp, maxHp: MASTER[type].hp
  });

  function formationError(state, ids) {
    if (!Array.isArray(ids) || ids.length > ARMY_RULES.maxHandPieces) return `手駒は最大${ARMY_RULES.maxHandPieces}体まで編成できるよ。`;
    if (new Set(ids).size !== ids.length) return '同じ個体は2回選べないよ。';
    const pieces = ids.map(id => state.roster.find(piece => piece.id === id));
    if (pieces.some(piece => !piece || !MASTER[piece.type] || piece.type === 'king')) return '持っている手駒を選んでね。';
    if (pieces.reduce((sum, piece) => sum + MASTER[piece.type].cost, 0) > ARMY_RULES.costLimit) return `編成コストは${ARMY_RULES.costLimit}までだよ。`;
    return null;
  }

  function weightedEnemy(floor) {
    // No level scaling: deeper floors change the encounter pool, not master values.
    const depth = (floor - 2) / 8;
    const entries = [
      ['slime', 30 - depth * 25], ['goblin', 25 - depth * 9],
      ['hamster', 16 - depth * 9], ['archer', 12 + depth * 3],
      ['knight', 8 + depth * 12], ['orc', 5 + depth * 15],
      ['mage', 2 + depth * 15], ['golem', 2 + depth * 13],
      ['dragon', floor < 4 ? 0 : 0.6 + depth * 3.4]
    ];
    let roll = Math.random() * entries.reduce((sum, entry) => sum + entry[1], 0);
    for (const [type, weight] of entries) { roll -= weight; if (roll < 0) return type; }
    return 'goblin';
  }

  function startBattle(state) {
    const error = formationError(state, state.formation);
    if (error) return { ok: false, error, events: [] };
    state.units = [unit(state, 'king', 'player', 0, 2)];
    state.formation.forEach((id, index) => {
      const piece = state.roster.find(item => item.id === id);
      const {x,y} = ARMY_RULES.playerSlots[index];
      state.units.push(unit(state, piece.type, 'player', x, y));
    });
    state.units.push(unit(state, 'king', 'enemy', 6, 2));
    const enemies = state.floor === 1 ? ARMY_RULES.firstFloorEnemyTypes : Array.from({ length: ARMY_RULES.maxHandPieces }, () => weightedEnemy(state.floor));
    enemies.forEach((type, index) => {
      const {x,y} = ARMY_RULES.enemySlots[index];
      state.units.push(unit(state, type, 'enemy', x, y));
    });
    state.phase = 'player';
    state.turn = 1;
    state.candidates = [];
    state.lastRewards = [];
    state.history = {};
    append(state, `${state.floor}Fの戦闘開始。味方は全員HP全回復。`);
    return { ok: true, events: [{ type: 'start', floor: state.floor }] };
  }

  function createRun() {
    const state = {
      floor: 1, turn: 1, totalActions: 0, phase: 'player', units: [],
      roster: [], formation: [], candidates: [], lastRewards: [], log: [],
      history: {}, nextId: 1
    };
    state.roster = ARMY_RULES.startingTypes.map(type => rosterPiece(state, type));
    state.formation = state.roster.map(piece => piece.id);
    startBattle(state);
    return state;
  }

  function moves(state, unitId) {
    const actor = find(state, unitId);
    if (!actor || actor.hp <= 0) return [];
    const max = MASTER[actor.type].move;
    const occupied = new Set(state.units.filter(piece => piece.id !== actor.id && piece.hp > 0).map(piece => `${piece.x},${piece.y}`));
    const visited = new Set([`${actor.x},${actor.y}`]);
    const queue = [{ x: actor.x, y: actor.y, path: [] }];
    const result = [];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (current.path.length >= max) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) {
        const x = current.x + dx, y = current.y + dy, key = `${x},${y}`;
        if (!inside(x, y) || occupied.has(key) || visited.has(key)) continue;
        visited.add(key);
        const move = { x, y, path: current.path.concat([{ x, y }]) };
        queue.push(move);
        result.push(move);
      }
    }
    return result;
  }

  function targets(state, unitId) {
    const actor = find(state, unitId);
    if (!actor || actor.hp <= 0) return [];
    return state.units.filter(target => target.hp > 0 && target.side !== actor.side && distance(actor, target) <= MASTER[actor.type].range);
  }

  const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const byId = (a, b) => compareIds(a.id, b.id);
  const hasPassive = (piece, passiveId) => (PASSIVE_LOADOUTS[piece.type] || []).includes(passiveId);

  function passivesFor(type) {
    return (PASSIVE_LOADOUTS[type] || []).map(id => PASSIVES[id]);
  }

  function guardsFor(state, target) {
    return state.units.filter(piece => piece.hp > 0 && piece.side === target.side
      && hasPassive(piece, 'stoneWall') && distance(piece, target) === 1)
      .sort((a, b) => b.hp - a.hp || byId(a, b));
  }

  function combatInfo(state, unitId) {
    const actor = find(state, unitId);
    if (!actor || actor.hp <= 0) return null;
    const knights = state.units.filter(piece => piece.hp > 0 && piece.side === actor.side
      && hasPassive(piece, 'inspiration') && distance(piece, actor) === 1).sort(byId);
    const baseAtk = MASTER[actor.type].atk;
    const atk = Math.floor(baseAtk * (1 + knights.length * PASSIVES.inspiration.bonusMultiplier));
    const guards = guardsFor(state, actor);
    return {
      baseAtk, atk, bonusAtk: atk - baseAtk, knightIds: knights.map(piece => piece.id),
      passives: passivesFor(actor.type), guardId: guards[0]?.id || null, guardIds: guards.map(piece => piece.id)
    };
  }

  function defeated(state, target, events) {
    events.push({ type: 'death', unitId: target.id, unitType: target.type, side: target.side });
    state.units = state.units.filter(piece => piece.id !== target.id);
    append(state, `${target.side === 'player' ? '味方' : '敵'}の${MASTER[target.type].name}を撃破。`);
    if (target.side === 'enemy' && target.type !== 'king') {
      state.candidates.push(target.type);
      events.push({ type: 'candidate', unitType: target.type });
      append(state, `${MASTER[target.type].name}が獲得候補に！`);
    }
    if (target.type !== 'king') return;
    if (target.side === 'enemy') {
      state.lastRewards = state.candidates.slice();
      state.roster.push(...state.lastRewards.map(type => rosterPiece(state, type)));
      state.candidates = [];
      state.phase = state.floor === 10 ? 'clear' : 'victory';
      append(state, state.phase === 'clear' ? '10F踏破！ 試作版クリア！' : `${state.floor}Fクリア！ 手駒${state.lastRewards.length}体を獲得。`);
      events.push({ type: state.phase, rewards: state.lastRewards.slice() });
    } else {
      state.candidates = [];
      state.lastRewards = [];
      state.phase = 'defeat';
      append(state, '味方の王が倒れた。今回の獲得候補は失われた。');
      events.push({ type: 'defeat' });
    }
  }

  // Each strike uses the current board. Redirect only once; excess never reaches the original target.
  function resolveStrike(state, actorId, originalTargetId, followUp, events) {
    const actor = find(state, actorId), original = find(state, originalTargetId);
    if (!active(state) || !actor || actor.hp <= 0 || !original || original.hp <= 0) return;
    const multiplier = followUp ? PASSIVES.supportFire.damageMultiplier : 1;
    const damage = Math.max(1, Math.floor(combatInfo(state, actor.id).atk * multiplier));
    const guard = guardsFor(state, original)[0];
    const target = guard || original;
    if (guard) {
      events.push({ type: 'guard', unitId: guard.id, protectedId: original.id, attackerId: actor.id, damage });
      append(state, `${MASTER[guard.type].name}が${MASTER[original.type].name}を守護。${damage}ダメージを肩代わり。`);
    }
    const hpBefore = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    events.push({
      type: 'attack', unitId: actor.id, targetId: target.id, originalTargetId: original.id,
      damage, followUp, hpBefore, hpAfter: target.hp
    });
    append(state, `${actor.side === 'player' ? '味方' : '敵'}の${MASTER[actor.type].name}${followUp ? 'の支援射撃' : ''} → ${MASTER[target.type].name}に${damage}ダメージ。`);
    if (target.hp === 0) defeated(state, target, events);
  }

  function resolveAttack(state, actorId, targetId, events) {
    const actor = find(state, actorId);
    resolveStrike(state, actorId, targetId, false, events);
    if (!active(state) || !find(state, targetId)) return;
    const supporters = state.units.filter(piece => piece.hp > 0 && piece.side === actor.side
      && piece.id !== actorId && hasPassive(piece, 'supportFire')).sort(byId).map(piece => piece.id);
    for (const id of supporters) {
      const supporter = find(state, id), original = find(state, targetId);
      if (!active(state) || !original || original.hp <= 0) break;
      if (!supporter || supporter.hp <= 0 || distance(supporter, original) > MASTER[supporter.type].range) continue;
      resolveStrike(state, supporter.id, targetId, true, events);
    }
  }

  function act(state, action) {
    const events = [];
    const invalid = error => ({ ok: false, error, events });
    if (!active(state)) return invalid('この戦闘は終了しているよ。');
    if (!action || !['move', 'attack', 'wait'].includes(action.type)) return invalid('行動を選んでね。');
    let actor = action.unitId ? find(state, action.unitId) : null;
    if (action.type !== 'wait' && (!actor || actor.side !== state.phase || actor.hp <= 0)) return invalid('今の陣営の駒を選んでね。');
    if (action.type === 'wait' && action.unitId && (!actor || actor.side !== state.phase || actor.hp <= 0)) return invalid('今の陣営の駒を選んでね。');

    const sideName = state.phase === 'player' ? '味方' : '敵';
    if (action.type === 'move') {
      const move = moves(state, actor.id).find(item => item.x === action.x && item.y === action.y);
      if (!move) return invalid('そこには移動できないよ。');
      const from = { x: actor.x, y: actor.y };
      const history = state.history[actor.id] || [];
      history.push(from);
      state.history[actor.id] = history.slice(-6);
      actor.x = move.x;
      actor.y = move.y;
      events.push({ type: 'move', unitId: actor.id, from, to: { x: actor.x, y: actor.y }, path: move.path });
      append(state, `${sideName}の${MASTER[actor.type].name}が移動。`);
    } else if (action.type === 'attack') {
      if (!targets(state, actor.id).some(target => target.id === action.targetId)) return invalid('その駒には攻撃できないよ。');
      resolveAttack(state, actor.id, action.targetId, events);
    } else {
      events.push({ type: 'wait', side: state.phase, unitId: actor ? actor.id : null });
      append(state, `${sideName}${actor ? 'の' + MASTER[actor.type].name : ''}は待機。`);
    }
    state.totalActions++;
    if (active(state)) {
      state.phase = state.phase === 'player' ? 'enemy' : 'player';
      state.turn++;
    }
    return { ok: true, events };
  }

  function predictAttack(state, actorId, targetId) {
    const simulated = JSON.parse(JSON.stringify(state));
    const result = act(simulated, { type: 'attack', unitId: actorId, targetId });
    const remaining = new Map(simulated.units.map(piece => [piece.id, piece.hp]));
    const damageById = {};
    for (const piece of state.units) {
      const damage = piece.hp - (remaining.get(piece.id) || 0);
      if (damage > 0) damageById[piece.id] = damage;
    }
    const deaths = result.events.filter(event => event.type === 'death');
    return {
      ...result, state: simulated, damageById, killedIds: deaths.map(event => event.unitId),
      kingKilledId: deaths.find(event => event.unitType === 'king')?.unitId || null,
      terminal: !active(simulated)
    };
  }

  // One opposing action, including all guards and follow-ups, on the candidate board.
  function forecastThreats(state, opponentSide) {
    const forecast = { ...state, phase: opponentSide };
    const damage = new Map();
    for (const attacker of forecast.units.filter(piece => piece.side === opponentSide && piece.hp > 0).sort(byId)) {
      for (const target of targets(forecast, attacker.id)) {
        const predicted = predictAttack(forecast, attacker.id, target.id);
        for (const [id, loss] of Object.entries(predicted.damageById)) damage.set(id, Math.max(damage.get(id) || 0, loss));
      }
    }
    return damage;
  }

  function firingDistance(state, actor, position, opponents) {
    const occupied = new Set(state.units.filter(piece => piece.id !== actor.id).map(piece => `${piece.x},${piece.y}`));
    const queue = [{ x: position.x, y: position.y, steps: 0 }];
    const seen = new Set([`${position.x},${position.y}`]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (opponents.some(target => distance(current, target) <= MASTER[actor.type].range)) return current.steps;
      for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) {
        const x = current.x + dx, y = current.y + dy, key = `${x},${y}`;
        if (!inside(x, y) || occupied.has(key) || seen.has(key)) continue;
        seen.add(key);
        queue.push({ x, y, steps: current.steps + 1 });
      }
    }
    return WIDTH * HEIGHT;
  }

  function chooseAI(state) {
    if (state.phase !== 'enemy') return { type: 'wait' };
    const enemies = state.units.filter(piece => piece.side === 'enemy' && piece.hp > 0).sort(byId);
    const opponents = state.units.filter(piece => piece.side === 'player' && piece.hp > 0).sort(byId);
    const ownKing = enemies.find(piece => piece.type === 'king');
    const playerKing = opponents.find(piece => piece.type === 'king');
    let currentRisks;
    const risksNow = () => currentRisks || (currentRisks = forecastThreats(state, 'player'));
    const scoreAttack = predicted => {
      const loss = Object.values(predicted.damageById).reduce((sum, damage) => sum + damage, 0);
      return (predicted.kingKilledId === playerKing?.id ? 1000000 : 0)
        + predicted.killedIds.length * 10000 + loss * 10 + (predicted.damageById[playerKing?.id] || 0) * 40;
    };
    let bestAttack = null, attackScore = -Infinity;
    for (const actor of enemies) {
      for (const target of targets(state, actor.id).sort(byId)) {
        const predicted = predictAttack(state, actor.id, target.id);
        let score = scoreAttack(predicted);
        if (actor.type === 'king' && !predicted.kingKilledId && (risksNow().get(actor.id) || 0) >= actor.hp) score -= 25;
        if (score > attackScore) {
          bestAttack = { type: 'attack', unitId: actor.id, targetId: target.id };
          attackScore = score;
        }
      }
    }
    if (bestAttack) return bestAttack;

    const currentKingRisk = ownKing ? risksNow().get(ownKing.id) || 0 : 0;
    let bestMove = null, moveScore = -Infinity, progressMove = null, progressScore = -Infinity;
    for (const actor of enemies) {
      const stats = MASTER[actor.type];
      const currentThreat = risksNow().get(actor.id) || 0;
      const currentGap = firingDistance(state, actor, actor, opponents);
      for (const move of moves(state, actor.id)) {
        const simulated = { ...state, units: state.units.map(piece => piece.id === actor.id ? { ...piece, x: move.x, y: move.y } : piece) };
        const risks = forecastThreats(simulated, 'player');
        const threat = risks.get(actor.id) || 0;
        const kingRisk = ownKing ? risks.get(ownKing.id) || 0 : 0;
        const attackable = targets(simulated, actor.id);
        const gap = firingDistance(state, actor, move, opponents);
        const history = state.history[actor.id] || [];
        const recent = history.slice(-2).some(position => position.x === move.x && position.y === move.y);
        let futureDamage = 0, futureKill = false;
        for (const target of attackable) {
          const predicted = predictAttack(simulated, actor.id, target.id);
          futureDamage = Math.max(futureDamage, Object.values(predicted.damageById).reduce((sum, damage) => sum + damage, 0));
          futureKill = futureKill || predicted.killedIds.length > 0;
        }
        let score = (currentGap - gap) * 9 - gap * 2 + (attackable.length ? 24 : 0);
        score += futureKill ? 12 : attackable.length ? 2 : 0;
        score += futureDamage * 0.2;
        score -= recent ? 22 : 0;
        score -= move.path.length * 0.15;
        score += playerKing ? (distance(actor, playerKing) - distance(move, playerKing)) * 0.3 : 0;
        if (actor.type === 'king') {
          score -= threat * 12;
          score += (currentThreat - threat) * 8;
          if (threat >= actor.hp) score -= 1000;
          score -= enemies.length > 1 ? 9 : 0;
        } else {
          score -= Math.max(0, threat - currentThreat) * 0.6;
          if (threat >= actor.hp) score -= 7;
        }
        if (ownKing && actor.id !== ownKing.id) {
          score -= Math.max(0, kingRisk - currentKingRisk) * 8;
          if (kingRisk >= ownKing.hp && currentKingRisk < ownKing.hp) score -= 1000;
        }
        const safeKing = !ownKing || kingRisk < ownKing.hp || currentKingRisk >= ownKing.hp;
        if (gap < currentGap && (actor.type !== 'king' || threat === 0) && safeKing && score > progressScore) {
          progressMove = { type: 'move', unitId: actor.id, x: move.x, y: move.y };
          progressScore = score;
        }
        if (score > moveScore) {
          bestMove = { type: 'move', unitId: actor.id, x: move.x, y: move.y };
          moveScore = score;
        }
      }
    }
    return bestMove && moveScore > 0 ? bestMove : progressMove || { type: 'wait' };
  }

  function setFormation(state, ids) {
    if (state.phase !== 'victory') return { ok: false, error: '階層クリア後に編成できるよ。' };
    const error = formationError(state, ids);
    if (error) return { ok: false, error };
    state.formation = ids.slice();
    return { ok: true };
  }

  function advance(state) {
    if (state.phase !== 'victory' || state.floor >= 10) return { ok: false, error: '今は次の階層へ進めないよ。', events: [] };
    const error = formationError(state, state.formation);
    if (error) return { ok: false, error, events: [] };
    state.floor++;
    return startBattle(state);
  }
  return Object.freeze({ createRun, startBattle, moves, targets, act, chooseAI, setFormation, advance, distance, combatInfo, passivesFor, predictAttack });
})();

globalThis.Sekasoko = { MASTER, ARMY_RULES, PASSIVES, PASSIVE_LOADOUTS, Engine };
