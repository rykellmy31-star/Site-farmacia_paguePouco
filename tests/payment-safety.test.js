import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Collection } from '../src/lib/store.js';
import { cancelarPedido, atualizarStatusFinanceiro, atualizarStatusOperacional } from '../src/lib/orders.js';
import { getProviderInfo, paymentSettings, createPayment } from '../src/lib/payments/index.js';
import { handleWebhook as webhookMP } from '../src/lib/payments/mercadopago.js';
import { simulateApproval } from '../src/lib/payments/internal.js';
import { config } from '../src/config.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection({ _commit() {} }, name));
    return this.cols.get(name);
  }
}
function order(db, { id, status = 'pendente', qtd = 1, payment = null }) {
  const p = db.collection('orders').insert({
    id, codigo: 'PP-' + id, statusFinanceiro: status,
    statusOperacional: status === 'aprovado' ? 'em_separacao' : 'aguardando_pagamento',
    pagamentoId: payment, itens: [{ produtoId: 'produto', quantidade: qtd }],
    totalCentavos: 1050, historico: [],
  });
  db.collection('stockMovements').insert({ pedidoId: id, produtoId: 'produto', tipo: 'reserva', quantidade: qtd });
  return p;
}

test('configuração do painel prevalece sobre a chave legada', () => {
  const db = new DB();
  db.collection('settings').insert({ id: 'payments', provedor: 'internal', meios: { pix: false } });
  db.collection('settings').insert({ id: 'pagamentos', provedor: 'mercadopago', meios: { pix: true } });
  assert.equal(paymentSettings(db).provedor, 'mercadopago');
  assert.equal(paymentSettings(db).meios.pix, true);
});

test('sem credenciais MP não ocorre fallback silencioso ao pagamento simulado', async () => {
  const db = new DB();
  db.collection('settings').insert({ id: 'pagamentos', provedor: 'mercadopago' });
  const tokenAnterior = config.payments.mp.accessToken;
  try {
    config.payments.mp.accessToken = '';
    assert.equal(getProviderInfo(db).configurado, false);
    assert.equal(getProviderInfo(db).efetivo, 'mercadopago');
    const r = await createPayment(db, { order: { id: 'x', totalCentavos: 100, codigo: 'x' }, method: 'pix' });
    assert.equal(r.ok, false);
    assert.equal(db.collection('payments').count(), 0);
  } finally {
    config.payments.mp.accessToken = tokenAnterior;
  }
});

test('cancelar libera só a reserva do pedido e nunca reativa por evento atrasado', () => {
  const db = new DB();
  db.collection('products').insert({ id: 'produto', nome: 'Teste', estoque: { quantidade: 10, reservado: 5 } });
  order(db, { id: 'a', qtd: 2 });
  order(db, { id: 'b', qtd: 3 });
  assert.equal(cancelarPedido(db, 'a').ok, true);
  assert.equal(db.collection('products').get('produto').estoque.reservado, 3);
  assert.equal(cancelarPedido(db, 'a').ok, false);
  assert.equal(atualizarStatusFinanceiro(db, 'a', 'aprovado').ok, false);
  assert.equal(atualizarStatusOperacional(db, 'a', 'em_separacao').ok, false);
  assert.equal(db.collection('products').get('produto').estoque.reservado, 3);
  assert.equal(atualizarStatusFinanceiro(db, 'b', 'aprovado').ok, true);
  assert.equal(db.collection('products').get('produto').estoque.quantidade, 7);
  assert.equal(db.collection('products').get('produto').estoque.reservado, 0);
  assert.equal(atualizarStatusFinanceiro(db, 'b', 'aprovado').semAlteracao, true);
  assert.equal(db.collection('products').get('produto').estoque.quantidade, 7);
});

test('pedido pago exige confirmação do estorno; sem devolução física automática', () => {
  const db = new DB();
  db.collection('products').insert({ id: 'produto', nome: 'Teste', estoque: { quantidade: 10, reservado: 1 } });
  order(db, { id: 'a', qtd: 1, payment: 'pg' });
  db.collection('payments').insert({ id: 'pg', pedidoId: 'a', status: 'approved', provedor: 'internal', valorCentavos: 1050 });
  assert.equal(atualizarStatusFinanceiro(db, 'a', 'aprovado').ok, true);
  assert.equal(cancelarPedido(db, 'a').ok, false);
  assert.equal(atualizarStatusFinanceiro(db, 'a', 'estornado').ok, false);
  db.collection('payments').update('pg', { status: 'refunded' });
  assert.equal(atualizarStatusFinanceiro(db, 'a', 'estornado').ok, true);
  assert.equal(cancelarPedido(db, 'a').ok, true);
  assert.equal(db.collection('products').get('produto').estoque.quantidade, 9);
  assert.equal(db.collection('products').get('produto').estoque.reservado, 0);
});

test('simulação não pode reaplicar aprovação já finalizada', async () => {
  const db = new DB();
  db.collection('payments').insert({ id: 'p1', status: 'pending', provedor: 'internal', eventos: [] });
  assert.equal((await simulateApproval(db, 'p1')).ok, true);
  const eventos = db.collection('payments').get('p1').eventos.length;
  const duplicado = await simulateApproval(db, 'p1');
  assert.equal(duplicado.ok, true);
  assert.equal(duplicado.duplicado, true);
  assert.equal(db.collection('payments').get('p1').eventos.length, eventos,
    'aprovação repetida nunca altera o histórico');
  assert.equal((await simulateApproval(db, 'p1', { aprovado: false })).ok, false,
    'não permite transformar pagamento aprovado em recusado');
});

test('webhook MP exige assinatura com segredo e verifica valor, moeda e vínculo', async () => {
  const db = new DB();
  db.collection('orders').insert({ id: 'o1', codigo: 'PP1', totalCentavos: 1050, pagamentoId: 'mp_123', statusFinanceiro: 'pendente' });
  db.collection('payments').insert({ id: 'mp_123', pedidoId: 'o1', transacaoId: '123', provedor: 'mercadopago', valorCentavos: 1050, status: 'pending' });
  const conf = { payments: { mp: { accessToken: 'FAKE_TEST_ONLY', webhookSecret: 'FAKE_SECRET' } } };
  const headers = { 'x-request-id': 'req-1' };
  const payload = { type: 'payment', data: { id: '123' } };
  const unsigned = await webhookMP({ db, headers, body: payload, config: conf });
  assert.equal(unsigned.ok, false);
  const ts = '1742505638683';
  const manifest = 'id:123;request-id:req-1;ts:' + ts + ';';
  headers['x-signature'] = 'ts=' + ts + ',v1=' + crypto.createHmac('sha256', 'FAKE_SECRET').update(manifest).digest('hex');
  const fetchOriginal = globalThis.fetch;
  let remote = { id: 123, external_reference: 'PP1', transaction_amount: 10.50, currency_id: 'BRL', metadata: { pedido_id: 'o1' }, status: 'approved' };
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(remote) });
  try {
    assert.equal((await webhookMP({ db, headers, body: payload, dataId: '123', config: conf })).ok, true);
    remote = { ...remote, transaction_amount: 11 };
    assert.equal((await webhookMP({ db, headers, body: payload, dataId: '123', config: conf })).ok, false);
    remote = { ...remote, transaction_amount: 10.50, currency_id: 'USD' };
    assert.equal((await webhookMP({ db, headers, body: payload, dataId: '123', config: conf })).ok, false);

    // Notificação atrasada "approved" pode chegar enquanto um estorno
    // está pendente ou até depois de já confirmado. Não pode voltar a
    // marcar a cobrança como aprovada nem reabrir a venda.
    remote = { ...remote, currency_id: 'BRL', status: 'approved' };
    db.collection('orders').update('o1', { statusFinanceiro: 'estorno_solicitado' });
    db.collection('payments').update('mp_123', { status: 'refund_pending' });
    const atrasadaPendente = await webhookMP({ db, headers, body: payload, dataId: '123', config: conf });
    assert.equal(atrasadaPendente.ok, true);
    assert.equal(atrasadaPendente.status, 'ignored');
    assert.equal(db.collection('payments').get('mp_123').status, 'refund_pending');

    remote = { ...remote, status: 'refunded' };
    const confirmada = await webhookMP({ db, headers, body: payload, dataId: '123', config: conf });
    assert.equal(confirmada.ok, true);
    assert.equal(confirmada.status, 'refunded');
    assert.equal(db.collection('payments').get('mp_123').status, 'refunded');
    db.collection('orders').update('o1', { statusFinanceiro: 'estornado' });
    remote = { ...remote, status: 'approved' };
    const atrasadaDepois = await webhookMP({ db, headers, body: payload, dataId: '123', config: conf });
    assert.equal(atrasadaDepois.ok, true);
    assert.equal(atrasadaDepois.status, 'ignored');
    assert.equal(db.collection('payments').get('mp_123').status, 'refunded');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
