import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import {
  atualizarStatusOperacional, atualizarStatusFinanceiro, cancelarPedido,
} from '../src/lib/orders.js';
import { enfileirarAvisoPedido } from '../src/lib/order-notifications.js';

class DB {
  constructor() { this.tables = new Map(); }
  collection(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Collection({ _commit() {} }, name));
    return this.tables.get(name);
  }
}

function pedidoTeste({ financeiro = 'pendente', operacional = 'aguardando_pagamento',
  email = 'cliente@exemplo.test', codigo = 'PP-EXEMPLO' } = {}) {
  const db = new DB();
  db.collection('products').insert({
    id: 'produto', estoque: { quantidade: 10, reservado: financeiro === 'aprovado' ? 0 : 2 },
    vendas: 0,
  });
  db.collection('orders').insert({
    id: 'pedido', codigo, clienteId: 'cliente', cliente: { nome: 'Cliente Teste', email },
    statusFinanceiro: financeiro, statusOperacional: operacional,
    itens: [{ produtoId: 'produto', quantidade: 2 }], historico: [],
    totalCentavos: 2000,
  });
  if (financeiro !== 'aprovado') db.collection('stockMovements').insert({
    id: 'reserva', pedidoId: 'pedido', produtoId: 'produto',
    tipo: 'reserva', quantidade: 2,
  });
  return db;
}

test('aprovação registra aviso pendente apenas uma vez, sem afirmar entrega', () => {
  const db = pedidoTeste();
  const aprovado = atualizarStatusFinanceiro(db, 'pedido', 'aprovado');
  assert.equal(aprovado.ok, true);
  const avisos = db.collection('mailOutbox').all();
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].assunto, /Pagamento confirmado/);
  assert.equal(avisos[0].meta.eventKey, 'pedido:pedido:financeiro:aprovado');
  assert.equal(avisos[0].status, 'fila');
  assert.equal(avisos[0].arquivo, null);
  assert.ok(!avisos[0].enviadoEm, 'não há confirmação de entrega sem integração de e-mail');
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'aprovado').semAlteracao, true);
  assert.equal(db.collection('mailOutbox').count(), 1);
  assert.equal(db.collection('products').get('produto').estoque.quantidade, 8);
});

test('rastreamento repetido não duplica envio; avanço de entrega registra um aviso por etapa', () => {
  const db = pedidoTeste({ financeiro: 'aprovado', operacional: 'em_separacao' });
  const primeiro = atualizarStatusOperacional(db, 'pedido', 'enviado', {
    rastreio: { codigo: 'OBJ-123' },
  });
  assert.equal(primeiro.ok, true);
  assert.equal(db.collection('mailOutbox').count(), 1);
  assert.match(db.collection('mailOutbox').all()[0].assunto, /Pedido enviado/);
  assert.equal(atualizarStatusOperacional(db, 'pedido', 'enviado', {
    rastreio: { codigo: 'OBJ-123' },
  }).ok, true);
  assert.equal(db.collection('mailOutbox').count(), 1);
  assert.equal(atualizarStatusOperacional(db, 'pedido', 'entregue').ok, true);
  assert.equal(db.collection('mailOutbox').count(), 2);
  assert.equal(atualizarStatusOperacional(db, 'pedido', 'preparando_envio').ok, false);
  assert.equal(db.collection('mailOutbox').count(), 2);
});

test('recusa e cancelamento geram avisos distintos uma única vez', () => {
  const db = pedidoTeste();
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'recusado').ok, true);
  assert.equal(cancelarPedido(db, 'pedido').ok, true);
  assert.equal(cancelarPedido(db, 'pedido').ok, false);
  assert.deepEqual(db.collection('mailOutbox').all().map(x => x.meta.eventKey), [
    'pedido:pedido:financeiro:recusado',
    'pedido:pedido:operacional:cancelado',
  ]);
  assert.ok(db.collection('mailOutbox').all().every(x => x.status === 'fila'));
});

test('repetição de evento de notificação é idempotente, mesmo se webhook repetir', () => {
  const db = pedidoTeste({ financeiro: 'aprovado' });
  const pedido = db.collection('orders').get('pedido');
  assert.equal(enfileirarAvisoPedido(db, pedido, 'financeiro', 'aprovado').enfileirado, true);
  const repeated = enfileirarAvisoPedido(db, pedido, 'financeiro', 'aprovado');
  assert.equal(repeated.enfileirado, false);
  assert.equal(repeated.duplicado, true);
  assert.equal(db.collection('mailOutbox').count(), 1);
  assert.equal(enfileirarAvisoPedido(db, pedido, 'operacional', 'inexistente').enfileirado, false);
  assert.equal(db.collection('mailOutbox').count(), 1);
});

test('nunca forma HTML ativo de código de pedido nem enfileira destinatário inválido', () => {
  const db = pedidoTeste({ codigo: '<img src=x onerror=alert(1)>' });
  assert.equal(enfileirarAvisoPedido(db, db.collection('orders').get('pedido'), 'financeiro', 'aprovado').enfileirado, true);
  const aviso = db.collection('mailOutbox').all()[0];
  assert.doesNotMatch(aviso.html, /<img/);
  assert.match(aviso.html, /&lt;img/);
  db.collection('orders').update('pedido', { cliente: { email: 'invalido\nBcc:outro@example.test' } });
  assert.equal(enfileirarAvisoPedido(db, db.collection('orders').get('pedido'), 'financeiro', 'recusado').enfileirado, false);
  assert.equal(db.collection('mailOutbox').count(), 1);
});
