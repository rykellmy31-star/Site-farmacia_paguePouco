/**
 * payments/mercadopago.js — Integração real com o Mercado Pago.
 *
 * Importante (honestidade técnica): este módulo está IMPLEMENTADO, mas NÃO FOI
 * EXECUTADO contra a API do Mercado Pago neste ambiente, porque não havia
 * credenciais disponíveis e o prompt veda contratar/cadastrar serviços.
 * Até que MP_ACCESS_TOKEN seja configurado, o sistema opera com o provedor
 * interno de testes e exibe "não configurado" no painel.
 *
 * Requisitos de segurança atendidos:
 *  - Access token usado somente no servidor; o frontend recebe no máximo a public key.
 *  - Nenhum dado de cartão trafega/é gravado por nós (usamos o token gerado pelo
 *    Checkout Transparente/Brick do Mercado Pago, que roda no navegador do cliente).
 *  - Idempotência: X-Idempotency-Key em toda criação de cobrança.
 *  - Webhook com validação de assinatura (x-signature) e/ou consulta autenticada.
 */
import crypto from 'node:crypto';
import { nowISO } from '../store.js';

const API = 'https://api.mercadopago.com';

function mpConfig(config) {
  const cfg = config?.payments?.mp || {};
  if (!cfg.accessToken) throw new Error('MPCONFIG: credenciais do Mercado Pago não configuradas.');
  return cfg;
}

async function mpFetch(path, { method = 'GET', body, headers = {}, idempotencyKey, config } = {}) {
  const cfg = mpConfig(config);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey || crypto.randomUUID(),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export const STATUS_LABELS = {
  pending: 'Aguardando pagamento',
  approved: 'Pagamento aprovado',
  authorized: 'Autorizado (em captura)',
  in_process: 'Em análise',
  in_mediation: 'Em mediação',
  rejected: 'Pagamento recusado',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
  charged_back: 'Estornado (chargeback)',
  expired: 'Expirado',
};

export function mapStatus(status) {
  return STATUS_LABELS[String(status || '').toLowerCase()] || status;
}

export async function createPayment({ db, order, method, payer, installments = 1, cardToken = null, issuerId = null, paymentMethodId = null, returnUrls = {}, config }) {
  const payments = db.collection('payments');
  const idempotencyKey = crypto.randomUUID();
  const notificationUrl = returnUrls.notificationUrl || '';
  const valor = Number((order.totalCentavos / 100).toFixed(2));

  const payerPayload = {
    email: payer?.email || '',
    first_name: (payer?.nome || 'Cliente').split(' ')[0],
    last_name: (payer?.nome || '').split(' ').slice(1).join(' ') || 'Pague Pouco',
    identification: payer?.cpf ? { type: 'CPF', number: String(payer.cpf).replace(/\D/g, '') } : undefined,
  };

  let payload;
  let endpoint = '/v1/payments';
  if (method === 'pix') {
    payload = {
      transaction_amount: valor,
      description: `Pedido ${order.codigo} — Farmácia Pague Pouco`,
      payment_method_id: 'pix',
      external_reference: order.codigo,
      notification_url: notificationUrl,
      payer: payerPayload,
      metadata: { pedido_id: order.id, origem: 'site' },
    };
  } else if (method === 'credit_card' || method === 'debit_card') {
    if (!cardToken) return { ok: false, erro: 'Token de cartão ausente. O token deve ser gerado pelo Mercado Pago no navegador (Checkout Transparente/Brick).' };
    payload = {
      transaction_amount: valor,
      token: cardToken,
      description: `Pedido ${order.codigo} — Farmácia Pague Pouco`,
      installments: Math.max(1, Number(installments) || 1),
      payment_method_id: paymentMethodId || (method === 'debit_card' ? 'debvisa' : 'visa'),
      issuer_id: issuerId || undefined,
      external_reference: order.codigo,
      notification_url: notificationUrl,
      payer: payerPayload,
      metadata: { pedido_id: order.id, origem: 'site' },
    };
  } else if (method === 'checkout_pro') {
    // Checkout Pro: o cliente é redirecionado para o Mercado Pago (sem dados de
    // cartão passando pelo nosso servidor).
    const pref = await mpFetch('/checkout/preferences', {
      method: 'POST',
      body: {
        items: (order.itens || []).map((it) => ({
          id: it.produtoId,
          title: it.nome,
          quantity: it.quantidade,
          unit_price: Number((it.precoUnitarioCentavos / 100).toFixed(2)),
          currency_id: 'BRL',
        })),
        external_reference: order.codigo,
        notification_url: notificationUrl,
        back_urls: {
          success: returnUrls.success || '',
          failure: returnUrls.failure || '',
          pending: returnUrls.pending || '',
        },
        auto_return: 'approved',
        payer: { email: payer?.email || '', name: payer?.nome || '' },
        shipment: { cost: Number((order.freteCentavos / 100).toFixed(2)), mode: 'not_specified' },
        metadata: { pedido_id: order.id },
      },
      idempotencyKey,
      config,
    });
    if (!pref.ok) {
      return {
        ok: false,
        indeterminado: [408, 429].includes(pref.status) || pref.status >= 500,
        erro: pref.status >= 500 || [408, 429].includes(pref.status)
          ? 'Resposta temporariamente indisponível. Confira a situação antes de tentar outra compra.'
          : 'O provedor não aceitou os dados do pagamento.',
      };
    }
    const pagamento = payments.insert({
      id: `mp_pref_${pref.data.id}`,
      pedidoId: order.id,
      pedidoCodigo: order.codigo,
      provedor: 'mercadopago',
      metodo: 'checkout_pro',
      status: 'pending',
      valorCentavos: order.totalCentavos,
      parcelas: 1,
      criadoEm: nowISO(),
      atualizadoEm: nowISO(),
      checkoutUrl: pref.data.init_point || pref.data.sandbox_init_point || '',
      simulado: false,
      eventos: [{ status: 'pending', em: nowISO(), origem: 'criacao-preferencia' }],
      raw: { preference: pref.data },
    });
    return { ok: true, pagamento, checkoutUrl: pagamento.checkoutUrl, simulado: false };
  } else {
    return { ok: false, erro: 'Meio de pagamento não suportado.' };
  }

  const res = await mpFetch(endpoint, { method: 'POST', body: payload, idempotencyKey, config });
  if (!res.ok) {
    // Após receber HTTP 5xx, 408 ou 429, não há garantia de que o
    // provedor não criou a cobrança. Não libere a reserva para vender
    // o mesmo estoque ou aceitar uma segunda cobrança automaticamente.
    const indeterminado = [408, 429].includes(res.status) || res.status >= 500;
    return {
      ok: false, indeterminado,
      erro: indeterminado
        ? 'Pagamento com confirmação pendente. Consulte seus pedidos antes de tentar novamente.'
        : 'O provedor recusou a solicitação de pagamento. Revise os dados e tente novamente.',
    };
  }
  const d = res.data;
  const poi = d.point_of_interaction || {};
  const pagamento = payments.insert({
    id: `mp_${d.id}`,
    pedidoId: order.id,
    pedidoCodigo: order.codigo,
    provedor: 'mercadopago',
    metodo: method,
    status: d.status || 'pending',
    statusDetalhe: d.status_detail || null,
    valorCentavos: order.totalCentavos,
    parcelas: d.installments || 1,
    valorParcelaCentavos: d.transaction_details?.installment_amount ? Math.round(d.transaction_details.installment_amount * 100) : order.totalCentavos,
    pixCodigo: poi.transaction_data?.qr_code || null,
    pixQrBase64: poi.transaction_data?.qr_code_base64 || null,
    pixExpiraEm: d.date_of_expiration || null,
    transacaoId: d.id ? String(d.id) : null,
    bandeira: d.payment_method_id || null,
    ultimosDigitos: d.card?.last_four_digits || null,
    pagadorEmail: payer?.email || '',
    simulado: false,
    criadoEm: nowISO(),
    atualizadoEm: nowISO(),
    checkoutUrl: poi.transaction_data?.ticket_url || '',
    eventos: [{ status: d.status || 'pending', em: nowISO(), origem: 'criacao' }],
    raw: d,
  });
  return {
    ok: true,
    pagamento,
    checkoutUrl: pagamento.checkoutUrl,
    simulado: false,
    instrucoes: method === 'pix' ? 'Aponte a câmera do seu banco para o QR Code ou use o código "Pix Copia e Cola".' : null,
  };
}

export async function getStatus({ db, payment, config }) {
  const mpId = String(payment.id || '').replace(/^mp_/, '').replace(/^mp_pref_/, '');
  if (payment.metodo === 'checkout_pro') return { ok: true, status: payment.status, pagamento: payment };
  const res = await mpFetch(`/v1/payments/${mpId}`, { config });
  if (!res.ok) return { ok: false, erro: `Falha ao consultar pagamento: ${res.status}` };
  const d = res.data || {};
  const pedido = db.collection('orders').get(payment.pedidoId);
  const valor = Math.round(Number(d.transaction_amount) * 100);
  if (!pedido || pedido.pagamentoId !== payment.id ||
      String(d.id) !== mpId || d.external_reference !== pedido.codigo ||
      d.currency_id !== 'BRL' || !Number.isSafeInteger(valor) ||
      valor !== Number(payment.valorCentavos) || valor !== Number(pedido.totalCentavos) ||
      (d.metadata?.pedido_id && String(d.metadata.pedido_id) !== String(pedido.id))) {
    return { ok: false, erro: 'Consulta retornou cobrança incompatível com o pedido. Conciliação necessária.' };
  }
  const status = String(d.status || payment.status).toLowerCase();
  // Também em consultas manuais, nunca retroceda um estorno em andamento
  // ou concluído para "approved" devido a uma resposta antiga.
  if ((['refund_pending', 'refunded'].includes(payment.status) ||
      ['estorno_solicitado', 'estornado'].includes(pedido.statusFinanceiro)) &&
      status !== 'refunded') {
    return { ok: true, status: payment.status, statusDetalhe: payment.statusDetalhe,
      pagamento: payment, ignorado: true };
  }
  if (payment.status === status) {
    return { ok: true, status, statusDetalhe: payment.statusDetalhe, pagamento: payment };
  }
  const upd = db.collection('payments').update(payment.id, {
    status,
    statusDetalhe: d.status_detail || null,
    atualizadoEm: nowISO(),
    raw: d,
  });
  return { ok: true, status, statusDetalhe: d.status_detail, pagamento: upd };
}

/**
 * Webhook do Mercado Pago.
 * Validação em duas camadas:
 *  1) assinatura HMAC (x-signature) quando MP_WEBHOOK_SECRET estiver configurado;
 *  2) consulta autenticada à API (/v1/payments/{id}) — fonte autoritativa.
 * Se não houver credencial, recusa (não aprova nada às cegas).
 */
export async function handleWebhook({ db, headers, body, dataId: queryDataId = null, config }) {
  const cfg = config?.payments?.mp || {};
  if (!cfg.accessToken) return { ok: false, erro: 'Integração Mercado Pago sem credenciais.' };
  const rawSignature = headers?.['x-signature'] || headers?.['X-Signature'] || '';
  const requestId = headers?.['x-request-id'] || headers?.['X-Request-Id'] || '';
  const dataId = String(queryDataId || body?.data?.id || '');
  if (!/^\d{1,30}$/.test(dataId)) return { ok: false, erro: 'Identificador de pagamento inválido.' };

  if (cfg.webhookSecret) {
    // Assinatura é obrigatória quando o segredo existe.
    if (!rawSignature || !requestId) return { ok: false, erro: 'Assinatura ou identificador de requisição ausente.' };
    const pairs = rawSignature.split(',').map((p) => p.trim().split('='));
    const values = Object.fromEntries(pairs.filter((p) => p.length === 2));
    const ts = values.ts || '';
    const v1 = values.v1 || '';
    if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(v1)) {
      return { ok: false, erro: 'Formato da assinatura inválido.' };
    }
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(manifest).digest('hex');
    const a = Buffer.from(v1.toLowerCase(), 'hex'), b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, erro: 'Assinatura do webhook inválida.' };
    }
  }
  if (body?.type && body.type !== 'payment' || body?.action && !String(body.action).startsWith('payment.')) {
    return { ok: false, erro: 'Tipo de notificação diferente de pagamento.' };
  }

  // A assinatura autentica a notificação, mas NÃO aprova pagamento.
  const res = await mpFetch(`/v1/payments/${dataId}`, { config });
  if (!res.ok) return { ok: false, erro: 'Falha ao consultar cobrança no provedor.' };
  const remoto = res.data || {};
  const pagamento = db.collection('payments').get(`mp_${dataId}`);
  if (!pagamento || pagamento.provedor !== 'mercadopago' || String(pagamento.transacaoId) !== dataId) {
    return { ok: false, erro: 'Cobrança desconhecida; aguardando conciliação.' };
  }
  const pedido = db.collection('orders').get(pagamento.pedidoId);
  const valorRemoto = Math.round(Number(remoto.transaction_amount) * 100);
  if (!pedido || pedido.pagamentoId !== pagamento.id ||
      remoto.external_reference !== pedido.codigo ||
      String(remoto.id) !== dataId ||
      remoto.currency_id !== 'BRL' ||
      !Number.isSafeInteger(valorRemoto) ||
      valorRemoto !== Number(pedido.totalCentavos) ||
      Number(pagamento.valorCentavos) !== Number(pedido.totalCentavos) ||
      (remoto.metadata?.pedido_id && String(remoto.metadata.pedido_id) !== String(pedido.id))) {
    return { ok: false, erro: 'Cobrança não corresponde ao pedido (identidade, valor ou moeda).' };
  }
  const status = String(remoto.status || '').toLowerCase();
  // Respostas antigas podem chegar depois de solicitar/confirmar um estorno.
  // A consulta autenticada confirma o estado observado no provedor, mas
  // não deve APAGAR a intenção de estorno nem reverter a confirmação local.
  // Mantemos esses casos para conciliação sem alterar o status financeiro.
  const emEstorno = ['refund_pending', 'refunded'].includes(pagamento.status) ||
    ['estorno_solicitado', 'estornado'].includes(pedido.statusFinanceiro);
  if (emEstorno && status !== 'refunded') {
    return { ok: true, pagamentoId: pagamento.id, pedidoId: pedido.id,
      status: 'ignored', ignorado: true, idempotencyKey: dataId };
  }
  // Reentrega de evento igual ainda pode completar o pedido que ficou
  // pendente na tentativa anterior, mas não cria outro evento da cobrança.
  if (pagamento.status !== status) {
    db.collection('payments').update(pagamento.id, {
      status, statusDetalhe: remoto.status_detail || null,
      atualizadoEm: nowISO(), raw: remoto,
      eventos: [...(pagamento.eventos || []), { status, em: nowISO(), origem: 'webhook' }],
    });
  }
  return { ok: true, pagamentoId: pagamento.id, pedidoId: pedido.id, status, idempotencyKey: dataId };
}

export async function refund({ db, payment, amountCents, config }) {
  if (payment.status !== 'approved') return { ok: false, erro: 'Somente cobranças aprovadas podem ser estornadas.' };
  const mpId = String(payment.id || '').replace(/^mp_/, '');
  const res = await mpFetch(`/v1/payments/${mpId}/refunds`, {
    method: 'POST', body: undefined, idempotencyKey: `refund-${payment.id}`, config,
  });
  if (!res.ok) return { ok: false, erro: 'O provedor recusou o estorno. Consulte a conciliação.' };
  const confirmado = res.data?.status === 'approved' &&
    Math.round(Number(res.data?.amount) * 100) === Number(payment.valorCentavos);
  const status = confirmado ? 'refunded' : 'refund_pending';
  const atualizado = db.collection('payments').update(payment.id, {
    status,
    statusDetalhe: confirmado ? 'Estorno total confirmado pelo provedor.' : 'Solicitação de estorno recebida; confirmação pendente.',
    atualizadoEm: nowISO(),
    eventos: [...(payment.eventos || []), { status, em: nowISO(), origem: 'solicitacao-estorno' }],
  });
  return { ok: true, status, pagamento: atualizado };
}
