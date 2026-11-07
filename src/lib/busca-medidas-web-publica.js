/**
 * Pesquisa de medidas no conteúdo PÚBLICO da internet, sem API, chave, conta ou custo.
 * 1. Lê o RSS público de resultados Bing (HTML/XML simples, sem credenciais).
 * 2. Quando possível, inspeciona a descrição de até dois resultados de lojas
 *    conhecidas que exibem informações publicamente. Nunca burla bloqueios.
 * 3. Aceita apenas medidas explícitas da EMBALAGEM e nome/apresentação compatível.
 * Se a busca pública limitar automação, reporta isso; NÃO cria valores fictícios.
 */
import {resultadoPertenceAoProduto, extrairMedidasEmbalagem, extrairPesoBruto} from './busca-medidas-nome.js';

const LOJAS = new Set([
  'magazineluiza.com.br','amazon.com.br','mercadolivre.com.br',
  'drogasil.com.br','drogaraia.com.br','paguemenos.com.br','panvel.com',
  'drogariaspacheco.com.br','drogariasaopaulo.com.br','carrefour.com.br',
  'casasbahia.com.br','drogariavenancio.com.br',
]);
const CACHE = new Map();
const decode = s => String(s||'')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi,'$1')
  .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
    const value=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);
    return value>0&&value<=0x10ffff?String.fromCodePoint(value):' ';
  })
  .replace(/&(amp|lt|gt|quot|apos|nbsp|aacute|eacute|iacute|oacute|uacute|ccedil|atilde|otilde);/gi,
    (_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',
      aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ccedil:'ç',
      atilde:'ã',otilde:'õ'}[n.toLowerCase()]||' '))
  .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const field = (xml,tag) => {
  const m=xml.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'));
  return m?decode(m[1]):'';
};
export function extrairResultadosRSS(xml) {
  if(typeof xml!=='string'||xml.length>450000)return [];
  const saida=[];
  for(const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
    const titulo=field(m[1],'title').slice(0,320);
    const descricao=field(m[1],'description').slice(0,1800);
    const link=field(m[1],'link').slice(0,1400);
    if(titulo&&descricao)saida.push({titulo,descricao,link});
    if(saida.length>=10)break;
  }
  return saida;
}
function siteConfiavel(url) {
  try{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
       u.pathname.length>500||u.search.length>300||u.hash)return false;
    return [...LOJAS].some(host=>u.hostname===host||u.hostname.endsWith('.'+host));
  }catch{return false;}
}
function textoDeProdutoHTML(html) {
  if(typeof html!=='string')return '';
  const simples=decode(html.slice(0,400000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<(?:br|\/p|\/li|\/div|\/tr|h[1-6])\b[^>]*>/gi,'\n'));
  // Limitar os trechos às informações explícitas de EMBALAGEM.
  const indice=/dimens[oõ]es|medidas da embalagem|medidas do pacote|peso bruto|peso da embalagem|altura da embalagem/i;
  const snippets=[];
  for(const m of simples.matchAll(new RegExp(indice.source,'gi'))){
    const ini=Math.max(0,m.index-90);
    snippets.push(simples.slice(ini,Math.min(simples.length,m.index+350)));
    if(snippets.length>=10)break;
  }
  return snippets.join(' ... ').slice(0,4500);
}
function candidatosDeItem(nome,item,textoExtra='') {
  if(!resultadoPertenceAoProduto(nome,item.titulo+' '+item.descricao))return null;
  const texto = textoExtra || item.descricao;
  const medidas=extrairMedidasEmbalagem(texto);
  if(!medidas)return null;
  return {dimensoes:medidas,peso:extrairPesoBruto(texto),
    origem:textoExtra?'Página pública do produto':'Pesquisa pública na internet',
    nome, url:siteConfiavel(item.link)?item.link:null,
    campos:['largura','altura','comprimento']};
}
async function lerTextoPublico(url,fetcher,timeoutMs,aceite='text/html,application/xml') {
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),Math.max(900,Math.min(7000,timeoutMs)));
  try{
    const res=await fetcher(url,{signal:ctrl.signal,redirect:'manual',
      headers:{Accept:aceite,'Accept-Language':'pt-BR,pt;q=0.9'}});
    if(res.status===403||res.status===429||res.status===202)
      return {ok:false,bloqueado:true};
    if(!res.ok)return {ok:false,temporario:res.status>=500};
    const tipo=res.headers?.get?.('content-type')||'';
    if(tipo&&!/text\/|xml|rss|html/i.test(tipo))return {ok:false};
    const tamanho=Number(res.headers?.get?.('content-length')||0);
    if(tamanho>450000)return {ok:false};
    const raw=await res.text();
    if(raw.length>450000)return {ok:false};
    return {ok:true,texto:raw};
  }catch{
    return {ok:false,temporario:true};
  }finally{clearTimeout(t);}
}
export async function buscarDimensoesInternetPublica(nomeBruto,{
  fetcher=globalThis.fetch,timeoutMs=5000,forcar=false,
}={}) {
  const nome=String(nomeBruto||'').trim().slice(0,170);
  if(nome.length<4)return {ok:false,encontrado:false,
    mensagem:'Informe o nome completo e a apresentação do produto.'};
  const chave=nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const emProducao=fetcher===globalThis.fetch;
  const cached=CACHE.get(chave);
  if(!forcar&&emProducao&&cached?.ate>Date.now())return {...cached.res,cache:true};
  const buscas=[
    '"'+nome+'" dimensões da embalagem cm',
    nome+' "altura" "largura" "comprimento" embalagem',
  ];
  const candidatos=[],vistos=new Set();
  let teveFeed=false,bloqueado=false;
  for(const q of buscas){
    const u=new URL('https://www.bing.com/search');
    u.searchParams.set('q',q);
    u.searchParams.set('format','rss');
    u.searchParams.set('setlang','pt-BR');
    const rss=await lerTextoPublico(u.href,fetcher,timeoutMs,'application/rss+xml,application/xml,text/xml');
    if(!rss.ok){
      if(rss.bloqueado)bloqueado=true;
      break;
    }
    const itens=extrairResultadosRSS(rss.texto);
    if(!/<rss[\s>]/i.test(rss.texto)){
      bloqueado=true;break; // Captcha/HTML não é um feed confiável.
    }
    teveFeed=true;
    for(const item of itens){
      if(vistos.has(item.link))continue;
      vistos.add(item.link);
      if(!resultadoPertenceAoProduto(nome,item.titulo+' '+item.descricao))continue;
      const direto=candidatosDeItem(nome,item);
      if(direto){candidatos.push(direto);continue;}
      if(!siteConfiavel(item.link)||vistos.size>6)continue;
      // Busca só 2 páginas públicas no máximo, sem redirecionar para outros hosts.
      const pagina=await lerTextoPublico(item.link,fetcher,Math.min(timeoutMs,4000));
      if(!pagina.ok)continue;
      const extra=textoDeProdutoHTML(pagina.texto);
      const candidato=candidatosDeItem(nome,item,extra);
      if(candidato)candidatos.push(candidato);
    }
    if(candidatos.length)break;
  }
  let ret;
  if(candidatos.length){
    const distintos=[...new Set(candidatos.map(c=>JSON.stringify(c.dimensoes)))];
    if(distintos.length>1)ret={ok:true,encontrado:false,divergencia:true,
      mensagem:'Resultados públicos indicam medidas diferentes. Não gravei valores conflitantes.'};
    else {
      const c=candidatos[0];
      ret={ok:true,encontrado:true,...c,
        peso:candidatos.every(x=>x.peso===c.peso)?c.peso:0,
        aviso:'Verifique medidas reais da embalagem para calcular frete com segurança.'};
    }
  }else if(!teveFeed||bloqueado){
    ret={ok:false,encontrado:false,temporario:true,
      mensagem:'A pesquisa pública na internet está temporariamente indisponível ou limitou consultas automáticas. Tente novamente mais tarde.'};
  }else{
    ret={ok:true,encontrado:false,
      mensagem:'Não encontrei dimensões de embalagem confiáveis para esse nome nas páginas públicas. Os campos foram mantidos.'};
  }
  if(emProducao&&!ret.temporario){
    if(CACHE.size>=250)CACHE.delete(CACHE.keys().next().value);
    CACHE.set(chave,{res:ret,ate:Date.now()+(ret.encontrado?86400000:120000)});
  }
  return ret;
}
