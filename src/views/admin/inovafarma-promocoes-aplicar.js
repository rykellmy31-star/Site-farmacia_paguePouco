/**
 * Revisão da aplicação real de descontos. Nesta página ainda não há mutação
 * de produtos; é preciso confirmar manualmente no formulário protegido.
 */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

const fmt=v=>e(String(v??''));
const reais=c=>'R$ '+(Number(c||0)/100).toLocaleString('pt-BR',{
  minimumFractionDigits:2,maximumFractionDigits:2
});
const rotulos={
  pronto:'Pronto para publicar',
  sem_produto:'Código não encontrado no site',
  codigo_duplicado:'Código repetido no catálogo',
  arquivado:'Produto arquivado',
  codigo_invalido:'Código interno inválido',
  preco_divergente:'Preço normal diferente do InovaFarma; atualize estoque/preços primeiro',
  sem_data_final:'Sem data final: defina validade no formulário',
  sem_dia_semanal:'Campanha sem fim e sem dia definido',
  pagamentos_restritos:'Condições de pagamento não autorizadas para o site',
  preco_invalido:'Preço inválido ou campanha repetida',
  data_invalida:'Período inválido',
  vencida:'Campanha já encerrada',
};
export function telaPreviaAplicacaoPromocoesInova(ctx,previa) {
  const {resumo,plano,id,politica}=previa;
  const confirmacao = previa.ok && resumo.prontos > 0;
  const body='<h1>Revisão dos descontos do InovaFarma</h1>'+
    '<div class="alerta info"><strong>Prévia — os preços da loja ainda não foram alterados.</strong> '+
    'Ao confirmar, as ofertas válidas serão aplicadas aos produtos correspondentes. '+
    'O site ativará/desativará os descontos automaticamente de acordo com as datas e dias da semana. '+
    'O checkout utilizará o mesmo preço mostrado ao cliente.</div>'+
    '<p><a href="/admin/estoque/importar" class="botao secundario">← Voltar à importação</a></p>'+
    painel({titulo:'Resumo da conferência',corpo:
      '<p><strong>Produtos com descontos preparados:</strong> '+fmt(resumo.prontos)+
      ' · <strong>Campanhas preparadas:</strong> '+fmt(resumo.campanhasAceitas)+
      ' · <strong>Códigos conferidos:</strong> '+fmt(resumo.codigos)+'</p>'+
      '<p><strong>Não encontrados:</strong> '+fmt(resumo.semProduto)+
      ' · <strong>Duplicados:</strong> '+fmt(resumo.codigoDuplicado)+
      ' · <strong>Preço divergente:</strong> '+fmt(resumo.precoDivergente)+
      ' · <strong>Arquivados:</strong> '+fmt(resumo.arquivados)+'</p>'+
      '<p><strong>Sem validade indicada:</strong> '+fmt(resumo.semDataFinal)+
      ' · <strong>Pagamento não autorizado:</strong> '+fmt(resumo.pagamentosRestritos)+
      ' · <strong>Campanhas encerradas:</strong> '+fmt(resumo.vencidas)+
      ' · <strong>Mais de uma promoção vigente no momento:</strong> '+fmt(resumo.conflitosAtuais)+'</p>'+
      '<p class="texto-pequeno">Ofertas simultâneas do mesmo produto suspendem o desconto '+
      'até cessar o conflito. '+fmt(resumo.manuaisSubstituidas)+
      ' produtos deixarão de usar a promoção manual anterior, passando a seguir a fonte InovaFarma.</p>'+
      (politica.aceitaTodosOnline?'<div class="alerta info">Você optou por disponibilizar '+
       'essas ofertas para Pix, crédito e débito online, mesmo quando o ERP restringir '+
       'as formas de pagamento.</div>':'')+
      (politica.fimAberto?'<p>Validade máxima das campanhas semanais sem data final: <strong>'+
       fmt(politica.fimAberto)+'</strong></p>':'')
    })+
    painel({titulo:'Produtos e descontos (primeiros 100 de '+fmt(plano.length)+')',corpo:
      '<div style="overflow-x:auto"><table class="tabela"><thead><tr>'+
      '<th>Código</th><th>Produto</th><th>Campanhas</th><th>Preço normal</th>'+
      '<th>Desconto</th><th>Situação</th></tr></thead><tbody>'+
      plano.slice(0,100).map(p=>{
        const oferta=p.ofertas?.[0];
        return '<tr><td>'+fmt(p.codigoInterno)+'</td><td>'+fmt(p.nome)+'</td>'+
          '<td>'+fmt(p.ofertas?.map(c=>c.nome+' ('+c.inicio+' a '+c.fim+
            (c.diaSemana?', '+c.diaSemana:'')+')').join('; ')||'—')+'</td>'+
          '<td>'+fmt(oferta?reais(oferta.precoVendaCentavos):'—')+'</td>'+
          '<td>'+fmt(oferta?reais(oferta.precoPromocionalCentavos):'—')+'</td>'+
          '<td>'+fmt(rotulos[p.status]||p.status)+'</td></tr>';
      }).join('')+'</tbody></table></div>'+
      '<p class="texto-pequeno">Produtos ausentes, duplicados, com preço divergente ou '+ 
      'com campanhas inseguras não serão atualizados nesta importação.</p>'})+
    painel({titulo:'Confirmação de aplicação de descontos',corpo:
      (confirmacao?
        '<form method="post" action="/admin/estoque/promocoes/aplicar">'+
        '<input type="hidden" name="_csrf" value="'+fmt(ctx.csrf)+'">'+
        '<input type="hidden" name="loteId" value="'+fmt(id)+'">'+
        (politica.aceitaTodosOnline?
          '<p><label><input type="checkbox" name="aceitaTodosOnline" value="1" required> '+
          'Confirmo que autorizo estas ofertas para todas as formas de pagamento online.</label></p>':'')+
        '<p><label><input type="checkbox" name="confirmado" value="1" required> '+
        'Revisei os preços e autorizo atualizar <strong>'+fmt(resumo.prontos)+
        '</strong> produtos. Entendo que o desconto só valerá nas datas e dias permitidos.</label></p>'+
        '<div class="campo"><label for="frasePromo">Digite APLICAR DESCONTOS INOVAFARMA</label>'+
        '<input id="frasePromo" type="text" name="frase" required autocomplete="off" '+
        'placeholder="APLICAR DESCONTOS INOVAFARMA"></div>'+
        '<button class="botao" type="submit">Aplicar descontos nos produtos</button>'+
        '</form>':
        '<p>Nenhum produto está apto para aplicação. Confira as pendências e reenvie o relatório.</p>')
      +'<p class="texto-pequeno">A confirmação expira em 30 minutos. '+
       'Ela não altera pedidos pagos, estoque, nome, EAN nem preços normais.</p>'
    });
  return paginaAdmin(ctx,{titulo:'Aplicar descontos InovaFarma',
    ativo:'importacao_estoque',conteudo:body});
}
