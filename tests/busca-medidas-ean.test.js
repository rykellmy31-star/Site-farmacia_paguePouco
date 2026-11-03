import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizarEAN,eanValido,buscarMedidasPorEAN,aplicarMedidasAusentes} from '../src/lib/busca-medidas-ean.js';
const ean='7891000100103';
function fetchFake(resp,observado=[]){
  return async (url,opts)=>{observado.push({url,opts});return {ok:true,json:async()=>resp};};
}
const exemplo={code:'OK',items:[{ean,title:'Produto de teste',
  dimension:'16 x 8 x 5 cm',weight:'450 g'}]};
test('EAN válido, normalização sem retirar dígitos e checagem do verificador',()=>{
  assert.equal(eanValido(ean),true);
  assert.equal(eanValido(ean.slice(0,-1)+'0'),false);
  assert.equal(eanValido('7891234567890'),false);
  assert.equal(eanValido('abc'),false);
  assert.equal(normalizarEAN('7891-0001 00103'),ean);
});
test('busca medidas por EAN em API gratuita sem acesso a segredo',async()=>{
  const chamadas=[];
  const r=await buscarMedidasPorEAN(ean,{fetcher:fetchFake(exemplo,chamadas)});
  assert.equal(r.encontrado,true);
  assert.equal(r.origem,'UPCitemDB');
  assert.equal(r.peso,0.45);
  assert.deepEqual(r.dimensoes,{comprimento:16,largura:8,altura:5});
  assert.equal(chamadas.length,1);
  assert.equal(chamadas[0].url,'https://api.upcitemdb.com/prod/trial/lookup?upc='+ean);
});
test('medidas em polegadas e libras convertem para cm e kg',async()=>{
  const r=await buscarMedidasPorEAN(ean,{fetcher:fetchFake({items:[
    {ean,dimension:'4 x 2 x 1 inches',weight:'2 lbs'}]})});
  assert.equal(r.encontrado,true);
  assert.deepEqual(r.dimensoes,{comprimento:10.16,largura:5.08,altura:2.54});
  assert.ok(Math.abs(r.peso-0.907)<0.002);
});
test('EAN de outro produto, peso líquido e dimensões sem unidade não preenchem',async()=>{
  const chamadas=[];
  const fetcher=async url=>{chamadas.push(url);
    if(url.includes('upcitemdb'))return {ok:true,json:async()=>({items:[
      {ean:'7891000100104',dimension:'16 x 8 x 5 cm',weight:'450 g'},
      {ean,dimension:'16 x 8 x 5',weight:'450 ml'}]})};
    return {ok:false};
  };
  const r=await buscarMedidasPorEAN(ean,{fetcher});
  assert.equal(r.encontrado,false);
  assert.equal(chamadas.length,4); // UPC e três catálogos abertos
});
test('retorno parcial não cria dimensões imaginárias nem usa peso líquido',async()=>{
  const r=await buscarMedidasPorEAN(ean,{fetcher:fetchFake({items:[
    {ean,dimension:'',weight:'300 g'}]})});
  assert.equal(r.peso,0.3);
  assert.deepEqual(r.dimensoes,{});
  assert.deepEqual(r.campos,['peso']);
});
test('base aberta só usa medida explícita da embalagem, não conteúdo em gramas',async()=>{
  const urls=[];
  const fetcher=async url=>{urls.push(url);
    if(url.includes('upcitemdb'))return {ok:false};
    return {ok:true,json:async()=>({product:{code:ean,quantity:'500 g',
      product_name:'Produto testado',packaging_dimensions:'20 x 12 x 6 cm',
      package_weight:'0.6 kg'}})};
  };
  const r=await buscarMedidasPorEAN(ean,{fetcher});
  assert.equal(r.encontrado,true);
  assert.equal(r.origem,'Open Food Facts');
  assert.equal(r.peso,0.6);
  assert.equal(r.dimensoes.largura,12);
});
test('mantém medidas preenchidas, complementa vazias e registra fonte para revisão',()=>{
  const dados={peso:1.2,dimensoes:{largura:0,altura:9,comprimento:0}};
  const busca={encontrado:true,ean,origem:'UPCitemDB',
    peso:0.45,dimensoes:{largura:8,altura:5,comprimento:16}};
  const patch=aplicarMedidasAusentes(dados,busca);
  assert.equal(patch.peso,undefined);
  assert.deepEqual(patch.dimensoes,{largura:8,altura:9,comprimento:16});
  assert.equal(patch.logisticaFonte.revisaoPendente,true);
  const cheio={peso:1.2,dimensoes:{largura:8,altura:9,comprimento:16}};
  assert.deepEqual(aplicarMedidasAusentes(cheio,busca),{});
});
test('falha externa não bloqueia fluxo de ativação nem escreve valores falsos',async()=>{
  const r=await buscarMedidasPorEAN(ean,{fetcher:async()=>{throw Error('offline')}});
  assert.equal(r.encontrado,false);
  assert.deepEqual(aplicarMedidasAusentes({peso:0,dimensoes:{}},r),{});
});
test('integração exige permissão admin e não altera pagamento, preço nem regras sanitárias',()=>{
  const base=new URL('../',import.meta.url);
  const rotas=readFileSync(new URL('src/routes/admin.js',base),'utf8');
  const tela=readFileSync(new URL('src/views/admin/catalogo.js',base),'utf8');
  const js=readFileSync(new URL('public/js/admin.js',base),'utf8');
  assert.match(rotas,/guardApi\(req,res,'produtos\.editar'\)/);
  assert.match(rotas,/buscarMedidasFaltantes/);
  assert.match(rotas,/app\.post\('\/admin\/api\/produtos\/:id\/ativar', async/);
  assert.match(rotas,/aplicarMedidasAusentes\(p,busca\.resultado\)/);
  assert.match(tela,/id="botaoBuscarMedidasEAN"/);
  assert.match(js,/campo\('ean'\)\?\.addEventListener\('change'/);
});
