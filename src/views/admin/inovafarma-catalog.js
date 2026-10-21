/** Revisão humana do mix de produtos da InovaFarma recebido por conector autorizado. */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel, tabelaAdmin, money } from './layout.js';
import { formatDateTime } from '../../lib/format.js';

export function telaImportacaoCatalogoInova(ctx, { lista, busca='', situacao='', saldo='disponivel', erro='' }) {
  const { candidatos, total, pagina, porPagina, estatisticas } = lista;
  return paginaAdmin(ctx, {
    titulo:'Produtos recebidos da InovaFarma',ativo:'produtos',
    conteudo:`
      <div class="linha centro entre mb-2" style="flex-wrap:wrap;gap:8px">
        <h1 class="mt-0 mb-0">Importação de produtos — InovaFarma</h1>
        <a class="botao secundario" href="/admin/produtos">Voltar a Produtos</a>
      </div>
      <div class="alerta aviso"><strong>Publicação controlada:</strong>
        os dados só aparecerão aqui depois que o conector oficial estiver homologado e autorizado.
        Receber um lote nunca anuncia produtos à venda. Você escolhe quais importar;
        novos produtos entram <strong>inativos, com estoque local zero e revisão sanitária pendente</strong>.
        É necessário revisar classificação, registro sanitário, preço e dados comerciais antes de ativar.
      </div>
      ${erro ? `<div class="alerta aviso" role="alert">${e(erro)}</div>` : ''}
      ${ctx.req?.query?.has('resultado') ? '<div class="alerta sucesso" role="status">Revisão registrada no catálogo.</div>' : ''}
      ${painel({titulo:'Produtos aguardando seleção',corpo:`
        <p><strong>${estatisticas.aguardando}</strong> aguardando revisão ·
           <strong>${estatisticas.importados}</strong> importados ·
           <strong>${total}</strong> encontrados nos filtros.</p>
        <form action="/admin/produtos/inovafarma" method="get" class="barra-ferramentas">
          <input type="search" name="q" aria-label="Buscar por nome ou EAN" maxlength="100"
            placeholder="Nome, código, EAN..." value="${e(busca)}">
          <select name="situacao" aria-label="Estado da revisão">
            <option value="" ${!situacao ? 'selected' : ''}>Todas as situações</option>
            ${[['aguardando_revisao','Aguardando'],['importado','Importados'],
              ['vinculado','Existentes no site'],['ignorado','Ignorados']].map(([id,n]) =>
                `<option value="${id}" ${situacao === id ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <select name="saldo" aria-label="Filtrar disponibilidade no ERP">
            <option value="disponivel" ${saldo === 'disponivel' ? 'selected' : ''}>Com saldo na Inova</option>
            <option value="todos" ${saldo === 'todos' ? 'selected' : ''}>Todos os saldos</option>
          </select>
          <button class="botao secundario" type="submit">Pesquisar</button>
        </form>
        <p class="texto-pequeno texto-suave">Saldo exibido é informativo e não é usado como estoque vendável até receber um snapshot oficial.</p>
      ` })}
      ${painel({titulo:'Selecionar produtos para importação',semPadding:true,corpo:`
        <form method="post" action="/admin/produtos/inovafarma/revisar"
          onsubmit="return confirm('Confirmar a revisão dos produtos marcados? Nenhum será publicado automaticamente.')">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          ${tabelaAdmin({
            colunas:['Selecionar','EAN','Produto','Marca','Preço recebido','Saldo informado','Situação','Cadastro do site'],
            linhas:candidatos.map(c => `<tr>
              <td>${c.situacao === 'aguardando_revisao' && !c.conflitoEAN
                ? `<input type="checkbox" name="eans[]" value="${e(c.ean)}"
                    aria-label="Selecionar produto ${e(c.nome)}">` : '—'}</td>
              <td><code>${e(c.ean)}</code></td><td><strong>${e(c.nome)}</strong></td>
              <td>${e(c.marca || '—')}</td>
              <td>${c.precoCentavos == null ? 'Não informado' : money(c.precoCentavos)}</td>
              <td>${Number(c.quantidade)}</td>
              <td>${e(c.conflitoEAN ? 'Conflito: EAN duplicado no site' :
                c.situacao.replaceAll('_',' '))}</td>
              <td>${c.vinculoAtual ? `<a href="/admin/produtos/${encodeURIComponent(c.vinculoAtual)}">Abrir produto</a>` : 'Novo produto'}</td>
            </tr>`),
            vazio:'Nenhum produto recebido para este filtro. Aguardando conector autorizado.',
          })}
          <div class="linha" style="gap:8px;flex-wrap:wrap;padding:14px">
            <button class="botao pequeno" name="acao" value="importar" type="submit">
              Importar selecionados (inativos)
            </button>
            <button class="botao pequeno secundario" name="acao" value="ignorar" type="submit">
              Ignorar selecionados
            </button>
          </div>
        </form>
        <p class="texto-pequeno texto-suave" style="padding:0 14px">Importações não modificam produtos que já existem com o mesmo EAN. Códigos duplicados exigem revisão manual.</p>
      ` })}
      <nav aria-label="Paginação de produtos Inova" class="linha centro" style="gap:8px;flex-wrap:wrap">
        ${pagina > 1 ? `<a class="botao pequeno secundario" href="?q=${encodeURIComponent(busca)}&situacao=${encodeURIComponent(situacao)}&saldo=${encodeURIComponent(saldo)}&pagina=${pagina-1}">Anterior</a>` : ''}
        <span>Página ${pagina} · até ${porPagina} produtos por página</span>
        ${pagina * porPagina < total ? `<a class="botao pequeno secundario" href="?q=${encodeURIComponent(busca)}&situacao=${encodeURIComponent(situacao)}&saldo=${encodeURIComponent(saldo)}&pagina=${pagina+1}">Próxima</a>` : ''}
      </nav>
    `,
  });
}
