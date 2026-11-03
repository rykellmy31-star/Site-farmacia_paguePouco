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
  apiToken='',zone='',fetcher=globalThis.fetch,timeoutMs=12000,
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
  google.searchParams.set('tbm','isch');
  google.searchParams.set('gl','br');
  google.searchParams.set('hl','pt-BR');
  google.searchParams.set('brd_json','1');
  let response;
  try{
    response=await fetcher(ENDPOINT,{
      method:'POST',
      headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},
      body:JSON.stringify({zone,url:google.href,format:'raw'}),
      signal:AbortSignal.timeout(timeoutMs),
    });
  }catch{
    return {ok:false,status:502,erro:'Não foi possível consultar o Google Imagens agora.'};
  }
  if(!response.ok){
    const status=response.status===401||response.status===403?503:502;
    return {ok:false,status,erro:status===503?
      'A Bright Data recusou as credenciais ou a zona. Confira a API configurada.':
      'A Bright Data não retornou resultados. Confira a zona SERP e tente novamente.'};
  }
  let json;
  try{json=await response.json()}catch{
    return {ok:false,status:502,erro:'A zona SERP não devolveu JSON estruturado de imagens.'};
  }
  const dados=normalizarResposta(json);
  if(!dados||!listasDeImagens(dados).length)
    return {ok:true,ean,imagens:[],mensagem:'Nenhuma imagem estruturada retornada. Verifique se a zona aceita Google Imagens com brd_json=1.'};
  const imagens=candidatosGoogleImagens(dados,ean);
  return {ok:true,ean,imagens,mensagem:imagens.length?
    'Resultados do Google Imagens para conferência. Não são fotos licenciadas automaticamente.':
    'Resultados retornados, mas nenhuma URL HTTPS de imagem foi identificada.'};
}
