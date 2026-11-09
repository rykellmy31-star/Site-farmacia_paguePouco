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
import { diagnosticarFalhaPix } from './diagnostics.js';

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

/**
 * Checkout Pro: cobrança por cartão no ambiente Mercado Pago, sem cartão/token
 * no nosso servidor. Cobramos exatamente o TOTAL do pedido (frete e descontos
 * inclusos) num item genérico, sem transmitir nomes de medicamentos.
 */
export function urlCheckoutMercadoPago(url) {
  try {
    const u=new URL(String(url||''));
    return u.protocol==='https:' && (
      u.hostname==='mercadopago.com.br' ||
      u.hostname.endsWith('.mercadopago.com.br') ||
      u.hostname==='mercadopago.com' ||
      u.hostname.endsWith('.mercadopago.com')
    ) ? u.href : null;
  } catch { return null; }
}
function pagamentoCheckoutProSeguro(db,remoto,preferencia) {
  const pedido=db.collection('orders').get(preferencia?.pedidoId);
  if (!pedido || !preferencia?.checkoutProCartao ||
      pedido.pagamentoId!==preferencia.id ||
      pedido.metodoPagamento!=='credit_card' ||
      pedido.pagamentoPresencial ||
      String(remoto?.id||'')==='' ||
      String(remoto?.external_reference||'')!==String(pedido.codigo) ||
      remoto?.currency_id!=='BRL' ||
      Math.round(Number(remoto?.transaction_amount)*100)!==Number(pedido.totalCentavos) ||
      Number(preferencia.valorCentavos)!==Number(pedido.totalCentavos) ||
      (remoto?.preference_id && String(remoto.preference_id)!==String(preferencia.preferenciaId)) ||
      (remoto?.metadata?.pedido_id && String(remoto.metadata.pedido_id)!==String(pedido.id)) ||
      (!remoto?.preference_id && !remoto?.metadata?.pedido_id) ||
      !['credit_card','account_money'].includes(String(remoto?.payment_type_id||''))) return null;
  return pedido;
}
async function criarPreferenciaCartao({db,order,payer,returnUrls,config}) {
  const maxParcelas=Math.max(1,Math.min(6,Math.floor(Number(order.totalCentavos)/2500)));
  const principal=returnUrls.success||'';
  if (!/^https:\/\//.test(principal) || !/^https:\/\//.test(returnUrls.notificationUrl||''))
    return {ok:false,erro:'URLs seguras de retorno e webhook não configuradas.'};
  const res=await mpFetch('/checkout/preferences',{
    method:'POST',
    body:{
      items:[{
        id:String(order.codigo),title:'Pedido '+String(order.codigo)+' — Farmácia Pague Pouco',
        quantity:1,unit_price:Number((order.totalCentavos/100).toFixed(2)),currency_id:'BRL',
      }],
      external_reference:String(order.codigo),
      notification_url:returnUrls.notificationUrl,
      back_urls:{success:returnUrls.success,failure:returnUrls.failure,pending:returnUrls.pending},
      auto_return:'approved',
      payer:{email:payer?.email||''},
      metadata:{pedido_id:order.id},
      payment_methods:{
        excluded_payment_types:[
          {id:'ticket'},{id:'bank_transfer'},{id:'debit_card'},{id:'prepaid_card'},{id:'atm'},
        ],
        installments:maxParcelas,
      },
    },
    config,idempotencyKey:'preferencia-cartao-'+order.id,
  });
  if(!res.ok) {
    return {ok:false,indeterminado:[408,429].includes(res.status)||res.status>=500,
      erro:'O Mercado Pago não conseguiu abrir o pagamento seguro. Consulte o pedido antes de tentar novamente.'};
  }
  const preferencia=res.data||{};
  const checkoutUrl=urlCheckoutMercadoPago(preferencia.init_point || preferencia.sandbox_init_point);
  if(!preferencia.id || !checkoutUrl) return {ok:false,indeterminado:true,
    erro:'O Mercado Pago não retornou link seguro de pagamento. Conferência necessária.'};
  const pagamento=db.collection('payments').insert({
    id:'mp_pref_'+String(preferencia.id),preferenciaId:String(preferencia.id),
    pedidoId:order.id,pedidoCodigo:order.codigo,checkoutProCartao:true,
    provedor:'mercadopago',metodo:'credit_card',status:'pending',
    valorCentavos:order.totalCentavos,parcelas:1,maxParcelas,checkoutUrl,
    simulado:false,criadoEm:nowISO(),atualizadoEm:nowISO(),
    eventos:[{status:'pending',em:nowISO(),origem:'preferencia-cartao'}],
  });
  return {ok:true,pagamento,checkoutUrl,simulado:false};
}
export async function createPayment({ db, order, method, payer, installments = 1, cardToken = null, issuerId = null, paymentMethodId = null, returnUrls = {}, config }) {
  if(method==='credit_card' && returnUrls.checkoutProCartao===true)
    return criarPreferenciaCartao({db,order,payer,returnUrls,config});
  const payments = db.collection('payments');
  const idempotencyKey = crypto.randomUUID();
  const notificationUrl = returnUrls.notificationUrl || '';
  const valor = Number((order.totalCentavos / 100).toFixed(2));

  if (method === 'pix' && !/^[0-9]{11}$/.test(String(payer?.cpf || '').replace(/\D/g, ''))) {
    return { ok: false, erro: 'Informe um CPF válido no pagamento para gerar o Pix.' };
  }
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
    const diagnostico = indeterminado ? null : diagnosticarFalhaPix(res.status, res.data);
    return {
      ok: false, indeterminado, diagnostico,
      erro: indeterminado
        ? 'Pagamento com confirmação pendente. Consulte seus pedidos antes de tentar novamente.'
        : diagnostico.motivo,
    };
  }
  const d = res.data;
  // Um 2xx sem identificador válido não prova que a cobrança falhou;
  // não cancele o pedido e não crie outra cobrança automaticamente.
  if (!d || !/^\d{1,30}$/.test(String(d.id ?? ''))) {
    return { ok: false, indeterminado: true,
      erro: 'O provedor confirmou a solicitação sem devolver a identificação. Conciliação necessária.' };
  }
  const poi = d.point_of_interaction || {};
  const pixSemCodigo = method === 'pix' && !poi.transaction_data?.qr_code &&
    !['approved','refunded'].includes(String(d.status || '').toLowerCase());
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
    pixSemCodigo,
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
    pixSemCodigo,
    instrucoes: method === 'pix' ? 'Aponte a câmera do seu banco para o QR Code ou use o código "Pix Copia e Cola".' : null,
  };
}

export async function getStatus({ db, payment, config }) {
  const mpId = String(payment.id || '').replace(/^mp_/, '').replace(/^mp_pref_/, '');
  if (payment.checkoutProCartao===true) {
    let id=payment.transacaoId||null;
    if(!id) {
      // Preferência não é prova de pagamento. Consultar pagamentos reais com
      // esta referência e validar TODOS os vínculos antes de mudar o pedido.
      const busca=await mpFetch('/v1/payments/search?external_reference='+
        encodeURIComponent(payment.pedidoCodigo)+'&limit=30',{config});
      if(!busca.ok)return {ok:false,erro:'Falha ao consultar pagamentos do Checkout Pro.'};
      const encontrados=(busca.data?.results||[]).filter(p=>
        pagamentoCheckoutProSeguro(db,p,payment));
      if(encontrados.length!==1)return {ok:true,status:'pending',pagamento:payment};
      id=String(encontrados[0].id);
    }
    if(!/^\d{1,30}$/.test(String(id)))
      return {ok:false,erro:'Identificador de cartão inválido.'};
    const confirmado=await mpFetch('/v1/payments/'+id,{config});
    if(!confirmado.ok)return {ok:false,erro:'Falha ao confirmar pagamento de cartão.'};
    if(!pagamentoCheckoutProSeguro(db,confirmado.data,payment))
      return {ok:false,erro:'Pagamento de cartão não corresponde ao pedido.'};
    const atual=db.collection('payments').update(payment.id,{
      transacaoId:id,status:String(confirmado.data.status||'pending').toLowerCase(),
      bandeira:confirmado.data.payment_method_id||null,
      ultimosDigitos:confirmado.data.card?.last_four_digits||null,
      parcelas:Number(confirmado.data.installments)||1,
      atualizadoEm:nowISO(),
    });
    return {ok:true,status:atual.status,pagamento:atual};
  }
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
  const pixOriginal=db.collection('payments').get('mp_'+dataId);
  const pro=db.collection('payments').findOne(p=>p.checkoutProCartao===true &&
    p.pedidoCodigo===remoto.external_reference &&
    (!p.transacaoId || String(p.transacaoId)===dataId) &&
    pagamentoCheckoutProSeguro(db,remoto,p));
  const pagamento=pixOriginal||pro;

  if (!pagamento || pagamento.provedor !== 'mercadopago' ||
      !pagamento.checkoutProCartao && String(pagamento.transacaoId)!==dataId ||
      pagamento.checkoutProCartao && !pagamentoCheckoutProSeguro(db,remoto,pagamento)) {
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
  if (pagamento.status !== status || pagamento.checkoutProCartao && !pagamento.transacaoId) {
    db.collection('payments').update(pagamento.id, {
      status, statusDetalhe: remoto.status_detail || null,
      ...(pagamento.checkoutProCartao?{transacaoId:dataId,
        bandeira:remoto.payment_method_id||null,
        parcelas:Number(remoto.installments)||1,
        ultimosDigitos:remoto.card?.last_four_digits||null}:{}),
      atualizadoEm: nowISO(), raw: remoto,
      eventos: [...(pagamento.eventos || []), { status, em: nowISO(), origem: 'webhook' }],
    });
  }
  return { ok: true, pagamentoId: pagamento.id, pedidoId: pedido.id, status, idempotencyKey: dataId };
}

export async function refund({ db, payment, amountCents, config }) {
  if (payment.status !== 'approved') return { ok: false, erro: 'Somente cobranças aprovadas podem ser estornadas.' };
  const mpId = payment.checkoutProCartao ? String(payment.transacaoId||'') :
    String(payment.id || '').replace(/^mp_/, '');
  if(!/^\d{1,30}$/.test(mpId)) return {ok:false,
    erro:'Não foi possível identificar a transação do cartão para estorno.'};
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
