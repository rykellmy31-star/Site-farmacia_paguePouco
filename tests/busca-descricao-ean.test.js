import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {consultarDescricaoEAN,preencherDescricaoAusente}
  from '../src/lib/busca-descricao-ean.js';
const ean='7891000100103';
const facto={code:ean,product_name_pt:'Sabonete Lavanda',
  generic_name_pt:'Sabonete em barra',brands:'Marca Exemplo',
  quantity:'90 g',packaging:'Papel'};
function mockFacts(product,urls=[]){
 return async url=>{
   urls.push(url);
   if(url.includes('world.openbeautyfacts'))return {
     ok:true,json:async()=>({product})};
   return {ok:true,json:async()=>({product:null})};
 };
}
test('busca gratuita retorna descrição, nome, marca e embalagem pelo EAN exato',async()=>{
 const urls=[];
 const r=await consultarDescricaoEAN(ean,{fetcher:mockFacts(facto,urls),cosmosToken:''});
 assert.equal(r.ok,true);assert.equal(r.encontrado,true);
 assert.equal(r.origem,'Open Beauty Facts');
 assert.equal(r.nome,'Sabonete Lavanda');assert.equal(r.marca,'Marca Exemplo');
 assert.match(r.descricao,/Sabonete em barra/);
 assert.match(r.descricao,/90 g/);
 assert.match(r.descricao,/fonte: Open Beauty Facts/);
 assert.equal(urls.length,3);
 assert.ok(urls.every(url=>url.includes('/api/v2/product/')));
});
test('EAN diferente nunca recebe descrição de outro produto',async()=>{
 const r=await consultarDescricaoEAN(ean,{fetcher:mockFacts({
   ...facto,code:'7891000100104'}),cosmosToken:''});
 assert.equal(r.encontrado,false);
});
test('Cosmos oficial é opcional com token e prioriza descrição se EAN idêntico',async()=>{
 const urls=[],heads=[];
 const fetcher=async(url,opts)=>{
   urls.push(url);heads.push(opts.headers);
   return {ok:true,json:async()=>({
     gtin:Number(ean),description:'Shampoo teste 200ml',
     brand:{name:'Marca Cosmos'},gross_weight:240,
   })};
 };
 const r=await consultarDescricaoEAN(ean,{fetcher,cosmosToken:'TOKEN_EXEMPLO'});
 assert.equal(r.origem,'Bluesoft Cosmos');
 assert.match(r.descricao,/Shampoo teste 200ml/);
 assert.equal(r.marca,'Marca Cosmos');
 assert.equal(urls.length,1);
 assert.match(urls[0],/api\.cosmos\.bluesoft\.com\.br\/gtins/);
 assert.equal(heads[0]['X-Cosmos-Token'],'TOKEN_EXEMPLO');
 assert.doesNotMatch(r.descricao,/peso bruto|240/);
});
test('sem descrição prévia preenche somente descrição, nunca preço ou sanitário',async()=>{
 const r=await consultarDescricaoEAN(ean,{fetcher:mockFacts(facto)});
 const produto={ean,descricao:'',precoCentavos:999,sanitario:{controlado:true}};
 assert.deepEqual(preencherDescricaoAusente(produto,r),{descricao:r.descricao});
 assert.deepEqual(preencherDescricaoAusente({...produto,descricao:'Manual'},r),{});
 assert.deepEqual(preencherDescricaoAusente({...produto,ean:'7891000100104'},r),{});
});
test('não executa HTML externo nem inventa indicações terapêuticas',async()=>{
 const malicious={code:ean,product_name:'Produto <script>alert(1)</script>',
   generic_name:'<img src=x onerror=alert(1)>',brands:'Teste'};
 const r=await consultarDescricaoEAN(ean,{fetcher:mockFacts(malicious)});
 assert.equal(r.encontrado,true);
 assert.doesNotMatch(r.descricao,/<script|<img|onerror/i);
 assert.doesNotMatch(r.descricao,/indicado para|cura|trata doenças/i);
});
test('painel oferece terceira ferramenta independente para descrição',()=>{
 const base=new URL('../',import.meta.url);
 const layout=readFileSync(new URL('src/views/admin/catalogo.js',base),'utf8');
 const routes=readFileSync(new URL('src/routes/admin.js',base),'utf8');
 const js=readFileSync(new URL('public/js/admin.js',base),'utf8');
 assert.match(layout,/botaoBuscarDescricaoEAN/);
 assert.match(layout,/botaoBuscarImagemEAN/);
 assert.match(layout,/botaoBuscarMedidasEAN/);
 assert.match(routes,/app\.post\('\/admin\/api\/produtos\/descricao-ean'/);
 assert.match(routes,/app\.post\('\/admin\/api\/produtos\/:id\/buscar-descricao-ean'/);
 assert.match(routes,/preencherDescricaoAusente\(p,dados\)/);
 assert.match(js,/buscarDescricaoEAN/);
 assert.match(js,/editor\.innerHTML=dados\.descricao/);
 assert.match(js,/buscar-descricao-ean/);
});
