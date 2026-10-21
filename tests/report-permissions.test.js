import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { validarReservaParaAprovacao, atualizarStatusFinanceiro, produtosMaisVendidos, vendasPorDia, metricas } from '../src/lib/orders.js';
import { can } from '../src/lib/permissions.js';

class TestDB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection({ _commit() {} }, name));
    return this.cols.get(name);
  }
}

test('relatório de produtos respeita início e fim, diferente do ranking global', () => {
  const db = new TestDB();
  db.collection('orders').insert({
    id: 'a', statusFinanceiro: 'aprovado', criadoEm: '2026-09-10T10:00:00.000Z',
    totalCentavos: 75000, itens: [{ produtoId: 'A', nome: 'Produto Antigo', quantidade: 30, subtotalCentavos: 75000 }],
  });
  db.collection('orders').insert({
    id: 'b', statusFinanceiro: 'aprovado', criadoEm: '2026-10-15T10:00:00.000Z',
    totalCentavos: 1500, itens: [{ produtoId: 'B', nome: 'Produto Novo', quantidade: 2, subtotalCentavos: 1500 }],
  });
  db.collection('orders').insert({
    id: 'c', statusFinanceiro: 'recusado', criadoEm: '2026-10-15T10:00:00.000Z',
    totalCentavos: 99900, itens: [{ produtoId: 'C', nome: 'Produto Não Pago', quantidade: 100, subtotalCentavos: 99900 }],
  });
  assert.equal(produtosMaisVendidos(db, 1)[0].produtoId, 'A', 'ranking global mantém histórico');
  const outubro = produtosMaisVendidos(db, 10, { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepEqual(outubro.map(p => p.produtoId), ['B'], 'ranking do período não inclui pedidos antigos ou recusados');
  assert.equal(metricas(db, { de: '2026-10-01T00:00:00Z', ate: '2026-10-31T23:59:59Z' }).receitaCentavos, 1500);
  const grafico = vendasPorDia(db, 3, new Date('2026-10-16T00:00:00Z'));
  assert.deepEqual(grafico.map(d => d.data), ['2026-10-14', '2026-10-15', '2026-10-16']);
  assert.equal(grafico[1].receitaCentavos, 1500);
});

test('dois itens repetidos não podem aprovar estoque insuficiente', () => {
  const db = new TestDB();
  db.collection('products').insert({ id: 'P', nome: 'Produto', estoque: { quantidade: 1, reservado: 1 } });
  db.collection('orders').insert({
    id: 'pedido', statusFinanceiro: 'pendente', statusOperacional: 'aguardando_pagamento',
    codigo: 'PP999', itens: [{ produtoId: 'P', quantidade: 1 }, { produtoId: 'P', quantidade: 1 }],
    historico: [],
  });
  db.collection('stockMovements').insert({
    id: 'movimento', pedidoId: 'pedido', produtoId: 'P', tipo: 'reserva', quantidade: 1,
  });
  const preflight = validarReservaParaAprovacao(db, 'pedido');
  assert.equal(preflight.ok, false);
  assert.equal(atualizarStatusFinanceiro(db, 'pedido', 'aprovado').ok, false);
  assert.equal(db.collection('orders').get('pedido').statusFinanceiro, 'pendente');
  assert.equal(db.collection('products').get('P').estoque.quantidade, 1);
  assert.equal(db.collection('stockMovements').count(), 1, 'falha não causa saída de estoque');
});

test('matriz de permissões restringe finanças e backups a perfis autorizados', () => {
  const atendente = { role: 'atendente' };
  const gerente = { role: 'gerente' };
  const superadmin = { role: 'super_admin' };
  assert.equal(can(atendente, 'pedidos.ver'), true);
  assert.equal(can(atendente, 'pagamentos.estornar'), false);
  assert.equal(can(atendente, 'sistema.ver'), false);
  assert.equal(can(atendente, 'relatorios.ver'), false);
  assert.equal(can(gerente, 'pedidos.ver'), true);
  assert.equal(can(gerente, 'pagamentos.estornar'), false);
  assert.equal(can(gerente, 'usuarios.ver'), false);
  assert.equal(can(superadmin, 'pagamentos.estornar'), true);
  assert.equal(can(superadmin, 'sistema.ver'), true);
});
