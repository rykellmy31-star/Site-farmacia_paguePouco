/**
 * freight.js — Motor de fretes FIXOS POR ESTADO (sem API dos Correios).
 *
 * Regras implementadas (todas configuráveis no painel → Configuração de Fretes):
 *  - Tabela por UF (26 estados + DF): valor, prazo, ativo/inativo
 *  - Frete grátis por valor mínimo e por cupom
 *  - Entrega local (cidades atendidas pela própria farmácia)
 *  - Retirada na farmácia (grátis)
 *  - Exceções por cidade e por faixa de CEP
 *  - Excedente por peso acima da franquia
 *  - Limites de peso/volume e bloqueio por produto/categoria
 *  - Campo separado "custo real estimado de postagem" (não confundir com o valor
 *    comercial cobrado do cliente) e preparação para integração futura Correios.
 *
 * NUNCA são inventados valores ou prazos: se o destino não tem configuração
 * ativa, o sistema bloqueia a finalização e informa o motivo.
 */
import { UF_LIST, UF_NAMES, ufFromCep, normalizeCep } from './cep.js';
import { toCents, fromCents } from './format.js';

export const DEFAULT_STATE_PRICE = {
  // Valores ILUSTRATIVOS de desenvolvimento (definidos pelo próprio lojista no painel).
  BA: 1290, MA: 2490, PE: 1990, SP: 2990, RJ: 3290,
};

export function defaultFreightConfig() {
  const states = {};
  for (const uf of UF_LIST) {
    states[uf] = {
      uf,
      ativo: true,
      valor: DEFAULT_STATE_PRICE[uf] ?? 2490, // centavos
      prazoMin: 3,
      prazoMax: 8,
      custoPostagemEstimado: null, // centavos; custo real da transportadora/Correios
      observacao: '',
    };
  }
  return {
    versao: 1,
    modo: 'fixo-por-estado', // nunca depende de API externa
    states,
    freteGratis: {
      ativo: true,
      valorMinimo: 19900, // R$ 199,00
      aplicaPara: 'todos', // todos | estados
      estados: [],
    },
    entregaLocal: {
      ativo: true,
      cidades: ['Itanhém'], // cidade da sede (editável)
      valor: 0,
      prazoMin: 0,
      prazoMax: 2,
      label: 'Entrega local (cidade da farmácia)',
    },
    retirada: {
      ativo: true,
      valor: 0,
      prazoMin: 0,
      prazoMax: 1,
      label: 'Retirar na farmácia',
      endereco: 'Informe o endereço da loja em Configurações → Empresa',
      horario: 'Seg. a sáb., 08h às 20h',
    },
    peso: {
      limiteKg: 30,
      franquiaKg: 5,
      valorKgExcedente: 190, // centavos por kg excedente
      cubagemLimiteM3: 0.3,
    },
    excecoes: [], // {id, tipo:'cidade'|'faixa-cep'|'uf-cidade', uf, cidade, cepIni, cepFim, valor, prazoMin, prazoMax, bloqueado, motivo}
    bloqueios: {
      categorias: [], // ids de categoria bloqueadas para envio
      produtos: [], // ids de produto bloqueados para envio
    },
    integracaoCorreios: {
      preparado: true,
      ativo: false,
      observacao: 'Integração futura. O frete fixo por estado continua funcionando independentemente.',
    },
    mensagemIndisponivel: 'Ainda não atendemos esta localidade pelas transportadoras configuradas. Entre em contato pelo WhatsApp para avaliarmos a entrega.',
  };
}

export function normalizeFreightConfig(cfg) {
  const base = defaultFreightConfig();
  if (!cfg || typeof cfg !== 'object') return base;
  const out = { ...base, ...cfg };
  out.states = { ...base.states };
  for (const uf of UF_LIST) {
    out.states[uf] = { ...base.states[uf], ...(cfg.states?.[uf] || {}) };
    if (!Number.isFinite(out.states[uf].valor)) out.states[uf].valor = 0;
  }
  out.freteGratis = { ...base.freteGratis, ...(cfg.freteGratis || {}) };
  out.entregaLocal = { ...base.entregaLocal, ...(cfg.entregaLocal || {}) };
  out.retirada = { ...base.retirada, ...(cfg.retirada || {}) };
  out.peso = { ...base.peso, ...(cfg.peso || {}) };
  out.bloqueios = { ...base.bloqueios, ...(cfg.bloqueios || {}) };
  out.excecoes = Array.isArray(cfg.excecoes) ? cfg.excecoes : [];
  return out;
}

function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function deadlineText(min, max) {
  const a = Math.max(0, Number(min) || 0);
  const b = Math.max(a, Number(max) || 0);
  if (b === 0) return 'Entrega no mesmo dia';
  if (a === b) return `${b} ${b === 1 ? 'dia útil' : 'dias úteis'}`;
  return `${a} a ${b} dias úteis`;
}

/**
 * Calcula as opções de frete.
 * @param {object} params
 * @param {object} params.config  configuração de fretes (já normalizada)
 * @param {string} params.cep
 * @param {string} [params.uf]
 * @param {string} [params.cidade]
 * @param {Array}  params.items   [{ productId, quantidade, precoUnitario, peso, largura, altura, comprimento, categoriaId }]
 * @param {number} params.subtotalCents
 * @param {boolean} params.cupomFreteGratis
 * @returns {object} { disponivel, motivo, opcoes: [{id,label,valor,prazo,detalhe}] , uf, pesoTotalKg }
 */
export function calcularFrete({ config: rawCfg, cep, uf, cidade, items = [], subtotalCents = 0, cupomFreteGratis = false }) {
  const cfg = normalizeFreightConfig(rawCfg);
  const cepNorm = normalizeCep(cep);
  const ufFinal = (uf && UF_LIST.includes(String(uf).toUpperCase()) ? String(uf).toUpperCase() : ufFromCep(cepNorm));

  const pesoTotalKg = items.reduce((acc, it) => acc + (Number(it.peso) || 0) * (Number(it.quantidade) || 1), 0);
  const volumeM3 = items.reduce((acc, it) => {
    const l = Number(it.largura) || 0, a = Number(it.altura) || 0, c = Number(it.comprimento) || 0;
    return acc + (l * a * c) / 1_000_000 * (Number(it.quantidade) || 1);
  }, 0);

  const result = {
    disponivel: false,
    motivo: '',
    uf: ufFinal,
    ufNome: ufFinal ? UF_NAMES[ufFinal] : null,
    cep: cepNorm,
    cidade: cidade || null,
    pesoTotalKg: Math.round(pesoTotalKg * 1000) / 1000,
    volumeM3: Math.round(volumeM3 * 100000) / 100000,
    opcoes: [],
  };

  // 1) Bloqueios por produto / categoria
  const bloqProd = new Set((cfg.bloqueios?.produtos || []).map(String));
  const bloqCat = new Set((cfg.bloqueios?.categorias || []).map(String));
  const bloqueado = items.find((it) => bloqProd.has(String(it.productId)) || (it.categoriaId && bloqCat.has(String(it.categoriaId))));
  if (bloqueado) {
    result.motivo = 'Este pedido contém itens com restrição de transporte (ex.: produtos hospitalares/aerossóis). Remova o item ou fale com nossa farmácia.';
    return result;
  }

  // 2) Limites físicos
  if (pesoTotalKg > Number(cfg.peso.limiteKg)) {
    result.motivo = `O peso do pedido (${pesoTotalKg.toFixed(2)} kg) excede o limite configurado de ${cfg.peso.limiteKg} kg por envio. Divida o pedido ou fale conosco.`;
    return result;
  }
  if (cfg.peso.cubagemLimiteM3 && volumeM3 > Number(cfg.peso.cubagemLimiteM3)) {
    result.motivo = `O volume do pedido (${volumeM3.toFixed(3)} m³) excede o limite configurado.`;
    return result;
  }

  const opcoes = [];

  // 3) Retirada na farmácia
  if (cfg.retirada?.ativo) {
    opcoes.push({
      id: 'retirada',
      label: cfg.retirada.label || 'Retirar na farmácia',
      valor: 0,
      prazoMin: cfg.retirada.prazoMin,
      prazoMax: cfg.retirada.prazoMax,
      prazo: deadlineText(cfg.retirada.prazoMin, cfg.retirada.prazoMax),
      detalhe: `${cfg.retirada.endereco || ''}${cfg.retirada.horario ? ' — ' + cfg.retirada.horario : ''}`.trim(),
      gratis: true,
    });
  }

  // 4) Entrega local
  const cidadeNorm = stripAccents(cidade);
  const isLocal = cfg.entregaLocal?.ativo && cidadeNorm && (cfg.entregaLocal.cidades || []).some((c) => stripAccents(c) === cidadeNorm);
  if (isLocal) {
    opcoes.push({
      id: 'entrega_local',
      label: cfg.entregaLocal.label || 'Entrega local',
      valor: Number(cfg.entregaLocal.valor) || 0,
      prazoMin: cfg.entregaLocal.prazoMin,
      prazoMax: cfg.entregaLocal.prazoMax,
      prazo: deadlineText(cfg.entregaLocal.prazoMin, cfg.entregaLocal.prazoMax),
      detalhe: `Entrega realizada pela própria farmácia em ${cidade}.`,
      gratis: !cfg.entregaLocal.valor,
    });
  }

  // 5) Frete por estado (ou exceção)
  if (!ufFinal) {
    result.motivo = 'Não foi possível identificar o estado (UF) a partir do CEP informado. Confira o CEP digitado.';
    result.opcoes = opcoes;
    result.disponivel = opcoes.length > 0;
    return result;
  }

  const state = cfg.states[ufFinal];
  if (!state || !state.ativo) {
    result.motivo = cfg.mensagemIndisponivel || 'Não há entrega configurada e ativa para este estado.';
    result.opcoes = opcoes;
    result.disponivel = opcoes.length > 0;
    return result;
  }

  // exceções (cidade, faixa de CEP)
  const excecao = (cfg.excecoes || []).find((ex) => {
    if (!ex.ativo) return false;
    if (ex.tipo === 'cidade' && ex.uf === ufFinal && stripAccents(ex.cidade) === cidadeNorm && cidadeNorm) return true;
    if (ex.tipo === 'faixa-cep') {
      const ini = normalizeCep(ex.cepIni);
      const fim = normalizeCep(ex.cepFim);
      const n = Number(cepNorm);
      return n >= Number(ini) && n <= Number(fim);
    }
    return false;
  });

  if (excecao && excecao.bloqueado) {
    result.motivo = excecao.motivo || cfg.mensagemIndisponivel;
    result.opcoes = opcoes;
    result.disponivel = opcoes.length > 0;
    return result;
  }

  let valor = excecao && Number.isFinite(Number(excecao.valor)) ? Number(excecao.valor) : Number(state.valor);
  let prazoMin = excecao?.prazoMin != null ? Number(excecao.prazoMin) : Number(state.prazoMin);
  let prazoMax = excecao?.prazoMax != null ? Number(excecao.prazoMax) : Number(state.prazoMax);

  // excedente de peso
  const franquia = Number(cfg.peso.franquiaKg) || 0;
  if (franquia && pesoTotalKg > franquia) {
    const excedente = Math.ceil(pesoTotalKg - franquia);
    valor += excedente * (Number(cfg.peso.valorKgExcedente) || 0);
  }

  // frete grátis por valor
  const fg = cfg.freteGratis || {};
  const aplicaFG = fg.ativo && subtotalCents >= Number(fg.valorMinimo || 0) &&
    (fg.aplicaPara !== 'estados' || (fg.estados || []).includes(ufFinal));
  if (aplicaFG || cupomFreteGratis) valor = 0;

  opcoes.unshift({
    id: '_padrao',
    label: excecao ? `Entrega para ${cidade || UF_NAMES[ufFinal]}` : `Entrega padrão — ${UF_NAMES[ufFinal]} (${ufFinal})`,
    valor: Math.max(0, Math.round(valor)),
    prazoMin,
    prazoMax,
    prazo: deadlineText(prazoMin, prazoMax),
    detalhe: excecao?.motivo || state.observacao || '',
    gratis: valor === 0,
    estado: ufFinal,
    excecao: excecao?.id || null,
    custoPostagemEstimado: state.custoPostagemEstimado ?? null,
  });

  result.opcoes = opcoes;
  result.disponivel = true;
  return result;
}

/**
 * Valida e devolve o frete escolhido pelo cliente, RECALCULANDO no servidor.
 * Nunca confia em valor enviado pelo navegador (segurança de preço).
 */
export function resolverFreteEscolhido({ config, cep, uf, cidade, items, subtotalCents, opcaoId, cupomFreteGratis }) {
  const calc = calcularFrete({ config, cep, uf, cidade, items, subtotalCents, cupomFreteGratis });
  if (!calc.disponivel) return { ok: false, erro: calc.motivo || 'Entrega indisponível para o destino informado.' };
  const escolhida = calc.opcoes.find((o) => o.id === opcaoId) || calc.opcoes[0];
  if (!escolhida) return { ok: false, erro: 'Selecione uma forma de entrega.' };
  return {
    ok: true,
    opcao: escolhida,
    valor: escolhida.valor,
    prazoMin: escolhida.prazoMin,
    prazoMax: escolhida.prazoMax,
    detalhes: calc,
  };
}

export { deadlineText };
