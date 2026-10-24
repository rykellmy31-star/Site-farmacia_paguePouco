/**
 * Resultado da conferência do CSV de promoções — somente leitura.
 * Não contém botões que alterem preços nem disponibiliza endpoint de aplicação.
 */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

const rotulos = {
  produto_nao_encontrado: 'Código não encontrado no catálogo',
  cadastro_ambiguo: 'Código duplicado no catálogo',
  campanhas_sobrepostas: 'Mais de uma campanha vigente',
  fora_da_vigencia: 'Sem campanha vigente nesta data',
  recorrencia_para_revisar: 'Campanha semanal / data final ausente: revisar',
  regras_de_pagamento: 'Possui condições de pagamento: revisar',
  candidato_para_revisao: 'Conferir antes de qualquer publicação'
};
const moeda = (centavos) => 'R$ ' + (Number(centavos) / 100)
  .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = v => e(String(v ?? ''));

export function telaPreviaPromocoesInova(ctx, previa) {
  const { resumo, itens, erros, dataReferencia } = previa;
  const linhas = itens.slice(0, 80).map(item => {
    const atual = item.campanhas
      .filter(p => p.inicio <= dataReferencia && (!p.fim || p.fim >= dataReferencia));
    const campanha = atual[0] || item.campanhas[0];
    return '<tr>' +
      '<td>' + fmt(item.codigoInterno) + '</td>' +
      '<td>' + fmt(item.nome) + '</td>' +
      '<td>' + fmt(item.ean || '—') + '</td>' +
      '<td>' + fmt(campanha?.nome || '—') + '</td>' +
      '<td>' + fmt(campanha?.descontoPercentual ?? '—') + '%</td>' +
      '<td>' + fmt(moeda(campanha?.precoVendaCentavos)) + '</td>' +
      '<td>' + fmt(moeda(campanha?.precoPromocionalCentavos)) + '</td>' +
      '<td>' + fmt(rotulos[item.status] || item.status) + '</td>' +
      '</tr>';
  }).join('');
  const falhas = erros.length ? '<div class="alerta erro">' +
    fmt(erros.length) + ' registros possuem preços ou descontos inválidos; não podem ser aplicados.</div>' : '';
  return paginaAdmin(ctx, {
    titulo: 'Prévia de promoções InovaFarma', ativo: 'importacao_estoque',
    conteudo: '<h1>Prévia de promoções InovaFarma</h1>' +
      '<div class="alerta info"><strong>Somente conferência — nada foi alterado.</strong> ' +
      'Esta tela não atualiza descontos, preços, estoque, nome de produtos nem campanhas. ' +
      'Promoções por dia da semana e forma de pagamento precisam de regras confirmadas antes da publicação.</div>' +
      '<p><a class="botao secundario" href="/admin/estoque/importar">← Voltar à importação de estoque</a></p>' +
      painel({ titulo: 'Resumo em ' + fmt(dataReferencia), corpo:
        '<p><strong>Registros de promoções:</strong> ' + fmt(resumo.registros) +
        ' · <strong>Códigos diferentes:</strong> ' + fmt(resumo.codigos) +
        ' · <strong>Campanhas:</strong> ' + fmt(resumo.campanhas) + '</p>' +
        '<p><strong>Produtos não encontrados:</strong> ' + fmt(resumo.semProduto) +
        ' · <strong>Códigos duplicados:</strong> ' + fmt(resumo.cadastroAmbiguo) +
        ' · <strong>Campanhas simultâneas:</strong> ' + fmt(resumo.multiplasCampanhas) +
        ' · <strong>Fora da vigência:</strong> ' + fmt(resumo.foraDaVigencia) + '</p>' +
        '<p><strong>Campanhas recorrentes / dia da semana:</strong> ' + fmt(resumo.recorrenciaParaRevisar) +
        ' · <strong>Restrições de pagamento:</strong> ' + fmt(resumo.regrasDePagamento) +
        ' · <strong>Demais casos para revisão:</strong> ' + fmt(resumo.candidatosParaRevisao) + '</p>' +
        falhas }),
      }) +
      painel({ titulo: 'Amostra para conferência (' + fmt(Math.min(itens.length, 80)) +
        ' de ' + fmt(itens.length) + ' produtos)', corpo:
        '<div style="overflow-x:auto"><table class="tabela">' +
        '<thead><tr><th>Código interno</th><th>Produto</th><th>EAN no site</th>' +
        '<th>Campanha</th><th>Desconto</th><th>Preço normal</th><th>Preço promocional</th>' +
        '<th>Conferência</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
        '<p class="texto-pequeno">Os valores exibidos são do relatório, não representam preço publicado. ' +
        'Se houver campanhas sobrepostas, o valor exibido é apenas um exemplo da lista.</p>' }) 
  });
}
