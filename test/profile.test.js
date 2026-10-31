'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Auth } = require('../lib/auth');
const { Social } = require('../lib/social');
const { Reports, AUTO_HIDE_AT } = require('../lib/reports');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-profile-'));
let clock = 5_000_000; const tick = () => (clock += 1000);
const auth = new Auth({ dataDir: dir, now: () => clock, secret: 's' });
const social = new Social({ dataDir: dir, now: () => ++clock });
const reports = new Reports({ dataDir: dir, now: () => clock });

// foto de perfil
tick(); const enzo = auth.claim('Enzo');
tick(); const ana = auth.claim('Ana');
assert.strictEqual(auth.setAvatar(enzo.token, { type: 'cover', id: 'fortnite' }).ok, true);
assert.deepStrictEqual(auth.avatarOf('enzo'), { type: 'cover', id: 'fortnite' });
assert.strictEqual(auth.setAvatar('nada', { type: 'cover', id: 'x' }).error, 'not_logged_in');

// amizade + conversa, depois troca de nickname mantendo tudo
social.request('enzo', 'ana'); social.accept('ana', 'enzo');
social.send('enzo', 'ana', 'oi'); social.send('ana', 'enzo', 'oi!');
tick();
assert.strictEqual(auth.rename(enzo.token, 'Ana').error, 'name_taken');
assert.strictEqual(auth.rename(enzo.token, 'a!').error, 'invalid_name');
const r = auth.rename(enzo.token, 'Enzo_Pro');
assert.deepStrictEqual([r.ok, r.oldKey, r.newKey, r.name], [true, 'enzo', 'enzo_pro', 'Enzo_Pro']);
assert.deepStrictEqual(auth.verify(enzo.token), { name: 'Enzo_Pro', recovered: false }, 'mesmo token continua valendo');
assert.strictEqual(auth.exists('enzo'), false);
assert.deepStrictEqual(auth.avatarOf('enzo_pro'), { type: 'cover', id: 'fortnite' }, 'foto vai junto');
assert.deepStrictEqual(social.rename('enzo', 'enzo_pro'), ['ana']);
assert.ok(social.areFriends('enzo_pro', 'ana') && social.areFriends('ana', 'enzo_pro'), 'amizade continua');
assert.ok(!social.areFriends('enzo', 'ana'));
assert.deepStrictEqual(social.thread('enzo_pro', 'ana').map((m) => `${m.from}:${m.text}`), ['enzo_pro:oi', 'ana:oi!'], 'conversa continua, com o nome novo');
assert.strictEqual(social.current('enzo'), 'enzo_pro', 'nome antigo resolve para o novo');
// a cópia antiga da Ana ainda fala em "enzo": a recuperação entende
const snapAna = { friends: ['enzo'], dms: { enzo: social.thread('ana', 'enzo_pro') } };
const lost = new Social({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gt-pl-')), now: () => ++clock });
lost.aliases.set('enzo', 'enzo_pro');
lost.merge('ana', snapAna); lost.merge('enzo_pro', { friends: ['ana'], dms: {} });
assert.ok(lost.areFriends('ana', 'enzo_pro'), 'cópia com nome antigo religa pelo nome novo');
// o nome antigo fica livre para outra pessoa, e um token velho não recupera a conta por ele
tick(); const novo = auth.claim('Enzo');
assert.strictEqual(novo.status, 'created');
// trocar só maiúsculas mantém a chave
assert.strictEqual(auth.rename(enzo.token, 'ENZO_pro').same, true);
assert.strictEqual(auth.nameOf('enzo_pro'), 'ENZO_pro');

// denúncias: 3 pessoas diferentes derrubam a foto
assert.strictEqual(reports.report('ana', 'ana', 'photo').error, 'invalid');
assert.deepStrictEqual(reports.report('ana', 'enzo_pro', 'photo').distinct, 1);
assert.deepStrictEqual(reports.report('ana', 'enzo_pro', 'photo').distinct, 1, 'a mesma pessoa não conta duas vezes');
reports.report('bia', 'enzo_pro', 'name');
const third = reports.report('caio', 'enzo_pro', 'other', 'foto ofensiva');
assert.strictEqual(third.distinct, AUTO_HIDE_AT);
assert.strictEqual(third.autoHide, true);
assert.strictEqual(reports.open().length, 3);
reports.resolve('enzo_pro');
assert.strictEqual(reports.open().length, 0);
assert.strictEqual(new Reports({ dataDir: dir }).list.length, 3, 'persistiu');

// banir: conta some e o nickname fica bloqueado
assert.strictEqual(auth.ban('enzo_pro'), true);
assert.strictEqual(auth.verify(enzo.token), null);
tick();
assert.strictEqual(auth.claim('enzo_pro').error, 'banned');
assert.strictEqual(auth.rename(ana.token, 'Enzo_Pro').error, 'banned');
assert.strictEqual(new Auth({ dataDir: dir, now: () => clock, secret: 's' }).claim('ENZO_PRO').error, 'banned', 'bloqueio persiste');

fs.rmSync(dir, { recursive: true, force: true });
console.log('perfil: todos os testes passaram');
