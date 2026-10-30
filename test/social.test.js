'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Social } = require('../lib/social');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-social-'));
let clock = 1000;
const s = new Social({ dataDir: dir, now: () => ++clock });

assert.strictEqual(s.request('ana', 'ana').error, 'self');
assert.strictEqual(s.request('ana', 'bia').status, 'pending');
assert.deepStrictEqual(s.requestsFor('bia').map((r) => r.from), ['ana']);
assert.strictEqual(s.send('ana', 'bia', 'oi').error, 'not_friends');
assert.strictEqual(s.accept('bia', 'ana').ok, true);
assert.ok(s.areFriends('ana', 'bia') && s.areFriends('bia', 'ana'));
assert.strictEqual(s.request('bia', 'ana').status, 'already');

// pedido cruzado vira amizade direto
s.request('ana', 'caio');
assert.strictEqual(s.request('caio', 'ana').status, 'friends');
assert.ok(s.areFriends('ana', 'caio'));

// recusar
s.request('dan', 'ana');
assert.strictEqual(s.decline('ana', 'dan').ok, true);
assert.deepStrictEqual(s.requestsFor('ana'), []);

// mensagens
assert.strictEqual(s.send('ana', 'bia', '   ').error, 'empty');
const m = s.send('ana', 'bia', 'bora jogar?');
assert.ok(m.ok && m.msg.id);
s.send('bia', 'ana', 'bora!');
assert.deepStrictEqual(s.thread('bia', 'ana').map((x) => x.text), ['bora jogar?', 'bora!']);

// snapshot e recuperação após perda do arquivo
const snapAna = s.snapshot('ana');
assert.deepStrictEqual(snapAna.friends.sort(), ['bia', 'caio']);
const snapBia = s.snapshot('bia');
const lost = new Social({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gt-social-lost-')), now: () => ++clock });
assert.deepStrictEqual(lost.merge('ana', snapAna), [], 'um lado só não religa');
assert.ok(!lost.areFriends('ana', 'bia'), 'ninguém se adiciona sozinho na lista do outro');
assert.deepStrictEqual(lost.merge('bia', snapBia), ['ana'], 'os dois lados confirmam: religa');
assert.ok(lost.areFriends('ana', 'bia'));
assert.deepStrictEqual(lost.thread('ana', 'bia').map((x) => x.text), ['bora!'], 'Bia devolveu só o que ela mandou');
lost.merge('ana', snapAna);
assert.deepStrictEqual(lost.thread('ana', 'bia').map((x) => x.text), ['bora jogar?', 'bora!'], 'Ana devolveu a dela; nada duplica');
lost.merge('ana', snapAna);
assert.strictEqual(lost.thread('ana', 'bia').length, 2, 'não duplica');
// um lado desfaz a amizade: a cópia velha do outro não religa sozinha
lost.unfriend('ana', 'bia');
assert.deepStrictEqual(lost.merge('bia', snapBia), []);
assert.ok(!lost.areFriends('ana', 'bia'));

// sair apaga tudo da pessoa e avisa os amigos
const affected = s.erase('ana');
assert.deepStrictEqual(affected.sort(), ['bia', 'caio']);
assert.strictEqual(s.areFriends('bia', 'ana'), false);
assert.deepStrictEqual(s.thread('ana', 'bia'), []);
assert.deepStrictEqual(s.friendsOf('ana'), []);

// persistência
const s2 = new Social({ dataDir: dir });
assert.ok(!s2.areFriends('ana', 'bia'));
fs.rmSync(dir, { recursive: true, force: true });
console.log('social: todos os testes passaram');
