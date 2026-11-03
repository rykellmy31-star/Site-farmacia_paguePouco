import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buscarDadosExternosEAN} from '../src/lib/enriquecimento-ean.js';
import {origemImagemPermitida,candidatosImagemEAN,buscarImagemDisponivel} from '../src/lib/ean-image-download.js';
import {can} from '../src/lib/permissions.js';
const ean='7891000100103';
const jpg='https://images.openfoodfacts.org/images/products/789/100/010/0103/front_pt.32.400.jpg';
function factory(respostas,urls=[]){
 return async url=>{
   urls.push(url);
   if(url.includes('googleapis'))
     return {ok:true,json:async()=>({items:[]})};
   if(url.includes('openfoodfacts'))return {ok:true,json:async()=>respostas};
   return {ok:false};
 };
}
test('imagem EAN isolada seleciona a frente em resolução full (não miniatura)',async()=>{
 const urls=[];
 const r=await buscarDadosExternosEAN(ean,{fetcher:factory({
   product:{code:ean,image_front_url:jpg},
 },urls),somente:'imagem',googleKey:'',googleCx:''});
 assert.equal(r.imagem.url,jpg);
 assert.equal(r.imagem.urlAltaResolucao,jpg.replace('.400.jpg','.full.jpg'));
 assert.equal(r.dimensoes,null);
 assert.equal(urls.length,7); // Quatro catálogos Open Facts + PreçoMelhor + Commons + Openverse
});
test('dimensões EAN isoladas não consultam catálogo de imagens',async()=>{
 const urls=[];
 const r=await buscarDadosExternosEAN(ean,{somente:'dimensoes',
  fetcher:factory({product:{code:ean,image_front_url:jpg}},urls),
  googleKey:'key',googleCx:'cx'});
 assert.equal(r.imagem,null);
 assert.equal(urls.some(url=>url.includes('openfoodfacts')),false);
 assert.equal(urls.filter(url=>url.includes('googleapis')).length,1);
});
test('duas ferramentas EAN têm endpoints e botões próprios; PNG é gerado e armazenado',()=>{
 const base=new URL('../',import.meta.url);
 const route=readFileSync(new URL('src/routes/admin.js',base),'utf8');
 const tela=readFileSync(new URL('src/views/admin/catalogo.js',base),'utf8');
 const js=readFileSync(new URL('public/js/admin.js',base),'utf8');
 const upload=readFileSync(new URL('src/lib/uploads.js',base),'utf8');
 for(const id of ['botaoBuscarImagemEAN','botaoBuscarMedidasEAN',
   'resultadoBuscaImagemEAN','resultadoBuscaEAN'])assert.ok(tela.includes('id="'+id+'"'),id);
 assert.match(route,/app\.post\('\/admin\/api\/produtos\/imagem-ean'/);
 assert.match(route,/app\.post\('\/admin\/api\/produtos\/dimensoes-ean'/);
 assert.match(route,/app\.get\('\/admin\/api\/produtos\/imagem-ean\/arquivo'/);
 assert.match(route,/app\.post\('\/admin\/api\/produtos\/:id\/vincular-imagem-ean'/);
 assert.match(route,/guardApi\(req,res,'produtos\.editar'\)/);
 assert.match(route,/m\.ext==='png'/);
 assert.match(route,/Number\(m\.largura\)>=600/);
 assert.match(js,/createImageBitmap/);
 assert.match(js,/tela\.toBlob\(resolve,'image\/png'\)/);
 assert.match(js,/arquivo\.ext!=='png'|resultado\.ext!=='png'/);
 assert.match(js,/formatoEAN\(ean\)/);
 assert.match(js,/imagemNaAtivacao\(id\)/);
 assert.match(js,/buscarFotoEAN/);
 assert.match(js,/consultarMedidasEAN/);
 assert.match(upload,/pngEAN/);
});
test('método de foto por EAN impede imagens ruins em vez de ampliar baixa resolução',()=>{
 const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
 assert.match(js,/Math\.min\(w,h\)<600/);
 assert.match(js,/arestas<95/);
 assert.match(js,/escala=Math\.min\(1,1400/);
 assert.match(js,/Foto com resolução insuficiente/);
});

test('editor farmacêutico consegue salvar PNG por EAN sem permissão geral de mídia',()=>{
  // Regressão: a busca por EAN funcionava, mas /admin/api/upload retornava 403
  // para quem tinha produtos.editar e não midia.criar.
  const usuario={role:'farmaceutico'};
  assert.equal(can(usuario,'produtos.editar'),true);
  assert.equal(can(usuario,'midia.criar'),false);
  const base=new URL('../',import.meta.url);
  const route=readFileSync(new URL('src/routes/admin.js',base),'utf8');
  const js=readFileSync(new URL('public/js/admin.js',base),'utf8');
  assert.match(route,/app\.post\('\/admin\/api\/produtos\/imagem-ean\/png', async \(req, res\)/);
  assert.match(route,/if \(!guardApi\(req, res, 'produtos\.editar'\)\) return/);
  assert.match(route,/foto\.filename !== `ean-\$\{ean\}\.png`/);
  assert.match(route,/detectFileType\(foto\.data\)/);
  assert.match(route,/imageSize\(foto\.data, 'png'\)/);
  assert.match(route,/await saveUpload\(db, foto/);
  assert.match(js,/api\('\/admin\/api\/produtos\/imagem-ean\/png'/);
  assert.doesNotMatch(js,/const dados=await api\('\/admin\/api\/upload'[^\n]*fd/);
  assert.match(js,/Foto encontrada, mas não foi possível salvá-la/);
});

test('foto EAN: formulário sem imagens não lança erro e permite buscar',()=>{
  const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
  const inicio=js.indexOf('  function fotoEANLegadaFormulario(){');
  const fim=js.indexOf('  const formatoEAN=',inicio);
  assert.ok(inicio>0&&fim>inicio);
  const funcoes=js.slice(inicio,fim);
  const montar=(imagens,legenda='')=>{
    const nodes=imagens.map(value=>({value}));
    const formEAN={
      querySelectorAll:(seletor)=>seletor==='[name="imagens[]"]'?nodes:[],
      querySelector:(seletor)=>seletor==='[name="imagens[]"]'?(nodes[0]||null):
        seletor==='[name="imagemLegenda[]"]'?{value:legenda}:null,
    };
    return Function('formEAN','$$','$',funcoes+
      ';return {fotoEANLegadaFormulario,podeAtualizarFotoEAN};')(
      formEAN,
      (seletor,contexto)=>Array.from(contexto.querySelectorAll(seletor)),
      (seletor,contexto)=>contexto.querySelector(seletor));
  };
  const vazio=montar([]);
  assert.equal(vazio.fotoEANLegadaFormulario(),false);
  assert.equal(vazio.podeAtualizarFotoEAN(),true);
  const legado=montar([jpg],'Fonte Open Facts (CC BY-SA 3.0)');
  assert.equal(legado.fotoEANLegadaFormulario(),true);
  assert.equal(legado.podeAtualizarFotoEAN(),true);
  const manual=montar(['/uploads/2026/11/manual.png'],'Foto cadastrada');
  assert.equal(manual.fotoEANLegadaFormulario(),false);
  assert.equal(manual.podeAtualizarFotoEAN(),false);
  const duas=montar([jpg,'/uploads/outra.png'],'Fonte Open Facts (CC BY-SA 3.0)');
  assert.equal(duas.fotoEANLegadaFormulario(),false);
  assert.equal(duas.podeAtualizarFotoEAN(),false);
});

test('PreçoMelhor é fallback via API por EAN quando Open Facts não traz foto',async()=>{
  const e='7896006716112';
  const cdn='https://pub-251da151f43b454d9e192d38bf5e6d71.r2.dev/';
  const urls=[];
  const fetcher=async url=>{
    urls.push(url);
    if(url.includes('precomelhor.com.br/api/product/'))
      return {ok:true,json:async()=>({
        product:{ean:e,image_url:cdn+e+'_w200.webp'},
        details:{media_high_res_url:cdn+e+'.webp',image_url_main:cdn+e+'.webp'},
      })};
    return {ok:false};
  };
  const r=await buscarDadosExternosEAN(e,{fetcher,somente:'imagem',googleKey:'',googleCx:''});
  assert.equal(r.imagem.url,cdn+e+'.webp');
  assert.equal(r.imagem.fonteEAN.fonte,'PreçoMelhor');
  assert.match(r.imagem.fonteEAN.licenca,/atribuição/);
  assert.equal(r.imagem.fonteEAN.urlAtribuicao,'https://www.precomelhor.com.br/p/'+e);
  assert.ok(r.imagem.alternativas.includes(cdn+e+'_w200.webp'));
  assert.equal(urls.filter(u=>u.includes('precomelhor.com.br/api/product/')).length,1);
  assert.deepEqual(candidatosImagemEAN(r.imagem),[cdn+e+'.webp',cdn+e+'_w200.webp']);
});

test('PreçoMelhor: impedir EAN divergente, host malicioso e URLs de outros códigos',async()=>{
  const e='7896006716112';
  const cdn='https://pub-251da151f43b454d9e192d38bf5e6d71.r2.dev/';
  for(const [code,url] of [
    ['7891000100103',cdn+e+'.webp'],
    [e,'https://malicioso.example/'+e+'.webp'],
    [e,cdn+'7891000100103.webp'],
  ]){
    const r=await buscarDadosExternosEAN(e,{somente:'imagem',googleKey:'',googleCx:'',
      fetcher:async req=>req.includes('precomelhor.com.br/api/product/')?
        {ok:true,json:async()=>({product:{ean:code,image_url:url},details:{media_high_res_url:url}})}:
        {ok:false}});
    assert.equal(r.imagem,null);
  }
  assert.equal(origemImagemPermitida(cdn+e+'.webp',e),true);
  assert.equal(origemImagemPermitida(cdn+e+'.webp','7891000100103'),false);
  assert.equal(origemImagemPermitida(cdn+e+'.webp?redirect=foo',e),false);
  assert.equal(origemImagemPermitida('http://pub-251da151f43b454d9e192d38bf5e6d71.r2.dev/'+e+'.webp',e),false);
});

test('proxy de foto PreçoMelhor aceita WEBP da CDN autorizada e recusa redirect externo',async()=>{
  const e='7896006716112';
  const url='https://pub-251da151f43b454d9e192d38bf5e6d71.r2.dev/'+e+'.webp';
  const imagem={url,fonteEAN:{ean:e,fonte:'PreçoMelhor'}};
  const bytes=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),Buffer.alloc(32)]);
  const ok=await buscarImagemDisponivel(imagem,{fetcher:async()=>({
    ok:true,status:200,headers:{get:()=>''},arrayBuffer:async()=>bytes,
  })});
  assert.equal(ok.ok,true);
  assert.equal(ok.mime,'image/webp');
  const denied=await buscarImagemDisponivel(imagem,{fetcher:async()=>({
    status:302,headers:{get:()=>('https://malicioso.example/redirect.webp')},
  })});
  assert.equal(denied.ok,false);
});

test('foto PreçoMelhor exibe crédito público e não assume licença Open Facts',()=>{
  const base=new URL('../',import.meta.url);
  const cliente=readFileSync(new URL('public/js/admin.js',base),'utf8');
  const route=readFileSync(new URL('src/routes/admin.js',base),'utf8');
  const pagina=readFileSync(new URL('src/views/public.js',base),'utf8');
  const cartoes=readFileSync(new URL('src/views/partials.js',base),'utf8');
  assert.match(cliente,/fonte==='PreçoMelhor'/);
  assert.match(route,/fonte==='PreçoMelhor'/);
  assert.match(pagina,/creditoPrecoMelhor/);
  assert.match(cartoes,/creditoImagemPrecoMelhor/);
  assert.match(pagina,/precomelhor\.com\.br\/p\//);
});

test('múltiplas fontes EAN: foto ruim não impede fontes posteriores de serem tentadas',async()=>{
  const e='7896006716112';
  const cdn='https://pub-251da151f43b454d9e192d38bf5e6d71.r2.dev/';
  const urls=[];
  const fetcher=async url=>{
    urls.push(url);
    if(url.includes('world.openfoodfacts.org'))
      return {ok:true,json:async()=>({product:{code:e,
        image_front_url:'https://images.openfoodfacts.org/images/products/789/600/671/6112/front_pt.1.400.jpg'}})};
    if(url.includes('precomelhor.com.br/api/product/'))
      return {ok:true,json:async()=>({product:{ean:e},details:{media_high_res_url:cdn+e+'.webp'}})};
    return {ok:false};
  };
  const r=await buscarDadosExternosEAN(e,{fetcher,somente:'imagem',googleKey:'',googleCx:''});
  assert.equal(r.imagensCandidatas.length,2);
  assert.equal(r.imagensCandidatas[0].fonteEAN.fonte,'Open Food Facts');
  assert.equal(r.imagensCandidatas[1].fonteEAN.fonte,'PreçoMelhor');
  assert.equal(r.imagem,r.imagensCandidatas[0]);
  assert.equal(r.consultadas.includes('Open Pet Food Facts'),true);
  assert.equal(urls.length,7);
});

test('Google API antiga quando configurada amplia candidatos sem baixar imagens de lojas',async()=>{
  const e='7896006716112';
  const good='https://images.openbeautyfacts.org/images/products/789/600/671/6112/front_pt.3.full.jpg';
  const bad='https://loja.example/'+e+'.jpg';
  const urls=[];
  const r=await buscarDadosExternosEAN(e,{somente:'imagem',googleKey:'key',googleCx:'cx',
    fetcher:async url=>{
      urls.push(url);
      if(url.includes('googleapis'))return {ok:true,json:async()=>({items:[
        {link:bad,title:e+' marca'},
        {link:good,title:e+' embalagem'},
      ]})};
      return {ok:false};
    }});
  assert.equal(r.imagensCandidatas.length,1);
  assert.equal(r.imagem.url,good);
  assert.equal(r.imagem.fonteEAN.fonte,'Open Facts (Google)');
  const call=urls.find(u=>u.includes('googleapis'));
  assert.ok(call);
  assert.equal(new URL(call).searchParams.get('searchType'),'image');
  assert.ok(new URL(call).searchParams.get('rights').includes('cc_attribute'));
});

test('painel continua tentando depois de fotos com menos de 600 pixels sem abrir Google manualmente',()=>{
  const base=new URL('../',import.meta.url);
  const js=readFileSync(new URL('public/js/admin.js',base),'utf8');
  const html=readFileSync(new URL('src/views/admin/catalogo.js',base),'utf8');
  const route=readFileSync(new URL('src/routes/admin.js',base),'utf8');
  assert.match(js,/for\(let indice=0;indice<fontes\.length;indice\+\+\)/);
  assert.match(js,/await enviarPNG\(ean,indice\)/);
  assert.match(js,/erros\.push\(fonte/);
  assert.doesNotMatch(js,/google\.com\/search\?tbm=isch/);
  assert.doesNotMatch(html,/id="linkGoogleImagensEAN"/);
  assert.match(html,/Buscar e salvar foto automaticamente/);
  assert.match(route,/const indice=Number\(req\.query\.get\('indice'\)/);
  assert.match(route,/imagensCandidatas\|\|\[\]\)\[indice\]/);
});

test('Wikimedia Commons entra no fluxo automático apenas com EAN, licença e arquivo correto',async()=>{
  const e='7896006716112';
  const foto='https://upload.wikimedia.org/wikipedia/commons/e/e0/'+e+'.jpg';
  const origem='https://commons.wikimedia.org/wiki/File:'+e+'.jpg';
  const fetcher=async url=>{
    if(url.startsWith('https://commons.wikimedia.org/w/api.php'))
      return {ok:true,json:async()=>({query:{pages:[{
        title:'File:'+e+'.jpg',
        imageinfo:[{url:foto,descriptionurl:origem,width:920,height:930,size:95000,
          extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},
            Artist:{value:'<a href="/wiki/User:Author">Fotógrafo</a>'},
            LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}],
      }]}})};
    return {ok:false};
  };
  const r=await buscarDadosExternosEAN(e,{somente:'imagem',googleKey:'',googleCx:'',fetcher});
  assert.equal(r.imagem.url,foto);
  assert.equal(r.imagem.fonteEAN.fonte,'Wikimedia Commons');
  assert.equal(r.imagem.fonteEAN.urlAtribuicao,origem);
  assert.equal(r.imagem.fonteEAN.licenca,'CC BY-SA 4.0');
  assert.equal(origemImagemPermitida(foto,e),true);
  assert.equal(origemImagemPermitida('https://upload.wikimedia.org.evil.test/wikipedia/commons/e/e0/'+e+'.jpg',e),false);
});

test('Wikimedia Commons rejeita EAN diferente, foto pequena e licença incerta',async()=>{
  const e='7896006716112';
  const foto='https://upload.wikimedia.org/wikipedia/commons/e/e0/'+e+'.jpg';
  const tentativa=async (title,width,license)=>{
    const fetcher=async url=>url.includes('commons.wikimedia.org/w/api.php')
      ?{ok:true,json:async()=>({query:{pages:[{title,
        imageinfo:[{url:foto,descriptionurl:'https://commons.wikimedia.org/wiki/File:'+e+'.jpg',
          width,height:900,size:12345,extmetadata:{LicenseShortName:{value:license}}}]}]}})}
      :{ok:false};
    return buscarDadosExternosEAN(e,{somente:'imagem',googleKey:'',googleCx:'',fetcher});
  };
  for(const args of [
    ['File:7896006716113.jpg',900,'CC BY 4.0'],
    ['File:'+e+'.jpg',399,'CC BY-SA 4.0'],
    ['File:'+e+'.jpg',900,'All rights reserved'],
  ])assert.equal((await tentativa(...args)).imagem,null);
});

test('um clique salva imagem PNG no cadastro existente, sem abrir outra aba',()=>{
  const base=new URL('../',import.meta.url);
  const js=readFileSync(new URL('public/js/admin.js',base),'utf8');
  const route=readFileSync(new URL('src/routes/admin.js',base),'utf8');
  assert.match(js,/const produtoExistente=destino\.match/);
  assert.match(js,/const salvo=await post/);
  assert.match(js,/vincular-imagem-ean/);
  assert.match(js,/salvaNoProduto\?'salva automaticamente no produto/);
  assert.match(route,/fonte==='Wikimedia Commons'/);
  assert.match(route,/Atribuição ou licença da foto inválida/);
});

test('Openverse procura EAN automaticamente sem chave e respeita licença comercial',async()=>{
 const code='7896006716112';
 const foto='https://live.staticflickr.com/65535/123456789012_aabbccddeeff_b.jpg';
 const link='https://www.flickr.com/photos/fotografo/123456789012/';
 const registro={source:'flickr',title:'Embalagem '+code,description:'Foto de embalagem',
   url:foto,foreign_landing_url:link,width:1200,height:1000,mature:false,
   license:'by-sa',license_version:'4.0',
   license_url:'https://creativecommons.org/licenses/by-sa/4.0/',creator:'Fotógrafo'};
 const urls=[];
 const resultado=await buscarDadosExternosEAN(code,{fetcher:async url=>{
   urls.push(url);
   return url.includes('api.openverse.org/v1/images/')?{ok:true,json:async()=>({results:[registro]})}:{ok:false};
 },somente:'imagem',googleKey:'',googleCx:''});
 assert.equal(resultado.imagem.url,foto);
 assert.equal(resultado.imagem.fonteEAN.fonte,'Openverse (Flickr)');
 assert.equal(resultado.imagem.fonteEAN.licenca,'CC BY-SA 4.0');
 assert.equal(resultado.imagem.fonteEAN.urlAtribuicao,link);
 assert.ok(resultado.consultadas.includes('Openverse (Flickr)'));
 assert.ok(urls.some(u=>u.includes('openverse.org/v1/images/')&&
   new URL(u).searchParams.get('license_type')==='commercial'));
 assert.equal(origemImagemPermitida(foto,code),true);
 assert.equal(origemImagemPermitida(foto+'?redirect=evil',code),false);
 const fake={...registro,foreign_landing_url:'https://evil.example/photos/author/123456789012/'};
 for(const altered of [
   {...registro,title:'7896006716113',description:'foto sem EAN'},
   {...registro,license:'by-nc-sa',license_url:'https://creativecommons.org/licenses/by-nc-sa/4.0/'},
   {...registro,url:'https://live.staticflickr.com.evil.test/65535/123456789012_aabbccddeeff_b.jpg'},
   {...registro,width:200},
   fake,
 ]){
   const r=await buscarDadosExternosEAN(code,{somente:'imagem',googleKey:'',googleCx:'',
     fetcher:async url=>url.includes('api.openverse.org/v1/images/')
       ?{ok:true,json:async()=>({results:[altered]})}:{ok:false}});
   assert.equal(r.imagem,null);
 }
});

test('Openverse: atribuição e foto são vinculadas automaticamente no produto existente',()=>{
 const root=new URL('../',import.meta.url);
 const js=readFileSync(new URL('public/js/admin.js',root),'utf8');
 const route=readFileSync(new URL('src/routes/admin.js',root),'utf8');
 const cards=readFileSync(new URL('src/views/partials.js',root),'utf8');
 const publicPage=readFileSync(new URL('src/views/public.js',root),'utf8');
 assert.ok(js.includes("fonte==='Openverse (Flickr)'"));
 assert.ok(route.includes("fonte==='Openverse (Flickr)'"));
 assert.match(cards,/function creditoFotoOpenverse/);
 assert.ok(publicPage.includes('creditoFotoOpenverse(produto)'));
 assert.match(js,/salvaNoProduto/);
 assert.doesNotMatch(js,/Google automático exige API/);
});
