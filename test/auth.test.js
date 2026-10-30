'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Auth } = require('../lib/auth');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-auth-'));
const auth = new Auth({ dataDir: dir });

assert.strictEqual(auth.register('ab', 'senha123').error, 'invalid_name', 'nome curto');
assert.strictEqual(auth.register('Enzo', '123').error, 'weak_password', 'senha curta');
const r = auth.register('Enzo', 'senha123');
assert.ok(r.token && r.name === 'Enzo');
assert.strictEqual(auth.register('enzo', 'outra123').error, 'name_taken', 'nome é único sem diferenciar maiúsculas');
assert.deepStrictEqual(auth.verify(r.token), { name: 'Enzo' });
assert.strictEqual(auth.verify('nada'), null);
assert.strictEqual(auth.login('Enzo', 'errada', '1.1.1.1').error, 'bad_credentials');
assert.strictEqual(auth.login('Ninguem', 'senha123', '1.1.1.1').error, 'bad_credentials');
const l = auth.login('enzo', 'senha123', '1.1.1.1');
assert.strictEqual(l.name, 'Enzo');
assert.deepStrictEqual(auth.verify(l.token), { name: 'Enzo' });

// senha não fica em texto no arquivo
const raw = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
assert.ok(!raw.includes('senha123'));

// contas sobrevivem a reinício
const auth2 = new Auth({ dataDir: dir });
assert.deepStrictEqual(auth2.verify(l.token), { name: 'Enzo' });
auth2.logout(l.token);
assert.strictEqual(auth2.verify(l.token), null);

// bloqueio após muitas tentativas erradas
for (let i = 0; i < 10; i++) auth2.login('Enzo', 'x', '2.2.2.2');
assert.strictEqual(auth2.login('Enzo', 'senha123', '2.2.2.2').error, 'too_many_attempts');

fs.rmSync(dir, { recursive: true, force: true });
console.log('auth: todos os testes passaram');
