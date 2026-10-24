import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

export function telaPreviaRelatorioInova(ctx, previa) {
  const n=previa.resumo;
  const bloqueado=n.conflitos>0;
  return paginaAdmin(ctx,{
    titulo:'Conferir relatório de estoque',ativo:'produtos',
    conteudo:`
      <h1>Prévia do estoque — relatório exportado</h1>
      <p><a href="/admin/produtos/importar">Voltar para importar produtos</a></p>
      <div class="alerta aviso">
        <strong>Nenhuma alteração foi realizada nesta etapa.</strong>
        Produtos existentes conservarão nome, preço, visibilidade, categorias e dados sanitários.
        Somente o saldo absoluto será ajustado quando você confirmar.
        Produtos novos entrarão <strong>inativos</strong>, com saldo importado, mas só poderão ser vendidos
        após revisão comercial e sanitária. Linhas ausentes no relatório não são zeradas.
      </div>
      ${painel({titulo:'Conferência antes de confirmar',corpo:`
        <p>Linhas: <strong>${n.total}</strong> · Produtos novos: <strong>${n.novos}</strong> ·
        Saldos que mudariam: <strong>${n.ajustes}</strong> · Sem mudança: <strong>${n.semAlteracao}</strong> ·
        Saldo zero no relatório: <strong>${n.esgotados}</strong> · Conflitos: <strong>${n.conflitos}</strong>.</p>
        ${previa.aplicado ? '<div class="alerta sucesso">Importação já confirmada e aplicada uma única vez.</div>' : ''}
        ${bloqueado ? '<div class="alerta aviso">Há conflitos com cadastros, código de barras ou reservas de pedidos. Corrija o arquivo ou o cadastro e envie nova exportação. Nenhuma linha será aplicada enquanto houver conflitos.</div>' : ''}
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>EAN</th><th>Descrição</th><th>Saldo Inova</th><th>Ação</th></tr></thead>
          <tbody>${previa.plano.slice(0,60).map(p=>`<tr>
            <td><code>${e(p.ean)}</code></td><td>${e(p.nome)}</td>
            <td>${p.quantidade}</td>
            <td>${e(p.tipo==='novo'?'Novo (inativo)':p.tipo==='igual'?'Sem alteração':
                p.tipo==='conflito'?'Conflito: '+p.motivo:'Atualizar somente saldo')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${previa.plano.length>60 ? '<p>Exibindo 60 primeiras linhas; a validação considera o arquivo inteiro.</p>' : ''}
        ${!previa.aplicado&&!bloqueado ? `<form action="/admin/api/produtos/inova-csv/aplicar" method="post">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <input type="hidden" name="loteId" value="${e(previa.id)}">
          <label><input type="checkbox" required name="confirmar" value="1"> Conferi o relatório e autorizo
            somente os ajustes de estoque indicados. Não publicar produtos novos automaticamente.</label>
          <div class="mt-2"><button class="botao" type="submit">Confirmar importação inicial</button></div>
        </form>` : ''}
      `})}
    `,
  });
}
