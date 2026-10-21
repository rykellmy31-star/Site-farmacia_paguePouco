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
 * Consulta completa de CEP. Nunca inventa dados: se a UF não for identificada
 * ou o ViaCEP não responder, devolve apenas o que foi possível apurar.
 */
export async function lookupCep(cep) {
  const d = normalizeCep(cep);
  const result = {
    cep: d,
    valido: isValidCep(d),
    uf: null,
    ufNome: null,
    cidade: null,
    bairro: null,
    logradouro: null,
    fonte: 'faixa-cep-offline',
    erro: null,
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
  if (config.cep.viacep) {
    const extra = await viaCep(d);
    if (extra) {
      result.cidade = extra.localidade || null;
      result.bairro = extra.bairro || null;
      result.logradouro = extra.logradouro || null;
      result.fonte = 'viacep+faixa-cep-offline';
      if (extra.uf && extra.uf !== result.uf) result.fonte += ' (divergência de UF conferida pela faixa)';
    } else {
      result.fonte = 'faixa-cep-offline (consulta de endereço indisponível)';
    }
  }
  return result;
}

async function viaCep(cep) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.cep.timeoutMs);
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json();
    if (data && data.erro) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
