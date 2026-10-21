/**
 * Rótulo público dos eventos do pedido.
 *
 * O registro de auditoria permanece íntegro no banco e no painel interno.
 * Nunca mostrar o campo "por" ao cliente: ele pode conter nomes de
 * funcionários, administradores, cliente, e-mails ou identificadores.
 */
const STATUS_AUTOMATICOS = new Set([
  'aguardando_pagamento', 'pendente', 'aprovado', 'recusado',
  'estornado', 'estorno_solicitado', 'expirado',
]);

export function autorPublicoDoEventoPedido(evento) {
  const status = String(evento?.status || '').toLowerCase();
  const tipo = String(evento?.tipo || '').toLowerCase();
  const origem = String(evento?.por || '').trim().toLowerCase();

  if (tipo === 'financeiro' || STATUS_AUTOMATICOS.has(status)) return 'Sistema';
  if (!origem || /^(sistema|system|cliente|customer|webhook|conciliacao|conciliação|mercado pago|mercadopago)$/.test(origem)) {
    return 'Sistema';
  }
  return 'Farmácia Pague Pouco';
}
