/** Relatório de vendas por pagamento confirmado — para lançamento manual no Inova. */
import {escapeHtml as e} from '../../lib/security.js';
import {paginaAdmin,painel,tabelaAdmin,cartaoMetrica,money} from './layout.js';
import {formatDateTime} from '../../lib/format.js';

export function telaRelatorioOperacional(ctx,r){
  const periodo=encodeURIComponent(r.de)+'&ate='+encodeURIComponent(r.ate);
  const colunas=['Pagamento em','Pedido','Itens / Quantidade','Cliente','Vendedor','Forma recebida','Total','Entrega',''];
  const linhas=r.vendas.map(v=>{
    const p=v.pedido;
    const itens=(v.itens||[]).map(i=>'<li>'+e(i.quantidade)+'× '+
      e(i.nome||'Produto')+(i.ean?' — EAN '+e(i.ean):'')+
      (i.sku?' · SKU '+e(i.sku):'')+'</li>').join('');
    return '<tr>'+
      '<td>'+formatDateTime(v.data)+'</td>'+
      '<td><strong>'+e(p.codigo)+'</strong></td>'+
      '<td><details><summary>'+v.qtdItens+' unidade(s) · '+v.itens.length+
        ' produto(s)</summary><ul>'+itens+'</ul></details></td>'+
      '<td>'+e(p.cliente?.nome||'—')+'</td>'+
      '<td>'+e(p.vendedor?.nome||'Atendimento geral')+'</td>'+
      '<td>'+e(v.forma)+(v.bandeira?' · '+e(v.bandeira):'')+
        (v.metodo==='credit_card'?' · '+e(v.parcelas)+'x':'')+
        '<br><small>'+(v.pagamentoLocal?'Presencial':'Online')+'</small></td>'+
      '<td><strong>'+money(v.valorCentavos)+'</strong></td>'+
      '<td>'+e(p.statusOperacional||'—')+'</td>'+
      '<td><a class="botao pequeno secundario" href="/admin/pedidos/'+e(p.id)+'">Abrir</a></td></tr>';
  });
  return paginaAdmin(ctx,{
    titulo:'Relatório de vendas para lançamento no InovaFarma',
    ativo:'relatorio_vendas_operacional',
    conteudo:'<h1 class="mt-0">Relatório de vendas</h1>'+
      '<p class="texto-suave">Vendas com pagamento confirmado no período, pelo horário de Brasília. '+
      'Utilize o CSV para lançamento <strong>manual</strong> no InovaFarma. '+
      'Pedidos pendentes e cancelados não entram no faturamento.</p>'+
      painel({corpo:
        '<form method="get" action="/admin/relatorio-vendas" class="barra-ferramentas" style="margin:0">'+
          '<label for="vendasDe">De</label><input id="vendasDe" name="de" type="date" required value="'+e(r.de)+'">'+
          '<label for="vendasAte">Até</label><input id="vendasAte" name="ate" type="date" required value="'+e(r.ate)+'">'+
          '<button type="submit" class="botao">Consultar</button>'+
          '<a class="botao secundario" href="/admin/api/relatorio-vendas.csv?de='+
            periodo+'">Exportar CSV detalhado</a>'+
          '<a class="botao secundario" href="/admin/relatorio-vendas">Hoje</a>'+
        '</form>'})+
      '<div class="cartoes">'+
        cartaoMetrica('Vendas pagas',r.quantidade)+
        cartaoMetrica('Itens vendidos',r.qtdItens)+
        cartaoMetrica('Recebido no período',money(r.receitaCentavos))+
      '</div>'+
      painel({titulo:'Totais por forma de pagamento',corpo:
        '<div class="cartoes">'+Object.entries(r.porMetodo).map(([nome,valor])=>
        cartaoMetrica(nome,money(valor))).join('')+'</div>'+
        (Object.keys(r.porMetodo).length?'':'<p>Nenhuma venda paga no período.</p>')})+
      painel({titulo:'Vendas detalhadas',semPadding:true,corpo:
        tabelaAdmin({colunas,linhas,vazio:'Nenhuma venda com pagamento confirmado neste período.'})}),
  });
}
