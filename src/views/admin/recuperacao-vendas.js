/** Painel exclusivo e responsivo de recuperação consentida de carrinhos. */
import { paginaAdmin, painel, campoAdmin } from './layout.js';
import { escapeHtml as e } from '../../lib/security.js';

const real=n=>(Number(n||0)/100).toFixed(2).replace('.',',');
function data(v){
  if(!v)return '—';
  const d=new Date(v);
  return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Bahia',day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',
  }).format(d);
}
function linhaResumo(rotulo,valor){
  return '<div class="cartao" style="flex:1;min-width:165px;padding:16px"><small>'+e(rotulo)+
    '</small><br><strong style="font-size:1.4em">'+e(String(valor))+'</strong></div>';
}
export function telaRecuperacaoVendas(ctx,{cfg,resumo,erro=''}) {
  const c=campoAdmin;
  const form = '<form method="post" action="/admin/recuperacao-vendas/configurar">'+
    '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
    c({nome:'ativo',rotulo:'Ativar recuperação automática para novos carrinhos',tipo:'checkbox',valor:cfg.ativo})+
    '<p class="texto-pequeno">Ao ativar, somente carrinhos com atividade posterior à ativação poderão receber mensagens. Requer autorização para ofertas no cadastro do cliente e a Evolution API conectada.</p>'+
    '<div class="linha" style="display:flex;gap:15px;flex-wrap:wrap">'+
      c({nome:'primeiroLembreteHoras',rotulo:'Primeiro lembrete após (horas)',tipo:'number',valor:cfg.primeiroLembreteHoras,min:1,max:168,step:1})+
      c({nome:'enviarCupomAposHoras',rotulo:'Enviar cupom após (horas)',tipo:'number',valor:cfg.enviarCupomAposHoras,min:2,max:720,step:1})+
      c({nome:'descontoPercentual',rotulo:'Porcentagem de desconto (%)',tipo:'number',valor:cfg.descontoPercentual,min:0.01,max:50,step:0.01})+
      c({nome:'descontoMaximo',rotulo:'Desconto máximo (R$)',tipo:'text',valor:real(cfg.descontoMaximoCentavos)})+
      c({nome:'compraMinima',rotulo:'Compra mínima (R$)',tipo:'text',valor:real(cfg.compraMinimaCentavos)})+
      c({nome:'validadeHoras',rotulo:'Validade após envio (horas)',tipo:'number',valor:cfg.validadeHoras,min:1,max:720,step:1})+
      c({nome:'intervaloDias',rotulo:'Intervalo mínimo entre ofertas (dias)',tipo:'number',valor:cfg.intervaloDias,min:1,max:365,step:1})+
    '</div>'+
    c({nome:'apenasPrimeiraCompra',rotulo:'Cupom exclusivo para primeira compra aprovada',tipo:'checkbox',valor:cfg.apenasPrimeiraCompra})+
    '<p class="texto-pequeno">Cupons individuais são vinculados à conta e aos produtos da seleção original. O limite e o prazo são validados no servidor. Nenhum desconto acumula com outro cupom. A validade começa na confirmação do envio.</p>'+
    '<p><button type="submit" class="botao destaque">Salvar configurações</button></p></form>';
  const linhas=resumo.linhas.map(x=>
    '<tr><td>'+e(data(x.criadoEm))+'</td><td>'+e(x.nome)+'</td>'+
    '<td>'+e(x.tipo==='cupom'?'Cupom':'Lembrete')+'</td>'+
    '<td><strong>'+e(x.codigo)+'</strong></td>'+
    '<td>'+e(x.situacao)+'</td>'+
    '<td>'+e(data(x.expiraEm))+'</td>'+
    '<td>'+(x.cupomId && x.ativo
      ? '<form method="post" action="/admin/recuperacao-vendas/cupons/'+encodeURIComponent(x.cupomId)+'/cancelar">'+
          '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
          '<button type="submit" class="botao secundario pequeno">Cancelar cupom</button></form>'
      : '—')+'</td></tr>'
  ).join('');
  const historico='<div class="tabela-rolagem"><table class="tabela">'+
    '<thead><tr><th>Criado em</th><th>Cliente</th><th>Tipo</th><th>Código</th><th>WhatsApp</th><th>Expiração</th><th>Ação</th></tr></thead>'+
    '<tbody>'+(linhas||'<tr><td colspan="7">Nenhuma campanha criada.</td></tr>')+'</tbody></table></div>';
  const indicadores='<div style="display:flex;flex-wrap:wrap;gap:10px">'+
    linhaResumo('Carrinhos com cliente',resumo.carrinhosElegiveis)+
    linhaResumo('Lembretes criados',resumo.lembretes)+
    linhaResumo('Cupons individuais',resumo.cuponsGerados)+
    linhaResumo('Mensagens enviadas',resumo.enviados)+
    linhaResumo('Pedidos pagos recuperados',resumo.recuperados)+
    linhaResumo('Receita recuperada','R$ '+real(resumo.receitaRecuperadaCentavos))+'</div>';
  return paginaAdmin(ctx,{
    titulo:'Recuperação Inteligente de Vendas',ativo:'recuperacao_vendas',
    conteudo:'<h1>🛒 Recuperação Inteligente de Vendas</h1>'+
      '<p>Recupere carrinhos autorizados usando o <strong>mesmo número e instância da Evolution API dos pedidos</strong>. '+
      'As mensagens usam ❤️ e o lema <strong>Farmácia Pague Pouco, cuidando da sua saúde.</strong></p>'+
      (erro?'<div class="alerta erro" role="alert">'+e(erro)+'</div>':'')+
      '<p class="texto-pequeno">Estado: <strong>'+(cfg.ativo?'Ativado':'Desativado')+'</strong>. '+
        'Apenas clientes com consentimento de ofertas e carrinhos recentes elegíveis são contatados. '+
        'Pedidos em andamento ou pagos interrompem os envios. '+
        'O cliente pode cancelar ofertas em Minha conta → Meus dados.</p>'+
      indicadores+
      painel({titulo:'Configurações da campanha e do cupom',corpo:form})+
      painel({titulo:'Histórico das últimas 100 ações',corpo:historico,semPadding:true})+
      '<p class="texto-pequeno">Receita recuperada conta somente pedidos com pagamento aprovado e cupom individual utilizado. '+
        'A entrega pelo WhatsApp depende da conexão ativa e do aceite do cliente. '+
        'Produtos com classificação sanitária sensível não participam desta automação.</p>',
  });
}
