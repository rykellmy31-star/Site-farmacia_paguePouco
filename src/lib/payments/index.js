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
import { credenciaisMercadoPago } from './credentials.js';

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
  const mp = credenciaisMercadoPago(db);
  const tokenConfigurado = !!mp.accessToken && mp.legivel !== false;
  const modoCoerente = mp.origem !== 'painel' ||
    (mp.sandbox === (settings.ambienteTestes !== false));
  const configurado = id !== 'mercadopago' || (tokenConfigurado && modoCoerente);
  return {
    ...PROVIDERS[id], configurado, efetivo: id,
    motivo: configurado ? null : (mp.legivel === false
      ? 'Cofre Mercado Pago indisponível. Verifique MP_CREDENTIALS_KEY antes de vender.'
      : !modoCoerente ? 'O ambiente de testes/produção não corresponde às credenciais armazenadas.'
      : 'Credenciais do Mercado Pago ausentes. Checkout bloqueado; nenhuma cobrança simulada será criada.'),
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

// Política comercial fixa: ate 6x; compras parceladas a partir de R$ 50,
// com minimo de R$ 25 sobre o valor da COMPRA por parcela (antes dos juros).
// Configuracoes anteriores de R$ 5 ou de ate 12x nao podem afrouxar a regra.
export const LIMITE_PARCELAS_LOJA = 6;
export const MINIMO_PARCELA_LOJA_CENTAVOS = 2500;
export const MINIMO_COMPRA_PARCELADA_CENTAVOS = 5000;

export function maxInstallments(_db) {
  return LIMITE_PARCELAS_LOJA;
}

export function installmentOptions(db, totalCents) {
  const settings = paymentSettings(db) || {};
  const semJuros = Math.max(1, Math.min(LIMITE_PARCELAS_LOJA,
    Number(settings.parcelasSemJuros) || 3));
  const taxaJurosMes = Number(settings.taxaJurosMes) || 0;
  const totalBase = Number(totalCents);
  if (!Number.isSafeInteger(totalBase) || totalBase < 0) return [];
  const opts = [];
  for (let n = 1; n <= LIMITE_PARCELAS_LOJA; n++) {
    // A elegibilidade leva em conta o valor real da compra, sem juros:
    // R$ 49,99 -> 1x; R$ 50 -> 2x; R$ 75 -> 3x; R$ 150 -> 6x.
    if (n > 1 && (totalBase < MINIMO_COMPRA_PARCELADA_CENTAVOS ||
        totalBase < n * MINIMO_PARCELA_LOJA_CENTAVOS)) break;
    let total = totalBase;
    let juros = false;
    if (n > semJuros && taxaJurosMes > 0) {
      const i = taxaJurosMes / 100;
      total = Math.round(totalBase * Math.pow(1 + i, n));
      juros = true;
    }
    if (!Number.isSafeInteger(total) || total < totalBase) break;
    const parcela = Math.round(total / n);
    opts.push({ numero: n, total, parcela, juros, semJuros: !juros,
      texto: `${n}x de R$ ${(parcela / 100).toFixed(2).replace('.', ',')}${juros ? ' com juros' : ' sem juros'}` });
  }
  return opts;
}

/**
 * Mensagens comerciais da vitrine seguem exatamente as opcoes do checkout.
 * Nao anuncia 2x antes de R$50, nem parcelas com juros como "sem juros".
 * Null significa nao exibir informacao de parcelamento.
 */
export function melhorParcelamentoSemJuros(db,precoCentavos) {
  const valor=Number(precoCentavos);
  // Abaixo do minimo nenhum parcelamento de duas ou mais vezes e possivel;
  // evite consultar configuracoes e anuncie apenas quando elegivel.
  if(!db||!Number.isSafeInteger(valor)||valor<MINIMO_COMPRA_PARCELADA_CENTAVOS)
    return null;
  const opcoes=installmentOptions(db,valor);
  return opcoes.filter(p=>p.numero>=2&&p.semJuros===true&&p.juros===false).at(-1)||null;
}

function mpConfigEfetiva(db) {
  return { ...config, payments: { ...config.payments, mp: credenciaisMercadoPago(db) } };
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
  return provider.createPayment({ db, order, method, payer, installments, cardToken, issuerId, paymentMethodId, returnUrls, config: mpConfigEfetiva(db) });
}

/** Consulta o status de uma cobrança no provedor. */
export async function getPaymentStatus(db, payment) {
  const provider = payment.provedor === 'mercadopago' ? mercadoPago : internalProvider;
  return provider.getStatus({ db, payment, config: mpConfigEfetiva(db) });
}

/** Processa notificação (webhook) do provedor. */
export async function handleWebhook(db, { provider, headers, body, rawBody, dataId = null }) {
  const id = String(provider || '').toLowerCase();
  if (id === 'mercadopago') return mercadoPago.handleWebhook({ db, headers, body, rawBody, dataId, config: mpConfigEfetiva(db) });
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
  return provider.refund({ db, payment, amountCents: null, config: mpConfigEfetiva(db) });
}

export function providerPublicInfo(db) {
  const info = getProviderInfo(db);
  return {
    provider: info.efetivo,
    nome: info.nome,
    real: !!info.real && info.configurado,
    configurado: !!info.configurado,
    motivo: info.motivo || null,
    publicKey: info.efetivo === 'mercadopago' && info.configurado ? (credenciaisMercadoPago(db).publicKey || '') : '',
    sandbox: credenciaisMercadoPago(db).sandbox,
  };
}
