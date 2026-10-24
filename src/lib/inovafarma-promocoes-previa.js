/**
 * Prévia somente leitura das promoções do ERP. Nenhuma alteração de catálogo.
 * Não deduzir dia de funcionamento a partir do nome da campanha: é indicação
 * para revisão, nunca uma regra autorizada de desconto automático.
 */
import { analisarPromocoesInovaCsv } from './inovafarma-promocoes-csv.js';

function diaBahia(date) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const valor = (tipo) => partes.find(p => p.type === tipo)?.value || '';
  return [valor('year'), valor('month'), valor('day')].join('-');
}
export function previsualizarPromocoesInova(db, csv, dataReferencia = new Date()) {
  const relatorio = analisarPromocoesInovaCsv(csv);
  const produtos = db.collection('products').all();
  const porCodigo = new Map();
  for (const produto of produtos) {
    const codigo = String(produto.codigoInterno ?? '').trim();
    if (!codigo) continue;
    const lista = porCodigo.get(codigo) || [];
    lista.push(produto);
    porCodigo.set(codigo, lista);
  }
  const hoje = diaBahia(dataReferencia);
  const agrupadas = new Map();
  for (const p of relatorio.promocoes) {
    const lista = agrupadas.get(p.codigoInterno) || [];
    lista.push(p);
    agrupadas.set(p.codigoInterno, lista);
  }
  const resumo = {
    registros: relatorio.total, codigos: agrupadas.size, campanhas: relatorio.campanhas.length,
    semProduto: 0, cadastroAmbiguo: 0, multiplasCampanhas: 0,
    foraDaVigencia: 0, recorrenciaParaRevisar: 0,
    regrasDePagamento: 0, candidatosParaRevisao: 0
  };
  const itens = [];
  const campoContador = {
    produto_nao_encontrado: 'semProduto', cadastro_ambiguo: 'cadastroAmbiguo',
    campanhas_sobrepostas: 'multiplasCampanhas', fora_da_vigencia: 'foraDaVigencia',
    recorrencia_para_revisar: 'recorrenciaParaRevisar',
    regras_de_pagamento: 'regrasDePagamento', candidato_para_revisao: 'candidatosParaRevisao'
  };
  for (const [codigo, campanhas] of agrupadas) {
    const encontrados = porCodigo.get(codigo) || [];
    const vigentes = campanhas.filter(p =>
      p.campanha.inicio <= hoje && (!p.campanha.fim || p.campanha.fim >= hoje));
    let status;
    if (!encontrados.length) status = 'produto_nao_encontrado';
    else if (encontrados.length !== 1) status = 'cadastro_ambiguo';
    else if (vigentes.length > 1) status = 'campanhas_sobrepostas';
    else if (!vigentes.length) status = 'fora_da_vigencia';
    else if (!vigentes[0].campanha.fim || vigentes[0].campanha.diaSugerido)
      status = 'recorrencia_para_revisar';
    else if (vigentes[0].campanha.formasPagamento.length)
      status = 'regras_de_pagamento';
    else status = 'candidato_para_revisao';
    resumo[campoContador[status]]++;
    itens.push({ codigoInterno: codigo, nome: campanhas[0].nome,
      produtoId: encontrados.length === 1 ? encontrados[0].id : null,
      ean: encontrados.length === 1 ? String(encontrados[0].ean ?? '') : '',
      status,
      campanhas: campanhas.map(p => ({ codigo: p.campanha.codigo,
        nome: p.campanha.nome, inicio: p.campanha.inicio,
        fim: p.campanha.fim, diaSugerido: p.campanha.diaSugerido,
        descontoPercentual: p.descontoPercentual,
        precoVendaCentavos: p.precoVendaCentavos,
        precoPromocionalCentavos: p.precoPromocionalCentavos,
        formasPagamento: p.campanha.formasPagamento })) });
  }
  return { resumo, itens, erros: relatorio.erros, dataReferencia: hoje,
    somenteLeitura: true, aplicarAutomaticamente: false };
}
