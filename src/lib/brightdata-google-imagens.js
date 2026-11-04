/**
 * Consulta somente Google Imagens por EAN via Bright Data SERP API.
 * Pesquisa é somente leitura: resultado de busca NÃO concede direito de uso
 * comercial nem comprova identidade da embalagem. Nenhuma imagem é gravada.
 */
import {eanValido,normalizarEAN} from './busca-medidas-ean.js';

const ENDPOINT='https://api.brightdata.com/request';
const MAX_ITENS=12;

function httpsUrl(value){
  if(typeof value!=='string'||value.length>2000)return '';
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
      /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(u.hostname))return '';
    return u.href;
  }catch{return ''}
}
function normalizarResposta(json){
  let data=json;
  if(typeof data==='string'){try{data=JSON.parse(data)}catch{return null}}
  if(data&&typeof data.body==='string'){try{data=JSON.parse(data.body)}catch{}}
  if(data&&typeof data.data==='object')data=data.data;
  return data&&typeof data==='object'?data:null;
}
function listasDeImagens(dados){
  const listas=[
    dados?.images,dados?.images_results,dados?.image_results,
    dados?.imageResults,dados?.results?.images,dados?.results?.images_results,
  ];
  return listas.find(Array.isArray)||[];
}
export function candidatosGoogleImagens(json,ean){
  const dados=normalizarResposta(json);
  const lista=listasDeImagens(dados);
  const encontrados=[];
  const vistos=new Set();
  for(const item of lista.slice(0,60)){
    if(!item||typeof item!=='object')continue;
    // thumb é apenas prévia. Link da página de origem não é imagem.
    const imagem=httpsUrl(item.original||item.original_image||item.original_image_url||
      item.image_url||item.image?.original||item.image?.url||
      (typeof item.image==='string'?item.image:'')||item.url||
      item.link);
    if(!imagem||vistos.has(imagem))continue;
    vistos.add(imagem);
    const pagina=httpsUrl(item.source_url||item.context_link||item.page_url||
      item.source?.link||item.source?.url||item.source_link||item.link);
    const titulo=String(item.title||item.image_alt||item.alt||item.description||'').slice(0,180);
    const dominio=pagina?new URL(pagina).hostname:new URL(imagem).hostname;
    encontrados.push({
      url:imagem,
      miniatura:httpsUrl(item.thumbnail||item.thumbnail_url||item.thumbnail_image||item.image?.thumbnail)||imagem,
      titulo,origem:dominio,pagina,
      eanMencionado:(titulo+' '+pagina).includes(ean),
      // Identidade, licença e apresentação exigem conferência independente.
      revisaoObrigatoria:true,
    });
    if(encontrados.length>=MAX_ITENS)break;
  }
  return encontrados;
}

export async function consultarGoogleImagensEAN(codigo,{
  apiToken='',zone='',fetcher=globalThis.fetch,timeoutMs=55000,
}={}){
  const ean=normalizarEAN(codigo);
  if(!eanValido(ean))
    return {ok:false,status:400,erro:'EAN inválido.'};
  if(!apiToken||!zone)
    return {ok:false,status:503,erro:'Configure o token e o nome da zona SERP na Cloudflare.'};
  if(!/^[a-zA-Z0-9_-]{2,90}$/.test(zone))
    return {ok:false,status:503,erro:'O nome da zona SERP não é válido.'};
  const google=new URL('https://www.google.com/search');
  google.searchParams.set('q','"'+ean+'" produto embalagem');
  google.searchParams.set('udm','2'); // Google Imagens: formato atual documentado
  google.searchParams.set('gl','br');
  google.searchParams.set('hl','pt-BR');
  google.searchParams.set('brd_json','1');
  // Uma SERP pode levar dezenas de segundos. Não repita automaticamente
  // chamadas: a conta possui cota gratuita limitada a consultas.
  const inicio=Date.now();
  let response;
  try{
    response=await fetcher(ENDPOINT,{
      method:'POST',
      headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},
      body:JSON.stringify({zone,url:google.href,format:'raw'}),
      signal:AbortSignal.timeout(timeoutMs),
    });
  }catch(erro){
    // Nunca imprimir err.message: o provedor pode incluir cabeçalhos na exceção.
    const nome=String(erro?.name||'');
    const duracaoMs=Math.max(0,Date.now()-inicio);
    const esgotado=['TimeoutError','AbortError'].includes(nome)||duracaoMs>=timeoutMs-200;
    const codigo=esgotado?'BD_TIMEOUT':'BD_REDE';
    console.warn('[brightdata] consulta falhou',codigo,'duracaoMs',duracaoMs);
    return {ok:false,status:esgotado?504:502,codigo,
      erro:esgotado?
        'A pesquisa ultrapassou o limite de '+Math.ceil(timeoutMs/1000)+' segundos. Tente novamente mais tarde.':
        'Falha de conexão entre a Cloudflare e a Bright Data. Verifique a disponibilidade da API.'};
  }
  const codigoRemoto=String(response.headers?.get?.('x-brd-error-code')||
    response.headers?.get?.('x-brd-err-code')||'').slice(0,45);
  const codigoSeguro=/^[a-z0-9_.-]{1,45}$/i.test(codigoRemoto)?codigoRemoto:'';
  const erroRemoto=!!(response.headers?.get?.('x-brd-error')||
    response.headers?.get?.('x-brd-err-msg'));
  if(!response.ok||erroRemoto){
    let codigo='BD_PROVEDOR',status=502;
    let mensagem='A Bright Data não conseguiu concluir a pesquisa. Verifique a zona SERP no painel.';
    if(response.status===401||response.status===403){
      codigo='BD_AUTORIZACAO';status=503;
      mensagem='A Bright Data recusou a chave de API ou as permissões. Confira API Keys e a zona SERP.';
    }else if(response.status===400){
      codigo='BD_CONFIGURACAO';status=503;
      mensagem='A Bright Data recusou a configuração da busca. Confirme o tipo SERP API e o nome exato da zona.';
    }else if(response.status===402){
      codigo='BD_FRANQUIA';status=503;
      mensagem='A Bright Data exige conferir o saldo ou a franquia gratuita. Não contrate plano pago sem revisar sua conta.';
    }else if(response.status===429){
      codigo='BD_LIMITE';status=429;
      mensagem='A Bright Data limitou as consultas. Aguarde antes de tentar novamente.';
    }
    return {ok:false,status,codigo,referencia:codigoSeguro||undefined,erro:mensagem};
  }
  let json;
  try{json=await response.json()}catch{
    return {ok:false,status:502,codigo:'BD_FORMATO',
      erro:'A zona SERP retornou uma resposta que não é JSON. Confira se a zona é do tipo SERP API.'};
  }
  const dados=normalizarResposta(json);
  if(dados?.error||dados?.errors?.length){
    return {ok:false,status:502,codigo:'BD_RESPOSTA_ERRO',
      erro:'A Bright Data retornou uma mensagem de erro. Confirme a zona SERP e o acesso à pesquisa de imagens.'};
  }
  if(!dados||!listasDeImagens(dados).length)
    return {ok:true,ean,imagens:[],mensagem:'Nenhuma imagem estruturada retornada. Verifique se a zona aceita Google Imagens com brd_json=1.'};
  const imagens=candidatosGoogleImagens(dados,ean);
  return {ok:true,ean,imagens,mensagem:imagens.length?
    'Resultados do Google Imagens para conferência. Não são fotos licenciadas automaticamente.':
    'Resultados retornados, mas nenhuma URL HTTPS de imagem foi identificada.'};
}
