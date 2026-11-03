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
  ['Open Pet Food Facts','https://world.openpetfoodfacts.org'],
];
const URL_IMAGEM=/^https:\/\/images\.open(?:food|beauty|products|petfood)facts\.org\/images\/products\//i;
const PRECOMELHOR_API='https://www.precomelhor.com.br';
const PRECOMELHOR_CDN='pub-251da151f43b454d9e192d38bf5e6d71.r2.dev';
// Nunca importar links arbitrários da API como URL de download.
// Aceitar somente o armazenamento oficial e nome vinculado ao EAN solicitado.
function fotoPrecoMelhorValida(url,ean){
  if(typeof url!=='string'||url.length>380||!eanValido(ean))return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&u.hostname===PRECOMELHOR_CDN&&
      !u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&
      new RegExp('^/'+ean+'(?:_w200)?\\.(?:webp|png|jpe?g)$','i').test(u.pathname);
  }catch{return false;}
}
function registroImagemPrecoMelhor(fotos,ean){
  const principal=fotos[0];
  const origem=PRECOMELHOR_API+'/p/'+encodeURIComponent(ean);
  return {url:principal,urlAltaResolucao:principal,alternativas:fotos.slice(1),
    principal:true,ordem:1,
    legenda:'Foto de produto — PreçoMelhor (uso comercial com atribuição: '+origem+')',
    fonteEAN:{ean,fonte:'PreçoMelhor',licenca:'Uso comercial com atribuição',
      atribuicao:'PreçoMelhor',urlAtribuicao:origem,atribuidoEm:new Date().toISOString()}};
}

// Pesquisa de arquivos com licenças comerciais claras no Wikimedia Commons.
// A busca por EAN exige identidade explícita, sem inferir embalagens parecidas.
const COMMONS_API='https://commons.wikimedia.org/w/api.php';
const COMMONS_LICENSE=/^(?:CC BY(?:-SA)? (?:2\.0|2\.5|3\.0|4\.0)|CC0(?: 1\.0)?|Public domain)$/i;
const COMMONS_FILE=/^\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/[a-z0-9_%()'!,+\-.]+\.(?:png|jpe?g|webp)$/i;
function fotoCommonsValida(url){
  if(typeof url!=='string'||url.length>850)return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&u.hostname==='upload.wikimedia.org'&&!u.port&&
      !u.username&&!u.password&&!u.search&&!u.hash&&COMMONS_FILE.test(u.pathname);
  }catch{return false;}
}
function fotoCommonsPorEAN(json,ean,referencia=null){
  const paginas=Object.values(json?.query?.pages||{});
  const imagens=[];
  for(const pagina of paginas){
    const info=pagina?.imageinfo?.[0];
    const meta=info?.extmetadata||{};
    const titulo=String(pagina?.title||'');
    const descricao=String(meta.ImageDescription?.value||'').replace(/<[^>]*>/g,' ');
    // A imagem deve mencionar o EAN completo; não aceitar apenas nome semelhante.
    const tituloLimpo=titulo.replace(/^File:/i,'').replace(/\.(?:png|jpe?g|webp)$/i,'').replace(/[_-]+/g,' ');
    const esmalteIdentico=referencia&&esmalteMesmaVariante({
      product_name:tituloLimpo,brands:'',quantity:''},referencia);
    if(!titulo.includes(ean)&&!descricao.includes(ean)&&!esmalteIdentico)continue;
    const variantePorNome=!titulo.includes(ean)&&!descricao.includes(ean)&&esmalteIdentico;
    if(!Number.isFinite(info?.width)||info.width<600||info.height<600||
      info.width/info.height>3.2||info.height/info.width>3.2||
      info.size>12*1024*1024||!fotoCommonsValida(info.url))continue;
    const licenca=String(meta.LicenseShortName?.value||'').trim();
    if(!COMMONS_LICENSE.test(licenca))continue;
    const fonteUrl=String(info.descriptionurl||'');
    let validacao;
    try{validacao=new URL(fonteUrl)}catch{continue}
    if(validacao.protocol!=='https:'||validacao.hostname!=='commons.wikimedia.org'||
       !validacao.pathname.startsWith('/wiki/File:')||validacao.search||validacao.hash)continue;
    const autor=String(meta.Artist?.value||'Contribuidores Wikimedia Commons')
      .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
    imagens.push({url:info.url,urlAltaResolucao:info.url,
      principal:true,ordem:1,
      legenda:'Foto de produto — Wikimedia Commons; '+licenca+'; autor: '+autor+'; origem: '+fonteUrl,
      fonteEAN:{ean,fonte:'Wikimedia Commons',licenca,atribuicao:autor,
        correspondencia:variantePorNome?'marca-cor-volume':'ean',
        urlAtribuicao:fonteUrl,licencaUrl:String(meta.LicenseUrl?.value||''),
        atribuidoEm:new Date().toISOString()}});
  }
  return imagens.slice(0,5);
}

// Catálogo aberto e gratuito de imagens com atribuição: Openverse (Flickr).
// Sem token; busca apenas o EAN exato e licenças de uso comercial.
const OPENVERSE_API='https://api.openverse.org/v1/images/';
function urlFlickrValida(url){
  if(typeof url!=='string'||url.length>700)return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&u.hostname==='live.staticflickr.com'&&
      !u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&
      /^\/\d{2,6}\/\d{5,15}_[a-z0-9]{6,50}_(?:b|c|h|k|o)\.jpe?g$/i.test(u.pathname);
  }catch{return false;}
}
function paginaFlickrValida(url){
  if(typeof url!=='string'||url.length>700)return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&['flickr.com','www.flickr.com'].includes(u.hostname)&&
      !u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&
      /^\/photos\/[^/]+\/\d{5,15}\/?$/i.test(u.pathname);
  }catch{return false;}
}
function registroOpenverseFlickr(item,ean,referencia=null){
  if(String(item?.source||'').toLowerCase()!=='flickr'||!urlFlickrValida(item.url)||
    !paginaFlickrValida(item.foreign_landing_url)||item.mature===true)return null;
  const width=Number(item.width),height=Number(item.height);
  if(width<600||height<600||width>8000||height>8000||
    width/height>3.2||height/width>3.2)return null;
  const identidade=[item.title,item.description,...(Array.isArray(item.tags)?item.tags.map(t=>t?.name):[])]
    .filter(x=>typeof x==='string').join(' ').replace(/<[^>]*>/g,' ');
  const esmalteIdentico=referencia&&esmalteMesmaVariante({
    product_name:item.title,brands:'',quantity:''},referencia);
  if(!identidade.includes(ean)&&!esmalteIdentico)return null;
  const variantePorNome=!identidade.includes(ean)&&esmalteIdentico;
  const licenca=String(item.license||'').toLowerCase();
  const versao=String(item.license_version||'');
  const urlLicenca=String(item.license_url||'');
  // Não aceitar CC-NC / ND: loja é uso comercial, PNG é obra derivada.
  if(!['by','by-sa','cc0'].includes(licenca))return null;
  const licencaEsperada=licenca==='cc0'
    ?'https://creativecommons.org/publicdomain/zero/1.0/'
    :'https://creativecommons.org/licenses/'+licenca+'/'+versao+'/';
  if(!urlLicenca.startsWith(licencaEsperada.replace('https://','http://'))&&
     !urlLicenca.startsWith(licencaEsperada))return null;
  if(licenca==='cc0'?versao!=='1.0':!['2.0','2.5','3.0','4.0'].includes(versao))
    return null;
  const autor=String(item.creator||'Autor não informado').replace(/<[^>]*>/g,' ').trim().slice(0,120);
  const licencaNome=licenca==='cc0'?'CC0 1.0':('CC '+licenca.toUpperCase()+' '+versao);
  return {url:item.url,urlAltaResolucao:item.url,alternativas:[],
    principal:true,ordem:1,
    legenda:'Foto de produto — Openverse (Flickr); '+licencaNome+
      '; autor: '+autor+'; origem: '+item.foreign_landing_url,
    fonteEAN:{ean,fonte:'Openverse (Flickr)',licenca:licencaNome,
      correspondencia:variantePorNome?'marca-cor-volume':'ean',
      atribuicao:autor,urlAtribuicao:item.foreign_landing_url,
      licencaUrl:urlLicenca,atribuidoEm:new Date().toISOString()}};
}

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

// Busca complementar de esmaltes em catálogo ESPECÍFICO de cosméticos.
// O nome sozinho não basta: exigir marca, tonalidade completa e volume,
// para não trocar, por exemplo, "Renda" por "Renda Paetê".
const MARCAS_ESMALTE=['RISQUE','RISQUE','IMPALA','COLORAMA','DAILUS','VULT',
  'AVON','HITS','BLANT','MOHDA','LUDURANA','NATI','REVLON','TOP BEAUTY',
  'BEAUTY COLOR','STUDIO 35','ANA HICKMANN','SALLY HANSEN','OCEANE'];
const GENERICOS_ESMALTE=new Set(['ESMALTE','ESM','VERNIZ','UNHAS','UNHA','PARA',
  'DE','DA','DO','DAS','DOS','COR','CORES','FRASCO','ML','ESMALTACAO',
  'UNIDADE','UN','COLECAO','VERNIS','NAIL','POLISH','NAGELLACK']);
function textoComparavel(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function tokensComparaveis(v){return textoComparavel(v).split(' ').filter(Boolean);}
function contemSequencia(texto,expressao){
  const a=' '+textoComparavel(texto)+' ',b=' '+textoComparavel(expressao)+' ';
  return b.trim().length>=3&&a.includes(b);
}
function referenciaEsmalte(nome,marca){
  const n=textoComparavel(nome);
  if(!/\b(?:ESMALTE|ESM|VERNIZ|NAIL POLISH)\b/.test(n)||n.length<13||n.length>130)return null;
  let fabricante=textoComparavel(marca);
  if(!fabricante){
    fabricante=MARCAS_ESMALTE.find(m=>contemSequencia(n,m))||'';
  }
  if(!fabricante||fabricante.length<4)return null;
  const volume=n.match(/\b(\d{1,2})\s*ML\b/)?.[1]||'';
  // Sem volume, a chance de confundir apresentações é maior.
  if(!volume)return null;
  const marcaTokens=new Set(tokensComparaveis(fabricante));
  const especificos=tokensComparaveis(n).filter((t,i,tokens)=>
    !GENERICOS_ESMALTE.has(t)&&!marcaTokens.has(t)&&
    t!==volume+'ML'&&!(t===volume&&tokens[i+1]==='ML'));
  if(!especificos.length||especificos.length>7)return null;
  return {marca:fabricante,volume,especificos:[...new Set(especificos)],
    query:[fabricante,...especificos].join(' ').slice(0,90)};
}
function esmalteMesmaVariante(produto,referencia){
  if(!produto||!referencia)return false;
  const nome=[produto.product_name_pt,produto.product_name].find(Boolean)||'';
  if(!nome||!/\b(?:ESMALTE|ESM|VERNIZ|NAIL POLISH)\b/.test(textoComparavel(nome)))return false;
  const texto=textoComparavel(nome);
  const marcas=textoComparavel(produto.brands||'');
  if(!contemSequencia(marcas,referencia.marca)&&!contemSequencia(texto,referencia.marca))return false;
  const volumes=[texto, textoComparavel(produto.quantity)].map(t=>t.match(/\b(\d{1,2})\s*ML\b/)?.[1]).filter(Boolean);
  if(!volumes.includes(referencia.volume))return false;
  const marcaTokens=new Set(tokensComparaveis(referencia.marca));
  const itens=tokensComparaveis(nome).filter((t,i,tokens)=>
    !GENERICOS_ESMALTE.has(t)&&!marcaTokens.has(t)&&
    t!==referencia.volume+'ML'&&!(t===referencia.volume&&tokens[i+1]==='ML'));
  const detalhe=[...new Set(itens)];
  // Exigir mesma tonalidade completa, sem aceitar tons parecidos ou versões
  // diferentes com palavras adicionais ("Renda Paetê" ≠ "Renda").
  return detalhe.length===referencia.especificos.length&&
    detalhe.every(t=>referencia.especificos.includes(t));
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
    somente='ambos',nomeProduto='',marcaProduto=''}={}){
  const ean=normalizarEAN(codigo);
  if(!eanValido(ean))return {ok:false,imagem:null,dimensoes:null,consultadas:[]};
  const referencia=somente==='dimensoes'?null:referenciaEsmalte(nomeProduto,marcaProduto);
  const cacheKey=ean+':'+somente+':'+(referencia?referencia.query+'|'+referencia.volume:'');
  if(fetcher===globalThis.fetch&&!force){
    const c=CACHE.get(cacheKey);if(c&&c.expira>Date.now())return c.resultado;
  }
  const resultado={ok:true,imagem:null,imagensCandidatas:[],dimensoes:null,consultadas:[],origemDimensoes:''};
  const adicionar=imagem=>{
    if(!imagem||resultado.imagensCandidatas.some(i=>i.url===imagem.url))return;
    if(resultado.imagensCandidatas.length>=35)return;
    resultado.imagensCandidatas.push(imagem);
    resultado.imagem??=imagem;
  };
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
    for(const {nome,produto:p} of respostas){
      resultado.consultadas.push(nome);
      if(!p||!eanIgual(p.code,ean))continue;
      const fotos=[p.image_front_url,p.selected_images?.front?.display?.pt,
        p.selected_images?.front?.display?.en,p.image_url]
        .filter(validarFoto);
      const urls=[...new Set(fotos)];
      if(urls.length){
        adicionar(registroImagem(urls[0],nome,ean,urls.slice(1)));
        // Uma imagem da mesma base pode ter várias fotos frontais.
        // Se a primeira for de resolução baixa, tentar também as outras.
        for(const url of urls.slice(1))adicionar(registroImagem(url,nome,ean));
      }
    }
  }
  // ESMALTES: se a marca/cor/volume são conhecidos, procurar também por
  // nome no índice de cosméticos Open Beauty Facts, mesmo sem o EAN indexado.
  // Não aceitar tons similares; manter a origem do código diferente visível.
  if(somente!=='dimensoes'&&referencia){
    resultado.consultadas.push('Open Beauty Facts — esmaltes por nome, cor e marca');
    const query=new URL('https://world.openbeautyfacts.org/cgi/search.pl');
    for(const [k,v] of Object.entries({search_terms:referencia.query,
      search_simple:'1',action:'process',json:'1',page_size:'24',
      fields:'code,product_name,product_name_pt,brands,quantity,image_front_url,image_url,selected_images'}))
      query.searchParams.set(k,v);
    const lista=await lerJson(query.href,{fetcher,timeoutMs:4100});
    for(const produto of (Array.isArray(lista?.products)?lista.products:[]).slice(0,24)){
      if(!esmalteMesmaVariante(produto,referencia))continue;
      // Se veio um EAN diferente, a correspondência é pela ficha: não
      // atribuir falsamente que o catálogo confirmou o EAN pesquisado.
      const urls=[produto.image_front_url,produto.selected_images?.front?.display?.pt,
        produto.selected_images?.front?.display?.en,produto.image_url]
        .filter(validarFoto);
      for(const url of [...new Set(urls)].slice(0,3)){
        const imagem=registroImagem(url,'Open Beauty Facts',ean);
        imagem.fonteEAN.correspondencia='marca-cor-volume';
        imagem.fonteEAN.codigoNaFonte=String(produto.code||'');
        imagem.legenda+='; correspondência por nome, marca, cor e volume.';
        adicionar(imagem);
      }
    }
  }
  // Fallback pela API pública oficial do PreçoMelhor, quando Open Facts
  // não oferece imagem. Uso comercial permitido com crédito visível.
  // Nunca usar fotos de URLs desconhecidas, nem aceitar EAN divergente.
  if(somente!=='dimensoes'){
    resultado.consultadas.push('PreçoMelhor');
    const api=PRECOMELHOR_API+'/api/product/'+encodeURIComponent(ean);
    const dados=await lerJson(api,{fetcher,timeoutMs:3800});
    const produto=dados?.product;
    if(produto&&eanIgual(produto.ean,ean)){
      const opcoes=[
        dados?.details?.media_high_res_url,
        dados?.details?.image_url_main,
        produto.image_url,
      ].filter(url=>fotoPrecoMelhorValida(url,ean));
      const unicas=[...new Set(opcoes)];
      if(unicas.length){
        adicionar(registroImagemPrecoMelhor(unicas,ean));
        for(const url of unicas.slice(1))adicionar(registroImagemPrecoMelhor([url],ean));
      }
    }
  }
  // Wikimedia Commons: busca automática sem cadastro ou API key, com
  // verificação de EAN, resolução, origem e licença por arquivo.
  if(somente!=='dimensoes'){
    resultado.consultadas.push('Wikimedia Commons');
    const consulta=new URL(COMMONS_API);
    for(const [k,v] of Object.entries({action:'query',generator:'search',
      gsrsearch:'"'+ean+'"',gsrnamespace:'6',gsrlimit:'12',
      prop:'imageinfo',iiprop:'url|size|extmetadata',format:'json',formatversion:'2'}))
      consulta.searchParams.set(k,v);
    const json=await lerJson(consulta.href,{fetcher,timeoutMs:3800});
    for(const imagem of fotoCommonsPorEAN(json,ean))adicionar(imagem);
    // Para esmaltes sem foto indexada pelo código: procurar o tom exato
    // pelo nome em arquivos de licença livre no Wikimedia.
    if(referencia){
      const nomeBusca=new URL(COMMONS_API);
      for(const [k,v] of Object.entries({action:'query',generator:'search',
        gsrsearch:'"'+referencia.marca+'" "'+referencia.especificos.join(' ')+
          '" esmalte '+referencia.volume+'ml',gsrnamespace:'6',gsrlimit:'15',
        prop:'imageinfo',iiprop:'url|size|extmetadata',format:'json',formatversion:'2'}))
        nomeBusca.searchParams.set(k,v);
      const encontrados=await lerJson(nomeBusca.href,{fetcher,timeoutMs:3400});
      for(const imagem of fotoCommonsPorEAN(encontrados,ean,referencia))adicionar(imagem);
    }
  }
  // Catálogo Openverse agrega fotos autorizadas de outras fontes, como
  // Flickr. Busca automaticamente sem exigir API key, com rate limit público.
  if(somente!=='dimensoes'){
    resultado.consultadas.push('Openverse (Flickr)');
    const busca=new URL(OPENVERSE_API);
    busca.searchParams.set('q','"'+ean+'"');
    busca.searchParams.set('source','flickr');
    busca.searchParams.set('license_type','commercial');
    busca.searchParams.set('page_size','15');
    const resposta=await lerJson(busca.href,{fetcher,timeoutMs:3500});
    for(const item of (Array.isArray(resposta?.results)?resposta.results:[]).slice(0,15)){
      const foto=registroOpenverseFlickr(item,ean);
      if(foto)adicionar(foto);
    }
    // Fotos com marca, tonalidade e volume exatos também podem existir
    // sem o código EAN nos metadados.
    if(referencia){
      const consulta=new URL(OPENVERSE_API);
      consulta.searchParams.set('q',referencia.query+' esmalte '+referencia.volume+'ml');
      consulta.searchParams.set('source','flickr');
      consulta.searchParams.set('license_type','commercial');
      consulta.searchParams.set('page_size','12');
      const fotos=await lerJson(consulta.href,{fetcher,timeoutMs:3400});
      for(const item of (Array.isArray(fotos?.results)?fotos.results:[]).slice(0,12)){
        const foto=registroOpenverseFlickr(item,ean,referencia);
        if(foto)adicionar(foto);
      }
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
    // Google Custom Search (somente contas já habilitadas) procura outras
    // imagens de catálogos com licença conhecida, mesmo se a primeira
    // fonte tiver foto pequena. Não copia URLs de lojas indiscriminadamente.
    if(somente!=='dimensoes'){
      const im=new URL('https://www.googleapis.com/customsearch/v1');
      im.searchParams.set('key',googleKey);im.searchParams.set('cx',googleCx);
      im.searchParams.set('q','"'+ean+'" embalagem produto');
      im.searchParams.set('searchType','image');
      im.searchParams.set('rights','cc_attribute|cc_sharealike');
      im.searchParams.set('num','10');
      const images=await lerJson(im.href,{fetcher});
      for(const item of images?.items||[]){
        const identidade=String(item.title||'')+' '+String(item.snippet||'')+
          ' '+String(item.image?.contextLink||'');
        if(!identidade.includes(ean))continue;
        if(validarFoto(item.link)){
          adicionar(registroImagem(item.link,'Open Facts (Google)',ean));
        }else if(fotoPrecoMelhorValida(item.link,ean)){
          adicionar(registroImagemPrecoMelhor([item.link],ean));
        }
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
  if((produto?.imagens||[]).length||!imagem||
    !(validarFoto(imagem.url)||fotoPrecoMelhorValida(imagem.url,imagem.fonteEAN?.ean))||
    !eanIgual(produto.ean,imagem.fonteEAN?.ean))
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
