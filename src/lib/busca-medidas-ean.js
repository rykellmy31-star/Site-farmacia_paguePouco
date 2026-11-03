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
let ultimaConsultaUPC=0;
export async function buscarMedidasPorEAN(eanBruto,{fetcher=globalThis.fetch,timeoutMs=2500,
  now=()=>Date.now(),forcar=false}={}){
  const ean=normalizarEAN(eanBruto);
  if(!eanValido(ean))return {ok:false,encontrado:false,
    mensagem:'Informe um código EAN/GTIN válido para pesquisar.'};
  const cacheAtivo=fetcher===globalThis.fetch;
  if(cacheAtivo){
    const c=CACHE.get(ean);
    if(!forcar&&c&&c.expira>now())return {...c.valor,cache:true};
  }
  let resultado=null, produtoEncontrado=false;
  const consultadas=[];
  // O limite gratuito de UPCitemDB NÃO deve bloquear outras bases:
  // cada catálogo público é independente. EAN diferente também pode
  // ser consultado nas bases Open Facts imediatamente.
  const permiteUPC=!cacheAtivo||now()-ultimaConsultaUPC>=10000;
  if(permiteUPC){
    if(cacheAtivo)ultimaConsultaUPC=now();
    consultadas.push('UPCitemDB');
    const upc=await buscarJson(urlUpc+ean,fetcher,timeoutMs);
    for(const item of Array.isArray(upc?.items)?upc.items:[]){
      if(!codigoCompativel(ean,item))continue;
      produtoEncontrado=true;
      resultado=converterItem(item,ean,'UPCitemDB');
      if(resultado)break;
    }
  }
  // Bases abertas: atributos explicitamente estruturados de embalagem;
  // nunca usar quantidade líquida nem tamanho de fotos. Complementa
  // pesquisas parciais, mas não mistura duas fontes com dimensões conflitantes.
  if(!resultado?.peso||!resultado?.dimensoes?.largura)for(const [nome,base] of fontesFacts){
    consultadas.push(nome);
    const raw=await buscarJson(base+ean+'.json?fields=code,product_name,package_dimensions,packaging_dimensions,package_weight,shipping_weight',fetcher,timeoutMs);
    const p=raw?.product;
    if(!p||!codigoCompativel(ean,p))continue;
    produtoEncontrado=true;
    const encontrado=converterItem(p,ean,nome);
    if(!encontrado)continue;
    if(!resultado)resultado=encontrado;
    else{
      // Completar apenas campos ausentes; fonte principal permanece
      // registrada para o operador revisar no cadastro.
      if(!resultado.peso&&encontrado.peso){
        resultado.peso=encontrado.peso;resultado.campos.push('peso');
      }
      if(!resultado.dimensoes?.largura&&encontrado.dimensoes?.largura){
        resultado.dimensoes=encontrado.dimensoes;
        resultado.campos.push('largura','altura','comprimento');
      }
    }
    if(resultado?.peso&&resultado?.dimensoes?.largura)break;
  }
  const ret=resultado?{ok:true,encontrado:true,...resultado,consultadas,produtoEncontrado:true}:{
    ok:true,encontrado:false,consultadas,produtoEncontrado,
    mensagem:produtoEncontrado
      ? 'Produto identificado pelo EAN, mas não há peso e dimensões de transporte disponíveis nessas bases. Confira a embalagem ou consulte o fabricante.'
      : 'Não foram encontradas medidas de transporte para este EAN. As bases públicas podem não ter produtos brasileiros. Confira o código e consulte outras fontes.'};
  if(!permiteUPC&&cacheAtivo&&!ret.encontrado)
    ret.mensagem+=' A UPCitemDB está no intervalo gratuito entre consultas; você pode tentar novamente em alguns segundos.';
  if(cacheAtivo){
    if(CACHE.size>200)CACHE.delete(CACHE.keys().next().value);
    // Não prender o operador por 1 hora ao receber uma falha ou ausência.
    CACHE.set(ean,{valor:ret,expira:now()+(ret.encontrado?86400000:90000)});
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

/**
 * Reutiliza medidas confirmadas de outro cadastro COM O MESMO EAN.
 * Não usa estimativas nem medidas aguardando revisão.
 */
export function buscarMedidasNoCatalogo(db,eanBruto,produtoId=null){
  const ean=normalizarEAN(eanBruto);
  if(!eanValido(ean)||!db?.collection)return null;
  const produtos=db.collection('products').all();
  for(const produto of produtos){
    if(produto.id===produtoId||produto.inovaArquivado?.em||
       produto.logisticaFonte?.revisaoPendente===true||
       normalizarEAN(produto.ean).padStart(14,'0')!==ean.padStart(14,'0'))continue;
    const pesoValor=Number(produto.peso)||0;
    const d=produto.dimensoes||{};
    if(!(pesoValor>0||(['largura','altura','comprimento'].every(k=>Number(d[k])>0))))continue;
    return {ok:true,encontrado:true,ean,origem:'Cadastro já revisado da farmácia',
      nome:produto.nome||'',peso:pesoValor,dimensoes:{
        largura:Number(d.largura)||0,altura:Number(d.altura)||0,
        comprimento:Number(d.comprimento)||0},
      campos:[...(pesoValor>0?['peso']:[]),
        ...(['largura','altura','comprimento'].every(k=>Number(d[k])>0)?['largura','altura','comprimento']:[])],
      consultadas:['Catálogo interno'],produtoEncontrado:true};
  }
  return null;
}
