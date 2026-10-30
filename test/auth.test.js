'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Auth } = require('../lib/auth');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-auth-'));
let clock = 1_000_000;
const tick = () => (clock += 1000);
const auth = new Auth({ dataDir: dir, now: () => clock, secret: 'segredo-de-teste' });

assert.strictEqual(auth.claim('ab').error, 'invalid_name', 'nome curto');
assert.strictEqual(auth.claim('a@b!').error, 'invalid_name', 'caractere inválido');

// primeiro aparelho cria a conta
const a = auth.claim('Enzo');
assert.strictEqual(a.status, 'created');
assert.ok(a.token.startsWith('v2.'));
assert.deepStrictEqual(auth.verify(a.token), { name: 'Enzo', recovered: false });
assert.strictEqual(auth.verify('v2.x.1.2.assinatura-falsa'), null, 'token forjado não vale');
assert.strictEqual(auth.verify(a.token.slice(0, -2) + 'zz'), null, 'assinatura alterada não vale');

// segundo aparelho com o mesmo nickname vira pedido; recusar e aprovar
tick();
const b = auth.claim('enzo');
assert.strictEqual(b.status, 'pending');
assert.strictEqual(auth.deny(a.token, b.requestId).ok, true);
assert.strictEqual(auth.requestStatus(b.requestId).status, 'denied');
tick();
const c = auth.claim('Enzo');
assert.strictEqual(auth.approve(a.token, c.requestId).ok, true);
const got = auth.requestStatus(c.requestId);
assert.ok(got.token);
assert.strictEqual(auth.verify(a.token), null, 'aparelho antigo saiu de verdade (token mais novo que a conta, não recupera)');
assert.deepStrictEqual(auth.verify(got.token), { name: 'Enzo', recovered: false });

// o servidor perde o arquivo: o token assinado recria a conta
tick();
const lost = new Auth({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gt-lost-')), now: () => clock, secret: 'segredo-de-teste' });
assert.deepStrictEqual(lost.verify(got.token), { name: 'enzo', recovered: true });
lost.restoreName(got.token, 'Enzo');
assert.deepStrictEqual(lost.verify(got.token), { name: 'Enzo', recovered: false }, 'depois de recuperar vira conta normal');

// alguém pega o nickname depois da perda; o dono original (token mais antigo) toma de volta
tick();
const lost2 = new Auth({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gt-lost2-')), now: () => clock, secret: 'segredo-de-teste' });
const intruder = lost2.claim('Enzo');
assert.strictEqual(intruder.status, 'created');
assert.strictEqual(lost2.verify(got.token).recovered, true, 'token antigo vence');
assert.strictEqual(lost2.verify(intruder.token), null, 'intruso perde');

// segredo diferente: token não vale
const other = new Auth({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gt-other-')), now: () => clock, secret: 'outro' });
assert.strictEqual(other.verify(got.token), null);

// sair apaga a conta e libera o nickname
assert.strictEqual(auth.logout(got.token), 'enzo');
assert.strictEqual(auth.verify(got.token), null, 'token antigo não recupera conta apagada de propósito');
assert.strictEqual(auth.exists('enzo'), false);
tick();
const d = auth.claim('Enzo');
assert.strictEqual(d.status, 'created');

// contas sobrevivem a reinício normal
const auth2 = new Auth({ dataDir: dir, now: () => clock, secret: 'segredo-de-teste' });
assert.deepStrictEqual(auth2.verify(d.token), { name: 'Enzo', recovered: false });

fs.rmSync(dir, { recursive: true, force: true });
console.log('auth: todos os testes passaram');
