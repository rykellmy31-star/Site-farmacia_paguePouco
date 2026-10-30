/** Conexão simplificada da farmácia: instância própria e QR Code no painel. */
import {paginaAdmin,painel,campoAdmin} from './layout.js';
import {escapeHtml as e} from '../../lib/security.js';

export function telaEvolutionWhatsapp(ctx,{cfg,resumo,servidorConfigurado=false}){
  const campo=(nome,rotulo,dica='')=>campoAdmin({nome,rotulo,valor:cfg[nome]||'',dica});
  const check=(nome,rotulo)=>campoAdmin({nome,rotulo,tipo:'checkbox',valor:cfg[nome]===true});
  const rotuloEvento={responsavel_pago:'Equipe — pagamento aprovado',
    cliente_pago:'Cliente — pagamento aprovado',cliente_recebido:'Cliente — pedido recebido'};
  const ultimos=resumo.recentes.map(x=>'<li>Pedido '+e(String(x.pedidoId))+
    ' — '+e(rotuloEvento[x.tipo]||'Notificação')+' — '+e(x.status)+'</li>').join('');
  const cabecalho='<h1>Evolution API — notificações de pedidos</h1>'+
    '<p>Conecte o WhatsApp da farmácia pelo QR Code. Esta integração é exclusiva de avisos de pedidos e não altera o Mercado Pago nem o botão de atendimento.</p>'+
    '<p><strong>Notificações:</strong> '+(cfg.ativo?'Ativadas':'Desativadas')+'</p>'+
    (servidorConfigurado?'':'<div class="alerta info">A conexão ainda precisa das configurações EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor Cloudflare da farmácia.</div>');
  const conexao=painel({titulo:'WhatsApp da farmácia',corpo:
    campo('instancia','Nome da instância exclusiva da farmácia',
      'Use um nome diferente das instâncias dos outros sistemas. Salve antes de conectar.')+
    '<div class="campo"><label>Status da conexão</label>'+
    '<p id="evo-status" role="status" aria-live="polite">Consultando conexão...</p>'+
    '<button type="button" id="evo-gerar-qr" class="botao secundario">Conectar WhatsApp / Gerar QR Code</button>'+
    '<div id="evo-qr-caixa" hidden style="margin-top:16px">'+
    '<p>WhatsApp da farmácia → Aparelhos conectados → Conectar aparelho → Leia o código:</p>'+
    '<img id="evo-qr-imagem" alt="QR Code temporário para conectar o WhatsApp da farmácia" width="260" height="260" style="max-width:100%;height:auto;background:white;padding:8px;border-radius:8px">'+
    '</div><p class="texto-pequeno">O WhatsApp que você conectar será o número remetente. Não é necessário digitá-lo.</p></div>'+
    campo('numeroResponsavel','Número que recebe avisos de pedidos pagos',
      'DDI 55 + DDD + número do responsável. Ex.: 5573999999999.')});
  const regras=painel({titulo:'Ativação e avisos',corpo:
    check('avisarResponsavel','Enviar aviso ao responsável quando o pagamento for aprovado')+
    check('avisarCliente','Avisar o cliente quando o pedido for recebido e quando o pagamento for aprovado')+
    check('ativo','Ativar notificações automáticas')+
    '<p class="texto-pequeno">Os avisos ao cliente respeitam a preferência de WhatsApp salva em sua conta. Nenhuma mensagem contém nomes de medicamentos ou CPF. Sem envios retroativos.</p>'});
  const historico=painel({titulo:'Histórico seguro',corpo:
    '<p>Fila: '+resumo.fila+' · Enviados: '+resumo.enviados+
    ' · Verificação: '+resumo.verificar+' · Falhas: '+resumo.falhas+'</p>'+
    '<p class="texto-pequeno">Em caso de resultado incerto, o sistema não repete automaticamente a mensagem para evitar duplicatas.</p>'+
    (ultimos?'<ul>'+ultimos+'</ul>':'<p>Nenhum aviso registrado.</p>')});
  return paginaAdmin(ctx,{titulo:'Evolution API',ativo:'whatsapp',
    conteudo:cabecalho+'<form method="post" action="/admin/evolution-whatsapp">'+
      '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+conexao+regras+
      '<p><button class="botao destaque" type="submit">Salvar configurações</button> '+
      '<a class="botao secundario" href="/admin/whatsapp">Voltar</a></p></form>'+historico,
    corpoExtra:'<script src="/js/evolution-whatsapp.js?v=20261030" defer></script>'});
}
