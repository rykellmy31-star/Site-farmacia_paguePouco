import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { config } from '../src/config.js';
import { estoqueDisponivel } from '../src/lib/catalog.js';
import {
  autenticacaoInovaValida, estoqueInovaDisponivel, importarEstoqueInova,
  confirmarVendasInova, vendasPendentesInova,
} from '../src/lib/inovafarma-stock.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection({ _commit() {} }, name));
    return this.cols.get(name);
  }
}
const EAN = '7891234567890';
const TOKEN = 'secret-connector-only-use-at-least-32-characters';
const previous = { ...config.inova };

function preparar() {
  config.inova = { enabled: true, token: TOKEN, maxAgeMinutes: 15 };
  const db = new DB();
  db.collection('products').insert({
    id: 'produto-1', ean: EAN, nome: 'Sabonete',
    ativo: true, estoque: { quantidade: 10, reservado: 2, inovaPendente: 3,
      inovaQuantidade: 10, inovaRecebidoEm: new Date().toISOString() },
  });
  db.collection('orders').insert({
    id: 'pedido-1', codigo: 'PP-1', criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    statusFinanceiro: 'aprovado', inovaEnvioPendente: true,
    itens: [{ produtoId: 'produto-1', quantidade: 3 }],
    historico: [{ tipo: 'financeiro', status: 'aprovado', em: new Date().toISOString() }],
  });
  return db;
}
test.after(() => { config.inova = previous; });

test('INOVAFARMA: desativado por padrão e token forte exigido', () => {
  const db = preparar();
  assert.equal(autenticacaoInovaValida('Bearer ' + TOKEN), true);
  assert.equal(autenticacaoInovaValida('Bearer errado'), false);
  assert.equal(autenticacaoInovaValida(''), false);
  config.inova.token = 'fraco';
  assert.equal(autenticacaoInovaValida('Bearer fraco'), false);
  config.inova.enabled = false;
  assert.equal(autenticacaoInovaValida('Bearer ' + TOKEN), false);
  assert.equal(estoqueDisponivel(db.collection('products').get('produto-1')), 8);
});

test('INOVAFARMA: saldo remoto menos reservas e vendas não refletidas', () => {
  const db = preparar();
  const p = db.collection('products').get('produto-1');
  assert.equal(estoqueDisponivel(p), 5);
  assert.equal(estoqueInovaDisponivel(p, Date.now() + 16 * 60_000), 0);
  assert.equal(vendasPendentesInova(db).length, 1);
  assert.deepEqual(vendasPendentesInova(db)[0].itens, [
    { produtoId: 'produto-1', ean: EAN, quantidade: 3, precoUnitarioCentavos: 0, subtotalCentavos: 0 },
  ]);
});

test('INOVAFARMA: confirma venda sem soltar reserva pendente; baixa apenas após snapshot refletido', () => {
  const db = preparar();
  const confirmado = confirmarVendasInova(db, { vendas: [
    { pedidoId: 'pedido-1', referenciaInova: 'ERP-VENDA-1' },
  ] });
  assert.equal(confirmado.ok, true);
  assert.equal(vendasPendentesInova(db).length, 0);
  assert.equal(estoqueDisponivel(db.collection('products').get('produto-1')), 5);

  const duplicate = confirmarVendasInova(db, { vendas: [
    { pedidoId: 'pedido-1', referenciaInova: 'ERP-VENDA-1' },
  ] });
  assert.equal(duplicate.duplicadas, 1);
  const conflito = confirmarVendasInova(db, { vendas: [
    { pedidoId: 'pedido-1', referenciaInova: 'OUTRA-VENDA' },
  ] });
  assert.equal(conflito.status, 409);
  assert.equal(estoqueDisponivel(db.collection('products').get('produto-1')), 5);

  const agora = Date.now();
  const lote = { loteId: 'lote-001', geradoEm: new Date(agora - 5000).toISOString(),
    itens: [{ ean: EAN, quantidade: 7 }], pedidosRefletidos: ['pedido-1'] };
  const r = importarEstoqueInova(db, lote, agora);
  assert.equal(r.ok, true);
  assert.equal(r.pedidosRefletidos, 1);
  const p = db.collection('products').get('produto-1');
  assert.equal(p.estoque.inovaPendente, 0);
  assert.equal(p.estoque.quantidade, 7);
  assert.equal(estoqueInovaDisponivel(p, agora), 5);
  assert.equal(importarEstoqueInova(db, lote, agora).duplicado, true);
});

test('INOVAFARMA: rejeita lote inválido/antigo e referência a produto ambíguo sem mutar estoque', () => {
  const db = preparar();
  const agora = Date.now();
  const estoqueInicial = db.collection('products').get('produto-1').estoque.quantidade;
  const base = { loteId: 'lote-002', geradoEm: new Date(agora - 1000).toISOString(),
    itens: [{ ean: EAN, quantidade: 6 }] };
  const invalido = importarEstoqueInova(db, { ...base, itens: [
    { ean: EAN, quantidade: 6 }, { ean: '7890000000000', quantidade: 2 },
  ] }, agora);
  assert.equal(invalido.ok, false);
  assert.equal(db.collection('products').get('produto-1').estoque.quantidade, estoqueInicial);

  db.collection('products').insert({ id: 'duplicado', ean: EAN, estoque: { quantidade: 20 } });
  assert.equal(importarEstoqueInova(db, base, agora).status, 409);
  assert.equal(db.collection('products').get('produto-1').estoque.quantidade, estoqueInicial);
});

test('INOVAFARMA: pedido não pode ser dado como refletido antes da confirmação no ERP', () => {
  const db = preparar();
  const agora = Date.now();
  const r = importarEstoqueInova(db, {
    loteId: 'lote-003', geradoEm: new Date(agora - 1000).toISOString(),
    itens: [{ ean: EAN, quantidade: 7 }], pedidosRefletidos: ['pedido-1'],
  }, agora);
  assert.equal(r.status, 409);
  assert.equal(estoqueDisponivel(db.collection('products').get('produto-1')), 5);
});
