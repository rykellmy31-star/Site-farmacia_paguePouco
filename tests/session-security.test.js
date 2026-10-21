import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { revogarSessoes, invalidarRecuperacoesSenha } from '../src/lib/session-revocation.js';

function criarBanco() {
  const cache = new Map();
  return { collection(name) {
    if (!cache.has(name)) cache.set(name, new Collection({ _commit() {} }, name));
    return cache.get(name);
  } };
}

test('troca voluntária conserva só a sessão autenticada e não afeta outras contas', () => {
  const db = criarBanco();
  for (const [id, type, userId] of [
    ['a1', 'admin', 'a'], ['a2', 'admin', 'a'],
    ['b1', 'admin', 'b'], ['c1', 'customer', 'a'],
  ]) db.collection('sessions').insert({ id, type, userId });
  const revogadas = revogarSessoes(db, 'admin', 'a', { preservar: 'a1' });
  assert.equal(revogadas, 1);
  assert.deepEqual(db.collection('sessions').all().map(x => x.id), ['a1', 'b1', 'c1']);
});

test('reset de senha revoga todas as sessões administrativas do usuário, sem afetar os demais', () => {
  const db = criarBanco();
  db.collection('sessions').insert({ id: 's1', type: 'admin', userId: '1' });
  db.collection('sessions').insert({ id: 's2', type: 'admin', userId: '1' });
  db.collection('sessions').insert({ id: 's3', type: 'admin', userId: '2' });
  assert.equal(revogarSessoes(db, 'admin', '1'), 2);
  assert.deepEqual(db.collection('sessions').all().map(x => x.id), ['s3']);
  assert.equal(revogarSessoes(db, 'admin', '1'), 0);
});

test('troca de senha invalida todos os links de recuperação ainda válidos do cliente', () => {
  const db = criarBanco();
  const tokens = db.collection('passwordTokens');
  tokens.insert({ id: 'p1', clienteId: '1', usado: false });
  tokens.insert({ id: 'p2', clienteId: '1', usado: false });
  tokens.insert({ id: 'p3', clienteId: '1', usado: true });
  tokens.insert({ id: 'p4', clienteId: '2', usado: false });
  assert.equal(invalidarRecuperacoesSenha(db, '1'), 2);
  assert.equal(tokens.get('p1').usado, true);
  assert.ok(tokens.get('p1').usadoEm);
  assert.equal(tokens.get('p2').usado, true);
  assert.equal(tokens.get('p3').usado, true);
  assert.equal(tokens.get('p4').usado, false);
  assert.equal(invalidarRecuperacoesSenha(db, '1'), 0);
});
