/** Evolution v2: avisos transacionais; nomes de itens só com autorização v2 do cliente. */
import {getSetting} from './settings.js';
import {nowISO} from './store.js';
const COL='evolutionWhatsappOutbox', CFG='evolutionWhatsapp';
export const DEFAULT_EVOLUTION=Object.freeze({
  ativo:false,baseUrl:'',instancia:'',numeroRemetente:'',numeroResponsavel:'',
  avisarResponsavel:true,avisarCliente:true,
});
const digitos=x=>String(x||'').replace(/\D/g,'');
export function numeroWhatsapp(valor){
  const raw=digitos(valor),n=(raw.length===10||raw.length===11)?'55'+raw:raw;
  return /^55\d{10,11}$/.test(n)?n:'';
}
/** Consentimento explicito do cliente, valido somente para o numero atual. */
export function autorizouWhatsappPedidos(cliente){
  const telefone=numeroWhatsapp(cliente?.telefone);
  const aceite=cliente?.consentimentoWhatsappPedidos;
  return Boolean(telefone&&aceite?.ativo===true&&aceite.numero===telefone);
}
/** Autorizacao para incluir nomes de produtos, inclusive medicamentos, no WhatsApp. */
export function autorizouWhatsappProdutos(cliente){
  return autorizouWhatsappPedidos(cliente)&&Number(cliente?.consentimentoWhatsappPedidos?.versao)>=2;
}
/** Nao confunde pagamento, marketing e autorizacao de contato. */
export function decidirAvisosWhatsappPedido(cliente,configuracao,escolha='',aceiteLegado=false){
  const disponivel=configuracao?.ativo===true&&configuracao?.avisarCliente===true;
  const autorizouAgora=disponivel&&(escolha==='autorizar'||escolha==='autorizar_detalhes'||aceiteLegado===true);
  const previamenteAutorizado=autorizouWhatsappPedidos(cliente);
  return {
    autorizouAgora,
    avisarCliente:disponivel&&(autorizouAgora||
      (escolha!=='sem'&&previamenteAutorizado)),
  };
}
export function hostValido(url){
  if(!/^https:\/\//i.test(String(url||'')))return false;
  try{
    const u=new URL(url),h=u.hostname.toLowerCase();
    return !u.username&&!u.password&&!u.search&&!u.hash&&
      (u.pathname==='/'||u.pathname==='')&&
      h.includes('.')&&!h.includes(':')&&!h.endsWith('.local')&&
      !h.endsWith('.localhost')&&!h.endsWith('.internal')&&
      h!=='localhost'&&!/^(\d{1,3}\.){3}\d{1,3}$/.test(h);
  }catch{return false;}
}
export function validarEvolutionConfig(entrada){
  const baseUrl=String(entrada.baseUrl||'').trim().replace(/\/+$/,'');
  const instancia=String(entrada.instancia||'').trim();
  const numeroRemetente=numeroWhatsapp(entrada.numeroRemetente);
  const numeroResponsavel=numeroWhatsapp(entrada.numeroResponsavel);
  if(baseUrl&&!hostValido(baseUrl))
    return {ok:false,erro:'Use uma URL HTTPS pública, sem caminhos ou parâmetros.'};
  if(instancia&&!/^[a-zA-Z0-9_-]{2,64}$/.test(instancia))
    return {ok:false,erro:'Instância inválida: letras, números, - e _.'};
  if(entrada.numeroRemetente&&!numeroRemetente)
    return {ok:false,erro:'Número da farmácia inválido. Use DDI 55, DDD e número.'};
  if(entrada.numeroResponsavel&&!numeroResponsavel)
    return {ok:false,erro:'Número do responsável inválido. Use DDI 55, DDD e número.'};
  const cfg={ativo:entrada.ativo===true,baseUrl,instancia,numeroRemetente,
    numeroResponsavel,avisarResponsavel:entrada.avisarResponsavel===true,
    avisarCliente:entrada.avisarCliente===true};
  if(cfg.ativo&&(!cfg.baseUrl||!cfg.instancia||
    (cfg.avisarResponsavel&&!cfg.numeroResponsavel)||
    (!cfg.avisarResponsavel&&!cfg.avisarCliente)))
    return {ok:false,erro:'Configure o endereço da Evolution no servidor, informe a instância e o destinatário dos avisos.'};
  return {ok:true,config:cfg};
}
export function evolutionConfig(db){return {...DEFAULT_EVOLUTION,...(getSetting(db,CFG)||{})};}
const nomeSeguro=nome=>String(nome||'cliente').replace(/[\r\n\t*~_<>\x60]/g,' ').trim().slice(0,50)||'cliente';
const codigoSeguro=x=>String(x||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,45);
const nomeProdutoSeguro=nome=>String(nome||'').replace(/[\x00-\x1f\x7f*~_<>`]/g,' ')
  .replace(/\s+/g,' ').trim().slice(0,140);
/** Usa o nome gravado no pedido, sem consultar um catálogo que pode ter mudado. */
function resumoItensWhatsapp(pedido){
  if(pedido?.enviarItensWhatsappPedido!==true||!Array.isArray(pedido.itens))return '';
  const nomes=pedido.itens.map(item=>{
    const nome=nomeProdutoSeguro(item?.nome);
    if(!nome)return '';
    const qtd=Number(item?.quantidade);
    return Number.isSafeInteger(qtd)&&qtd>1?String(qtd)+'x '+nome:nome;
  }).filter(Boolean);
  if(!nomes.length)return '';
  let lista='';
  for(let i=0;i<nomes.length;i++){
    const proximo=(lista?', ':'')+nomes[i];
    if(lista.length+proximo.length>2800)
      return ' ('+lista+'; mais '+(nomes.length-i)+' item(ns) no site)';
    lista+=proximo;
  }
  return ' ('+lista+')';
}
export function enfileirarEvolution(db,pedido,tipo){
  const cfg=evolutionConfig(db);
  if(!cfg.ativo||!cfg.instancia)return {ok:false,motivo:'desativado'};
  if(!pedido?.id||!pedido.codigo||!['cliente_recebido','cliente_pago','responsavel_pago'].includes(tipo))
    return {ok:false,motivo:'pedido_invalido'};
  if(['cliente_recebido','cliente_pago'].includes(tipo)&&(!cfg.avisarCliente||pedido.receberWhatsappPedido!==true))
    return {ok:false,motivo:'sem_optin'};
  if(tipo==='cliente_pago'&&pedido.statusFinanceiro!=='aprovado')
    return {ok:false,motivo:'ainda_nao_pago'};
  if(tipo==='responsavel_pago'&&(!cfg.avisarResponsavel||pedido.statusFinanceiro!=='aprovado'))
    return {ok:false,motivo:'ainda_nao_pago'};
  const numero=tipo==='responsavel_pago'?numeroWhatsapp(cfg.numeroResponsavel):
    numeroWhatsapp(pedido.cliente?.telefone);
  if(!numero)return {ok:false,motivo:'sem_numero'};
  const id='evo:'+String(pedido.id)+':'+tipo,col=db.collection(COL);
  if(col.get(id))return {ok:true,duplicado:true};
  const codigo=codigoSeguro(pedido.codigo);
  const itens=resumoItensWhatsapp(pedido);
  const texto=tipo==='responsavel_pago'
    ? '🔔 FARMÁCIA PAGUE POUCO\n✅ Pedido PAGO!\n📦 Pedido: #'+codigo+itens+
      '\nO pagamento foi confirmado. Acesse o painel para separar o pedido.'
    : tipo==='cliente_pago'
    ? 'Olá, '+nomeSeguro(pedido.cliente?.nome)+'! ✅\n'+
      'O pagamento do seu pedido #'+codigo+itens+' na Farmácia Pague Pouco foi confirmado!\n'+
      'Nossa equipe vai preparar seu pedido. Acompanhe o andamento pelo site.\n'+
      'Esta mensagem é automática.'
    : 'Olá, '+nomeSeguro(pedido.cliente?.nome)+'! 👋\n'+
      'A Farmácia Pague Pouco recebeu seu pedido #'+codigo+itens+'.\n'+
      'Quando o pagamento for confirmado pelo site (até 10 minutos), seu pedido será enviado para separação!\n'+
      'Acompanhe seu pedido pelo site. Esta mensagem é automática.';
  col.insert({id,pedidoId:pedido.id,tipo,numero,texto,status:'fila',
    criadoEm:nowISO(),tentativas:0});
  return {ok:true,enfileirado:true};
}
export function resumoEvolution(db){
  const x=db.collection(COL).all();
  return {fila:x.filter(v=>v.status==='fila').length,
    enviados:x.filter(v=>v.status==='enviado').length,
    verificar:x.filter(v=>v.status==='verificar').length,
    falhas:x.filter(v=>v.status==='falha').length,
    recentes:x.slice().sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .slice(0,12).map(v=>({id:v.id,pedidoId:v.pedidoId,tipo:v.tipo,
        status:v.status,criadoEm:v.criadoEm,enviadoEm:v.enviadoEm||null}))};
}
export function possuiFilaEvolution(db){
  return db.collection(COL).all().some(x=>x.status==='fila');
}
/** Uma tentativa automática por evento para impedir reenvio após timeout incerto. */
export async function processarFilaEvolution(db,{apiKey='',baseUrl='',enviar=globalThis.fetch,
  persistir=async()=>{},max=3}={}){
  const cfg=evolutionConfig(db);
  const urlBase=String(baseUrl||cfg.baseUrl||'').trim().replace(/\/+$/,'');
  if(!cfg.ativo||!urlBase||!cfg.instancia||!String(apiKey).trim()||
      !hostValido(urlBase))return {ativo:false,processados:0};
  const col=db.collection(COL);
  const fila=col.all().filter(i=>i.status==='fila').slice(0,Math.max(1,Math.min(max,5)));
  let enviados=0,verificar=0;
  for(const item of fila){
    if(col.get(item.id)?.status!=='fila')continue;
    col.update(item.id,{status:'enviando',tentativas:1,tentadoEm:nowISO()});
    await persistir(); // escrita durável ANTES do envio externo
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
      let response;
      try{
        response=await enviar(urlBase+'/message/sendText/'+encodeURIComponent(cfg.instancia),{
          method:'POST',headers:{'Content-Type':'application/json',apikey:String(apiKey)},
          body:JSON.stringify({number:item.numero,text:item.texto}),
          signal:controller.signal,redirect:'manual', // Workers nao aceita redirect:error
        });
      }finally{clearTimeout(timer);}
      if(response.ok){col.update(item.id,{status:'enviado',enviadoEm:nowISO(),texto:null});enviados++;}
      else if([400,401,403,404].includes(response.status)){
        col.update(item.id,{status:'falha',codigoHttp:response.status,atualizadoEm:nowISO(),texto:null});
      }else{
        col.update(item.id,{status:'verificar',codigoHttp:response.status,atualizadoEm:nowISO(),texto:null});
        verificar++;
      }
    }catch{
      col.update(item.id,{status:'verificar',atualizadoEm:nowISO(),texto:null});
      verificar++;
    }
    await persistir();
  }
  return {ativo:true,processados:fila.length,enviados,verificar};
}
