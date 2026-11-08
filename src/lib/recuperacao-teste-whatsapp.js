/**
 * Teste MANUAL, isolado e pontual das mensagens de recuperação.
 * Usa a mesma Evolution da farmácia; não interage com campanhas,
 * clientes, cupons, carrinhos, pedidos, pagamentos nem estoque.
 * Resposta externa jamais é exibida ou armazenada (pode conter segredos).
 */
import { numeroWhatsapp, evolutionConfig } from './evolution-whatsapp.js';
import { credenciaisEvolution } from './evolution-connection.js';
import { configRecuperacao, configRecuperacaoLocal, configRecuperacaoPedido } from './recuperacao-vendas.js';
import { config } from '../config.js';

const TESTE_ID='testeRecuperacaoWhatsapp';
export const TIPOS_TESTE_RECUPERACAO=Object.freeze({
  carrinho_global_lembrete:'🌎 Carrinho global — lembrete',
  carrinho_global_cupom:'🌎 Carrinho global — cupom',
  pagamento_pendente_lembrete:'💳 Pagamento global pendente — lembrete',
  pagamento_encerrado_cupom:'💳 Pagamento global não concluído — cupom',
  carrinho_local_lembrete:'🏪 Carrinho local — lembrete',
  carrinho_local_cupom:'🏪 Carrinho local — cupom',
});
const brl=centavos=>(Number(centavos||0)/100).toLocaleString('pt-BR',{
  style:'currency',currency:'BRL',
});
function textoTeste(db,tipo) {
  const sitio=String(config.publicBaseUrl||'https://site.farmaciapaguepouco.app').replace(/\/+$/,'');
  const modo=tipo.startsWith('carrinho_local_')?'local':
    tipo.startsWith('pagamento_')?'pedido':'nacional';
  const cfg=modo==='local'?configRecuperacaoLocal(db):
    modo==='pedido'?configRecuperacaoPedido(db):configRecuperacao(db);
  const desconto=String(cfg.descontoPercentual).replace('.',',');
  const cupom='🎟️ Exemplo de cupom: *TESTE-SEM-VALIDADE* ('+desconto+
    '% até '+brl(cfg.descontoMaximoCentavos)+
    ', compra mínima '+brl(cfg.compraMinimaCentavos)+
    ', validade configurada: '+cfg.validadeHoras+' horas).\n';
  let mensagem='';
  switch(tipo){
    case 'carrinho_global_lembrete':
      mensagem='🛒 Sua seleção ainda está esperando no carrinho!\nRetome sua compra pelo site: '+sitio;
      break;
    case 'carrinho_global_cupom':
      mensagem='🛒 Você deixou produtos no carrinho.\n'+cupom+'Retome sua compra: '+sitio;
      break;
    case 'pagamento_pendente_lembrete':
      mensagem='💳 O pagamento do pedido de exemplo *#TESTE-123* ainda não foi confirmado.\n'+
        'Confira o pedido no site, sem gerar uma cobrança duplicada: '+sitio;
      break;
    case 'pagamento_encerrado_cupom':
      mensagem='💳 A cobrança de exemplo foi encerrada sem aprovação.\n'+
        cupom+'Você pode retomar a compra e gerar um novo pagamento pelo site: '+sitio;
      break;
    case 'carrinho_local_lembrete':
      mensagem='🛒 Sua seleção está esperando!\n🏪 Finalize pelo site e pague na retirada ou no recebimento da entrega local: '+sitio;
      break;
    case 'carrinho_local_cupom':
      mensagem='🏪 Seu carrinho local está esperando.\n'+cupom+
        'Finalize no site e pague na retirada ou no recebimento: '+sitio;
      break;
    default:
      return '';
  }
  return '🧪 *TESTE DE RECUPERAÇÃO — FARMÁCIA PAGUE POUCO*\n'+
    mensagem+'\n\n❤️ *Farmácia Pague Pouco, cuidando da sua saúde.*\n\n'+
    '⚠️ Simulação administrativa: nenhum pedido, pagamento ou cupom foi criado. '+
    'O código de exemplo NÃO é válido para compras.';
}
export function prepararTesteRecuperacao(db,{numero,tipo,confirmado}={}) {
  if (!Object.hasOwn(TIPOS_TESTE_RECUPERACAO,String(tipo||'')))
    return {ok:false,codigo:'tipo'};
  const telefone=numeroWhatsapp(numero);
  if(!telefone) return {ok:false,codigo:'numero'};
  if(confirmado!==true) return {ok:false,codigo:'autorizacao'};
  const texto=textoTeste(db,tipo);
  if(!texto) return {ok:false,codigo:'tipo'};
  return {ok:true,telefone,texto,tipo};
}
export async function enviarTesteRecuperacao(db,env={},dados={},{
  enviar=globalThis.fetch,agora=Date.now(),
}={}){
  const teste=prepararTesteRecuperacao(db,dados);
  if(!teste.ok)return teste;
  const cfg=evolutionConfig(db);
  const {baseUrl,apiKey,configurado}=credenciaisEvolution(db,env);
  if(!cfg.ativo||!configurado||!/^[a-zA-Z0-9_-]{2,64}$/.test(String(cfg.instancia||'')))
    return {ok:false,codigo:'evolution'};
  const col=db.collection('settings');
  const anterior=col.get(TESTE_ID);
  const ultimo=Date.parse(anterior?.ultimaTentativaEm||'');
  if(Number.isFinite(ultimo)&&agora>=ultimo&&agora-ultimo<60_000)
    return {ok:false,codigo:'intervalo'};
  const tentativa={ultimaTentativaEm:new Date(agora).toISOString(),
    ultimaSituacao:'enviando'};
  if(anterior)col.update(TESTE_ID,tentativa);
  else col.insert({id:TESTE_ID,...tentativa});
  // Uma única tentativa por clique, sem retentativas quando o provedor
  // demora ou a resposta é desconhecida.
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),7000);
  try {
    const resposta=await enviar(baseUrl+'/message/sendText/'+encodeURIComponent(cfg.instancia),{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:apiKey},
      body:JSON.stringify({number:teste.telefone,text:teste.texto}),
      signal:ctrl.signal,redirect:'manual',
    });
    if(resposta.ok){
      col.update(TESTE_ID,{ultimaSituacao:'aceito'});
      return {ok:true,codigo:'enviado'};
    }
    col.update(TESTE_ID,{ultimaSituacao:'recusado'});
    return {ok:false,codigo:'recusado'};
  }catch{
    col.update(TESTE_ID,{ultimaSituacao:'verificar'});
    return {ok:false,codigo:'verificar'};
  }finally{clearTimeout(timeout);}
}
