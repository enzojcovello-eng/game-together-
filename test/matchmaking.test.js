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

// jogo com crossplay total: plataforma não é pedida e não entra na chave
r = mm.find('t1', { name: 'T1', gameId: 'ark-survival-ascended', lang: 'pt-BR', mode: 'duo' });
assert.strictEqual(r.status, 'waiting');
r = mm.find('t2', { name: 'T2', gameId: 'ark-survival-ascended', lang: 'pt-BR', platform: 'xbox', mode: 'duo' });
assert.strictEqual(r.status, 'matched', 'ARK SA com crossplay casa sem plataforma');
assert.strictEqual(mm.publicRoom(r.room).members[0].platform, null);

// Terraria não tem crossplay: Switch não casa com celular
r = mm.find('u1', { name: 'U1', gameId: 'terraria', lang: 'en-US', platform: 'switch', mode: 'duo' });
assert.strictEqual(r.status, 'waiting');
r = mm.find('u2', { name: 'U2', gameId: 'terraria', lang: 'en-US', platform: 'mobile', mode: 'duo' });
assert.strictEqual(r.status, 'waiting');
r = mm.find('u3', { name: 'U3', gameId: 'terraria', lang: 'en-US', platform: 'switch', mode: 'duo' });
assert.strictEqual(r.status, 'matched');
assert.deepStrictEqual(r.joined.sort(), ['u1', 'u3']);
mm.leave('u2');

// Minecraft: crossplay parcial (console e celular juntos, PC separado)
r = mm.find('m1', { name: 'M1', gameId: 'minecraft', lang: 'pt-BR', platform: 'playstation', mode: 'duo' });
assert.strictEqual(r.status, 'waiting');
r = mm.find('m2', { name: 'M2', gameId: 'minecraft', lang: 'pt-BR', platform: 'pc', mode: 'duo' });
assert.strictEqual(r.status, 'waiting', 'PC (Java) não casa com console');
r = mm.find('m3', { name: 'M3', gameId: 'minecraft', lang: 'pt-BR', platform: 'switch', mode: 'duo' });
assert.strictEqual(r.status, 'matched', 'Switch casa com PlayStation (Bedrock)');
assert.deepStrictEqual(r.joined.sort(), ['m1', 'm3']);

// Helldivers 2: crossplay total, limite 4 no grupo
for (const id of ['h1', 'h2', 'h3', 'h4', 'h5']) mm.find(id, { name: id, gameId: 'helldivers-2', lang: 'en-US', mode: 'group' });
assert.strictEqual(mm.roomOf('h1').members.size, 4);
assert.strictEqual(mm.roomOf('h5').members.size, 1);

// estatísticas por jogo
const st = mm.stats();
assert.strictEqual(st.games['helldivers-2'].inCall, 5);
assert.strictEqual(st.games['minecraft'].inCall, 2);
assert.strictEqual(st.games['minecraft'].searching, 1, 'm2 continua procurando');
assert.strictEqual(st.games['gta-5'], undefined, 'jogo sem ninguém não aparece');

// sala privada de amigos: anfitrião cria, convidado entra pelo id, lota em 5
const priv = mm.hostPrivate('p1', 'P1');
assert.strictEqual(priv.private, true);
for (const id of ['p2', 'p3', 'p4', 'p5']) assert.strictEqual(mm.joinById(priv.id, id, id).status, 'matched');
assert.strictEqual(mm.joinById(priv.id, 'p6', 'P6').error, 'room_full');
assert.strictEqual(mm.joinById('nada', 'p6', 'P6').error, 'unknown_room');
assert.strictEqual(mm.roomOf('p3').id, priv.id);
mm.leave('p1');
assert.strictEqual(mm.roomOf('p3').members.size, 4, 'sala continua sem o anfitrião');
// convite para uma sala pública (jogo) também funciona, respeitando o limite
assert.strictEqual(mm.joinById(mm.roomOf('g1').id, 'g9', 'G9').error, 'room_full', 'Fortnite já tem 4');

// validação
assert.strictEqual(mm.find('z', { name: 'Z', gameId: 'nope', lang: 'pt-BR', platform: 'pc', mode: 'duo' }).error, 'unknown_game');
assert.strictEqual(mm.find('z', { name: 'Z', gameId: 'terraria', lang: 'pt-BR', mode: 'duo' }).error, 'unknown_platform', 'sem crossplay a plataforma é obrigatória');
assert.strictEqual(mm.find('z', { name: 'Z', gameId: 'ark-survival-evolved', lang: 'pt-BR', platform: 'nintendo', mode: 'duo' }).error, 'unknown_platform');
assert.strictEqual(mm.find('z', { name: '', gameId: 'roblox', lang: 'pt-BR', platform: 'pc', mode: 'duo' }).error, 'missing_name');

// cancelar busca duo tira da fila
mm.find('w', { name: 'W', gameId: 'roblox', lang: 'pt-BR', platform: 'pc', mode: 'duo' });
mm.leave('w');
assert.strictEqual(mm.stats().searching, 3, 'na fila só sobram "b", "e" e "m2"');
assert.strictEqual(mm.stats().games.friends.inCall, 4);

// reconexão: o jogador volta com outro id e continua na mesma sala, na mesma posição
{
  const m2 = new Matchmaker(config);
  const req = { gameId: 'rocket-league', lang: 'pt-BR', mode: 'duo', platform: 'pc' };
  m2.find('s1', { name: 'A', ...req });
  const r = m2.find('s2', { name: 'B', ...req });
  assert.strictEqual(r.status, 'matched');
  const room = m2.replaceId('s1', 's9');
  assert.ok(room && room.id === r.room.id);
  assert.deepStrictEqual([...room.members.keys()], ['s9', 's2']);
  assert.strictEqual(m2.roomOf('s9').id, room.id);
  assert.strictEqual(m2.roomOf('s1'), null);
  assert.strictEqual(m2.replaceId('nope', 'x'), null);
  const left = m2.leave('s9');
  assert.deepStrictEqual(left.remaining, ['s2']);
}
// sem par: abre chamada sozinho; o próximo com a mesma escolha entra nela
{
  const m3 = new Matchmaker(config);
  const req = { gameId: 'rocket-league', lang: 'pt-BR', mode: 'duo', platform: 'pc' };
  assert.strictEqual(m3.find('p1', { name: 'A', ...req }).status, 'waiting');
  assert.ok(m3.isQueued('p1'));
  const solo = m3.openSolo('p1');
  assert.strictEqual(solo.status, 'matched');
  assert.deepStrictEqual(solo.joined, ['p1']);
  assert.strictEqual(solo.room.max, 2);
  assert.ok(!m3.isQueued('p1'));
  assert.strictEqual(m3.openSolo('p1'), null, 'já está em sala: nada a abrir');
  const j = m3.find('p2', { name: 'B', ...req });
  assert.strictEqual(j.status, 'matched');
  assert.strictEqual(j.room.id, solo.room.id, 'entrou na chamada de quem esperava');
  assert.deepStrictEqual(j.joined, ['p2']);
  assert.strictEqual(m3.find('p3', { name: 'C', ...req }).status, 'waiting', 'sala cheia: o terceiro espera');
  assert.strictEqual(m3.find('p4', { name: 'D', ...req, lang: 'en-US' }).status, 'waiting', 'escolha diferente não entra');
  m3.leave('p1');
  assert.strictEqual(m3.openSolo('p1'), null);
}
console.log('matchmaking: todos os testes passaram');
