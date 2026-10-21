import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { cancelarPedido, atualizarStatusFinanceiro, cancelarCriacaoComRecusaDefinitiva } from '../src/lib/orders.js';
import { createPayment as criarCobrancaMP } from '../src/lib/payments/mercadopago.js';
import { renovarCestaAposPedido } from '../src/routes/checkout.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection({ _commit() {} }, name));
    return this.cols.get(name);
  }
}

function tentativa({ status = 'pendente', quantidade = 2 } = {}) {
  const db = new DB();
  db.collection('products').insert({
    id: 'p1', nome: 'Produto', estoque: { quantidade: 10, reservado: status === 'aprovado' ? 0 : quantidade },
  });
  db.collection('coupons').insert({ id: 'cupom', codigo: 'CUPOM-UNICO', usoMaximo: 1, usos: 1, ativo: true });
  db.collection('orders').insert({
    id: 'pedido', codigo: 'PP-TESTE', statusFinanceiro: status,
    statusOperacional: status === 'aprovado' ? 'em_separacao' : 'aguardando_pagamento',
    itens: [{ produtoId: 'p1', quantidade }],
    cupom: { cupomId: 'cupom', codigo: 'CUPOM-UNICO', desconto: 100 },
    cupomUsoReservado: true, cupomUsoLiberadoEm: null,
    totalCentavos: 1900, historico: [],
  });
  if (status !== 'aprovado') {
    db.collection('stockMovements').insert({
      id: 'reserva', produtoId: 'p1', pedidoId: 'pedido', tipo: 'reserva', quantidade,
    });
  }
  return db;
}

test('falha definitiva de cobrança libera estoque e uso de cupom só uma vez', () => {
  const db = tentativa();
  assert.equal(cancelarPedido(db, 'pedido').ok, true);
  assert.equal(db.collection('products').get('p1').estoque.reservado, 0);
  assert.equal(db.collection('coupons').get('cupom').usos, 0);
  const pedido = db.collection('orders').get('pedido');
  assert.equal(pedido.statusFinanceiro, 'recusado');
  assert.ok(pedido.cupomUsoLiberadoEm);
  assert.equal(cancelarPedido(db, 'pedido').ok, false);
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'recusado').semAlteracao, true);
  assert.equal(db.collection('coupons').get('cupom').usos, 0,
    'não devolve o mesmo uso de cupom duas vezes');
});

test('cobrança expirada devolve cupom sem permitir aprovação tardia', () => {
  const db = tentativa();
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'expirado').ok, true);
  assert.equal(db.collection('products').get('p1').estoque.reservado, 0);
  assert.equal(db.collection('coupons').get('cupom').usos, 0);
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'aprovado').ok, false);
});

test('pagamento aprovado não devolve o uso legítimo da promoção', () => {
  const db = tentativa();
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'aprovado').ok, true);
  assert.equal(db.collection('coupons').get('cupom').usos, 1);
  assert.equal(db.collection('orders').get('pedido').cupomUsoLiberadoEm, null);
});

test('pedido antigo sem indicador de cupom não altera contagem ao cancelar', () => {
  const db = tentativa();
  db.collection('orders').update('pedido', { cupomUsoReservado: undefined });
  assert.equal(cancelarPedido(db, 'pedido').ok, true);
  assert.equal(db.collection('coupons').get('cupom').usos, 1);
});

async function respostaProvedor(status) {
  const db = new DB();
  const fetchAntes = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return { ok: status >= 200 && status < 300, status,
      async text() { return JSON.stringify({ message: 'Falha simulada para auditoria' }); } };
  };
  try {
    const resultado = await criarCobrancaMP({
      db, order: { id: 'pedido', codigo: 'PP-AUDITORIA', totalCentavos: 1980 },
      method: 'pix', payer: { nome: 'Teste', email: 'teste@example.invalid' },
      config: { payments: { mp: { accessToken: 'TOKEN_FICTICIO_NAO_PUBLICAR' } } },
      returnUrls: { notificationUrl: 'https://site.example.invalid/webhooks/mercadopago' },
    });
    return { resultado, chamadas, pagamentos: db.collection('payments').count() };
  } finally {
    globalThis.fetch = fetchAntes;
  }
}

test('Mercado Pago HTTP 500, 408 e 429 são indeterminados, sem criar cobrança falsa', async () => {
  for (const status of [500, 503, 408, 429]) {
    const { resultado, chamadas, pagamentos } = await respostaProvedor(status);
    assert.equal(resultado.ok, false);
    assert.equal(resultado.indeterminado, true, 'HTTP ' + status + ' não comprova recusa');
    assert.equal(pagamentos, 0);
    assert.equal(chamadas.length, 1);
    assert.ok(chamadas[0].opcoes.headers['X-Idempotency-Key']);
  }
});

test('Mercado Pago HTTP 400 permanece falha definitiva e não bloqueia novo checkout', async () => {
  const { resultado, pagamentos } = await respostaProvedor(400);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.indeterminado, false);
  assert.equal(pagamentos, 0);
});

test('timeout ou falha de rede exigem conciliação, sem criar pagamento fictício', async () => {
  const db = new DB();
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Timeout simulado'); };
  try {
    await assert.rejects(criarCobrancaMP({
      db, order: { id: 'p', codigo: 'PP-REDE', totalCentavos: 1000 },
      method: 'pix', payer: { email: 'teste@example.invalid' },
      config: { payments: { mp: { accessToken: 'TOKEN_FICTICIO_NAO_PUBLICAR' } } },
    }), /Timeout simulado/);
    assert.equal(db.collection('payments').count(), 0);
  } finally {
    globalThis.fetch = fetchAntes;
  }
});

test('recusa comprovada libera reserva e cupom durante criação da cobrança', () => {
  const db = tentativa();
  db.collection('orders').update('pedido', { pendenciaPagamento: 'criacao_em_andamento' });
  assert.equal(cancelarPedido(db, 'pedido').ok, false,
    'cancelamento normal segue bloqueado enquanto a cobrança é incerta');
  const r = cancelarCriacaoComRecusaDefinitiva(db, 'pedido');
  assert.equal(r.ok, true);
  assert.equal(db.collection('orders').get('pedido').statusFinanceiro, 'recusado');
  assert.equal(db.collection('orders').get('pedido').statusOperacional, 'cancelado');
  assert.equal(db.collection('products').get('p1').estoque.reservado, 0);
  assert.equal(db.collection('coupons').get('cupom').usos, 0);
  assert.ok(db.collection('orders').get('pedido').cupomUsoLiberadoEm);
  assert.equal(cancelarCriacaoComRecusaDefinitiva(db, 'pedido').ok, false,
    'segundo rollback não gera outra saída nem devolve cupom duas vezes');
  assert.equal(db.collection('stockMovements').find(m => m.tipo === 'liberacao').length, 1);
});

test('recusa não permite liberar estoque se pagamento já foi registrado', () => {
  const db = tentativa();
  db.collection('orders').update('pedido', { pendenciaPagamento: 'criacao_em_andamento' });
  db.collection('payments').insert({
    id: 'pagamento', pedidoId: 'pedido', provedor: 'mercadopago',
    status: 'pending', valorCentavos: 1900,
  });
  assert.equal(cancelarCriacaoComRecusaDefinitiva(db, 'pedido').ok, false);
  assert.equal(db.collection('orders').get('pedido').pendenciaPagamento, 'criacao_em_andamento');
  assert.equal(db.collection('orders').get('pedido').statusFinanceiro, 'pendente');
  assert.equal(db.collection('products').get('p1').estoque.reservado, 2);
  assert.equal(db.collection('coupons').get('cupom').usos, 1);
});

test('resultado financeiro indeterminado não executa rollback mesmo sem vínculo', () => {
  const db = tentativa();
  db.collection('orders').update('pedido', { pendenciaPagamento: 'conciliacao_necessaria' });
  assert.equal(cancelarCriacaoComRecusaDefinitiva(db, 'pedido').ok, false);
  assert.equal(cancelarPedido(db, 'pedido').ok, false);
  assert.equal(db.collection('products').get('p1').estoque.reservado, 2);
  assert.equal(db.collection('coupons').get('cupom').usos, 1);
});

test('inconsistência na reserva bloqueia rollback e mantém conciliação manual', () => {
  const db = tentativa();
  db.collection('orders').update('pedido', { pendenciaPagamento: 'criacao_em_andamento' });
  db.collection('products').update('p1', { estoque: { quantidade: 10, reservado: 0 } });
  const r = cancelarCriacaoComRecusaDefinitiva(db, 'pedido');
  assert.equal(r.ok, false);
  assert.equal(db.collection('orders').get('pedido').pendenciaPagamento, 'conciliacao_necessaria');
  assert.equal(db.collection('orders').get('pedido').statusFinanceiro, 'pendente');
  assert.equal(db.collection('coupons').get('cupom').usos, 1);
});

test('checkout incerto troca cookie e conserva pedido/cesta original para auditoria', () => {
  const db = new DB();
  db.collection('carts').insert({
    id: 'c_original', clienteId: 'cliente', itens: [{ produtoId: 'p1', quantidade: 2 }],
    frete: { endereco: { cep: '01001000' } }, cupom: { codigo: 'DESCONTO' },
  });
  db.collection('orders').insert({
    id: 'pedido', clienteId: 'cliente', carrinhoId: 'c_original',
    pendenciaPagamento: 'conciliacao_necessaria', statusFinanceiro: 'pendente',
  });
  const cookies = [];
  const res = { cookie: (...args) => cookies.push(args) };
  const novo = renovarCestaAposPedido(db, res, 'cliente');
  assert.notEqual(novo.id, 'c_original');
  assert.equal(novo.clienteId, 'cliente');
  assert.deepEqual(novo.itens, []);
  assert.equal(novo.cupom, null);
  assert.equal(novo.frete, null);
  assert.equal(cookies[0][1], novo.id, 'navegador recebe nova cesta');
  assert.equal(db.collection('orders').get('pedido').carrinhoId, 'c_original');
  assert.equal(db.collection('orders').get('pedido').statusFinanceiro, 'pendente');
  assert.equal(db.collection('carts').get('c_original').itens[0].quantidade, 2);
  assert.equal(db.collection('carts').get('c_original').cupom.codigo, 'DESCONTO');
});

test('cada retomada cria novo identificador de cesta sem duplicar pedido', () => {
  const db = new DB();
  const res = { cookie() {} };
  const primeira = renovarCestaAposPedido(db, res, 'c1');
  const segunda = renovarCestaAposPedido(db, res, 'c1');
  assert.notEqual(primeira.id, segunda.id);
  assert.equal(db.collection('orders').count(), 0);
  assert.equal(db.collection('carts').count(), 2);
});
