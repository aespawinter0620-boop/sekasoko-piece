/* One atomic localStorage record keeps permanent ownership and exploration in sync. */
(() => {
'use strict';
const { MASTER, ARMY_RULES, Growth, Engine } = globalThis.Sekasoko;
const KEY = 'sekasoko-piece.save.v1';
let readError = false;
const clone = value => JSON.parse(JSON.stringify(value));

function load() {
  readError = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw), c = data.collection, s = data.exploration;
    // Additive VER.010 migration: keep ownership, IDs and progress; fill only new fields.
    if (c && s && Array.isArray(c.roster) && Array.isArray(s.roster)) {
      Growth.ensure(c.king); c.roster.forEach(Growth.ensure); s.roster.forEach(Growth.ensure);
      s.king = Growth.ensure(s.king || { ...c.king });
      c.crystals ??= 0; s.crystals ??= c.crystals;
      s.defeatedForEXP ||= []; s.damageContributors ||= {}; s.lastCrystalReward ??= 0;
      for (const piece of [...s.units, ...s.hands.player, ...s.hands.enemy]) {
        Growth.ensure(piece); piece.maxHp = Growth.stats(piece).hp;
      }
    }
    if (data.schema !== 1 || c?.king?.type !== 'king' || !c.king.id || !Array.isArray(c.roster)
      || !Array.isArray(c.formation) || !s || !Array.isArray(s.units) || !Array.isArray(s.roster)
      || !Array.isArray(s.hands?.player) || !Array.isArray(s.hands?.enemy)
      || !['preparation','player','enemy','victory','defeat','clear'].includes(s.phase)
      || !Number.isInteger(s.floor) || s.floor < 1 || s.floor > 10
      || !Number.isInteger(c.nextId) || c.nextId < 1 || s.nextId !== c.nextId
      || s.kingId !== c.king.id) throw Error('Invalid save');
    const owned = [c.king, ...c.roster];
    if (new Set(owned.map(p => p.id)).size !== owned.length || owned.some(p => !p.id || !MASTER[p.type])
      || c.roster.some(p => p.type === 'king') || JSON.stringify(s.roster) !== JSON.stringify(c.roster)
      || JSON.stringify(s.formation) !== JSON.stringify(c.formation)
      || c.formation.length > ARMY_RULES.maxHandPieces || new Set(c.formation).size !== c.formation.length
      || c.formation.some(id => !c.roster.some(p => p.id === id))
      || c.formation.reduce((n,id) => n + MASTER[c.roster.find(p => p.id === id).type].cost,0) > ARMY_RULES.costLimit) throw Error('Invalid ownership');
    const pieces = [...s.units, ...s.hands.player, ...s.hands.enemy];
    if (new Set(pieces.map(p => p.id)).size !== pieces.length
      || pieces.some(p => !MASTER[p.type] || !['player','enemy'].includes(p.originSide) || p.currentSide !== p.side)
      || s.units.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.x > 6 || p.y < 0 || p.y > 4 || p.hp <= 0)
      || new Set(s.units.map(p => `${p.x},${p.y}`)).size !== s.units.length
      || (['victory','clear','defeat'].includes(s.phase) && !s.battleFinalized)) throw Error('Invalid battle');
    data.exploration = Engine.restoreRun(s);
    return data;
  } catch (_) { readError = true; return null; }
}

function sync(collection, state) {
  // Ownership never disappears when an individual changes side in battle.
  const owned = new Map(collection.roster.map(p => [p.id, { ...p }]));
  for (const piece of state.roster) owned.set(piece.id, { ...Growth.ensure(piece) });
  collection.roster = [...owned.values()];
  collection.king = { ...Growth.ensure(state.king || collection.king) };
  collection.crystals = state.crystals || 0;
  state.roster = collection.roster.map(p => ({ ...p }));
  collection.formation = state.formation.slice();
  collection.nextId = Math.max(collection.nextId, state.nextId);
  state.nextId = collection.nextId;
}

function save(collection, state) {
  sync(collection, state);
  if (readError) return false; // Keep an unreadable record until explicit initialization.
  try {
    localStorage.setItem(KEY, JSON.stringify({ schema: 1, collection: clone(collection), exploration: clone(state) }));
    return true;
  } catch (_) { return false; }
}

function clear() {
  try { localStorage.removeItem(KEY); readError = false; return true; }
  catch (_) { return false; }
}

globalThis.Sekasoko.Storage = Object.freeze({ load, save, sync, clear });
})();
