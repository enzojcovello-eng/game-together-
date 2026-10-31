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
assert.strictEqual(reports.report('ana', 'ana', 'photo', 'relato qualquer aqui').error, 'invalid');
assert.deepStrictEqual(reports.report('ana', 'enzo_pro', 'photo', 'foto de perfil imprópria').distinct, 1);
assert.deepStrictEqual(reports.report('ana', 'enzo_pro', 'photo', 'foto de perfil imprópria mesmo').distinct, 1, 'a mesma pessoa não conta duas vezes');
reports.report('bia', 'enzo_pro', 'name', 'nickname ofensivo demais');
const third = reports.report('caio', 'enzo_pro', 'other', 'foto ofensiva e xingamentos');
assert.strictEqual(third.distinct, AUTO_HIDE_AT);
assert.strictEqual(third.autoHide, true);
assert.strictEqual(reports.open().length, 3);
reports.resolve('enzo_pro');
assert.strictEqual(reports.open().length, 0);
assert.strictEqual(new Reports({ dataDir: dir }).list.length, 3, 'persistiu');

// título: só sai com "Sair" da conta ou pelo "tirar" da administração
assert.strictEqual(auth.setTitle('Enzo_Pro', 'Dono').ok, true);
// o token antigo trazia o nome velho por dentro: depois da troca, o servidor renova
const tok = auth.refreshToken(enzo.token);
assert.ok(tok && tok !== enzo.token, 'token renovado com o nome atual');
assert.strictEqual(auth.refreshToken(tok), null, 'já está atualizado');
assert.strictEqual(auth.verify(enzo.token), null, 'token velho sai da lista');
assert.deepStrictEqual(auth.verify(tok), { name: 'ENZO_pro', recovered: false });
const cert = auth.titleCert('enzo_pro');
assert.ok(cert && cert.startsWith('t1.'));
// reinício sem dados: o aparelho devolve o comprovante assinado e o título volta
tick();
const lostA = new Auth({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gt-lt-')), now: () => clock, secret: 's' });
assert.strictEqual(lostA.verify(tok).recovered, true);
assert.strictEqual(lostA.titleOf('enzo_pro'), null);
assert.strictEqual(lostA.restoreTitle(tok, cert), true, 'comprovante válido devolve o título');
assert.strictEqual(lostA.titleOf('enzo_pro'), 'Dono');
assert.strictEqual(lostA.restoreTitle(tok, cert.slice(0, -3) + 'xyz'), false, 'comprovante adulterado não vale');
assert.strictEqual(lostA.restoreTitle(ana.token, cert), false, 'comprovante de outra pessoa não vale');
// Sair tira o título; voltar com o mesmo nickname não traz de volta
assert.strictEqual(auth.logout(tok), 'enzo_pro');
tick();
const volta = auth.claim('Enzo_Pro');
assert.strictEqual(volta.status, 'created');
assert.strictEqual(auth.titleOf('enzo_pro'), null, 'Sair tirou o título');
auth.setTitle('Enzo_Pro', 'Dono');
assert.strictEqual(auth.setTitle('Enzo_Pro', '').title, null);
assert.strictEqual(auth.titleOf('enzo_pro'), null, 'administração tirou');
auth.setTitle('Enzo_Pro', 'Mod');
// banir: conta some e o nickname fica bloqueado
assert.strictEqual(auth.ban('enzo_pro'), true);
assert.strictEqual(auth.verify(volta.token), null);
tick();
assert.strictEqual(auth.claim('enzo_pro').error, 'banned');
assert.strictEqual(auth.rename(ana.token, 'Enzo_Pro').error, 'banned');
assert.strictEqual(new Auth({ dataDir: dir, now: () => clock, secret: 's' }).claim('ENZO_PRO').error, 'banned', 'bloqueio persiste');
assert.strictEqual(auth.titleOf('enzo_pro'), 'Mod', 'banir não mexe no título');

fs.rmSync(dir, { recursive: true, force: true });
console.log('perfil: todos os testes passaram');

// ---- banimento com prazo (conta congelada) e denúncia com relato ----
{
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ban-'));
  let c2 = 9_000_000;
  const a2 = new Auth({ dataDir: dir2, now: () => c2, secret: 's' });
  const r2 = new Reports({ dataDir: dir2, now: () => c2 });
  c2 += 1000; const u = a2.claim('Bagunceiro');
  assert.strictEqual(a2.banFor('ninguem', 1, 'x').error, 'unknown_user');
  const b = a2.banFor('bagunceiro', 2, 'Xingou no chat');
  assert.strictEqual(b.ok, true);
  assert.strictEqual(a2.isBanned('bagunceiro'), true);
  assert.deepStrictEqual(a2.verify(u.token), { name: 'Bagunceiro', recovered: false }, 'a conta continua existindo (congelada)');
  assert.strictEqual(a2.banOf('bagunceiro').reason, 'Xingou no chat');
  c2 += 2 * 60 * 60 * 1000 + 1;
  assert.strictEqual(a2.isBanned('bagunceiro'), false, 'acabou o prazo: libera sozinho');
  a2.banFor('bagunceiro', null, 'para sempre');
  c2 += 365 * 24 * 60 * 60 * 1000;
  assert.strictEqual(a2.isBanned('bagunceiro'), true, 'para sempre não vence');
  assert.strictEqual(new Auth({ dataDir: dir2, now: () => c2, secret: 's' }).isBanned('bagunceiro'), true, 'persiste');
  assert.strictEqual(a2.unban('bagunceiro'), true);
  assert.strictEqual(a2.isBanned('bagunceiro'), false);
  // denúncia precisa de relato; a mesma pessoa atualiza em vez de duplicar; print fica guardado
  assert.strictEqual(r2.report('ana', 'bagunceiro', 'other', 'curto').error, 'note_required');
  const d1 = r2.report('ana', 'bagunceiro', 'name', 'Ficou xingando todo mundo na chamada', 'abc.jpg');
  assert.ok(d1.ok && d1.id);
  const d2 = r2.report('ana', 'bagunceiro', 'name', 'Atualizei: xingou e ameaçou', null);
  assert.strictEqual(d2.id, d1.id, 'mesma denúncia atualizada');
  assert.strictEqual(r2.byId(d1.id).note, 'Atualizei: xingou e ameaçou');
  assert.strictEqual(r2.byId(d1.id).evidence, 'abc.jpg', 'print continua');
  assert.strictEqual(r2.open().length, 1);
  fs.rmSync(dir2, { recursive: true, force: true });
}
console.log('banimento: todos os testes passaram');
