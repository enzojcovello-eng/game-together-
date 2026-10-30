'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Auth, INACTIVE_DAYS } = require('../lib/auth');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-auth-'));
let clock = 1_000_000;
const auth = new Auth({ dataDir: dir, now: () => clock });

assert.strictEqual(auth.claim('ab').error, 'invalid_name', 'nome curto');
assert.strictEqual(auth.claim('a@b!').error, 'invalid_name', 'caractere inválido');

// primeiro aparelho cria a conta
const a = auth.claim('Enzo');
assert.strictEqual(a.status, 'created');
assert.ok(a.token && a.name === 'Enzo');
assert.deepStrictEqual(auth.verify(a.token), { name: 'Enzo' });

// segundo aparelho com o mesmo nome vira pedido
const b = auth.claim('enzo');
assert.strictEqual(b.status, 'pending', 'nome em uso vira pedido, sem diferenciar maiúsculas');
assert.deepStrictEqual(auth.pendingFor(a.token).map((r) => r.id), [b.requestId]);
assert.strictEqual(auth.requestStatus(b.requestId).status, 'pending');

// recusar
assert.strictEqual(auth.deny(a.token, b.requestId).ok, true);
assert.strictEqual(auth.requestStatus(b.requestId).status, 'denied');
assert.deepStrictEqual(auth.pendingFor(a.token), []);

// aprovar: a conta passa para o outro aparelho, o token antigo morre
const c = auth.claim('Enzo');
assert.strictEqual(c.status, 'pending');
assert.strictEqual(auth.approve('token-invalido', c.requestId).error, 'not_logged_in');
assert.strictEqual(auth.approve(a.token, c.requestId).ok, true);
const got = auth.requestStatus(c.requestId);
assert.strictEqual(got.status, 'approved');
assert.ok(got.token, 'quem pediu recebe o token');
assert.strictEqual(auth.requestStatus(c.requestId).token, undefined, 'o token é entregue uma vez só');
assert.strictEqual(auth.verify(a.token), null, 'aparelho antigo saiu');
assert.deepStrictEqual(auth.verify(got.token), { name: 'Enzo' });

// sair libera o nome: o próximo entra direto
auth.logout(got.token);
const d = auth.claim('Enzo');
assert.strictEqual(d.status, 'ok', 'conta sem dono entra direto');

// conta parada há mais de INACTIVE_DAYS entra direto (ninguém fica trancado)
clock += (INACTIVE_DAYS + 1) * 24 * 60 * 60 * 1000;
const e = auth.claim('Enzo');
assert.strictEqual(e.status, 'ok', 'conta inativa entra direto');
assert.strictEqual(auth.verify(d.token), null);

// contas e pedidos sobrevivem a reinício
const f = auth.claim('Enzo');
assert.strictEqual(f.status, 'pending');
const auth2 = new Auth({ dataDir: dir, now: () => clock });
assert.deepStrictEqual(auth2.verify(e.token), { name: 'Enzo' });
assert.strictEqual(auth2.pendingFor(e.token).length, 1);
auth2.cancelRequest(f.requestId);
assert.strictEqual(auth2.requestStatus(f.requestId).status, 'unknown');

fs.rmSync(dir, { recursive: true, force: true });
console.log('auth: todos os testes passaram');
