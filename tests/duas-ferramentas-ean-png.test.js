import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buscarDadosExternosEAN} from '../src/lib/enriquecimento-ean.js';
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
 assert.equal(urls.length,1);
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
