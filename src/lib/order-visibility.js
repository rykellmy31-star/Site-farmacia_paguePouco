/**
 * Arquivamento VISUAL de pedidos para o cliente. Nunca deleta pedido,
 * pagamento, movimentações de estoque, histórico ou dados de auditoria.
 * Apenas o Super Administrador pode executar essas operações (nas rotas).
 */
import { nowISO } from './store.js';

const TERMINAIS = new Set(['recusado', 'expirado', 'estornado']);
const ENTREGA_EM_ABERTO = new Set(['em_separacao', 'enviado', 'saiu_para_entrega',
  'entregue', 'devolucao_em_analise']);

export function pedidoOcultoDoCliente(pedido) {
  return Boolean(pedido?.ocultoDoClienteEm);
}

export function podeOcultarPedido(pedido) {
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (pedidoOcultoDoCliente(pedido)) return { ok: false, erro: 'Pedido já está oculto.' };
  if (!TERMINAIS.has(pedido.statusFinanceiro) || pedido.cancelamentoPendenteEstorno ||
      pedido.pendenciaPagamento) {
    return { ok: false, erro: 'Somente pedidos com pagamento recusado, expirado ou estorno confirmado, sem pendências, podem ser ocultados.' };
  }
  if (ENTREGA_EM_ABERTO.has(pedido.statusOperacional)) {
    return { ok: false, erro: 'Não é seguro ocultar um pedido em preparo, enviado, entregue ou aguardando devolução.' };
  }
  return { ok: true };
}

export function ocultarPedidoDoCliente(db, id, { por = null } = {}) {
  const pedido = db.collection('orders').get(id);
  const validacao = podeOcultarPedido(pedido);
  if (!validacao.ok) return validacao;
  const atualizado = db.collection('orders').update(id, {
    ocultoDoClienteEm: nowISO(),
    ocultoDoClientePor: por ? String(por).slice(0, 80) : null,
  });
  return { ok: true, pedido: atualizado };
}

export function restaurarPedidoAoCliente(db, id) {
  const pedido = db.collection('orders').get(id);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (!pedidoOcultoDoCliente(pedido)) return { ok: false, erro: 'Pedido já está visível.' };
  const atualizado = db.collection('orders').update(id, {
    ocultoDoClienteEm: null, ocultoDoClientePor: null,
  });
  return { ok: true, pedido: atualizado };
}
