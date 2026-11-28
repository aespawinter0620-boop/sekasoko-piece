'use strict';
// Preserve existing full-army cases while production starts with three owned pieces.
module.exports = function armyCollection() {
  const types = ['knight','knight','knight','knight','archer','archer','archer','archer','slime','slime','slime'];
  const roster = types.map((type,i) => ({ id: `r${i+2}`, type }));
  return { king: { id: 'r1', type: 'king' }, roster, formation: roster.map(p => p.id), nextId: 13 };
};
