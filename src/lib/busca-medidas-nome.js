/**
 * Busca de medidas logísticas pelo NOME, não pelo EAN.
 * O Google Programmable Search fornece resultado textual; aceitamos somente
 * medidas explícitas da embalagem e identificação consistente do produto.
 * Não supõe peso a partir de conteúdo líquido ou quantidade comercial.
 */
import { config } from '../config.js';

const CACHE = new Map();
const limpar = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const tokens = name => limpar(name).split(/\s+/).filter(Boolean);
const numero = s => Number(String(s).replace(',','.'));
const arred = n => Math.round(n*1000)/1000;
const ruido = new Set(['de','da','do','dos','das','com','sem','para','em','un','und','unid','undd',
  'unidade','unidades','c','s','cx','pct','pc','pct','emb','tamanho','produto']);
export function nomeMedidasValido(nome) {
  const list = tokens(nome).filter(t=>t.length>=2&&!ruido.has(t));
  return list.length>=2 && String(nome||'').length<=170;
}
export function resultadoPertenceAoProduto(nome, texto) {
  const nomeTokens = tokens(nome).filter(t=>t.length>=2&&!ruido.has(t));
  if(nomeTokens.length<2)return false;
  const referencia = new Set(tokens(texto));
  // Versões/apresentações (30ml, 80un, 500mg, etc.) precisam coincidir,
  // para não misturar embalagem com outra quantidade.
  const numeros = nomeTokens.filter(t=>/\d/.test(t));
  if(numeros.some(t=>!referencia.has(t)))return false;
  const textoTokens = nomeTokens.filter(t=>referencia.has(t));
  const minimo = nomeTokens.length <= 3 ? nomeTokens.length : Math.ceil(nomeTokens.length*0.85);
  return textoTokens.length>=minimo;
}
export function extrairMedidasEmbalagem(texto) {
  if(typeof texto!=='string')return null;
  const normalizado = texto.replace(/\s+/g,' ').slice(0,1800);
  const padrao = /(?:dimens[oõ]es|medidas|tamanho)\s*(?:da|do|de)?\s*(?:embalagem|pacote|produto|caixa)\s*[:\-–]?\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*[x×*]\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*[x×*]\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(cm|mm|pol|polegadas)\b/i;
  const m=normalizado.match(padrao);
  if(!m)return null;
  const escala=/^mm$/i.test(m[4])?0.1:/^(pol|polegadas)$/i.test(m[4])?2.54:1;
  const nums=m.slice(1,4).map(s=>arred(numero(s)*escala));
  if(nums.some(n=>!Number.isFinite(n)||n<0.1||n>150))return null;
  return {comprimento:nums[0],largura:nums[1],altura:nums[2]};
}
export function extrairPesoBruto(texto) {
  const m=String(texto||'').slice(0,1800).match(/(?:peso\s*(?:bruto|da embalagem|para envio)|peso\s*do pacote|shipping weight)\s*[:\-–]?\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*(kg|g|gramas?)\b/i);
  if(!m)return 0;
  const val=numero(m[1])*(/^kg$/i.test(m[2])?1:0.001);
  return val>=0.001&&val<=30?arred(val):0;
}

/**
 * Reaproveita medidas de uma ficha do próprio catálogo pelo nome COMPLETO:
 * marca, apresentação e quantidade precisam coincidir. Nunca confunde
 * nomes parecidos (fralda M versus G, 30 versus 60 cápsulas).
 * Consulta somente leitura, não altera produtos ou estoque.
 */
export function buscarMedidasNoCatalogoPorNome(db, nomeBruto, {ignorarId=null}={}) {
  if (!db || !nomeMedidasValido(nomeBruto)) return null;
  const nome = limpar(nomeBruto);
  const candidatos = db.collection('products').all().filter(p =>
    !p.inovaArquivado?.em &&
    String(p.id) !== String(ignorarId ?? '') &&
    limpar(p.nome) === nome &&
    ['largura','altura','comprimento'].every(campo => {
      const valor = Number(p.dimensoes?.[campo]);
      return Number.isFinite(valor) && valor >= 0.1 && valor <= 150;
    }));
  if (!candidatos.length) return null;
  const medidas = candidatos.map(p => ({
    largura: arred(Number(p.dimensoes.largura)),
    altura: arred(Number(p.dimensoes.altura)),
    comprimento: arred(Number(p.dimensoes.comprimento)),
  }));
  const distintos = [...new Set(medidas.map(m => JSON.stringify(m)))];
  if (distintos.length > 1) return {ok:true,encontrado:false,divergencia:true,
    mensagem:'Há dimensões diferentes em cadastros com esse mesmo nome. Confira a embalagem manualmente.'};
  const pesos = [...new Set(candidatos.map(p => {
    const n=Number(p.peso);
    return Number.isFinite(n) && n>=0.001 && n<=30 ? arred(n) : 0;
  }).filter(Boolean))];
  return {ok:true,encontrado:true,nome:String(nomeBruto),dimensoes:medidas[0],
    peso:pesos.length===1?pesos[0]:0,origem:'Catálogo da farmácia — mesmo nome',
    url:null,campos:['largura','altura','comprimento'],
    aviso:'Medidas encontradas em outro cadastro. Confira a embalagem real antes de usar no frete.'};
}

export async function buscarMedidasPorNome(nomeBruto,{
  fetcher=globalThis.fetch,googleKey=config.googleEan?.key,
  googleCx=config.googleEan?.cx,timeoutMs=5000,forcar=false,
}={}) {
  const nome=String(nomeBruto||'').trim().slice(0,170);
  if(!nomeMedidasValido(nome))return {ok:false,encontrado:false,mensagem:'Informe o nome completo do produto, incluindo apresentação e quantidade.'};
  if(!googleKey||!googleCx)return {ok:false,encontrado:false,semIntegracao:true,
    mensagem:'Pesquisa por nome sem acesso ao Google. Configure GOOGLE_CSE_API_KEY e GOOGLE_CSE_CX nos segredos da Cloudflare. A busca de imagens usa uma integração diferente.'};
  const chave=limpar(nome);
  const cacheAtivo=fetcher===globalThis.fetch;
  const cached=CACHE.get(chave);
  if(!forcar&&cacheAtivo&&cached&&cached.expira>Date.now())return {...cached.res,cache:true};
  const url=new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key',googleKey);
  url.searchParams.set('cx',googleCx);
  url.searchParams.set('q','"'+nome+'" dimensões da embalagem cm');
  url.searchParams.set('num','5');
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),Math.max(1000,Math.min(7000,timeoutMs)));
  let ret;
  try{
    const response=await fetcher(url.href,{signal:ctrl.signal,headers:{Accept:'application/json'}});
    if(!response.ok){
      // A chave de imagens/Photos ou outro provedor não habilita automaticamente
      // a Custom Search JSON API. Nunca mostrar credenciais ou corpo bruto.
      if(response.status===429)return {ok:false,encontrado:false,cotaEsgotada:true,
        mensagem:'Limite de consultas do Google atingido. Aguarde a renovação da cota.'};
      if([400,401,403].includes(response.status)){
        let motivo='';
        try {
          const erro=await response.json();
          motivo=String(erro?.error?.errors?.[0]?.reason||erro?.error?.status||'').slice(0,80);
        } catch { /* sem corpo JSON */ }
        if(/quota|rate|resource_exhausted|dailyLimit/i.test(motivo))
          return {ok:false,encontrado:false,cotaEsgotada:true,
            mensagem:'A cota da pesquisa Google está esgotada. Consulte os limites da sua API.'};
        return {ok:false,encontrado:false,credencialInvalida:true,
          mensagem:'O Google não autorizou a pesquisa por nome. Verifique a chave GOOGLE_CSE_API_KEY, o identificador GOOGLE_CSE_CX e se a Custom Search JSON API está habilitada para essa chave.'};
      }
      return {ok:false,encontrado:false,temporario:true,
        mensagem:'Pesquisa externa indisponível (HTTP '+response.status+'). Tente novamente.'};
    }
    const json=await response.json();
    const candidatos=[];
    for(const item of Array.isArray(json.items)?json.items:[]){
      const titulo=String(item.title||'').slice(0,250);
      const resumo=String(item.snippet||'').slice(0,1400);
      if(!resultadoPertenceAoProduto(nome,titulo+' '+resumo))continue;
      const medidas=extrairMedidasEmbalagem(resumo)||extrairMedidasEmbalagem(titulo);
      if(!medidas)continue;
      candidatos.push({dimensoes:medidas,peso:extrairPesoBruto(resumo),origem:'Google — resultado por nome',
        nome,campos:['largura','altura','comprimento'],
        url:/^https?:\/\//.test(item.link||'')?item.link:null});
    }
    // Se duas fontes trazem medidas diferentes, nenhuma medida será salva.
    const chaves=[...new Set(candidatos.map(c=>JSON.stringify(c.dimensoes)))];
    if(chaves.length>1){
      ret={ok:true,encontrado:false,divergencia:true,
        mensagem:'Fontes apresentam medidas divergentes. Confira a embalagem antes de preencher.'};
    }else if(candidatos.length){
      const c=candidatos[0];
      ret={ok:true,encontrado:true,...c,
        aviso:'Dados de terceiros localizados pelo nome. Confirme dimensões do pacote usado para envio.',
        peso:candidatos.every(v=>v.peso===c.peso)?c.peso:0};
    }else ret={ok:true,encontrado:false,
      mensagem:'Não foram encontradas dimensões de embalagem identificadas com segurança pelo nome.'};
  }catch{
    ret={ok:false,encontrado:false,temporario:true,mensagem:'A busca de dimensões não respondeu. Tente novamente.'};
  }finally{clearTimeout(timeout);}
  if(cacheAtivo&&!ret.temporario&&!ret.cotaEsgotada){
    if(CACHE.size>=300)CACHE.delete(CACHE.keys().next().value);
    CACHE.set(chave,{res:ret,expira:Date.now()+(ret.encontrado?86400000:300000)});
  }
  return ret;
}

export function medidasCompletas(produto) {
  return Number(produto?.peso)>0&&
    ['largura','altura','comprimento'].every(k=>Number(produto?.dimensoes?.[k])>0);
}

export function buscaLogisticaPendente(produto) {
  return Boolean(produto&&!produto.inovaArquivado?.em&&nomeMedidasValido(produto.nome)&&
    !medidasCompletas(produto));
}
