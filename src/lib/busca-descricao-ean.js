/**
 * Consulta por EAN da descrição comercial do produto.
 * Fontes: Bluesoft Cosmos (API oficial, SOMENTE se token existente)
 * e Open Food/Beauty/Products Facts, gratuitas e sem token.
 * Não inventa benefícios farmacológicos, dosagem, indicação ou embalagem.
 */
import {config} from '../config.js';
import {eanValido,normalizarEAN} from './busca-medidas-ean.js';
const HOSTS=[
  ['Open Food Facts','https://world.openfoodfacts.org'],
  ['Open Beauty Facts','https://world.openbeautyfacts.org'],
  ['Open Products Facts','https://world.openproductsfacts.org'],
];
const CACHE=new Map();
const AGENT='FarmaciaPaguePouco/1.0 (site.farmaciapaguepouco.app)';
function limpar(x,max=160){
  if(typeof x!=='string')return '';
  return x.replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f\x7f]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,max);
}
function equivalentes(a,b){
  const x=normalizarEAN(a),y=normalizarEAN(b);
  return eanValido(x)&&eanValido(y)&&x.padStart(14,'0')===y.padStart(14,'0');
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
function montarDescricao({nome,designacao,marca,conteudo,embalagem,origem}){
  const linhas=[];
  if(designacao&&designacao.toLowerCase()!==nome.toLowerCase())
    linhas.push('Descrição da embalagem: '+designacao);
  if(nome)linhas.push('Produto: '+nome);
  if(marca)linhas.push('Marca: '+marca);
  if(conteudo)linhas.push('Conteúdo declarado: '+conteudo);
  if(embalagem)linhas.push('Embalagem: '+embalagem);
  if(!linhas.length)return '';
  return '<p>'+linhas.map(esc).join('<br>')+'</p>'+
    '<p><small>Informações cadastrais da fonte: '+esc(origem)+
    '. Confira os dados no rótulo do fabricante.</small></p>';
}
async function ler(url,headers,fetcher){
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),3300);
  try{
    const r=await fetcher(url,{headers:{Accept:'application/json',
      'User-Agent':AGENT,...headers},signal:ctrl.signal});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null;}finally{clearTimeout(t);}
}
function doCosmos(p,ean){
  if(!p||!equivalentes(p.gtin,ean))return null;
  const nome=limpar(p.description,180);
  if(!nome)return null;
  const marca=limpar(p.brand?.name||p.brand,90);
  const conteudo='';
  const dados={nome,marca,designacao:'',conteudo,embalagem:'',
    origem:'Bluesoft Cosmos',url:'https://cosmos.bluesoft.com.br/produtos/'+ean};
  return {...dados,descricao:montarDescricao(dados)};
}
function doFacts(p,ean,origem,url){
  if(!p||!equivalentes(p.code,ean))return null;
  const nome=limpar(p.product_name_pt||p.product_name,180);
  const designacao=limpar(p.generic_name_pt||p.generic_name,240);
  const marca=limpar(p.brands,90);
  const conteudo=limpar(p.quantity,80);
  const embalagem=limpar(p.packaging_text_pt||p.packaging_text||p.packaging,140);
  if(!nome&&!designacao)return null;
  const dados={nome,designacao,marca,conteudo,embalagem,origem,url};
  return {...dados,descricao:montarDescricao(dados)};
}
export async function consultarDescricaoEAN(codigo,{fetcher=globalThis.fetch,
  cosmosToken=config.cosmos?.token||'',forcar=false}={}){
  const ean=normalizarEAN(codigo);
  if(!eanValido(ean))return {ok:false,encontrado:false,erro:'EAN inválido.'};
  const cacheAtivo=fetcher===globalThis.fetch;
  if(cacheAtivo&&!forcar){
    const item=CACHE.get(ean);if(item&&item.validade>Date.now())return item.dados;
  }
  const fontes=[];
  let resultado=null;
  if(cosmosToken){
    fontes.push('Bluesoft Cosmos');
    const p=await ler('https://api.cosmos.bluesoft.com.br/gtins/'+
      encodeURIComponent(ean)+'.json',{'X-Cosmos-Token':cosmosToken},fetcher);
    resultado=doCosmos(p,ean);
  }
  if(!resultado){
    // Endpoints públicos documentados com EAN exato. Não raspar a página.
    const respostas=await Promise.all(HOSTS.map(async ([nome,host])=>{
      const url=host+'/api/v2/product/'+encodeURIComponent(ean)+
        '.json?fields=code,product_name,product_name_pt,generic_name,generic_name_pt,brands,quantity,packaging,packaging_text,packaging_text_pt';
      const json=await ler(url,{},fetcher);
      return {nome,host,p:json?.product};
    }));
    for(const {nome,host,p} of respostas){
      fontes.push(nome);
      const x=doFacts(p,ean,nome,host+'/product/'+ean);
      if(x){resultado=x;break;}
    }
  }
  const dados=resultado?{ok:true,encontrado:true,ean,...resultado,fontes}:{
    ok:true,encontrado:false,ean,fontes,
    mensagem:'Nenhuma descrição correspondente ao EAN foi encontrada nas fontes disponíveis.'};
  if(cacheAtivo){
    if(CACHE.size>250)CACHE.delete(CACHE.keys().next().value);
    CACHE.set(ean,{dados,validade:Date.now()+(resultado?12*3600000:90000)});
  }
  return dados;
}
export function preencherDescricaoAusente(produto,dados){
  if(!produto||!dados?.encontrado||!dados?.descricao||
     !equivalentes(produto.ean,dados.ean)||String(produto.descricao||'').trim())return {};
  return {descricao:dados.descricao};
}
