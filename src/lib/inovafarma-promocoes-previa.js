import { analisarPromocoesInovaCsv } from './inovafarma-promocoes-csv.js';

/**
 * Prévia somente leitura. Não modifica o banco e não autoriza descontos.
 * Usa código interno para cruzar o CSV com produtos já importados.
 * Conflitos e campanhas simultâneas devem ser revisados antes de publicar.
 */
export function previsualizarPromocoesInova(db, csv, dataReferencia = new Date()) {
  const relatorio = analisarPromocoesInovaCsv(csv);
  const produtos = db.collection('products').all();
  const porCodigo = new Map();
  for (const produto of produtos) {
    const codigo = String(produto.codigoInterno || '').trim();
    if (!codigo) continue;
    const encontrados = porCodigo.get(codigo) || [];
    encontrados.push(produto);
    porCodigo.set(codigo, encontrados);
  }
  const hoje = dataReferencia.toISOString().slice(0, 10);
  const agrupadas = new Map();
  for (const p of relatorio.promocoes) {
    const lista = agrupadas.get(p.codigoInterno) || [];
    lista.push(p);
    agrupadas.set(p.codigoInterno, lista);
  }
  const itens = [];
  const resumo = { codigos: agrupadas.size, elegiveisParaRevisao: 0,
    semProduto: 0, cadastroAmbiguo: 0, multiplasCampanhas: 0,
    foraDaVigencia: 0, regrasDePagamento: 0 };
  for (const [codigo, campanhas] of agrupadas) {
    const encontrados = porCodigo.get(codigo) || [];
    const vigentes = campanhas.filter(p => p.campanha.inicio <= hoje && p.campanha.fim >= hoje);
    let status;
    if (!encontrados.length) status = 'produto_nao_encontrado';
    else if (encontrados.length !== 1) status = 'cadastro_ambiguo';
    else if (vigentes.length !== 1) status = vigentes.length ? 'campanhas_sobrepostas' : 'fora_da_vigencia';
    else if (vigentes[0].campanha.formasPagamento.length) status = 'regras_de_pagamento';
    else status = 'revisar';
    const campo = ({ produto_nao_encontrado: 'semProduto', cadastro_ambiguo: 'cadastroAmbiguo',
      campanhas_sobrepostas: 'multiplasCampanhas', fora_da_vigencia: 'foraDaVigencia',
      regras_de_pagamento: 'regrasDePagamento', revisar: 'elegiveisParaRevisao' })[status];
    resumo[campo]++;
    itens.push({ codigoInterno: codigo, produtoId: encontrados.length === 1 ? encontrados[0].id : null,
      status, campanhas: campanhas.map(p => ({ nome: p.campanha.nome,
        inicio: p.campanha.inicio, fim: p.campanha.fim,
        descontoPercentual: p.descontoPercentual,
        precoVendaCentavos: p.precoVendaCentavos,
        precoPromocionalCentavos: p.precoPromocionalCentavos,
        formasPagamento: p.campanha.formasPagamento })) });
  }
  return { resumo, itens, erros: relatorio.erros,
    somenteLeitura: true, aplicarAutomaticamente: false };
}
