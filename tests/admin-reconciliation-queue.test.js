import test from 'node:test';
import assert from 'node:assert/strict';
import { pedidoPrecisaConferencia } from '../src/lib/orders.js';

test('fila de revisão marca apenas pedidos pendentes com resultado financeiro incerto', () => {
  const pedidos = [
    { id: 'a', statusFinanceiro: 'pendente', pendenciaPagamento: 'criacao_em_andamento' },
    { id: 'b', statusFinanceiro: 'pendente', pendenciaPagamento: 'conciliacao_necessaria' },
    { id: 'c', statusFinanceiro: 'pendente', pendenciaPagamento: null },
    { id: 'd', statusFinanceiro: 'aprovado', pendenciaPagamento: 'conciliacao_necessaria' },
    { id: 'e', statusFinanceiro: 'recusado', pendenciaPagamento: 'criacao_em_andamento' },
  ];
  assert.deepEqual(pedidos.filter(pedidoPrecisaConferencia).map(p => p.id), ['a', 'b']);
  assert.equal(pedidoPrecisaConferencia(null), false);
  assert.equal(pedidoPrecisaConferencia({}), false);
});

test('estado de pagamento aprovado não aparece na revisão mesmo com marca legada', () => {
  for (const statusFinanceiro of ['aprovado', 'recusado', 'expirado', 'estornado']) {
    assert.equal(pedidoPrecisaConferencia({
      statusFinanceiro, pendenciaPagamento: 'conciliacao_necessaria',
    }), false);
  }
});
