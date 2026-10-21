/**
 * Conciliação recorrente de cobranças Pix. A aprovação exige consulta
 * autenticada ao provedor; falha de rede não é evidência de cancelamento.
 * Executar dentro da fila serial do Durable Object para evitar disputa.
 */
import { getPaymentStatus } from './index.js';
import { atualizarStatusFinanceiro } from '../orders.js';
import { nowISO } from '../store.js';

const TERMINAL = { approved: 'aprovado', rejected: 'recusado', cancelled: 'recusado', expired: 'expirado' };

export function temPixPendente(db) {
  return db.collection('orders').all().some((order) =>
    order.metodoPagamento === 'pix' && order.statusFinanceiro === 'pendente' &&
    !!order.pagamentoId);
}

export async function reconciliarPix(db, { limit = 50 } = {}) {
  const pendentes = db.collection('orders').find((order) =>
    order.metodoPagamento === 'pix' && order.statusFinanceiro === 'pendente' &&
    !!order.pagamentoId).slice(0, Math.max(1, Math.min(100, limit)));
  const resultado = { verificados: 0, atualizados: 0, pendentes: 0, erros: 0 };
  for (const pedido of pendentes) {
    const pagamento = db.collection('payments').get(pedido.pagamentoId);
    if (!pagamento || pagamento.pedidoId !== pedido.id ||
        Number(pagamento.valorCentavos) !== Number(pedido.totalCentavos) ||
        !['internal', 'mercadopago'].includes(pagamento.provedor)) {
      resultado.erros++;
      continue;
    }
    resultado.verificados++;
    let consulta;
    try {
      consulta = await getPaymentStatus(db, pagamento);
    } catch {
      resultado.erros++;
      continue;
    }
    if (!consulta?.ok) {
      resultado.erros++;
      continue;
    }
    const destino = TERMINAL[String(consulta.status || '').toLowerCase()];
    if (!destino) {
      resultado.pendentes++;
      continue;
    }
    const r = atualizarStatusFinanceiro(db, pedido.id, destino, {
      obs: 'Reconciliação automática de cobrança Pix com confirmação do provedor.',
      por: 'conciliacao',
    });
    if (r.ok) resultado.atualizados++;
    else resultado.erros++;
  }
  return { ...resultado, conferidoEm: nowISO() };
}
