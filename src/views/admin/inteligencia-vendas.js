/** Indicadores reais da loja e de produtos adicionados pelos cards de recomendação. */
import { escapeHtml as e } from '../../lib/security.js';
import { money } from '../layout.js';
import { paginaAdmin, painel, cartaoMetrica, tabelaAdmin, graficoBarras } from './layout.js';

const inteiro=n=>Number(n||0).toLocaleString('pt-BR');
const rotulos={
  pix:'Pix',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',
  presencial:'Pagamento na entrega/retirada',cash:'Dinheiro',outros:'Outros',
};
export function telaInteligenciaVendas(ctx,{relatorio:r}){
  const grafico=r.porDia.map(x=>({rotulo:x.dia.split('-').reverse().join('/'),
    valor:x.centavos,texto:money(x.centavos)}));
  return paginaAdmin(ctx,{
    titulo:'Inteligência de Vendas',ativo:'inteligencia_vendas',
    conteudo:'<h1 class="mt-0">📊 Inteligência de Vendas</h1>'+
      '<p class="texto-suave">Indicadores calculados a partir de pedidos reais. '+
      'Nenhum valor demonstrativo ou pedido pendente entra no faturamento.</p>'+
      painel({corpo:
        '<form class="barra-ferramentas" method="get" action="/admin/inteligencia-vendas">'+
        '<label for="dataInicialInteligencia">De</label>'+
        '<input id="dataInicialInteligencia" name="de" type="date" required value="'+e(r.de)+'">'+
        '<label for="dataFinalInteligencia">Até</label>'+
        '<input id="dataFinalInteligencia" name="ate" type="date" required value="'+e(r.ate)+'">'+
        '<button class="botao secundario" type="submit">Atualizar análise</button>'+
        '</form><p class="texto-pequeno texto-suave mb-0">Filtro pela data de criação do pedido. '+
        'Só entram nos valores os pedidos com pagamento aprovado atualmente.</p>',
      })+
      '<div class="cartoes">'+
        cartaoMetrica('Faturamento confirmado',money(r.receitaCentavos))+
        cartaoMetrica('Ticket médio pago',money(r.ticketMedioCentavos))+
        cartaoMetrica('Pedidos pagos',inteiro(r.pedidosPagos))+
        cartaoMetrica('Pedidos pendentes',inteiro(r.pedidosPendentes))+
        cartaoMetrica('Cancelados',inteiro(r.pedidosCancelados))+
        cartaoMetrica('Clientes com 2+ compras no período',inteiro(r.clientesRecorrentes))+
      '</div>'+
      painel({titulo:'Faturamento por dia',corpo:graficoBarras(grafico)})+
      '<h2>✨ Resultados das recomendações</h2>'+
      '<div class="cartoes">'+
        cartaoMetrica('Pedidos pagos com item recomendado',inteiro(r.pedidosComRecomendacao))+
        cartaoMetrica('Unidades de itens recomendados vendidas',inteiro(r.itensRecomendadosVendidos))+
        cartaoMetrica('Valor bruto dos itens recomendados',money(r.valorBrutoItensRecomendadosCentavos))+
        cartaoMetrica('% dos pedidos pagos com recomendação',String(r.taxaConversaoRecomendacoes).replace('.',',')+'%')+
        cartaoMetrica('Pedidos pagos vinculados à recuperação',inteiro(r.vendasRecuperadas))+
        cartaoMetrica('Receita de pedidos vinculados à recuperação',money(r.receitaRecuperadaCentavos))+
      '</div>'+
      '<div class="alerta info mb-3"><strong>Como medimos:</strong> só atribuímos recomendação '+
        'quando o cliente clica em <strong>+ Adicionar à cesta</strong> e o produto aparece '+
        'em um pedido aprovado daquela cesta. O valor dos itens é bruto, antes de ratear '+
        'descontos e frete. Isso identifica vendas associadas ao recurso, não comprova '+
        'que ele causou a compra. Pedidos vinculados à recuperação podem se sobrepor '+
        'a pedidos com recomendação; não some esses indicadores ao faturamento geral.</div>'+
      '<div class="grade-form duas-colunas">'+
        painel({titulo:'Produtos recomendados mais vendidos',semPadding:true,
          corpo:tabelaAdmin({
            colunas:['Produto','Unidades','Valor bruto'],
            linhas:r.recomendadosMaisVendidos.map(p=>'<tr><td>'+e(p.nome)+
              '</td><td>'+inteiro(p.quantidade)+'</td><td>'+money(p.receitaCentavos)+'</td></tr>'),
            vazio:'Ainda não há compras pagas com produtos adicionados pelos cards.',
          }),
        })+
        painel({titulo:'Vendas pagas por forma de pagamento',semPadding:true,
          corpo:tabelaAdmin({
            colunas:['Forma','Pedidos','Faturamento'],
            linhas:r.pagamentos.map(p=>'<tr><td>'+e(rotulos[p.metodo]||p.metodo)+
              '</td><td>'+inteiro(p.quantidade)+'</td><td>'+money(p.receitaCentavos)+'</td></tr>'),
            vazio:'Nenhuma venda paga no período.',
          }),
        })+
      '</div>'+
      '<p class="texto-pequeno texto-suave">Produtos inativos, sem estoque ou bloqueados '+
      'para venda online não são sugeridos. O recurso não exige serviços externos pagos.</p>',
  });
}
