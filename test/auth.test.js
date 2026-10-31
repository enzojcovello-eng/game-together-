'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Auth } = require('../lib/auth');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-auth-'));
const dir = tmp();
let clock = 1_000_000;
const tick = () => (clock += 1000);
const SECRET = 'segredo-de-teste';
const auth = new Auth({ dataDir: dir, now: () => clock, secret: SECRET });

assert.strictEqual(auth.claim('ab').error, 'invalid_name', 'nome curto');
assert.strictEqual(auth.claim('a@b!').error, 'invalid_name', 'caractere inválido');

// primeiro aparelho cria a conta
tick();
const a = auth.claim('Enzo');
assert.strictEqual(a.status, 'created');
assert.ok(a.token.startsWith('v2.'));
assert.deepStrictEqual(auth.verify(a.token), { name: 'Enzo', recovered: false });
assert.strictEqual(auth.verify('v2.x.1.2.assinatura-falsa'), null, 'token forjado não vale');
assert.strictEqual(auth.verify(a.token.slice(0, -2) + 'zz'), null, 'assinatura alterada não vale');

// segundo aparelho vira pedido; recusar
tick();
const b = auth.claim('enzo');
assert.strictEqual(b.status, 'pending');
assert.strictEqual(auth.deny(a.token, b.requestId).ok, true);
assert.strictEqual(auth.requestStatus(b.requestId).status, 'denied');

// aprovar ADICIONA o aparelho: os dois ficam logados
tick();
const c = auth.claim('Enzo');
assert.strictEqual(auth.approve(a.token, c.requestId).devices, 2);
const got = auth.requestStatus(c.requestId);
assert.ok(got.token);
assert.deepStrictEqual(auth.verify(a.token), { name: 'Enzo', recovered: false }, 'aparelho 1 continua');
assert.deepStrictEqual(auth.verify(got.token), { name: 'Enzo', recovered: false }, 'aparelho 2 entrou');
assert.strictEqual(auth.devicesOf(a.token), 2);
// terceiro aparelho, aprovado pelo segundo
tick();
const d = auth.claim('Enzo');
assert.strictEqual(auth.approve(got.token, d.requestId).devices, 3);
const tok3 = auth.requestStatus(d.requestId).token;
assert.ok(tok3);

// reinício normal (arquivo intacto): tudo igual, token de fora não entra
const auth2 = new Auth({ dataDir: dir, now: () => clock, secret: SECRET });
for (const tk of [a.token, got.token, tok3]) assert.deepStrictEqual(auth2.verify(tk), { name: 'Enzo', recovered: false });
tick();
const other = new Auth({ dataDir: tmp(), now: () => clock, secret: SECRET });
const strangerTok = other.claim('Enzo').token;
assert.strictEqual(auth2.verify(strangerTok), null, 'conta carregada do arquivo só aceita os tokens dela');

// o servidor sobe SEM o arquivo: os três aparelhos antigos voltam, cada um na sua hora
tick();
const lost = new Auth({ dataDir: tmp(), now: () => clock, secret: SECRET });
assert.deepStrictEqual(lost.verify(a.token), { name: 'enzo', recovered: true });
lost.restoreName(a.token, 'Enzo');
assert.deepStrictEqual(lost.verify(got.token), { name: 'Enzo', recovered: true }, 'segundo aparelho antigo entra junto');
assert.deepStrictEqual(lost.verify(tok3), { name: 'Enzo', recovered: true });
assert.strictEqual(lost.devicesOf(a.token), 3);
// token emitido DEPOIS do reinício e fora da lista não entra
tick();
const fake = new Auth({ dataDir: tmp(), now: () => clock, secret: SECRET });
const postBoot = fake.claim('Enzo').token;
assert.strictEqual(lost.verify(postBoot), null, 'token novo que não está na lista não vale');

// alguém pegou o nickname depois da perda; os aparelhos antigos tomam de volta
tick();
const lost2 = new Auth({ dataDir: tmp(), now: () => clock, secret: SECRET });
tick();
const intruder = lost2.claim('Enzo');
assert.strictEqual(intruder.status, 'created');
assert.strictEqual(lost2.verify(a.token).recovered, true, 'token antigo vence');
assert.strictEqual(lost2.verify(intruder.token), null, 'intruso perde');
assert.strictEqual(lost2.verify(got.token).recovered, true, 'outro aparelho antigo também entra');

// segredo diferente: token não vale
const outro = new Auth({ dataDir: tmp(), now: () => clock, secret: 'outro' });
assert.strictEqual(outro.verify(a.token), null);

// Sair apaga a conta em todos os aparelhos e libera o nickname
tick();
assert.strictEqual(auth2.logout(got.token), 'enzo');
for (const tk of [a.token, got.token, tok3]) assert.strictEqual(auth2.verify(tk), null, 'nenhum token antigo recupera conta apagada de propósito');
assert.strictEqual(auth2.exists('enzo'), false);
tick();
const e = auth2.claim('Enzo');
assert.strictEqual(e.status, 'created');
const auth3 = new Auth({ dataDir: dir, now: () => clock, secret: SECRET });
assert.deepStrictEqual(auth3.verify(e.token), { name: 'Enzo', recovered: false });
assert.strictEqual(auth3.verify(a.token), null, 'a marca de "saiu" sobrevive ao reinício');

fs.rmSync(dir, { recursive: true, force: true });
console.log('auth: todos os testes passaram');
