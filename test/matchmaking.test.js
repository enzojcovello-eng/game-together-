'use strict';
const assert = require('assert');
const { Matchmaker } = require('../lib/matchmaker');
const config = require('../games.json');

const mm = new Matchmaker(config);

// duo: primeiro espera, segundo com mesma combinação casa
let r = mm.find('a', { name: 'Ana', gameId: 'rocket-league', lang: 'pt-BR', platform: 'pc', mode: 'duo' });
assert.strictEqual(r.status, 'waiting');
r = mm.find('b', { name: 'Bia', gameId: 'rocket-league', lang: 'en-US', platform: 'pc', mode: 'duo' });
assert.strictEqual(r.status, 'waiting', 'idioma diferente não casa');
r = mm.find('c', { name: 'Caio', gameId: 'rocket-league', lang: 'pt-BR', platform: 'xbox', mode: 'duo' });
assert.strictEqual(r.status, 'matched', 'Rocket League tem crossplay: PC casa com Xbox');
assert.deepStrictEqual(r.joined.sort(), ['a', 'c']);
assert.strictEqual(r.room.max, 2);

// ARK SE sem crossplay: PC não casa com PlayStation
r = mm.find('d', { name: 'Dan', gameId: 'ark-survival-evolved', lang: 'pt-BR', platform: 'pc', mode: 'duo' });
assert.strictEqual(r.status, 'waiting');
r = mm.find('e', { name: 'Edu', gameId: 'ark-survival-evolved', lang: 'pt-BR', platform: 'playstation', mode: 'duo' });
assert.strictEqual(r.status, 'waiting', 'ARK SE: PC e PlayStation não se encontram');
r = mm.find('f', { name: 'Fê', gameId: 'ark-survival-evolved', lang: 'pt-BR', platform: 'pc', mode: 'duo' });
assert.strictEqual(r.status, 'matched');
assert.deepStrictEqual(r.joined.sort(), ['d', 'f']);

// group: entra em sala aberta até o limite do jogo (Fortnite = 4)
const ids = ['g1', 'g2', 'g3', 'g4', 'g5'];
const rooms = new Set();
for (const id of ids) {
  r = mm.find(id, { name: id, gameId: 'fortnite', lang: 'en-US', platform: 'mobile', mode: 'group' });
  assert.strictEqual(r.status, 'matched');
  rooms.add(r.room.id);
}
assert.strictEqual(rooms.size, 2, 'a quinta pessoa abre uma segunda sala');
const first = mm.roomOf('g1');
assert.strictEqual(first.members.size, 4);
assert.strictEqual(mm.roomOf('g5').members.size, 1);

// sair libera vaga
const left = mm.leave('g2');
assert.deepStrictEqual(left.remaining.sort(), ['g1', 'g3', 'g4']);
r = mm.find('g6', { name: 'g6', gameId: 'fortnite', lang: 'en-US', platform: 'mobile', mode: 'group' });
assert.strictEqual(r.room.id, first.id, 'vaga liberada é preenchida antes de criar sala nova');

// validação
assert.strictEqual(mm.find('z', { name: 'Z', gameId: 'nope', lang: 'pt-BR', platform: 'pc', mode: 'duo' }).error, 'unknown_game');
assert.strictEqual(mm.find('z', { name: 'Z', gameId: 'ark-survival-ascended', lang: 'pt-BR', platform: 'switch', mode: 'duo' }).error, 'unknown_platform');
assert.strictEqual(mm.find('z', { name: '', gameId: 'roblox', lang: 'pt-BR', platform: 'pc', mode: 'duo' }).error, 'missing_name');

// cancelar busca duo tira da fila
mm.find('w', { name: 'W', gameId: 'roblox', lang: 'pt-BR', platform: 'pc', mode: 'duo' });
mm.leave('w');
assert.strictEqual(mm.stats().searching, 2, 'na fila só sobram "b" e "e"');

console.log('matchmaking: todos os testes passaram');
