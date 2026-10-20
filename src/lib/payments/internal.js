/**
 * payments/internal.js — PROVEDOR INTERNO DE TESTES.
 *
 * Objetivo: permitir que TODO o fluxo comercial seja exercitado de verdade
 * (criação de cobrança, "pagamento", webhook, aprovação, baixa de estoque,
 * estorno e expiração) SEM movimentar dinheiro real e SEM contratar nada.
 *
 * TRANSPARÊNCIA: todos os códigos/QR gerados aqui são marcados como SIMULADOS.
 * Nenhum Pix gerado por este provedor é pagável. Em produção, configure o
 * Mercado Pago (PAYMENT_PROVIDER=mercadopago + credenciais).
 */
import crypto from 'node:crypto';
import { nowISO } from '../store.js';

const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
};

export const STATUS_LABELS = {
  pending: 'Aguardando pagamento',
  approved: 'Pagamento aprovado',
  rejected: 'Pagamento recusado',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
  expired: 'Expirado',
};

export function mapStatus(status) {
  const s = String(status || '').toLowerCase();
  return STATUS_LABELS[s] || s;
}

function simCode(orderId) {
  const token = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `PIX-SIMULADO-${orderId}-${token}`;
}

/**
 * Cria cobrança simulada.
 * PIX: devolve código "copia e cola" SIMULADO (não pagável) + instruções.
 * CARTÃO: devolve cobrança pendente, aprovada manualmente pelo painel (teste) ou
 *         via simulação de webhook — o navegador NÃO aprova pagamento sozinho.
 */
export async function createPayment({ db, order, method, payer, installments = 1, config: cfg }) {
  const payments = db.collection('payments');
  const id = `int_${crypto.randomBytes(8).toString('base64url')}`;
  const expiresMinutes = 30;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresMinutes * 60_000).toISOString();

  const pagamento = payments.insert({
    id,
    pedidoId: order.id,
    pedidoCodigo: order.codigo,
    provedor: 'internal',
    metodo: method, // pix | credit_card | debit_card
    status: STATUS.PENDING,
    statusDetalhe: null,
    valorCentavos: order.totalCentavos,
    parcelas: method === 'credit_card' ? Math.max(1, Number(installments) || 1) : 1,
    valorParcelaCentavos: method === 'credit_card' ? Math.round(order.totalCentavos / Math.max(1, Number(installments) || 1)) : order.totalCentavos,
    pagadorNome: payer?.nome || '',
    pagadorEmail: payer?.email || '',
    pagadorCpf: payer?.cpf || '',
    pixCodigo: method === 'pix' ? simCode(order.codigo || order.id) : null,
    pixQrBase64: null,
    pixExpiraEm: method === 'pix' ? expiresAt : null,
    simulado: true,
    transacaoId: null,
    bandeira: null,
    ultimosDigitos: null,
    criadoEm: nowISO(),
    atualizadoEm: nowISO(),
    eventos: [{ status: STATUS.PENDING, em: nowISO(), origem: 'criacao' }],
    raw: { ambiente: 'testes-interno', aviso: 'Cobrança simulada. Nenhum valor é movimentado.' },
  });

  return {
    ok: true,
    pagamento,
    simulado: true,
    instrucoes:
      method === 'pix'
        ? 'Ambiente de testes: este código Pix é SIMULADO e não pode ser pago em nenhum banco. Use-o apenas para validar o fluxo.'
        : 'Ambiente de testes: a cobrança de cartão fica "Aguardando pagamento" até a confirmação (simulação de webhook no painel ou integração real).',
  };
}

export async function getStatus({ db, payment }) {
  // Expiração automática de Pix simulado
  if (payment.status === STATUS.PENDING && payment.pixExpiraEm && new Date(payment.pixExpiraEm).getTime() < Date.now()) {
    const upd = db.collection('payments').update(payment.id, {
      status: STATUS.EXPIRED,
      statusDetalhe: 'Pix expirado (30 minutos sem pagamento).',
      atualizadoEm: nowISO(),
      eventos: [...(payment.eventos || []), { status: STATUS.EXPIRED, em: nowISO(), origem: 'expiracao-automatica' }],
    });
    return { ok: true, status: STATUS.EXPIRED, statusDetalhe: upd.statusDetalhe, pagamento: upd };
  }
  return { ok: true, status: payment.status, statusDetalhe: payment.statusDetalhe, pagamento: payment };
}

/**
 * Webhook do provedor interno. Só aceita notificações com o segredo local
 * (simulando a validação de assinatura que o Mercado Pago exige).
 */
export async function handleWebhook({ db, headers, body, config: cfg }) {
  const segredoEsperado = cfg?.payments?.mp?.webhookSecret || process.env.MP_WEBHOOK_SECRET || null;
  const assinatura = headers?.['x-pp-signature'] || headers?.['x-signature'] || '';
  if (!segredoEsperado) {
    return { ok: false, erro: 'Provedor interno sem segredo configurado. Notificação recusada (falha de segurança).' };
  }
  const esperado = crypto.createHmac('sha256', segredoEsperado).update(JSON.stringify(body || {})).digest('hex');
  const a = Buffer.from(String(assinatura));
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, erro: 'Assinatura inválida. Notificação recusada.' };
  }
  const pagamento = db.collection('payments').get(body?.pagamentoId || body?.data?.id);
  if (!pagamento) return { ok: false, erro: 'Pagamento não encontrado.' };

  const novoStatus = String(body?.status || '').toLowerCase();
  if (!['approved', 'rejected', 'cancelled', 'refunded'].includes(novoStatus)) {
    return { ok: false, erro: 'Status de notificação inválido.' };
  }
  return { ok: true, pagamentoId: pagamento.id, pedidoId: pagamento.pedidoId, status: novoStatus, idempotencyKey: body?.idempotencyKey || null };
}

export async function refund({ db, payment, amountCents }) {
  if (payment.status !== STATUS.APPROVED) {
    return { ok: false, erro: 'Somente pagamentos aprovados podem ser estornados.' };
  }
  const upd = db.collection('payments').update(payment.id, {
    status: STATUS.REFUNDED,
    statusDetalhe: `Estorno ${amountCents ? 'parcial' : 'total'} (simulado).`,
    atualizadoEm: nowISO(),
    eventos: [...(payment.eventos || []), { status: STATUS.REFUNDED, em: nowISO(), origem: 'painel', valor: amountCents }],
  });
  return { ok: true, status: STATUS.REFUNDED, pagamento: upd, simulado: true };
}

/** Aprovação manual por administrador (apenas em ambiente de testes). */
export async function simulateApproval(db, paymentId, { aprovado = true, origem = 'painel' } = {}) {
  const p = db.collection('payments').get(paymentId);
  if (!p) return { ok: false, erro: 'Pagamento não encontrado.' };
  if (p.provedor !== 'internal') {
    return { ok: false, erro: 'Pagamentos reais não podem ser aprovados manualmente. Aguarde a confirmação do provedor.' };
  }
  const status = aprovado ? STATUS.APPROVED : STATUS.REJECTED;
  const upd = db.collection('payments').update(paymentId, {
    status,
    statusDetalhe: aprovado ? 'Aprovado em ambiente de testes (simulação).' : 'Recusado em ambiente de testes (simulação).',
    atualizadoEm: nowISO(),
    transacaoId: p.transacaoId || `sim_${crypto.randomBytes(6).toString('hex')}`,
    eventos: [...(p.eventos || []), { status, em: nowISO(), origem }],
  });
  return { ok: true, pagamentoId: upd.id, pedidoId: upd.pedidoId, status, pagamento: upd };
}
