/**
 * Leitor SEM EFEITOS COLATERAIS do relatório "Relatório de Promoções" (InovaFarma).
 * Não altera produtos, estoque, pedidos ou preços. A sincronização deve ter
 * revisão explícita, checagem de período/formas de pagamento e transação própria.
 */
export function analisarPromocoesInovaCsv(csv) {
  if (typeof csv !== 'string' || csv.length > 8 * 1024 * 1024)
    throw new Error('CSV ausente ou maior que 8 MB');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i+1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ';' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && csv[i+1] === '\n') i++;
      row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV com aspas incompletas');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  if (!rows[0]?.[0]?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes('RELATORIO DE PROMOCOES'))
    throw new Error('Arquivo não é o Relatório de Promoções');
  const money = v => {
    const s = String(v || '').replace(/\s/g, '');
    if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(s)) return null;
    const [inteiro, dec=''] = s.split(',');
    return Number(inteiro.replace(/\./g, '')) * 100 + Number(dec.padEnd(2,'0'));
  };
  const percent = v => {
    const s = String(v || '').trim();
    if (!/^\d{1,3}(?:,\d{1,2})?$/.test(s)) return null;
    const n = Number(s.replace(',', '.'));
    return n <= 100 ? n : null;
  };
  const date = v => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
    if (!m) return null;
    const [_,d,mo,y] = m;
    const x = new Date(Date.UTC(+y,+mo-1,+d));
    return x.getUTCFullYear()===+y && x.getUTCMonth()===+mo-1 &&
      x.getUTCDate()===+d ? `${y}-${mo}-${d}` : null;
  };
  const promocoes = []; const erros = [];
  let campanha = null, cabecalho = false;
  for (const [index, r] of rows.entries()) {
    if (r[0] === 'Promoção') {
      campanha = { codigo: r[2] || '', nome: r[5] || '', inicio: null, fim: null, formasPagamento: [] };
      cabecalho = false; continue;
    }
    if (campanha && date(r[0]) && date(r[2])) {
      const formasPagamento = [[6,7,'vista'],[8,10,'cheque'],[11,14,'cartao'],[15,18,'cartao_digital'],[19,21,'prazo']]\n        .filter(([nome,flag]) => r[nome] && r[flag] === '[X]').map(([, , tipo]) => tipo);\n      campanha = { ...campanha, inicio: date(r[0]), fim: date(r[2]), formasPagamento };
      continue;
    }
    if (r[0] === 'Código' && r[1] === 'Produto') {
      if (r[21] !== 'Desc.%' || r[24] !== 'Preço Venda' || r[27] !== 'Preço Promoção')
        throw new Error('Colunas de preços/descontos não reconhecidas');
      cabecalho = true; continue;
    }
    if (!cabecalho || !/^\d+$/.test(r[0] || '')) continue;
    const desconto = percent(r[21]), preco = money(r[24]), promocional = money(r[27]);
    if (!campanha?.inicio || !campanha?.fim || campanha.inicio > campanha.fim ||
      !r[1] || desconto === null || preco === null || preco <= 0 ||
      promocional === null || promocional > preco ||\n      !Number.isSafeInteger(preco) || !Number.isSafeInteger(promocional)) {
      erros.push({ linha: index + 1, codigo: r[0] }); continue;
    }
    promocoes.push({ codigoInterno: r[0], nome: r[1], descontoPercentual: desconto,
      precoVendaCentavos: preco, precoPromocionalCentavos: promocional,
      campanha: { ...campanha } });
  }
  if (!promocoes.length) throw new Error('Nenhuma promoção válida encontrada');
  const contagem = new Map();
  for (const p of promocoes) contagem.set(p.codigoInterno, (contagem.get(p.codigoInterno)||0)+1);
  return { promocoes, erros, total: promocoes.length,
    codigosDistintos: contagem.size,
    codigosComMultiplasPromocoes: [...contagem].filter(([,n])=>n>1).map(([k])=>k),\n    campanhas: [...new Map(promocoes.map(p => [p.campanha.codigo, p.campanha])).values()],
    aviso: 'Somente leitura. Não aplicar automaticamente: campanhas podem ter regras de dia, pagamento e sobreposição.' };
}
