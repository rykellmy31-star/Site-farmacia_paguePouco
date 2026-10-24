import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

const reais = centavos => centavos==null ? 'Não informado' :
  (Number(centavos)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function telaPreviaRelatorioInova(ctx, previa) {
  const n=previa.resumo;
  const bloqueado=n.conflitos>0;
  return paginaAdmin(ctx,{
    titulo:'Conferir relatório de estoque',ativo:'importacao_estoque',
    conteudo:`
      <h1>Prévia do estoque — relatório exportado</h1>
      <p><a href="/admin/estoque/importar">Voltar para Importação de estoque</a></p>
      <div class="alerta aviso">
        <strong>Nenhuma alteração foi realizada nesta etapa.</strong>
        Produtos existentes conservarão nome, imagens, visibilidade, categorias e dados sanitários.
        <strong>Preço de venda e saldo</strong> serão atualizados, quando o CSV trouxer o preço.
        Confira cuidadosamente os valores antes de confirmar.
        Produtos novos entrarão <strong>inativos</strong>, com saldo importado, mas só poderão ser vendidos
        após revisão comercial e sanitária. Linhas ausentes no relatório não são zeradas.
      </div>
      ${painel({titulo:'Conferência antes de confirmar',corpo:`
        <p>Linhas: <strong>${n.total}</strong> · Produtos novos: <strong>${n.novos}</strong> ·
        Saldos que mudariam: <strong>${n.ajustes}</strong> · Sem mudança: <strong>${n.semAlteracao}</strong> ·
        Saldo zero no relatório: <strong>${n.esgotados}</strong> · Conflitos: <strong>${n.conflitos}</strong>.</p>
        <p>Preços de produtos novos: <strong>${n.precosNovos||0}</strong> ·
          Preços existentes que mudariam: <strong>${n.precosAtualizados||0}</strong> ·
          Sem preço de venda no relatório: <strong>${n.precosAusentes||0}</strong> ·
          Alterações grandes de preço: <strong>${n.alertasPreco||0}</strong>.</p>
        ${n.precosAusentes ? '<div class="alerta aviso">O relatório não inclui preço de venda para todos os itens. Esses itens ficarão sem reprecificação; produtos novos sem preço permanecerão inativos e com preço zero. Exporte novamente com a coluna Preço de Venda para não precisar editar manualmente.</div>' : ''}
        ${n.alertasPreco ? '<div class="alerta aviso">Atenção: existem preços com diferença superior a 50% em relação à loja. Confira os valores antes de confirmar; a alteração só será feita com sua autorização.</div>' : ''}
        ${previa.aplicado ? '<div class="alerta sucesso">Importação já confirmada e aplicada uma única vez.</div>' : ''}
        ${bloqueado ? '<div class="alerta aviso">Há conflitos com cadastros, código de barras ou reservas de pedidos. Corrija o arquivo ou o cadastro e envie nova exportação. Nenhuma linha será aplicada enquanto houver conflitos.</div>' : ''}
        <div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>EAN</th><th>Descrição</th><th>Saldo Inova</th><th>Preço de venda (CSV)</th><th>Preço atual</th><th>Ação</th></tr></thead>
          <tbody>${previa.plano.slice(0,60).map(p=>`<tr>
            <td><code>${e(p.ean)}</code></td><td>${e(p.nome)}</td>
            <td>${p.quantidade}</td>
            <td><strong>${e(reais(p.precoCentavos))}</strong></td>
            <td>${e(p.precoAnteriorCentavos===null?'Novo produto':reais(p.precoAnteriorCentavos))}</td>
            <td>${e(p.tipo==='conflito'?'Conflito: '+p.motivo:
              p.tipo==='novo'?'Novo produto (inativo)':
              p.tipo==='igual' ? (p.alterarPreco?'Atualizar somente preço':'Sem alteração') :
              (p.alterarPreco?'Atualizar saldo e preço':'Atualizar somente saldo'))}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${previa.plano.length>60 ? '<p>Exibindo 60 primeiras linhas; a validação considera o arquivo inteiro.</p>' : ''}
        ${!previa.aplicado&&!bloqueado ? `<form action="/admin/api/produtos/inova-csv/aplicar" method="post">
          <input type="hidden" name="_csrf" value="${e(ctx.csrf)}">
          <input type="hidden" name="loteId" value="${e(previa.id)}">
          <label><input type="checkbox" required name="confirmar" value="1"> Conferi os
            <strong>saldos e preços de venda</strong> e autorizo atualizar os valores indicados.
            Produtos novos não serão publicados automaticamente.</label>
          <div class="mt-2"><button class="botao" type="submit">Confirmar importação inicial</button></div>
        </form>` : ''}
      `})}
    `,
  });
}
