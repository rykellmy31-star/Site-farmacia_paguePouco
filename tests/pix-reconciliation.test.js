import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import {
  reconciliarPix, temEstornoPendente, reconciliarEstornos,
  temCheckoutInterrompido, reconciliarCheckoutsInterrompidos,
} from '../src/lib/payments/reconciliation.js';
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


function dbEstorno({ provider = 'internal', status = 'refund_pending',
  financeiro = 'estorno_solicitado', cancelar = true } = {}) {
  const cols = new Map();
  const db = { collection(name) {
    if (!cols.has(name)) cols.set(name, new Collection({ _commit() {} }, name));
    return cols.get(name);
  } };
  db.collection('products').insert({ id: 'p', nome: 'Produto', estoque: { quantidade: 8, reservado: 0 }, vendas: 2 });
  db.collection('orders').insert({
    id: 'o', codigo: 'PP123', statusFinanceiro: financeiro,
    statusOperacional: 'em_separacao', metodoPagamento: 'pix',
    pagamentoId: provider === 'mercadopago' ? 'mp_123' : 'pg',
    totalCentavos: 2000, itens: [{ produtoId: 'p', quantidade: 2 }],
    historico: [], cancelamentoPendenteEstorno: cancelar ?
      { motivo: 'Cancelamento solicitado no painel.', por: 'Administrador' } : null,
  });
  db.collection('payments').insert({
    id: provider === 'mercadopago' ? 'mp_123' : 'pg',
    transacaoId: provider === 'mercadopago' ? '123' : null,
    pedidoId: 'o', provedor: provider, metodo: 'pix', valorCentavos: 2000,
    status, eventos: [],
  });
  return db;
}

test('estorno pendente não cancela pedido nem devolve mercadoria', async () => {
  const db = dbEstorno();
  assert.equal(temEstornoPendente(db), true);
  const a = await reconciliarEstornos(db);
  assert.equal(a.pendentes, 1);
  assert.equal(a.confirmados, 0);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'estorno_solicitado');
  assert.equal(db.collection('orders').get('o').statusOperacional, 'em_separacao');
  assert.equal(db.collection('products').get('p').estoque.quantidade, 8);
});

test('estorno confirmado conclui cancelamento solicitado uma vez, sem reembolso duplicado', async () => {
  const db = dbEstorno({ status: 'refunded' });
  const primeiro = await reconciliarEstornos(db);
  assert.equal(primeiro.confirmados, 1);
  assert.equal(primeiro.cancelados, 1);
  const order = db.collection('orders').get('o');
  assert.equal(order.statusFinanceiro, 'estornado');
  assert.equal(order.statusOperacional, 'cancelado');
  assert.equal(order.cancelamentoPendenteEstorno, null);
  assert.equal(db.collection('products').get('p').estoque.quantidade, 8);
  const events = db.collection('payments').get('pg').eventos.length;
  const second = await reconciliarEstornos(db);
  assert.equal(second.confirmados + second.cancelados, 0);
  assert.equal(db.collection('payments').get('pg').eventos.length, events);
  assert.equal(temEstornoPendente(db), false);
});

test('estorno avulso confirmado não cancela automaticamente pedido', async () => {
  const db = dbEstorno({ status: 'refunded', cancelar: false });
  assert.equal((await reconciliarEstornos(db)).confirmados, 1);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'estornado');
  assert.equal(db.collection('orders').get('o').statusOperacional, 'em_separacao');
  assert.equal(temEstornoPendente(db), false);
});

test('webhook adiantou estado estornado: conciliação termina somente cancelamento pendente', async () => {
  const db = dbEstorno({ status: 'refunded', financeiro: 'estornado' });
  assert.equal(temEstornoPendente(db), true);
  const a = await reconciliarEstornos(db);
  assert.equal(a.confirmados, 0);
  assert.equal(a.cancelados, 1);
  assert.equal(db.collection('orders').get('o').statusOperacional, 'cancelado');
});

test('cobrança incompatível com pedido é preservada para conferência manual', async () => {
  const db = dbEstorno({ status: 'refunded' });
  db.collection('payments').update('pg', { valorCentavos: 1000 });
  const a = await reconciliarEstornos(db);
  assert.equal(a.erros, 1);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'estorno_solicitado');
  assert.equal(db.collection('orders').get('o').statusOperacional, 'em_separacao');
});

test('estorno MP só confirma após consulta autenticada de pagamento com valor e vínculo válidos', async () => {
  const db = dbEstorno({ provider: 'mercadopago' });
  const fetchOriginal = globalThis.fetch;
  const previous = config.payments.mp.accessToken;
  let remoteStatus = 'approved';
  config.payments.mp.accessToken = 'TOKEN_FICTICIO_AUDITORIA';
  globalThis.fetch = async () => ({ ok: true, status: 200,
    text: async () => JSON.stringify({
      id: 123, external_reference: 'PP123', transaction_amount: 20,
      currency_id: 'BRL', metadata: { pedido_id: 'o' }, status: remoteStatus,
    }),
  });
  try {
    let a = await reconciliarEstornos(db);
    assert.equal(a.pendentes, 1);
    assert.equal(db.collection('orders').get('o').statusFinanceiro, 'estorno_solicitado');
    remoteStatus = 'refunded';
    a = await reconciliarEstornos(db);
    assert.equal(a.confirmados, 1);
    assert.equal(a.cancelados, 1);
    assert.equal(db.collection('orders').get('o').statusOperacional, 'cancelado');
  } finally {
    globalThis.fetch = fetchOriginal;
    config.payments.mp.accessToken = previous;
  }
});

test('falha de rede ao consultar estorno real mantém pedido pendente, sem cancelar', async () => {
  const db = dbEstorno({ provider: 'mercadopago' });
  const fetchOriginal = globalThis.fetch;
  const previous = config.payments.mp.accessToken;
  config.payments.mp.accessToken = 'TOKEN_FICTICIO_AUDITORIA';
  globalThis.fetch = async () => { throw new Error('Provedor indisponível'); };
  try {
    const a = await reconciliarEstornos(db);
    assert.equal(a.erros, 1);
    assert.equal(db.collection('orders').get('o').statusFinanceiro, 'estorno_solicitado');
    assert.equal(db.collection('products').get('p').estoque.quantidade, 8);
    assert.equal(temEstornoPendente(db), true);
  } finally {
    globalThis.fetch = fetchOriginal;
    config.payments.mp.accessToken = previous;
  }
});


function compraInterrompida({ idadeMinutos = 10, pagamento = null,
  valorPagamento = 2000, fase = 'criacao_em_andamento' } = {}) {
  const db = dbTeste({ hasPayment: false });
  db.collection('orders').update('o', {
    criadoEm: new Date(Date.now() - idadeMinutos * 60_000).toISOString(),
    pendenciaPagamento: fase,
    historico: [],
  });
  if (pagamento) {
    db.collection('payments').insert({
      id: 'pg', pedidoId: 'o', metodo: 'pix',
      provedor: 'internal', valorCentavos: valorPagamento, status: pagamento,
    });
  }
  return db;
}

test('checkout recente não é cancelado enquanto pode estar criando cobrança', () => {
  const db = compraInterrompida({ idadeMinutos: 1 });
  assert.equal(temCheckoutInterrompido(db), true);
  const r = reconciliarCheckoutsInterrompidos(db);
  assert.equal(r.recentes, 1);
  assert.equal(db.collection('orders').get('o').pendenciaPagamento, 'criacao_em_andamento');
  assert.equal(db.collection('products').get('p').estoque.reservado, 2);
});

test('checkout interrompido sem cobrança entra em conciliação, sem liberar reservas', () => {
  const db = compraInterrompida();
  assert.equal(temCheckoutInterrompido(db), true);
  assert.equal(reconciliarCheckoutsInterrompidos(db).sinalizados, 1);
  const o = db.collection('orders').get('o');
  assert.equal(o.statusFinanceiro, 'pendente');
  assert.equal(o.pendenciaPagamento, 'conciliacao_necessaria');
  assert.equal(o.pagamentoId, null);
  assert.equal(db.collection('products').get('p').estoque.reservado, 2);
  assert.equal(db.collection('stockMovements').count(), 1);
  assert.equal(temCheckoutInterrompido(db), false);
  assert.equal(reconciliarCheckoutsInterrompidos(db).sinalizados, 0,
    'repetição do alarme não duplica alerta de conciliação');
});

test('checkout interrompido vincula cobrança existente por identidade e valor', async () => {
  const db = compraInterrompida({ pagamento: 'approved' });
  const reconciliado = reconciliarCheckoutsInterrompidos(db);
  assert.equal(reconciliado.recuperados, 1);
  assert.equal(db.collection('orders').get('o').pagamentoId, 'pg');
  assert.equal(db.collection('orders').get('o').pendenciaPagamento, null);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'pendente',
    'vínculo local não comprova pagamento sem consulta ao provedor');
  assert.equal((await reconciliarPix(db)).atualizados, 1);
  assert.equal(db.collection('orders').get('o').statusFinanceiro, 'aprovado');
  assert.equal(db.collection('products').get('p').estoque.quantidade, 8);
  assert.equal(db.collection('products').get('p').estoque.reservado, 0);
  assert.equal(reconciliarCheckoutsInterrompidos(db).recuperados, 0);
});

test('cobrança com valor incompatível nunca é associada automaticamente', () => {
  const db = compraInterrompida({ pagamento: 'pending', valorPagamento: 100 });
  const r = reconciliarCheckoutsInterrompidos(db);
  assert.equal(r.recuperados, 0);
  assert.equal(r.sinalizados, 1);
  assert.equal(db.collection('orders').get('o').pagamentoId, null);
  assert.equal(db.collection('products').get('p').estoque.reservado, 2);
});

test('duas cobranças ligadas ao mesmo pedido exigem revisão sem escolher ao acaso', () => {
  const db = compraInterrompida({ pagamento: 'pending' });
  db.collection('payments').insert({
    id: 'pg2', pedidoId: 'o', metodo: 'pix',
    provedor: 'internal', valorCentavos: 2000, status: 'pending',
  });
  assert.equal(reconciliarCheckoutsInterrompidos(db).sinalizados, 1);
  assert.equal(db.collection('orders').get('o').pagamentoId, null);
});
