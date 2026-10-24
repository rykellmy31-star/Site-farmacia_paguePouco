/**
 * Leitor SOMENTE LEITURA do relatório de promoções exportado do InovaFarma.
 * Não publica promoções nem modifica estoque, produtos, preços ou pagamentos.
 * Algumas campanhas são semanais e não possuem data final: isso não equivale
 * a autorização para ofertar permanentemente no e-commerce.
 */
const LIMITE_BYTES = 8 * 1024 * 1024;
const LIMITE_LINHAS = 10000;
const norm = (v) => String(v ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

function linhasCsv(csv) {
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  function terminar() {
    linha.push(campo.trim());
    if (linha.some(Boolean)) linhas.push(linha);
    linha = []; campo = '';
    if (linhas.length > LIMITE_LINHAS)
      throw new Error('Relatório maior que o limite de linhas.');
  }
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (aspas && csv[i + 1] === '"') { campo += '"'; i++; }
      else aspas = !aspas;
    } else if (c === ';' && !aspas) {
      linha.push(campo.trim()); campo = '';
    } else if ((c === '\n' || c === '\r') && !aspas) {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      terminar();
    } else campo += c;
  }
  if (aspas) throw new Error('CSV com aspas não fechadas.');
  terminar();
  return linhas;
}
function centavos(valor) {
  const v = String(valor ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(v))
    return null;
  const [inteiro, decimal = ''] = v.split(',');
  const n = Number(inteiro.replace(/\./g, '')) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000 ? n : null;
}
function porcentagem(valor) {
  const v = String(valor ?? '').trim();
  if (!/^\d{1,3}(?:,\d{1,2})?$/.test(v)) return null;
  const n = Number(v.replace(',', '.'));
  return n <= 100 ? n : null;
}
function dataBr(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor ?? '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const v = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (v.getUTCFullYear() !== Number(y) || v.getUTCMonth() !== Number(mo) - 1 ||
      v.getUTCDate() !== Number(d)) return null;
  return [y, mo, d].join('-');
}
function addPagamentos(campanha, r) {
  const campos = [
    [6, 7, 'a_vista'], [8, 10, 'cheque'], [11, 14, 'cartao'],
    [15, 18, 'cartao_digital'], [19, 20, 'a_prazo']
  ];
  for (const [texto, marca, tipo] of campos) {
    if (r[texto] && String(r[marca] ?? '').trim() === '[X]' &&
        !campanha.formasPagamento.includes(tipo)) campanha.formasPagamento.push(tipo);
  }
}
const DIAS = [
  ['SEGUNDA', 'segunda'], ['TERCA', 'terca'], ['QUARTA', 'quarta'],
  ['QUINTA', 'quinta'], ['SEXTA', 'sexta'], ['SABADO', 'sabado'], ['DOMINGO', 'domingo']
];

/** Relatório do InovaFarma com colunas fixas: código, nome, Desc.%, Preço Venda e Preço Promoção. */
export function analisarPromocoesInovaCsv(csv) {
  if (typeof csv !== 'string' || !csv.length || csv.length > LIMITE_BYTES)
    throw new Error('Envie um CSV de promoções com até 8 MB.');
  const rows = linhasCsv(csv.replace(/^\uFEFF/, ''));
  if (norm(rows[0]?.[0]) !== 'RELATORIO DE PROMOCOES')
    throw new Error('O arquivo não é um Relatório de Promoções do InovaFarma.');

  const promocoes = [], erros = [], campanhas = [];
  let campanha = null, cabecalho = false;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (norm(r[0]) === 'PROMOCAO') {
      const nome = String(r[5] ?? '').trim();
      campanha = { codigo: String(r[2] ?? '').trim(), nome, inicio: null,
        fim: null, formasPagamento: [],
        diaSugerido: DIAS.find(([termo]) => norm(nome).startsWith(termo))?.[1] || null };
      campanhas.push(campanha);
      cabecalho = false;
      continue;
    }
    if (!campanha) continue;
    if (norm(r[0]) === 'CODIGO' && norm(r[1]) === 'PRODUTO') {
      if (norm(r[21]) !== 'DESC.%' || norm(r[24]) !== 'PRECO VENDA' ||
          norm(r[27]) !== 'PRECO PROMOCAO')
        throw new Error('O layout das colunas de promoções foi alterado.');
      if (!campanha.codigo || !campanha.inicio)
        throw new Error('Promoção sem código ou data inicial reconhecida.');
      cabecalho = true;
      continue;
    }
    if (!cabecalho) {
      addPagamentos(campanha, r);
      if (dataBr(r[0])) {
        campanha.inicio = dataBr(r[0]);
        if (String(r[2] ?? '').trim()) {
          const fim = dataBr(r[2]);
          if (!fim || fim < campanha.inicio)
            throw new Error('Vigência de promoção inválida.');
          campanha.fim = fim;
        }
      }
      continue;
    }
    if (!/^\d{1,20}$/.test(String(r[0] || '').trim())) continue;
    const codigoInterno = r[0].trim();
    const nome = String(r[1] ?? '').trim();
    const descontoPercentual = porcentagem(r[21]);
    const precoVendaCentavos = centavos(r[24]);
    const precoPromocionalCentavos = centavos(r[27]);
    if (!nome || nome.length > 220 || descontoPercentual === null ||
        precoVendaCentavos === null || precoVendaCentavos <= 0 ||
        precoPromocionalCentavos === null || precoPromocionalCentavos > precoVendaCentavos) {
      erros.push({ linha: i + 1, codigoInterno, motivo: 'Desconto ou preço inválido.' });
      continue;
    }
    promocoes.push({ codigoInterno, nome, descontoPercentual,
      precoVendaCentavos, precoPromocionalCentavos, campanha: { ...campanha,
        formasPagamento: [...campanha.formasPagamento] } });
  }
  if (!promocoes.length) throw new Error('Nenhuma promoção válida foi encontrada.');
  const porCodigo = new Map();
  for (const p of promocoes)
    porCodigo.set(p.codigoInterno, (porCodigo.get(p.codigoInterno) || 0) + 1);
  return { promocoes, erros, campanhas, total: promocoes.length,
    codigosDistintos: porCodigo.size,
    codigosComMultiplasPromocoes: [...porCodigo]
      .filter(([, quantidade]) => quantidade > 1).map(([codigo]) => codigo),
    aviso: 'Somente leitura. Vigências abertas, dias da semana, pagamentos e conflitos exigem revisão.' };
}
