/** Configuração independente do botão WhatsApp público. */
import {paginaAdmin,painel,campoAdmin} from './layout.js';
import {escapeHtml as e} from '../../lib/security.js';

export function telaEvolutionWhatsapp(ctx,{cfg,resumo}){
  const campo=(nome,rotulo,dica='')=>campoAdmin({nome,rotulo,valor:cfg[nome]||'',dica});
  const check=(nome,rotulo)=>campoAdmin({nome,rotulo,tipo:'checkbox',valor:cfg[nome]===true});
  const rotuloEvento={responsavel_pago:'Equipe — pagamento aprovado',
    cliente_pago:'Cliente — pagamento aprovado',cliente_recebido:'Cliente — pedido recebido'};
  const ultimos=resumo.recentes.map(x=>'<li>Pedido '+e(String(x.pedidoId))+
    ' — '+e(rotuloEvento[x.tipo]||'Notificação')+' — '+e(x.status)+'</li>').join('');
  const cabecalho='<h1>Evolution API — notificações de pedidos</h1>'+
    '<p>Esta integração é exclusiva para avisos de pedidos. Não altera os robôs, '+
    'o Mercado Pago ou o botão de atendimento.</p>'+
    '<p><strong>Status:</strong> '+(cfg.ativo?'Ativa (depende do segredo EVOLUTION_API_KEY e da instância conectada)':
      'Desativada — sem envios automáticos')+'</p>'+
    (ctx.req?.query?.get('salvo')?'<div class="alerta info">Configuração salva.</div>':'');
  const conexao=painel({titulo:'Conexão Evolution API v2',corpo:
    campo('baseUrl','URL pública HTTPS da Evolution API','Ex.: https://evolution.seudominio.com')+
    campo('instancia','Nome da instância exclusiva da farmácia')+
    campo('numeroRemetente','Número que ENVIA (WhatsApp da farmácia)','DDI 55 + DDD + número; a instância deve estar conectada.')+
    campo('numeroResponsavel','Número que RECEBE avisos de pedidos pagos','DDI 55 + DDD + número.')+
    '<div class="alerta info">Cadastre a chave de acesso com o nome '+
    '<strong>EVOLUTION_API_KEY</strong> nas Variáveis e segredos do Worker '+
    'da farmácia na Cloudflare. Nunca digite a chave neste painel.</div>'});
  const regras=painel({titulo:'Ativação e avisos',corpo:
    check('avisarResponsavel','Enviar aviso ao responsável apenas depois do pagamento aprovado')+
    check('avisarCliente','Avisar o cliente no recebimento do pedido e após pagamento aprovado (com autorização no checkout)')+
    check('ativo','Ativar notificações automáticas')+
    '<p class="texto-pequeno">O cliente autoriza no checkout (opção desmarcada por padrão). '+
    'Nenhuma mensagem contém nomes dos medicamentos, CPF ou dados médicos. '+
    'Sem envio retroativo de pedidos anteriores.</p>'});
  const historico=painel({titulo:'Histórico seguro',corpo:
    '<p>Fila: '+resumo.fila+' · Enviados: '+resumo.enviados+
    ' · Verificação: '+resumo.verificar+' · Falhas: '+resumo.falhas+'</p>'+
    '<p class="texto-pequeno">Após falha de resultado incerto, não repetimos a tentativa '+
    'sem conferência para evitar duplicatas.</p>'+
    (ultimos?'<ul>'+ultimos+'</ul>':'<p>Nenhum aviso registrado.</p>')});
  return paginaAdmin(ctx,{titulo:'Evolution API',ativo:'whatsapp',
    conteudo:cabecalho+'<form method="post" action="/admin/evolution-whatsapp">'+
      '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+conexao+regras+
      '<p><button class="botao destaque" type="submit">Salvar Evolution API</button> '+
      '<a class="botao secundario" href="/admin/whatsapp">Voltar</a></p></form>'+historico});
}
