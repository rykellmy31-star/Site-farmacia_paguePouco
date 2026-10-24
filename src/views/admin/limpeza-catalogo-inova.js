/**
 * Página de auditoria de produtos antigos. Exclusões/desativações não são
 * disponibilizadas nesta etapa, apenas uma relação para revisão humana.
 */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

const status = {
  preservar: 'Preservar: consta no InovaFarma',
  conferir_identificacao: 'Conferir: identificação ambígua/sem código',
  candidato_sem_historico: 'Candidato à limpeza, após conferência',
  vinculado_pedidos: 'Histórico de pedidos: não remover',
  com_reserva: 'Reservas/quarentena: não remover'
};
export function telaPreviaLimpezaInova(ctx, analise) {
  const { resumo, itens } = analise;
  const candidatos = itens.filter(p => p.status !== 'preservar');
  const linhas = candidatos.slice(0, 120).map(p => [
    '<tr><td>', e(p.codigoInterno || '—'), '</td><td>', e(p.ean || '—'),
    '</td><td>', e(p.nome || '—'), '</td><td>',
    e(status[p.status] || p.status), '</td></tr>'
  ].join('')).join('');
  return paginaAdmin(ctx, {
    titulo: 'Conferência de limpeza do catálogo InovaFarma',
    ativo: 'importacao_estoque',
    conteudo: '<h1>Conferência de produtos antigos</h1>' +
      '<div class="alerta info"><strong>Nenhum produto foi alterado ou apagado.</strong> ' +
      'Esta prévia compara os códigos EAN e internos com o relatório CSV do InovaFarma. ' +
      'Produtos aproveitados na primeira importação também são preservados. ' +
      'Não exclua produtos com pedidos anteriores, reservas ou identificação incerta.</div>' +
      '<p><a class="botao secundario" href="/admin/estoque/importar">← Voltar à importação</a></p>' +
      painel({ titulo: 'Resumo da comparação', corpo:
        '<p><strong>Produtos cadastrados no site:</strong> ' + e(resumo.produtosNoSite) +
        ' · <strong>Registros no relatório:</strong> ' + e(resumo.registrosNoRelatorio) + '</p>' +
        '<p><strong>Preservar (encontrados no InovaFarma):</strong> ' + e(resumo.preservar) +
        ' · <strong>Candidatos à limpeza:</strong> ' + e(resumo.candidatosSemHistorico) + '</p>' +
        '<p><strong>Conferir identificação:</strong> ' + e(resumo.conferirIdentificacao) +
        ' · <strong>Com pedidos:</strong> ' + e(resumo.vinculadosPedidos) +
        ' · <strong>Com reservas:</strong> ' + e(resumo.comReserva) + '</p>' +
        '<p class="texto-pequeno"><strong>Atenção:</strong> relatórios incompletos podem ' +
        'marcar incorretamente como candidatos produtos que existem no ERP. ' +
        'Regularize também os produtos sem EAN e as pendências antes de uma limpeza definitiva.</p>' }) +
      painel({ titulo: 'Exceções encontradas — primeiras ' +
        e(Math.min(candidatos.length, 120)) + ' de ' + e(candidatos.length), corpo:
        '<div style="overflow-x:auto"><table class="tabela">' +
        '<thead><tr><th>Código interno</th><th>EAN</th><th>Produto</th><th>Situação</th></tr></thead>' +
        '<tbody>' + (linhas || '<tr><td colspan="4">Nenhuma exceção identificada.</td></tr>') +
        '</tbody></table></div>' +
        '<p class="texto-pequeno">Somente conferência. Não existe botão para excluir em massa nesta tela.</p>' })
  });
}
