/**
 * Avisos transacionais de pedidos: fila persistente e idempotente.
 *
 * Esta função NÃO envia e-mail. Nenhuma mudança de status deve depender
 * de SMTP ou fingir que uma mensagem na fila foi entregue. Um transporte
 * real precisa ser conectado, retentado e homologado separadamente.
 */
import { nowISO } from './store.js';

const FINANCEIRO = Object.freeze({
  aprovado: 'Pagamento confirmado',
  recusado: 'Pagamento recusado',
  expirado: 'Prazo do pagamento encerrado',
  estorno_solicitado: 'Reembolso solicitado',
  estornado: 'Reembolso confirmado',
});
const OPERACIONAL = Object.freeze({
  em_separacao: 'Pedido em separação',
  preparando_envio: 'Pedido sendo preparado para envio',
  enviado: 'Pedido enviado',
  saiu_para_entrega: 'Pedido saiu para entrega',
  entregue: 'Pedido entregue',
  cancelado: 'Pedido cancelado',
});

function textoSeguro(v) {
  return String(v ?? '').replace(/[&<>"']/g, x => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[x]);
}

export function enfileirarAvisoPedido(db, pedido, etapa, status) {
  if (!pedido?.id || !pedido.codigo) return { enfileirado: false, motivo: 'pedido_invalido' };
  const assuntoEvento = (etapa === 'financeiro' ? FINANCEIRO : etapa === 'operacional' ? OPERACIONAL : null)?.[status];
  if (!assuntoEvento) return { enfileirado: false, motivo: 'evento_nao_notificavel' };

  const cliente = pedido.clienteId ? db.collection('customers').get(pedido.clienteId) : null;
  const para = String(pedido.cliente?.email || cliente?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para) || /[\r\n]/.test(para)) {
    return { enfileirado: false, motivo: 'destinatario_ausente' };
  }
  const eventKey = `pedido:${pedido.id}:${etapa}:${status}`;
  const fila = db.collection('mailOutbox');
  const anterior = fila.findOne(item => item.meta?.eventKey === eventKey);
  if (anterior) return { enfileirado: false, duplicado: true, aviso: anterior };

  const codigo = textoSeguro(pedido.codigo);
  const assunto = `${assuntoEvento} — pedido ${pedido.codigo}`;
  const html = `<p>${textoSeguro(assuntoEvento)}.</p><p>Pedido: <strong>${codigo}</strong>.</p>
    <p>Consulte os detalhes na seção Meus pedidos da loja.</p>`;
  const aviso = fila.insert({
    para, assunto, html,
    texto: `${assuntoEvento}. Pedido: ${pedido.codigo}. Confira a seção Meus pedidos da loja.`,
    meta: { tipo: 'atualizacao_pedido', pedidoId: pedido.id, codigo: pedido.codigo,
      etapa, status, eventKey },
    criadoEm: nowISO(),
    status: 'fila', erro: null, arquivo: null,
  });
  return { enfileirado: true, aviso };
}
