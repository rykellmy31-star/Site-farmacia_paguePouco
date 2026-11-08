/** Painel exclusivo e responsivo de recuperação consentida de carrinhos. */
import { paginaAdmin, painel, campoAdmin } from './layout.js';
import { escapeHtml as e } from '../../lib/security.js';
import { TIPOS_TESTE_RECUPERACAO } from '../../lib/recuperacao-teste-whatsapp.js';

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
export function telaRecuperacaoVendas(ctx,{cfg,cfgLocal,cfgPedido,resumo,erro='',testeStatus=''}) {
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
  const pedido = cfgPedido || {
    ativo:false,primeiroLembreteHoras:1,enviarCupomAposHoras:4,
    descontoPercentual:7,descontoMaximoCentavos:2000,
    compraMinimaCentavos:6000,validadeHoras:24,intervaloDias:15,
    apenasPrimeiraCompra:true,
  };
  const formPedido = '<form method="post" action="/admin/recuperacao-vendas/pedidos/configurar">'+
    '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
    c({nome:'ativo',rotulo:'Ativar recuperação global de pagamentos online não confirmados',tipo:'checkbox',valor:pedido.ativo})+
    '<p class="texto-pequeno">Funciona separadamente dos carrinhos globais e locais. '+
    'Acompanha pedidos com pagamento online gerado (Pix ou cartão, conforme disponibilidade). Envia lembrete somente após '+
    'confirmar no Mercado Pago que a cobrança continua pendente. '+
    'Cupom para uma nova compra somente após a cobrança anterior ser confirmada como expirada ou recusada. '+
    'Não gera nova cobrança automaticamente e não altera o valor do pagamento anterior.</p>'+
    '<div style="display:flex;flex-wrap:wrap;gap:15px">'+
      c({nome:'primeiroLembreteHoras',rotulo:'Lembrete de pagamento após (horas)',tipo:'number',valor:pedido.primeiroLembreteHoras,min:1,max:168,step:1})+
      c({nome:'enviarCupomAposHoras',rotulo:'Cupom de pedido não pago após (horas)',tipo:'number',valor:pedido.enviarCupomAposHoras,min:2,max:720,step:1})+
      c({nome:'descontoPercentual',rotulo:'Desconto para pedido não pago (%)',tipo:'number',valor:pedido.descontoPercentual,min:0.01,max:50,step:0.01})+
      c({nome:'descontoMaximo',rotulo:'Desconto máximo (R$)',tipo:'text',valor:real(pedido.descontoMaximoCentavos)})+
      c({nome:'compraMinima',rotulo:'Compra mínima (R$)',tipo:'text',valor:real(pedido.compraMinimaCentavos)})+
      c({nome:'validadeHoras',rotulo:'Validade do cupom (horas)',tipo:'number',valor:pedido.validadeHoras,min:1,max:720,step:1})+
      c({nome:'intervaloDias',rotulo:'Intervalo entre cupons de pedidos (dias)',tipo:'number',valor:pedido.intervaloDias,min:1,max:365,step:1})+
    '</div>'+
    c({nome:'apenasPrimeiraCompra',rotulo:'Desconto de pedido somente para primeira compra aprovada',tipo:'checkbox',valor:pedido.apenasPrimeiraCompra})+
    '<p class="texto-pequeno">Os dois cupons globais são independentes. Apenas clientes que '+
    'autorizaram receber ofertas são contatados; itens sanitários sensíveis ficam excluídos. '+
    'Se o pagamento for aprovado, os contatos param. A validade começa quando a mensagem é enviada.</p>'+
    '<p><button type="submit" class="botao destaque">Salvar recuperação de pedidos não pagos</button></p></form>';
  const local = cfgLocal || {
    ativo:false,primeiroLembreteHoras:1,enviarCupomAposHoras:4,
    descontoPercentual:5,descontoMaximoCentavos:1500,
    compraMinimaCentavos:6000,validadeHoras:48,intervaloDias:15,
    apenasPrimeiraCompra:true,
  };
  const formLocal = '<form method="post" action="/admin/recuperacao-vendas/local/configurar">'+
    '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
    c({nome:'ativo',rotulo:'Ativar recuperação automática de vendas locais',tipo:'checkbox',valor:local.ativo})+
    '<p class="texto-pequeno">Configuração independente da recuperação nacional. '+
    'Atualmente, o checkout permite pagamento presencial apenas para o MESMO CEP da sede. '+
    'O cliente precisa ter esse CEP no carrinho ou como endereço principal na conta. '+
    'Sem endereço conhecido, nenhuma modalidade é presumida.</p>'+
    '<div style="display:flex;flex-wrap:wrap;gap:15px">'+
      c({nome:'primeiroLembreteHoras',rotulo:'Primeiro lembrete local após (horas)',tipo:'number',valor:local.primeiroLembreteHoras,min:1,max:168,step:1})+
      c({nome:'enviarCupomAposHoras',rotulo:'Enviar cupom local após (horas)',tipo:'number',valor:local.enviarCupomAposHoras,min:2,max:720,step:1})+
      c({nome:'descontoPercentual',rotulo:'Desconto local (%)',tipo:'number',valor:local.descontoPercentual,min:0.01,max:50,step:0.01})+
      c({nome:'descontoMaximo',rotulo:'Desconto máximo local (R$)',tipo:'text',valor:real(local.descontoMaximoCentavos)})+
      c({nome:'compraMinima',rotulo:'Compra mínima local (R$)',tipo:'text',valor:real(local.compraMinimaCentavos)})+
      c({nome:'validadeHoras',rotulo:'Validade do cupom local (horas)',tipo:'number',valor:local.validadeHoras,min:1,max:720,step:1})+
      c({nome:'intervaloDias',rotulo:'Intervalo mínimo entre ofertas locais (dias)',tipo:'number',valor:local.intervaloDias,min:1,max:365,step:1})+
    '</div>'+
    c({nome:'apenasPrimeiraCompra',rotulo:'Cupom local somente para primeira compra',tipo:'checkbox',valor:local.apenasPrimeiraCompra})+
    '<p class="texto-pequeno">O cupom é individual e pode ser utilizado uma única vez no pedido. '+
    'O pedido é registrado como aguardando pagamento presencial; a venda só entra na receita recuperada '+
    'quando a equipe confirmar o recebimento. As mensagens param após a criação do pedido. '+
    'Somente WhatsApp de clientes autorizados e itens promocionais elegíveis.</p>'+
    '<p><button type="submit" class="botao destaque">Salvar recuperação local</button></p></form>';
  const estadosTeste={
    enviado:['sucesso','A Evolution API aceitou o envio. Confira se a mensagem chegou ao número informado.'],
    evolution:['erro','Evolution API indisponível. Confira a conexão na aba WhatsApp Evolution.'],
    intervalo:['erro','Aguarde pelo menos 60 segundos antes de fazer outro teste.'],
    numero:['erro','Informe um WhatsApp válido com DDD (e DDI 55, se desejar).'],
    tipo:['erro','Selecione o modelo de mensagem para testar.'],
    autorizacao:['erro','Confirme que o número informado autorizou receber esta mensagem de teste.'],
    recusado:['erro','A Evolution API recusou o envio. Verifique a conexão e o número e tente novamente depois.'],
    verificar:['erro','Não foi possível confirmar a resposta da Evolution. Verifique o WhatsApp antes de repetir para evitar mensagem duplicada.'],
  };
  const estadoTeste=Object.hasOwn(estadosTeste,testeStatus)?estadosTeste[testeStatus]:null;
  const painelTeste='<section id="teste-whatsapp-recuperacao">'+
    '<p>Envie uma <strong>mensagem real de teste</strong> para um número autorizado, '+
    'usando o mesmo WhatsApp conectado na Evolution API. Escolha o modelo abaixo; '+
    'o texto será claramente identificado como <strong>TESTE</strong>.</p>'+
    (estadoTeste?'<div class="alerta '+estadoTeste[0]+'" role="status">'+e(estadoTeste[1])+'</div>':'')+
    '<form method="post" action="/admin/recuperacao-vendas/testar-whatsapp">'+
    '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
    '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">'+
      '<div style="flex:1;min-width:200px"><label for="testeNumeroRecuperacao"><strong>WhatsApp destinatário</strong></label>'+
      '<input id="testeNumeroRecuperacao" class="entrada" type="tel" name="numero" required '+
        'inputmode="tel" maxlength="24" autocomplete="off" placeholder="(73) 99999-9999"></div>'+
      '<div style="flex:2;min-width:240px"><label for="testeModeloRecuperacao"><strong>Mensagem para testar</strong></label>'+
      '<select id="testeModeloRecuperacao" class="entrada" name="tipo" required>'+
        Object.entries(TIPOS_TESTE_RECUPERACAO).map(([value,label])=>
          '<option value="'+e(value)+'">'+e(label)+'</option>').join('')+
      '</select></div>'+
    '</div>'+
    '<p><label><input type="checkbox" name="confirmado" value="1" required> '+
      'Confirmo que este número é meu ou autorizou receber a mensagem de teste.</label></p>'+
    '<p><button type="submit" class="botao destaque">📲 Enviar mensagem de teste</button></p>'+
    '</form>'+
    '<p class="texto-pequeno">Envio imediato por clique, sem esperar 1 hora. '+
    'Não gera cupons, pedidos, cobranças ou campanhas e não altera métricas. '+
    'Há intervalo mínimo de 60 segundos entre testes. O aceite pela API não garante a entrega no aparelho.</p>'+
    '</section>';
  const linhas=resumo.linhas.map(x=>
    '<tr><td>'+e(data(x.criadoEm))+'</td><td>'+e(x.nome)+'</td>'+
    '<td>'+e(x.modo==='local'?'🏪 Local':x.modo==='pedido'?'💳 Pedido não pago':'🌎 Carrinho global')+'</td>'+ 
    '<td>'+e(['cupom','pedido_cupom'].includes(x.tipo)?'Cupom':'Lembrete')+'</td>'+
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
    '<thead><tr><th>Criado em</th><th>Cliente</th><th>Modalidade</th><th>Tipo</th><th>Código</th><th>WhatsApp</th><th>Expiração</th><th>Ação</th></tr></thead>'+
    '<tbody>'+(linhas||'<tr><td colspan="8">Nenhuma campanha criada.</td></tr>')+'</tbody></table></div>';
  const indicadores='<div style="display:flex;flex-wrap:wrap;gap:10px">'+
    linhaResumo('Carrinhos com cliente',resumo.carrinhosElegiveis)+
    linhaResumo('Lembretes criados',resumo.lembretes)+
    linhaResumo('Cupons individuais',resumo.cuponsGerados)+
    linhaResumo('Cupons locais',resumo.cuponsLocais)+
    linhaResumo('Cupons nacionais',resumo.cuponsNacionais)+
    linhaResumo('Lembretes de pagamento',resumo.lembretesPedidos)+
    linhaResumo('Cupons de pedidos não pagos',resumo.cuponsPedidos)+
    linhaResumo('Pedidos online pendentes',resumo.pedidosOnlinePendentes)+
    linhaResumo('Mensagens enviadas',resumo.enviados)+
    linhaResumo('Pedidos pagos recuperados',resumo.recuperados)+
    linhaResumo('Receita recuperada','R$ '+real(resumo.receitaRecuperadaCentavos))+
    linhaResumo('Pedidos locais gerados',resumo.pedidosLocaisGerados)+
    linhaResumo('Pedidos locais pagos',resumo.pedidosLocaisPagos)+
    linhaResumo('Receita local recebida','R$ '+real(resumo.receitaLocalCentavos))+'</div>';
  return paginaAdmin(ctx,{
    titulo:'Recuperação Inteligente de Vendas',ativo:'recuperacao_vendas',
    conteudo:'<h1>🛒 Recuperação Inteligente de Vendas</h1>'+
      '<p>Recupere carrinhos autorizados usando o <strong>mesmo número e instância da Evolution API dos pedidos</strong>. '+
      'As mensagens usam ❤️ e o lema <strong>Farmácia Pague Pouco, cuidando da sua saúde.</strong></p>'+
      (erro?'<div class="alerta erro" role="alert">'+e(erro)+'</div>':'')+
      '<p class="texto-pequeno">Carrinho global: <strong>'+(cfg.ativo?'Ativado':'Desativado')+'</strong> • Pagamento não confirmado: <strong>'+(pedido.ativo?'Ativado':'Desativado')+'</strong> • Local: <strong>'+(local.ativo?'Ativado':'Desativado')+'</strong>. '+
        'Apenas clientes com consentimento de ofertas, endereço conhecido e carrinhos recentes elegíveis são contatados. '+
        'Quando um pedido é gerado, o carrinho para de enviar mensagens. Pedidos online não pagos seguem suas regras próprias; após pagamento aprovado, a recuperação é interrompida. '+
        'O cliente pode cancelar ofertas em Minha conta → Meus dados.</p>'+
      indicadores+
      painel({titulo:'📲 Testar envio de recuperação pelo WhatsApp',corpo:painelTeste})+
      painel({titulo:'🌎 Carrinho global abandonado — configurações e cupons',corpo:form})+
      painel({titulo:'💳 Pagamento global pendente — configurações e cupons',corpo:formPedido})+
      painel({titulo:'🏪 Recuperação local — configurações e cupons',corpo:formLocal})+
      painel({titulo:'Histórico das últimas 100 ações',corpo:historico,semPadding:true})+
      '<p class="texto-pequeno">Receita recuperada conta somente pedidos com pagamento aprovado e cupom individual utilizado. '+
        'A entrega pelo WhatsApp depende da conexão ativa e do aceite do cliente. '+
        'Produtos com classificação sanitária sensível não participam desta automação.</p>',
  });
}
