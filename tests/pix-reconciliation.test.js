import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { reconciliarPix } from '../src/lib/payments/reconciliation.js';
import { config } from '../src/config.js';

function dbTeste({ expiraEm, status = 'pending', provider = 'internal', hasPayment = true } = {}) {
  const cols = new Map();
  const db = { collection(name) {
    if (!cols.has(name)) cols.set(name, new Collection({ _commit() {} }, name));
    return cols.get(name);
  } };
  db.collection('products').insert({ id: 'p', nome: 'Produto', estoque: { quantidade: 10, reservado: 2 }, vendas: 0 });
  db.collection('orders').insert({
    id: 'o', codigo: 'PP123', statusFinanceiro: 'pendente', statusOperacional: 'aguardando_pagamento',
    metodoPagamento: 'pix', pagamentoId: hasPayment ? 'pg' : null,
    totalCentavos: 2000, itens: [{ produtoId: 'p', quantidade: 2 }], historico: [],
  });
  db.collection('stockMovements').insert({ produtoId: 'p', pedidoId: 'o', tipo: 'reserva', quantidade: 2 });
  if (hasPayment) db.collection('payments').insert({
    id: 'pg', pedidoId: 'o', provedor: provider, metodo: 'pix',
    status, valorCentavos: 2000, pixExpiraEm: expiraEm, eventos: [],
  });
  return db;
}

test('Pix simulado expirado libera somente uma vez a reserva do pedido', async () => {
  const db = dbTeste({ expiraEm: new Date(Date.now() - 60_000).toISOString() });
  const a = await reconciliarPix(db);
  assert.equal(a.atualizados, 1);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'expirado');
  assert.equal(db.collection('products').get('p').estoque.reservado, 0);
  const b = await reconciliarPix(db);
  assert.equal(b.atualizados, 0);
  assert.equal(db.collection('stockMovements').find((m) => m.tipo === 'liberacao').length, 1);
});

test('Pix pendente e válido mantém a reserva', async () => {
  const db = dbTeste({ expiraEm: new Date(Date.now() + 30 * 60_000).toISOString() });
  const a = await reconciliarPix(db);
  assert.equal(a.pendentes, 1);
  assert.equal(db.collection('products').get('p').estoque.reservado, 2);
});

test('Pix aprovado previamente no provedor baixa estoque uma única vez', async () => {
  const db = dbTeste({ status: 'approved' });
  assert.equal((await reconciliarPix(db)).atualizados, 1);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'aprovado');
  assert.equal(db.collection('products').get('p').estoque.quantidade, 8);
  assert.equal((await reconciliarPix(db)).atualizados, 0);
  assert.equal(db.collection('products').get('p').estoque.quantidade, 8);
});

test('sem vínculo de pagamento não presume expiração', async () => {
  const db = dbTeste({ hasPayment: false });
  assert.equal((await reconciliarPix(db)).verificados, 0);
  assert.equal(db.collection('products').get('p').estoque.reservado, 2);
});

test('falha no provedor real preserva reserva e exige conciliação', async () => {
  const db = dbTeste({ provider: 'mercadopago', expiraEm: new Date(Date.now() - 60_000).toISOString() });
  const oldFetch = globalThis.fetch, oldToken = config.payments.mp.accessToken;
  config.payments.mp.accessToken = 'FAKE_TOKEN_FOR_TESTING';
  globalThis.fetch = async () => { throw new Error('rede indisponível'); };
  try {
    const r = await reconciliarPix(db);
    assert.equal(r.erros, 1);
    assert.equal(db.collection('orders').get('o').statusFinanceiro, 'pendente');
    assert.equal(db.collection('products').get('p').estoque.reservado, 2);
  } finally {
    config.payments.mp.accessToken = oldToken;
    globalThis.fetch = oldFetch;
  }
});
