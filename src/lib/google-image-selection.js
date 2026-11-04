/**
 * Google Imagens: escolha explícita e download restrito.
 * Um ticket autenticado vincula imagem encontrada na SERP, EAN e operador.
 * O servidor nunca aceita uma URL arbitrária indicada pelo navegador.
 * Google não concede licença comercial sobre imagens de terceiros.
 */
import {createHmac,timingSafeEqual} from 'node:crypto';
import {eanValido,normalizarEAN} from './busca-medidas-ean.js';

const TEMPO_TICKET=15*60*1000;
const MAX_BYTES=12*1024*1024;

export function urlFotoGoogleSegura(valor){
  if(typeof valor!=='string'||valor.length>1800)return '';
  try{
    const u=new URL(valor);
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
       !host.includes('.')||host.includes(':')||
       /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)||
       /^0x[a-f0-9]+$/i.test(host)||
       /^(?:localhost|metadata\.google\.internal)$/.test(host)||
       /\.(?:localhost|local|internal|test|invalid|onion|home\.arpa)$/.test(host))
      return '';
    return u.href;
  }catch{return ''}
}
function assinatura(conteudo,segredo){
  return createHmac('sha256',segredo).update(conteudo).digest('base64url');
}
export function criarTicketGoogle(imagem,{ean,adminId,segredo,agora=Date.now()}={}){
  const url=urlFotoGoogleSegura(imagem?.url);
  const normalizado=normalizarEAN(ean);
  if(!url||!eanValido(normalizado)||!adminId||!segredo)return '';
  const p={
    url,ean:normalizado,adminId:String(adminId),
    pagina:urlFotoGoogleSegura(imagem?.pagina)||'',
    titulo:String(imagem?.titulo||'').slice(0,180),
    exp:agora+TEMPO_TICKET
  };
  const dados=Buffer.from(JSON.stringify(p)).toString('base64url');
  return dados+'.'+assinatura(dados,segredo);
}
export function validarTicketGoogle(ticket,{ean,adminId,segredo,agora=Date.now()}={}){
  if(typeof ticket!=='string'||ticket.length>4400||!segredo||!adminId)return null;
  const [dados,assinada,extra]=ticket.split('.');
  if(extra!==undefined||!dados||!assinada)return null;
  const certa=assinatura(dados,segredo);
  const a=Buffer.from(assinada),b=Buffer.from(certa);
  if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  try{
    const p=JSON.parse(Buffer.from(dados,'base64url').toString('utf8'));
    if(!p||p.adminId!==String(adminId)||!Number.isSafeInteger(p.exp)||
       p.exp<agora||p.exp>agora+TEMPO_TICKET||
       !eanValido(p.ean)||p.ean!==normalizarEAN(ean)||
       !urlFotoGoogleSegura(p.url))return null;
    return {url:p.url,ean:p.ean,pagina:urlFotoGoogleSegura(p.pagina)||'',
      titulo:String(p.titulo||'').slice(0,180)};
  }catch{return null}
}

function detectarTipoImagem(bytes){
  if(bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return 'image/png';
  if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&
     bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return '';
}
async function lerImagemLimitada(resp){
  const tamanho=Number(resp.headers?.get?.('content-length')||0);
  if(tamanho>MAX_BYTES)throw Error('grande');
  if(!resp.body?.getReader){
    const bytes=Buffer.from(await resp.arrayBuffer());
    if(bytes.length>MAX_BYTES)throw Error('grande');
    return bytes;
  }
  const partes=[];let total=0;
  const reader=resp.body.getReader();
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BYTES)throw Error('grande');
      partes.push(Buffer.from(value));
    }
    return Buffer.concat(partes,total);
  }finally{
    try{await reader.cancel()}catch{}
    reader.releaseLock?.();
  }
}
/** Baixa somente a URL assinada; no máximo dois redirects HTTPS seguros. */
export async function baixarFotoGoogleEscolhida(url,{
  fetcher=globalThis.fetch,timeoutMs=11500
}={}){
  let atual=urlFotoGoogleSegura(url);
  if(!atual)return {ok:false,motivo:'A origem da imagem não é permitida.'};
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    for(let redirecionamentos=0;redirecionamentos<=2;redirecionamentos++){
      if(!urlFotoGoogleSegura(atual))
        return {ok:false,motivo:'A origem da imagem não é segura.'};
      const resp=await fetcher(atual,{
        method:'GET',redirect:'manual',signal:ctrl.signal,
        headers:{Accept:'image/png,image/jpeg,image/webp;q=0.9'}
      });
      if([301,302,303,307,308].includes(resp.status)){
        const destino=resp.headers?.get?.('location');
        if(!destino||redirecionamentos===2)
          return {ok:false,motivo:'A imagem redirecionou muitas vezes.'};
        atual=urlFotoGoogleSegura(new URL(destino,atual).href);
        if(!atual)return {ok:false,motivo:'A imagem redirecionou para origem não permitida.'};
        continue;
      }
      if(!resp.ok)return {ok:false,motivo:'A fonte da imagem não permitiu o download. Escolha outra foto.'};
      const bytes=await lerImagemLimitada(resp);
      const mime=detectarTipoImagem(bytes);
      if(!mime)return {ok:false,motivo:'A imagem encontrada não possui formato JPG, PNG ou WEBP válido.'};
      return {ok:true,bytes,mime};
    }
  }catch(e){
    return {ok:false,motivo:e?.message==='grande'?
      'A imagem é maior que 12 MB. Escolha outra foto.':
      ctrl.signal.aborted?'A fonte demorou demais para fornecer a imagem. Tente outra.':
      'Não foi possível baixar a foto da origem. Escolha outra imagem.'};
  }finally{clearTimeout(timeout)}
  return {ok:false,motivo:'Não foi possível baixar a imagem.'};
}
