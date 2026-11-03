import test from 'node:test';
import assert from 'node:assert/strict';
import {consultaFabricante,mesmoProdutoDoFabricante,normalizarNomeCatalogo}
  from '../src/lib/busca-fotos-fabricantes.js';
import {buscarDadosExternosEAN} from '../src/lib/enriquecimento-ean.js';
import {origemImagemPermitida} from '../src/lib/ean-image-download.js';

const ean='7898148299317';
const foto='https://images.openproductsfacts.org/images/products/789/814/829/9317/front_pt.1.800.jpg';
const candidato={code:ean,product_name:'ACICLOVIR CREME 50 MG/G 10G',
  brands:'Prati Donaduzzi',image_front_url:foto};
const contexto={somente:'imagem',googleKey:'',googleCx:'',
  nomeProduto:'ACICLOVIR CREME 50MG/G 10G',
  marcaProduto:'ACICLOVIR',fabricanteProduto:'PRATI DONADUZZI'};
const fetcherCom=(item,urls=[])=>async url=>{
  urls.push(url);
  if(url.includes('cgi/search.pl')&&url.includes('openproductsfacts.org'))
    return {ok:true,json:async()=>({products:item?[item]:[]})};
  return {ok:false,json:async()=>({})};
};
test('todo fabricante válido pode participar da busca sem hardcode de 434 nomes',()=>{
 assert.equal(consultaFabricante('ACICLOVIR CREME 50MG/G 10G','PRATI DONADUZZI').fabricante,
   'PRATI DONADUZZI');
 assert.ok(consultaFabricante('DIPIRONA 500MG 20 CPR','EMS'));
 assert.ok(consultaFabricante('SHAMPOO 250ML','LOREAL'));
 assert.equal(consultaFabricante('ACICLOVIR CREME 50MG/G 10G','DIVERSOS'),null);
 assert.equal(consultaFabricante('ACICLOVIR CREME 50MG/G 10G',''),null);
 assert.equal(normalizarNomeCatalogo('Aciclovir creme 50 mg/g 10g'),
   normalizarNomeCatalogo('ACICLOVIR CREME 50MG/G 10G'));
});
test('foto de fabricante exige nome/apresentação e fabricante idênticos',()=>{
 const ref=consultaFabricante(contexto.nomeProduto,contexto.fabricanteProduto);
 assert.equal(mesmoProdutoDoFabricante(candidato,ref),true);
 assert.equal(mesmoProdutoDoFabricante({...candidato,brands:'OUTRO FABRICANTE'},ref),false);
 assert.equal(mesmoProdutoDoFabricante({...candidato,product_name:'ACICLOVIR 50MG/G 20G'},ref),false);
 assert.equal(mesmoProdutoDoFabricante({...candidato,product_name:'ACICLOVIR COMPRIMIDO 200MG 25 CPR'},ref),false);
});
test('integra nome e fabricante nas bases Open Facts somente com EAN idêntico',async()=>{
 const urls=[];
 const r=await buscarDadosExternosEAN(ean,{...contexto,fetcher:fetcherCom(candidato,urls)});
 assert.equal(r.imagem?.url,foto);
 assert.equal(r.imagem?.fonteEAN?.fonte,'Open Products Facts');
 assert.equal(r.imagem?.fonteEAN?.ean,ean);
 assert.equal(origemImagemPermitida(foto,ean),true);
 assert.ok(urls.some(u=>u.includes('search_terms=')&&u.includes('PRATI')));
 assert.ok(r.consultadas.some(x=>x.includes('busca por fabricante')));
});
test('não associa fotos de outro EAN, outro fabricante nem apresentações diferentes',async()=>{
 for(const p of [
  {...candidato,code:'7898148295227'},
  {...candidato,brands:'Eurofarma'},
  {...candidato,product_name:'ACICLOVIR CREME 50 MG/G 20G'},
 ]){
  const r=await buscarDadosExternosEAN(ean,{...contexto,fetcher:fetcherCom(p)});
  assert.equal(r.imagem,null);
 }
});
test('sem fabricante não executa consultas de nome, mantendo busca EAN usual',async()=>{
 const urls=[];
 const r=await buscarDadosExternosEAN(ean,{
  ...contexto,fabricanteProduto:'',fetcher:fetcherCom(candidato,urls)});
 assert.equal(r.imagem,null);
 assert.equal(urls.filter(u=>u.includes('cgi/search.pl')).length,0);
});
