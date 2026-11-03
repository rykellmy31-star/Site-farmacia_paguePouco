/**
 * Enriquecimento EAN com fontes licenciadas e Google Custom Search (opcional).
 * Fotos só de catálogos Open Facts com mesmo EAN e licença CC BY-SA, ou
 * imagens indexadas no Google que apontem para esse mesmo repositório.
 * Não raspar Google Images nem copiar imagens de lojas sem licença.
 * Google Custom Search JSON API requer conta previamente habilitada.
 */
import { eanValido, normalizarEAN } from './busca-medidas-ean.js';
import { config } from '../config.js';

const FACTS=[
  ['Open Food Facts','https://world.openfoodfacts.org'],
  ['Open Beauty Facts','https://world.openbeautyfacts.org'],
  ['Open Products Facts','https://world.openproductsfacts.org'],
];
const URL_IMAGEM=/^https:\/\/images\.open(?:food|beauty|products)facts\.org\/images\/products\//i;
const CACHE=new Map();
const AGENTE='FarmaciaPaguePouco/1.0 (site.farmaciapaguepouco.app)';
const normal=s=>String(s||'').replace(/\D/g,'');
function eanIgual(a,b){return eanValido(a)&&normalizarEAN(a).padStart(14,'0')===normalizarEAN(b).padStart(14,'0');}
function validarFoto(url){
  if(typeof url!=='string'||url.length>550||!URL_IMAGEM.test(url))return false;
  try{
    const u=new URL(url);
    return !u.username&&!u.password&&!u.search&&!u.hash&&
      /\.(?:jpg|jpeg|png|webp)$/i.test(u.pathname);
  }catch{return false;}
}
function registroImagem(url,fonte,ean,alternativas=[]){
  // OFF fornece o original em .full.jpg; .400.jpg é versão reduzida
  // e nunca deve ser convertida/esticada para parecer alta resolução.
  const urlAltaResolucao=url.replace(/\.(?:100|200|400)\.(jpe?g)$/i,'.full.$1');
  return {url, urlAltaResolucao,alternativas,principal:true,ordem:1,
    legenda:'Imagem do produto — '+fonte+' (CC BY-SA 3.0; fonte: '+fonte+')',
    fonteEAN:{ean,fonte,licenca:'CC BY-SA 3.0',
      atribuicao:'Contribuidores de '+fonte,atribuidoEm:new Date().toISOString(),
      licencaUrl:'https://creativecommons.org/licenses/by-sa/3.0/'}};
}
async function lerJson(url,{fetcher,timeoutMs=2400}){
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const resp=await fetcher(url,{headers:{Accept:'application/json','User-Agent':AGENTE},
      signal:ctrl.signal});
    if(!resp.ok)return null;
    return await resp.json();
  }catch{return null}finally{clearTimeout(t)}
}
function extrairDimensaoGoogle(s){
  // Aceita apenas "dimensões da embalagem: 12 x 8 x 5 cm" com três valores,
  // nunca dimensões de foto/tela, ou medidas inventadas.
  const re=/(?:dimensões\s*(?:da\s*)?(?:embalagem|pacote|produto)|medidas\s*(?:da\s*)?embalagem)\s*[:\-]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(cm|mm)\b/i;
  const m=String(s||'').match(re);
  if(!m)return null;
  const f=m[4].toLowerCase()==='mm'?0.1:1;
  const nums=m.slice(1,4).map(x=>Math.round(Number(x.replace(',','.'))*f*1000)/1000);
  if(nums.some(x=>x<0.1||x>250))return null;
  return {comprimento:nums[0],largura:nums[1],altura:nums[2]};
}
export async function buscarDadosExternosEAN(codigo,{fetcher=globalThis.fetch,
    googleKey=config.googleEan?.key,googleCx=config.googleEan?.cx,force=false,
    somente='ambos'}={}){
  const ean=normalizarEAN(codigo);
  if(!eanValido(ean))return {ok:false,imagem:null,dimensoes:null,consultadas:[]};
  const cacheKey=ean+':'+somente;
  if(fetcher===globalThis.fetch&&!force){
    const c=CACHE.get(cacheKey);if(c&&c.expira>Date.now())return c.resultado;
  }
  const resultado={ok:true,imagem:null,dimensoes:null,consultadas:[],origemDimensoes:''};
  // Fontes estruturadas com EAN exato e imagens reutilizáveis. Nunca
  // atribuir imagem de código parecido ou variante distinta.
  if(somente!=='dimensoes'){
    // Várias fontes + variantes de frente do MESMO EAN.
    // Se a foto original falhar no download, o proxy tentará outra
    // origem, evitando a mensagem genérica da versão antiga.
    const respostas=await Promise.all(FACTS.map(async ([nome,base])=>{
      const url=base+'/api/v2/product/'+encodeURIComponent(ean)+
        '.json?fields=code,product_name,image_front_url,image_url,selected_images';
      const json=await lerJson(url,{fetcher,timeoutMs:3500});
      return {nome,produto:json?.product};
    }));
    const urls=[];
    for(const {nome,produto:p} of respostas){
      resultado.consultadas.push(nome);
      if(!p||!eanIgual(p.code,ean))continue;
      const fotos=[p.image_front_url,p.selected_images?.front?.display?.pt,
        p.selected_images?.front?.display?.en,p.image_url]
        .filter(validarFoto);
      for(const url of fotos)if(!urls.some(x=>x.url===url))urls.push({url,nome});
    }
    if(urls.length){
      resultado.imagem=registroImagem(urls[0].url,urls[0].nome,ean,
        urls.slice(1).map(f=>f.url));
    }
  }
  // Google só por API oficial com credenciais existentes. API descontinuada
  // em janeiro de 2027, portanto não depende dela para operar.
  if(googleKey&&googleCx){
    resultado.consultadas.push('Google Custom Search');
    if(somente!=='imagem'){
    const query=new URL('https://www.googleapis.com/customsearch/v1');
    query.searchParams.set('key',googleKey);
    query.searchParams.set('cx',googleCx);
    query.searchParams.set('q','"'+ean+'" "dimensões da embalagem" peso bruto');
    query.searchParams.set('num','5');
    const json=await lerJson(query.href,{fetcher});
    for(const item of json?.items||[]){
      const texto=String(item.title||'')+' '+String(item.snippet||'');
      if(!texto.includes(ean))continue;
      const d=extrairDimensaoGoogle(texto);
      if(d){resultado.dimensoes=d;resultado.origemDimensoes='Google (medidas de embalagem a revisar)';break;}
    }
    }
    // Busca opcional no índice de imagens: só reutiliza imagens de base
    // Open Facts (licença conhecida). Resultados de outros sites não
    // podem ser usados automaticamente, mesmo aparecendo no Google.
    if(somente!=='dimensoes'&&!resultado.imagem){
      const im=new URL('https://www.googleapis.com/customsearch/v1');
      im.searchParams.set('key',googleKey);im.searchParams.set('cx',googleCx);
      im.searchParams.set('q','"'+ean+'" embalagem produto');
      im.searchParams.set('searchType','image');
      im.searchParams.set('rights','cc_attribute|cc_sharealike');
      im.searchParams.set('num','5');
      const images=await lerJson(im.href,{fetcher});
      for(const item of images?.items||[]){
        if(!validarFoto(item.link))continue;
        const identidade=String(item.title||'')+' '+String(item.snippet||'')+
          ' '+String(item.image?.contextLink||'');
        if(!identidade.includes(ean))continue;
        resultado.imagem=registroImagem(item.link,'Open Facts (indexação Google)',ean);
        break;
      }
    }
  }
  if(fetcher===globalThis.fetch){
    if(CACHE.size>300)CACHE.delete(CACHE.keys().next().value);
    CACHE.set(cacheKey,{expira:Date.now()+(resultado.imagem?86400000:90000),resultado});
  }
  return resultado;
}

export function anexarImagemAusente(produto,imagem){
  if((produto?.imagens||[]).length||!imagem||!validarFoto(imagem.url)||!eanIgual(produto.ean,imagem.fonteEAN?.ean))
    return {};
  return {imagens:[{...imagem,principal:true,ordem:1}]};
}

/** Somente substitui a foto automaticamente adicionada pelo buscador ANTIGO.
 * Fotos enviadas/editadas manualmente nunca são substituídas.
 */
export function imagemAutomaticaAntiga(produto){
  const arr=produto?.imagens||[];
  if(arr.length!==1)return false;
  const img=arr[0];
  return /^https:\/\/images\.open(?:food|beauty|products)facts\.org\/images\/products\//i.test(String(img.url||'')) &&
    /CC BY-SA/i.test(String(img.legenda||''));
}
