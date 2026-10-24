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
  com_reserva: 'Reservas/quarentena: não remover',
  ja_arquivado: 'Já arquivado anteriormente'
};
export function telaPreviaLimpezaInova(ctx, analise) {
  const { resumo, itens } = analise;
  const candidatos = itens.filter(p => p.status !== 'preservar' && p.status !== 'ja_arquivado');
  const {id, fonte, habilitado, inalterado, elegiveis, emCarrinhos} = analise;
  const n = elegiveis?.length || 0;
  const bloqueios = fonte && !fonte.coberturaCompleta ?
    '<div class="alerta erro"><strong>Limpeza bloqueada:</strong> relatório incompleto ou com códigos repetidos. ' +
    'Registros: ' + e(fonte.total) + ' (mínimo para esta primeira limpeza: ' +
    e(fonte.minimoEsperado) + '), linhas inválidas: ' + e(fonte.invalidos) +
    ', códigos repetidos: ' + e(fonte.repetidos) + '. Use a exportação integral do InovaFarma, ' +
    'incluindo os 66 registros pendentes, em vez do CSV filtrado de 6.062 itens.</div>' : '';
  const acao = !id ? '' : '<div class="mt-2">' + bloqueios +
    '<p><strong>Elegíveis ao arquivamento reversível:</strong> ' + e(n) +
    ' · <strong>Em carrinhos (protegidos):</strong> ' + e(emCarrinhos?.length || 0) +
    ' · <strong>Já arquivados:</strong> ' + e(resumo.jaArquivados || 0) + '</p>' +
    (!inalterado ? '<div class="alerta erro">Catálogo alterado após a conferência. Envie novamente o CSV.</div>' : '') +
    (habilitado ? '<form method="post" action="/admin/estoque/limpeza/aplicar">' +
      '<input type="hidden" name="_csrf" value="' + e(ctx.csrf) + '">' +
      '<input type="hidden" name="loteId" value="' + e(id) + '">' +
      '<p><label><input type="checkbox" name="conferido" value="1" required> ' +
      'Conferi o relatório integral e autorizo arquivar <strong>' + e(n) +
      '</strong> produtos antigos, preservando registros e pedidos.</label></p>' +
      '<div class="campo"><label for="confirmarLimpeza">Digite LIMPAR PRODUTOS ANTIGOS</label>' +
      '<input id="confirmarLimpeza" type="text" name="frase" required autocomplete="off" ' +
      'placeholder="LIMPAR PRODUTOS ANTIGOS"></div>' +
      '<button class="botao perigo" type="submit">Limpar produtos antigos</button>' +
      '</form>' : '<button class="botao perigo" type="button" disabled>' +
        'Limpar produtos antigos — indisponível até corrigir pendências</button>') +
    '<p class="texto-pequeno">A limpeza é reversível: os produtos saem da vitrine e ' +
    'da lista principal, mas permanecem no banco com opção de restauração. ' +
    'Antes de operações definitivas, confira também os backups em ' +
    '<a href="/admin/sistema">Sistema e backups</a>.</p></div>';
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
        '<p class="texto-pequeno">Os produtos com pedidos, reservas ou identificação incerta não serão arquivados automaticamente.</p>' }) +
      painel({ titulo: 'Limpar produtos antigos', corpo:
        acao || '<p>Esta primeira conferência não habilita a limpeza. Use o relatório integral para continuar.</p>' })
  });
}
