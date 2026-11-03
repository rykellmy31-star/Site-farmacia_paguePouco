/**
 * Consulta por GTIN/EAN exclusivamente para sugerir atributos logísticos.
 * UPCitemDB FREE (sem chave) e bases Open Facts (sem raspar Google).
 * Peso líquido / volume / conteúdo em g/ml NÃO equivalem a peso de envio.
 * Nunca inventa medidas ou substitui campos já preenchidos.
 */
const CACHE=new Map();
const USER_AGENT='FarmaciaPaguePouco/1.0 (site.farmaciapaguepouco.app)';
const urlUpc='https://api.upcitemdb.com/prod/trial/lookup?upc=';
const fontesFacts=[
  ['Open Food Facts','https://world.openfoodfacts.org/api/v2/product/'],
  ['Open Beauty Facts','https://world.openbeautyfacts.org/api/v2/product/'],
  ['Open Products Facts','https://world.openproductsfacts.org/api/v2/product/'],
];
const numero=v=>Number(String(v??'').replace(',','.'));
const arred=v=>Math.round(v*1000)/1000;
export function normalizarEAN(v){return String(v||'').replace(/[\s.-]/g,'');}
export function eanValido(v){
  const s=normalizarEAN(v);
  if(!/^\d{8}$|^\d{12,14}$/.test(s))return false;
  let soma=0;
  for(let i=s.length-2,peso=3;i>=0;i--,peso=peso===3?1:3)soma+=Number(s[i])*peso;
  return (10-(soma%10))%10===Number(s.at(-1));
}
function dimensoes(texto){
  if(typeof texto!=='string')return null;
  // Aceita somente 3 medidas explícitas + uma unidade física; NÃO
  // interpretar "20 comprimidos", "200ml" ou unidades de tela (px).
  const m=texto.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|\*)\s*(\d+(?:[.,]\d+)?)\s*(?:x|×|\*)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|in|inches|inch|pol|polegadas)$/i);
  if(!m)return null;
  const fator=/^mm$/i.test(m[4])?0.1:/^(in|inches|inch|pol|polegadas)$/i.test(m[4])?2.54:1;
  const medidas=m.slice(1,4).map(x=>arred(numero(x)*fator));
  if(medidas.some(v=>!Number.isFinite(v)||v<0.1||v>250))return null;
  return {comprimento:medidas[0],largura:medidas[1],altura:medidas[2]};
}
function peso(texto){
  if(typeof texto!=='string')return 0;
  const m=texto.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|g|grams?|gramas?|lb|lbs|pounds?|oz|ounces?)$/i);
  if(!m)return 0;
  const u=m[2].toLowerCase();
  const f=u.startsWith('kg')||u.startsWith('kilo')?1:u.startsWith('g')?0.001:u.startsWith('lb')||u.startsWith('pound')?0.45359237:0.028349523125;
  const v=arred(numero(m[1])*f);
  return v>=0.001&&v<=70?v:0;
}
function codigoCompativel(ean,item){
  const valores=[item.ean,item.upc,item.gtin,item.code].filter(Boolean).map(normalizarEAN);
  return valores.some(v=>v===ean||v.padStart(14,'0')===ean.padStart(14,'0'));
}
function converterItem(item,ean,origem){
  if(!item||!codigoCompativel(ean,item))return null;
  const medida=dimensoes(item.dimension||item.package_dimensions||item.packaging_dimensions);
  const massa=peso(item.weight||item.shipping_weight||item.package_weight);
  if(!medida&&!massa)return null;
  return {ean,origem,nome:String(item.title||item.product_name||'').slice(0,120),
    peso:massa||0,dimensoes:medida||{},
    url:origem==='UPCitemDB'?'https://www.upcitemdb.com/upc/'+ean:
      null,campos:[...(massa?['peso']:[]),...(medida?['largura','altura','comprimento']:[])],
    aviso:'Dados fornecidos por terceiros. Confira medidas da embalagem usada para envio antes de cobrar frete.'};
}
async function buscarJson(url,fetcher,timeoutMs){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),Math.max(700,Math.min(3500,Number(timeoutMs)||2500)));
  try{
    const r=await fetcher(url,{signal:ctrl.signal,headers:{Accept:'application/json','User-Agent':USER_AGENT}});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null;}finally{clearTimeout(t);}
}
let ultimaConsulta=0;
export async function buscarMedidasPorEAN(eanBruto,{fetcher=globalThis.fetch,timeoutMs=2500,
  now=()=>Date.now()}={}){
  const ean=normalizarEAN(eanBruto);
  if(!eanValido(ean))return {ok:false,encontrado:false,
    mensagem:'Informe um código EAN/GTIN válido para pesquisar.'};
  const cacheAtivo=fetcher===globalThis.fetch;
  if(cacheAtivo){
    const c=CACHE.get(ean);
    if(c&&c.expira>now())return {...c.valor,cache:true};
    // Plano gratuito UPCitemDB: no máximo 6 consultas/minuto; respeitar
    // intervalo de 10s para evitar banimento. Nunca bloquear ativação.
    if(now()-ultimaConsulta<10000)return {ok:true,encontrado:false,
      mensagem:'Busca temporariamente limitada. Tente novamente em alguns segundos.'};
    ultimaConsulta=now();
  }
  let resultado=null;
  const upc=await buscarJson(urlUpc+ean,fetcher,timeoutMs);
  for(const item of Array.isArray(upc?.items)?upc.items:[]){
    resultado=converterItem(item,ean,'UPCitemDB');
    if(resultado)break;
  }
  // Bases abertas: somente atributos explicitamente estruturados de
  // dimensões da embalagem, jamais quantidade líquida ou tamanho de imagens.
  if(!resultado)for(const [nome,base] of fontesFacts){
    const raw=await buscarJson(base+ean+'.json?fields=code,product_name,package_dimensions,packaging_dimensions,package_weight,shipping_weight',fetcher,timeoutMs);
    const p=raw?.product;
    if(!p)continue;
    resultado=converterItem({...p,ean:p.code||ean},ean,nome);
    if(resultado)break;
  }
  const ret=resultado?{ok:true,encontrado:true,...resultado}:{
    ok:true,encontrado:false,mensagem:'Nenhuma medida logística confiável disponível para este EAN nas bases consultadas. Preencha manualmente.'};
  if(cacheAtivo){
    if(CACHE.size>200)CACHE.delete(CACHE.keys().next().value);
    CACHE.set(ean,{valor:ret,expira:now()+(ret.encontrado?86400000:3600000)});
  }
  return ret;
}
export function aplicarMedidasAusentes(produto,resultado){
  const patch={};
  if(!resultado?.encontrado)return patch;
  if(!Number(produto.peso)&&resultado.peso>0)patch.peso=resultado.peso;
  const novas={...(produto.dimensoes||{})};let mudou=false;
  for(const nome of ['largura','altura','comprimento']){
    if(!Number(novas[nome])&&Number(resultado.dimensoes?.[nome])>0){
      novas[nome]=resultado.dimensoes[nome];mudou=true;
    }
  }
  if(mudou)patch.dimensoes=novas;
  if(Object.keys(patch).length)
    patch.logisticaFonte={origem:resultado.origem,ean:resultado.ean,
      revisaoPendente:true,consultadoEm:new Date().toISOString()};
  return patch;
}
