/**
 * Conciliação recorrente de cobranças Pix. A aprovação exige consulta
 * autenticada ao provedor; falha de rede não é evidência de cancelamento.
 * Executar dentro da fila serial do Durable Object para evitar disputa.
 */
import { getPaymentStatus } from './index.js';
import { atualizarStatusFinanceiro, cancelarPedido } from '../orders.js';
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


/**
 * Estornos que dependem de confirmação externa são acompanhados da mesma
 * forma que o Pix. Nenhuma venda é considerada reembolsada pela mera
 * solicitação de cancelamento.
 *
 * Se a solicitação teve origem no botão Cancelar, o pedido é cancelado
 * somente depois da confirmação; um estorno avulso não cancela a entrega.
 */
export function temEstornoPendente(db) {
  return db.collection('orders').all().some(pedido =>
    pedido.statusFinanceiro === 'estorno_solicitado' ||
    (pedido.statusFinanceiro === 'estornado' && !!pedido.cancelamentoPendenteEstorno));
}

export async function reconciliarEstornos(db, { limit = 50 } = {}) {
  const pedidos = db.collection('orders').find(pedido =>
    pedido.statusFinanceiro === 'estorno_solicitado' ||
    (pedido.statusFinanceiro === 'estornado' && !!pedido.cancelamentoPendenteEstorno))
    .slice(0, Math.max(1, Math.min(100, limit)));
  const resumo = { verificados: 0, confirmados: 0, cancelados: 0, pendentes: 0, erros: 0 };
  for (const pedido of pedidos) {
    const pagamento = db.collection('payments').get(pedido.pagamentoId);
    if (!pagamento || pagamento.pedidoId !== pedido.id ||
        Number(pagamento.valorCentavos) !== Number(pedido.totalCentavos) ||
        !['internal', 'mercadopago'].includes(pagamento.provedor)) {
      resumo.erros++;
      continue;
    }
    // Quando um webhook já confirmou o estorno, resta apenas concluir um
    // cancelamento solicitado anteriormente, sem consultar/reembolsar de novo.
    if (pedido.statusFinanceiro !== 'estornado') {
      resumo.verificados++;
      let resultado;
      try {
        resultado = await getPaymentStatus(db, pagamento);
      } catch {
        resumo.erros++;
        continue;
      }
      if (!resultado?.ok) {
        resumo.erros++;
        continue;
      }
      if (String(resultado.status).toLowerCase() !== 'refunded') {
        resumo.pendentes++;
        continue;
      }
      const transicao = atualizarStatusFinanceiro(db, pedido.id, 'estornado', {
        obs: 'Estorno confirmado por consulta autenticada ao provedor.',
        por: 'conciliacao',
      });
      if (!transicao.ok) {
        resumo.erros++;
        continue;
      }
      resumo.confirmados++;
    }
    const atual = db.collection('orders').get(pedido.id);
    if (!atual?.cancelamentoPendenteEstorno) continue;
    const cancelar = cancelarPedido(db, atual.id, {
      motivo: atual.cancelamentoPendenteEstorno.motivo || 'Cancelamento após estorno confirmado.',
      por: atual.cancelamentoPendenteEstorno.por || 'conciliacao',
    });
    if (!cancelar.ok) {
      resumo.erros++;
      continue;
    }
    db.collection('orders').update(pedido.id, { cancelamentoPendenteEstorno: null });
    resumo.cancelados++;
  }
  return { ...resumo, conferidoEm: nowISO() };
}
