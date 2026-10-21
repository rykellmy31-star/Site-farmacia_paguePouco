/** Cadastro administrativo de vendedores, sem acesso ao ERP. */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel, tabelaAdmin, money } from './layout.js';

export function telaVendedores(ctx, { vendedores, editando = null, filtros = {}, metricas = new Map(), erro = '', salvo = '' }) {
  const podeEditar = ctx.permissoes?.podeEditarVendedores === true;
  const edit = editando || {};
  const filtroNome = e(filtros.q || '');
  const situacao = e(filtros.situacao || '');
  return paginaAdmin(ctx, {
    titulo: 'Vendedores',
    ativo: 'vendedores',
    conteudo: `<div class="linha entre centro mb-2" style="flex-wrap:wrap;gap:10px">
      <h1 class="mt-0 mb-0">Vendedores</h1>
      ${podeEditar ? '<a class="botao" href="/admin/vendedores#cadastro">Cadastrar vendedor</a>' : ''}
    </div>
    <p class="texto-suave">Cadastre o vendedor com o código exato utilizado na InovaFarma. Não são enviadas informações ao ERP nesta etapa.</p>
    ${erro ? `<div class="alerta aviso" role="alert">${e(erro)}</div>` : ''}
    ${salvo ? '<div class="alerta sucesso" role="status">Cadastro de vendedores atualizado.</div>' : ''}
    ${painel({ titulo: 'Pesquisar vendedores', corpo: `
      <form method="get" action="/admin/vendedores" class="barra-ferramentas">
        <input type="search" name="q" value="${filtroNome}" placeholder="Nome ou código Inova" aria-label="Pesquisar vendedores">
        <select name="situacao" aria-label="Filtrar por situação">
          <option value="">Todas as situações</option>
          <option value="ativo" ${situacao === 'ativo' ? 'selected' : ''}>Ativos</option>
          <option value="inativo" ${situacao === 'inativo' ? 'selected' : ''}>Inativos</option>
        </select>
        <button class="botao secundario" type="submit">Filtrar</button>
      </form>` })}
    ${painel({ titulo:'Lista de vendedores', semPadding:true,
      corpo:tabelaAdmin({
        colunas:['Nome','Código Inova','Situação','Pedidos aprovados','Total aprovado','Ações'],
        linhas:vendedores.map(v=>{
          const m=metricas.get(v.id) || {pedidos:0,totalCentavos:0};
          return `<tr>
            <td><strong>${e(v.nome)}</strong></td>
            <td><code>${e(v.codigoInova)}</code></td>
            <td>${v.ativo ? 'Ativo' : 'Inativo'}</td>
            <td>${m.pedidos}</td><td>${money(m.totalCentavos)}</td>
            <td>${podeEditar ? `
              <a class="botao pequeno secundario" href="/admin/vendedores?editar=${encodeURIComponent(v.id)}#cadastro">Editar</a>
              <form method="post" action="/admin/vendedores/${encodeURIComponent(v.id)}/situacao" style="display:inline"
                onsubmit="return confirm('Confirma a alteração da situação do vendedor?')">
                <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
                <input type="hidden" name="ativo" value="${v.ativo ? '0' : '1'}">
                <button class="botao pequeno secundario" type="submit">${v.ativo ? 'Desativar' : 'Ativar'}</button>
              </form>` : 'Somente leitura'}</td>
          </tr>`}),
        vazio:'Nenhum vendedor cadastrado. Não há cadastros fictícios.',
      }) })}
    ${podeEditar ? `<div id="cadastro">
      ${painel({ titulo:editando ? 'Editar vendedor' : 'Cadastrar vendedor',
        corpo:`<form method="post" action="/admin/vendedores${editando ? '/'+encodeURIComponent(editando.id) : ''}">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <div class="grade-form duas-colunas">
            <div class="campo"><label for="vendedorNome">Nome do vendedor</label>
              <input id="vendedorNome" name="nome" required maxlength="120" value="${e(edit.nome || '')}" placeholder="Nome profissional"></div>
            <div class="campo"><label for="vendedorCodigo">Código interno InovaFarma</label>
              <input id="vendedorCodigo" name="codigoInova" required maxlength="40" autocomplete="off"
                value="${e(edit.codigoInova || '')}" placeholder="00125" pattern="[A-Za-z0-9._-]+">
              <span class="dica">Código textual, preserva zeros à esquerda.</span></div>
          </div>
          <div class="campo"><label for="vendedorAtivo">Situação</label>
            <select name="ativo" id="vendedorAtivo">
              <option value="1" ${edit.ativo !== false ? 'selected' : ''}>Ativo</option>
              <option value="0" ${edit.ativo === false ? 'selected' : ''}>Inativo</option>
            </select></div>
          <button class="botao" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar vendedor'}</button>
          ${editando ? '<a class="botao secundario" href="/admin/vendedores">Cancelar edição</a>' : ''}
        </form>` })}
    </div>` : ''}`,
  });
}
