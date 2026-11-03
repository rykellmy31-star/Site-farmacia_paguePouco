/**
 * Download seguro de fotos Open Facts por EAN.
 *
 * Tenta variantes oficiais (frente completa, foto original quando oferecida,
 * e foto exibida) e outras bases com o mesmo EAN. Nunca segue redirecionamento
 * para sites fora da lista de fontes permitidas.
 */
const ALLOWED=new Set([
 'images.openfoodfacts.org','static.openfoodfacts.org',
 'images.openbeautyfacts.org','static.openbeautyfacts.org',
 'images.openproductsfacts.org','static.openproductsfacts.org',
 'images.openpetfoodfacts.org','static.openpetfoodfacts.org',
]);
const MAX_SOURCE_BYTES=12*1024*1024;
const PRECOMELHOR_CDN='pub-251da151f43b454d9e192d38bf5e6d71.r2.dev';
export function origemImagemPermitida(url,ean=null){
  if(typeof url!=='string'||url.length>900)return false;
  try{
    const u=new URL(url);
    if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||u.search)
      return false;
    if(ALLOWED.has(u.hostname.toLowerCase()))
      return u.pathname.startsWith('/images/products/')&&
        /\.(?:jpe?g|png|webp)$/i.test(u.pathname);
    // A API PreçoMelhor pode apontar para um CDN próprio, mas o proxy só
    // baixa o arquivo cujo nome corresponde EXATAMENTE ao EAN pesquisado.
    if(u.hostname==='upload.wikimedia.org')
      return /^\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/[a-z0-9_%()'!,+\-.]+\.(?:png|jpe?g|webp)$/i.test(u.pathname);
    if(u.hostname==='live.staticflickr.com')
      return /^\/\d{2,6}\/\d{5,15}_[a-z0-9]{6,50}_(?:b|c|h|k|o)\.jpe?g$/i.test(u.pathname);
    return u.hostname===PRECOMELHOR_CDN&&/^\d{8}$|^\d{12,14}$/.test(String(ean||''))&&
      new RegExp('^/'+ean+'(?:_w200)?\\.(?:webp|png|jpe?g)$','i').test(u.pathname);
  }catch{return false;}
}
export function candidatosImagemEAN(imagem){
  const ean=imagem?.fonteEAN?.ean;
  const urls=[imagem?.urlAltaResolucao,imagem?.url,
    ...(Array.isArray(imagem?.alternativas)?imagem.alternativas:[]),
    ...(Array.isArray(imagem?.candidatos)?imagem.candidatos:[])];
  const ret=[],vistas=new Set();
  const add=u=>{if(origemImagemPermitida(u,ean)&&!vistas.has(u)){
    vistas.add(u);ret.push(u);
  }};
  for(const url of urls){
    if(!origemImagemPermitida(url,ean))continue;
    // Formato oficial front_pt.42.full.jpg, conforme API Open Facts.
    // Manter a versão publicada como fallback; não ampliar a miniatura.
    const full=url.replace(/\.(?:100|200|400)\.(jpe?g)$/i,'.full.$1');
    add(full);add(url);
  }
  return ret.slice(0,12);
}
function mimePelosBytes(bytes){
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return 'image/png';
  if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&
    bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return '';
}
async function lerLimitado(resp,maxBytes){
  const informado=Number(resp.headers?.get?.('content-length')||0);
  if(informado>maxBytes)throw new Error('grande');
  if(!resp.body?.getReader){
    const b=Buffer.from(await resp.arrayBuffer());
    if(b.length>maxBytes)throw new Error('grande');
    return b;
  }
  const reader=resp.body.getReader(),partes=[];let tamanho=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      tamanho+=value.byteLength;
      if(tamanho>maxBytes)throw new Error('grande');
      partes.push(Buffer.from(value));
    }
    return Buffer.concat(partes,tamanho);
  }finally{
    try{await reader.cancel();}catch{/* already closed */}
    reader.releaseLock?.();
  }
}
export async function buscarImagemDisponivel(imagem,{
  fetcher=globalThis.fetch,timeoutMs=6500,maxBytes=MAX_SOURCE_BYTES,
  maxTentativas=9,
}={}){
  const candidatos=candidatosImagemEAN(imagem).slice(0,maxTentativas);
  if(!candidatos.length)return {ok:false,motivo:'Nenhuma origem de imagem permitida.'};
  const erros={indisponivel:0,grande:0,formato:0,tempo:0};
  for(const inicio of candidatos){
    let url=inicio,redirects=0;
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{
      while(true){
        if(!origemImagemPermitida(url,imagem?.fonteEAN?.ean))throw new Error('indisponivel');
        const resp=await fetcher(url,{
          method:'GET',redirect:'manual',signal:ctrl.signal,
          headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
            'User-Agent':'FarmaciaPaguePouco/1.0 (site.farmaciapaguepouco.app)'}
        });
        if([301,302,303,307,308].includes(resp.status)){
          const destino=resp.headers?.get?.('location');
          if(!destino||redirects++>=2)throw new Error('indisponivel');
          const novo=new URL(destino,url).href;
          if(!origemImagemPermitida(novo,imagem?.fonteEAN?.ean))throw new Error('indisponivel');
          url=novo;continue;
        }
        if(!resp.ok)throw new Error('indisponivel');
        const bytes=await lerLimitado(resp,maxBytes);
        const mime=mimePelosBytes(bytes);
        if(!mime)throw new Error('formato');
        return {ok:true,bytes,mime,origem:url,tentativas:candidatos.indexOf(inicio)+1};
      }
    }catch(e){
      const code=ctrl.signal.aborted?'tempo':
        ['grande','formato'].includes(e.message)?e.message:'indisponivel';
      erros[code]++;
    }finally{clearTimeout(timer);}
  }
  const motivo=erros.grande===candidatos.length?'As imagens encontradas excedem o limite de 12 MB.':
    erros.tempo===candidatos.length?'As fontes de imagens demoraram demais para responder.':
    erros.formato===candidatos.length?'As imagens encontradas não possuem formato válido.':
      'Nenhuma das fontes disponíveis entregou uma foto utilizável para esse EAN.';
  return {ok:false,motivo,erros,tentadas:candidatos.length};
}
