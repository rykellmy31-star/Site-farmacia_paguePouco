/**
 * cep.js — Identificação de UF a partir do CEP.
 *
 * FONTE PRIMÁRIA (offline, gratuita, sem custo e sem dependência de terceiros):
 * tabela de faixas de CEP por unidade federativa divulgada pelos Correios.
 * Isso garante que o frete por estado funcione SEM API externa (requisito 7).
 *
 * FONTE OPCIONAL: ViaCEP, apenas para COMPLEMENTO de endereço (cidade/bairro/
 * logradouro). Desligada por padrão (VIACEP_ENABLED=false). Se falhar ou estiver
 * desligada, o sistema continua funcionando com a UF determinada offline.
 */
import { config } from '../config.js';

export const UFS = [
  { uf: 'AC', nome: 'Acre', regiao: 'Norte' },
  { uf: 'AL', nome: 'Alagoas', regiao: 'Nordeste' },
  { uf: 'AP', nome: 'Amapá', regiao: 'Norte' },
  { uf: 'AM', nome: 'Amazonas', regiao: 'Norte' },
  { uf: 'BA', nome: 'Bahia', regiao: 'Nordeste' },
  { uf: 'CE', nome: 'Ceará', regiao: 'Nordeste' },
  { uf: 'DF', nome: 'Distrito Federal', regiao: 'Centro-Oeste' },
  { uf: 'ES', nome: 'Espírito Santo', regiao: 'Sudeste' },
  { uf: 'GO', nome: 'Goiás', regiao: 'Centro-Oeste' },
  { uf: 'MA', nome: 'Maranhão', regiao: 'Nordeste' },
  { uf: 'MT', nome: 'Mato Grosso', regiao: 'Centro-Oeste' },
  { uf: 'MS', nome: 'Mato Grosso do Sul', regiao: 'Centro-Oeste' },
  { uf: 'MG', nome: 'Minas Gerais', regiao: 'Sudeste' },
  { uf: 'PA', nome: 'Pará', regiao: 'Norte' },
  { uf: 'PB', nome: 'Paraíba', regiao: 'Nordeste' },
  { uf: 'PR', nome: 'Paraná', regiao: 'Sul' },
  { uf: 'PE', nome: 'Pernambuco', regiao: 'Nordeste' },
  { uf: 'PI', nome: 'Piauí', regiao: 'Nordeste' },
  { uf: 'RJ', nome: 'Rio de Janeiro', regiao: 'Sudeste' },
  { uf: 'RN', nome: 'Rio Grande do Norte', regiao: 'Nordeste' },
  { uf: 'RS', nome: 'Rio Grande do Sul', regiao: 'Sul' },
  { uf: 'RO', nome: 'Rondônia', regiao: 'Norte' },
  { uf: 'RR', nome: 'Roraima', regiao: 'Norte' },
  { uf: 'SC', nome: 'Santa Catarina', regiao: 'Sul' },
  { uf: 'SP', nome: 'São Paulo', regiao: 'Sudeste' },
  { uf: 'SE', nome: 'Sergipe', regiao: 'Nordeste' },
  { uf: 'TO', nome: 'Tocantins', regiao: 'Norte' },
];

export const UF_LIST = UFS.map((u) => u.uf);
export const UF_NAMES = Object.fromEntries(UFS.map((u) => [u.uf, u.nome]));

/** Faixas oficiais (início, fim) de CEP por UF — 8 dígitos. */
const FAIXAS = [
  ['01000000', '19999999', 'SP'],
  ['20000000', '28999999', 'RJ'],
  ['29000000', '29999999', 'ES'],
  ['30000000', '39999999', 'MG'],
  ['40000000', '48999999', 'BA'],
  ['49000000', '49999999', 'SE'],
  ['50000000', '56999999', 'PE'],
  ['57000000', '57999999', 'AL'],
  ['58000000', '58999999', 'PB'],
  ['59000000', '59999999', 'RN'],
  ['60000000', '63999999', 'CE'],
  ['64000000', '64999999', 'PI'],
  ['65000000', '65999999', 'MA'],
  ['66000000', '68899999', 'PA'],
  ['68900000', '68999999', 'AP'],
  ['69000000', '69299999', 'AM'],
  ['69300000', '69399999', 'RR'],
  ['69400000', '69899999', 'AM'],
  ['69900000', '69999999', 'AC'],
  ['70000000', '73699999', 'DF'],
  ['73700000', '76799999', 'GO'],
  ['76800000', '76999999', 'RO'],
  ['77000000', '77999999', 'TO'],
  ['78000000', '78899999', 'MT'],
  ['79000000', '79999999', 'MS'],
  ['80000000', '87999999', 'PR'],
  ['88000000', '89999999', 'SC'],
  ['90000000', '99999999', 'RS'],
];

export function normalizeCep(cep) {
  return String(cep ?? '').replace(/\D/g, '');
}

export function isValidCep(cep) {
  return /^\d{8}$/.test(normalizeCep(cep));
}

/** Retorna a UF correspondente ao CEP, ou null se fora das faixas conhecidas. */
export function ufFromCep(cep) {
  const d = normalizeCep(cep);
  if (!isValidCep(d)) return null;
  const n = Number(d);
  for (const [ini, fim, uf] of FAIXAS) {
    if (n >= Number(ini) && n <= Number(fim)) return uf;
  }
  return null;
}

/**
 * CEP: UF pela tabela local dos Correios, cidade via ViaCEP e, se necessário,
 * BrasilAPI. Não é viável embutir milhões de CEPs com atualização contínua;
 * o fallback offline nunca inventa município, bairro ou rua.
 *
 * O checkout solicita consultarEndereco:true mesmo quando o enriquecimento
 * opcional das outras páginas estiver desligado por configuração.
 */
const CEP_CACHE = new Map();
const CEP_CACHE_MS = 24 * 60 * 60 * 1000;
const CEP_CACHE_MAX = 250;
const textoSeguro = valor => String(valor || '').replace(/[\x00-\x1f\x7f<>]/g, ' ').trim().slice(0, 160);

async function consultarProvedor(url, cep, expectedUF, fetcher, timeoutMs, tipo) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(4500, Math.max(500, Number(timeoutMs) || 3000)));
  try {
    const resp = await fetcher(url, { signal: ctrl.signal, headers:{Accept:'application/json'} });
    if (!resp.ok) return null;
    const raw = await resp.json();
    if (!raw || raw.erro || raw.errors || typeof raw !== 'object') return null;
    const uf = String(tipo === 'viacep' ? raw.uf : raw.state || '').toUpperCase();
    const cidade = textoSeguro(tipo === 'viacep' ? raw.localidade : raw.city);
    if (uf !== expectedUF || !cidade) return null;
    return {
      cidade, bairro: textoSeguro(tipo === 'viacep' ? raw.bairro : raw.neighborhood) || null,
      logradouro: textoSeguro(tipo === 'viacep' ? raw.logradouro : raw.street) || null,
      fonte: tipo+'+faixa-cep-offline',
    };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function lookupCep(cep, { consultarEndereco = false,
  fetcher = globalThis.fetch, timeoutMs = config.cep.timeoutMs } = {}) {
  const d = normalizeCep(cep);
  const result = {
    cep: d, valido: isValidCep(d), uf: null, ufNome: null,
    cidade: null, bairro: null, logradouro: null,
    encontrado: false, fonte: 'faixa-cep-offline', erro: null,
  };
  if (!result.valido) {
    result.erro = 'CEP inválido. Digite os 8 dígitos.';
    return result;
  }
  result.uf = ufFromCep(d);
  result.ufNome = result.uf ? UF_NAMES[result.uf] : null;
  if (!result.uf) {
    result.erro = 'Não foi possível identificar o estado (UF) deste CEP.';
    return result;
  }

  if (!consultarEndereco && !config.cep.viacep) return result;
  // Cache local apenas em consultas reais: testes injetam fetchers independentes.
  const cachePermitido = fetcher === globalThis.fetch;
  const hit = cachePermitido ? CEP_CACHE.get(d) : null;
  if (hit && hit.expires > Date.now()) return {...result,...hit.extra};
  const fontes = [
    ['viacep', 'https://viacep.com.br/ws/'+d+'/json/'],
    ['brasilapi', 'https://brasilapi.com.br/api/cep/v1/'+d],
  ];
  let extra = null;
  for (const [tipo, url] of fontes) {
    extra = await consultarProvedor(url,d,result.uf,fetcher,timeoutMs,tipo);
    if (extra) break;
  }
  if (extra) {
    extra.encontrado = true;
  } else {
    extra = {
      encontrado: false,
      erro: 'Cidade não localizada automaticamente. Confira o CEP e informe a cidade manualmente.',
      fonte: 'faixa-cep-offline (consulta de município indisponível)',
    };
  }
  if (cachePermitido) {
    if (CEP_CACHE.size >= CEP_CACHE_MAX) CEP_CACHE.delete(CEP_CACHE.keys().next().value);
    // Não persistir dados de endereço de cliente: cache efêmero apenas por CEP.
    CEP_CACHE.set(d, {extra,expires:Date.now()+(extra.encontrado?CEP_CACHE_MS:60_000)});
  }
  return {...result,...extra};
}
