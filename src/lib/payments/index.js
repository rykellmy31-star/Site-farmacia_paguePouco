/**
 * payments/index.js — Camada de pagamentos (abstração de provedor).
 *
 * Provedores:
 *  - "internal"    : PROVEDOR INTERNO DE TESTES. Não move dinheiro real, não exige
 *                    credencial, não gera cobrança. Serve para validar todo o fluxo
 *                    (pedido → cobrança → webhook → baixa de estoque).
 *  - "mercadopago" : integração real com o Mercado Pago (Pix, cartão de crédito e
 *                    débito, parcelamento). Exige MP_ACCESS_TOKEN. Enquanto não
 *                    houver credencial, o sistema NÃO finge que integra: mostra
 *                    status "não configurado" no painel.
 *
 * Regras de segurança aplicadas aqui:
 *  - Nenhum segredo é exposto ao frontend (o token só vive no servidor).
 *  - Nenhum dado sensível de cartão é armazenado (no máximo últimos 4 dígitos e
 *    a bandeira, devolvidos pelo próprio provedor).
 *  - Pedido só é marcado como PAGO mediante confirmação do provedor (webhook
 *    validado ou consulta autenticada à API), nunca por ação do navegador.
 */
import { config } from '../../config.js';
import * as internalProvider from './internal.js';
import * as mercadoPago from './mercadopago.js';

export const PROVIDERS = {
  internal: {
    id: 'internal',
    nome: 'Provedor interno de testes (sem movimentação financeira)',
    methods: ['pix', 'credit_card', 'debit_card'],
    requerCredencial: false,
    real: false,
  },
  mercadopago: {
    id: 'mercadopago',
    nome: 'Mercado Pago',
    methods: ['pix', 'credit_card', 'debit_card'],
    requerCredencial: true,
    real: true,
  },
};

export function paymentSettings(db) {
  // A chave utilizada pelo painel é "pagamentos"; "payments" é legado.
  const canonical = db.collection('settings').get('pagamentos');
  const legacy = db.collection('settings').get('payments');
  const defaults = { provedor: config.payments.provider, meios: { pix: true, credit_card: true, debit_card: false } };
  return { ...defaults, ...(legacy || {}), ...(canonical || {}), meios: {
    ...defaults.meios, ...(legacy?.meios || {}), ...(canonical?.meios || {}),
  } };
}

export function getProviderInfo(db) {
  const settings = paymentSettings(db) || {};
  const id = String(settings.provedor || config.payments.provider || 'internal').toLowerCase();
  if (!PROVIDERS[id]) return { ...PROVIDERS.internal, configurado: false, motivo: 'Provedor inválido.', efetivo: id };
  const configurado = id !== 'mercadopago' || Boolean(config.payments.mp.accessToken);
  return {
    ...PROVIDERS[id], configurado, efetivo: id,
    motivo: configurado ? null : 'Credenciais do Mercado Pago ausentes. Checkout bloqueado; nenhuma cobrança simulada será criada.',
  };
}

export function enabledMethods(db) {
  const settings = paymentSettings(db) || {};
  const list = settings.meios || {};
  const info = getProviderInfo(db);
  return {
    pix: info.configurado && list.pix !== false,
    // Cartão real permanece bloqueado até a tokenização no navegador ser homologada.
    credit_card: info.configurado && info.efetivo === 'internal' && list.credit_card !== false,
    debit_card: info.configurado && info.efetivo === 'internal' && list.debit_card === true,
    provider: info.efetivo,
    real: info.efetivo === 'mercadopago' && info.configurado,
  };
}

export function maxInstallments(db) {
  const settings = paymentSettings(db) || {};
  return Math.max(1, Math.min(12, Number(settings.parcelamentoMaximo) || 6));
}

export function installmentOptions(db, totalCents) {
  const settings = paymentSettings(db) || {};
  const max = maxInstallments(db);
  const semJuros = Math.max(1, Math.min(max, Number(settings.parcelasSemJuros) || 3));
  const taxaJurosMes = Number(settings.taxaJurosMes) || 0; // % ao mês, repassada se houver
  const valorMinimoParcela = Number(settings.valorMinimoParcela) || 500; // centavos
  const opts = [];
  for (let n = 1; n <= max; n++) {
    let total = totalCents;
    let juros = false;
    if (n > semJuros && taxaJurosMes > 0) {
      // juros compostos (Price simplificado): total = PV * (1+i)^n
      const i = taxaJurosMes / 100;
      total = Math.round(totalCents * Math.pow(1 + i, n));
      juros = true;
    }
    const parcela = Math.round(total / n);
    if (parcela < valorMinimoParcela && n > 1) break;
    opts.push({ numero: n, total, parcela, juros, semJuros: !juros, texto: `${n}x de R$ ${(parcela / 100).toFixed(2).replace('.', ',')}${juros ? ' com juros' : ' sem juros'}` });
  }
  if (!opts.length) opts.push({ numero: 1, total: totalCents, parcela: totalCents, juros: false, semJuros: true, texto: `1x de R$ ${(totalCents / 100).toFixed(2).replace('.', ',')}` });
  return opts;
}

function resolve(db) {
  const info = getProviderInfo(db);
  return info.efetivo === 'mercadopago' ? mercadoPago : internalProvider;
}

/**
 * Cria uma cobrança para o pedido.
 * @returns {Promise<{ok:boolean, erro?:string, pagamento:object}>}
 */
export async function createPayment(db, { order, method, payer, installments = 1, cardToken = null, issuerId = null, paymentMethodId = null, returnUrls = {} }) {
  const info = getProviderInfo(db);
  if (!info.configurado) return { ok: false, erro: info.motivo || 'Provedor não configurado.' };
  if (!enabledMethods(db)[method]) return { ok: false, erro: 'Meio de pagamento indisponível ou não homologado.' };
  const provider = resolve(db);
  return provider.createPayment({ db, order, method, payer, installments, cardToken, issuerId, paymentMethodId, returnUrls, config });
}

/** Consulta o status de uma cobrança no provedor. */
export async function getPaymentStatus(db, payment) {
  const provider = payment.provedor === 'mercadopago' ? mercadoPago : internalProvider;
  return provider.getStatus({ db, payment, config });
}

/** Processa notificação (webhook) do provedor. */
export async function handleWebhook(db, { provider, headers, body, rawBody }) {
  const id = String(provider || '').toLowerCase();
  if (id === 'mercadopago') return mercadoPago.handleWebhook({ db, headers, body, rawBody, config });
  return internalProvider.handleWebhook({ db, headers, body, rawBody, config });
}

/** Solicita estorno (quando o provedor permitir). */
export async function refundPayment(db, payment, amountCents = null) {
  if (!payment) return { ok: false, erro: 'Pagamento inexistente.' };
  if (amountCents != null && Number(amountCents) !== Number(payment.valorCentavos)) {
    return { ok: false, erro: 'Estorno parcial exige conciliação própria; somente o estorno total está disponível.' };
  }
  const provider = payment.provedor === 'mercadopago' ? mercadoPago :
    payment.provedor === 'internal' ? internalProvider : null;
  if (!provider) return { ok: false, erro: 'Provedor do pagamento desconhecido.' };
  return provider.refund({ db, payment, amountCents: null, config });
}

export function providerPublicInfo(db) {
  const info = getProviderInfo(db);
  return {
    provider: info.efetivo,
    nome: info.nome,
    real: !!info.real && info.configurado,
    configurado: !!info.configurado,
    motivo: info.motivo || null,
    publicKey: info.efetivo === 'mercadopago' ? (config.payments.mp.publicKey || '') : '',
    sandbox: config.payments.mp.sandbox,
  };
}
