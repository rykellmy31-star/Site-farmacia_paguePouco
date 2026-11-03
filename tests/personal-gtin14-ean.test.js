import test from 'node:test';
import assert from 'node:assert/strict';
import {gtinVarejoDaEmbalagem,mesmaFraldaDeEmbalagem}
 from '../src/lib/gtin-embalagem-foto.js';
import {buscarDadosExternosEAN} from '../src/lib/enriquecimento-ean.js';
import {candidatosImagemEAN,origemImagemPermitida} from '../src/lib/ean-image-download.js';

const original='17896110011209',varejo='7896110011202';
const foto='https://pub-251da151f43b454d9e192d38bf5e6d71.r2.dev/'+varejo+'.webp';
const baseProduto={ean:varejo,brand:'Personal Baby',product_name:
 'Fralda Descartável Personal Baby Protect & Sec G Pacote Leve 60 Pague 57 Unidades',
 image_url:foto};
const catalogo={product:baseProduto,details:{media_high_res_url:foto}};
const mock=({product=baseProduto,details=catalogo.details,urls=[]}={})=>async url=>{
 urls.push(url);
 if(url==='https://www.precomelhor.com.br/api/product/'+varejo)
   return {ok:true,json:async()=>({product,details})};
 return {ok:false};
};
test('converte apenas GTIN14 de embalagem válido para GTIN13 com novo dígito',()=>{
 assert.equal(gtinVarejoDaEmbalagem(original),varejo);
 assert.equal(gtinVarejoDaEmbalagem('17896110011193'),'7896110011196');
 assert.equal(gtinVarejoDaEmbalagem('17896110011208'),'');
 assert.equal(gtinVarejoDaEmbalagem('7896110011202'),'');
 assert.equal(gtinVarejoDaEmbalagem('07894222042381'),'');
});

test('confere marca, tamanho e quantidade antes de aceitar foto da caixa Personal',()=>{
 assert.equal(mesmaFraldaDeEmbalagem({nomeProduto:'FRALDA PERSONAL HIPER G 60 UNI',
   marcaProduto:'PERSONAL',produtoFonte:baseProduto}),true);
 for(const wrong of [
   {...baseProduto,product_name:'Fralda Personal XG Leve 60'},
   {...baseProduto,product_name:'Fralda Personal G Leve 70'},
   {...baseProduto,brand:'Outra',product_name:'Fralda Outra G 60 Unidades'},
   {...baseProduto,product_name:'Fralda Personal Pants G 60 Unidades'},
   {...baseProduto,product_name:'Fralda Personal G sem quantidade'},
   {...baseProduto,product_name:'Lenço umedecido Personal G 60 Unidades'},
 ]){
   assert.equal(mesmaFraldaDeEmbalagem({nomeProduto:'FRALDA PERSONAL HIPER G 60 UNI',
     marcaProduto:'PERSONAL',produtoFonte:wrong}),false,wrong.product_name);
 }
});
test('reconhece fonte abreviada Personal XG 50 (FR PERSON EG50)',()=>{
 assert.equal(mesmaFraldaDeEmbalagem({nomeProduto:'FRALDA PERSONAL HIPER XG 50 UNIDADES',
   marcaProduto:'PERSONAL',produtoFonte:{product_name:'Fr Person Pr Sec Eg50',
     brand:'Personal'}}),true);
});
test('integra no fluxo: GTIN14 consulta e baixa o mesmo GTIN13 confirmado',async()=>{
 const urls=[];
 const r=await buscarDadosExternosEAN(original,{fetcher:mock({urls}),
    somente:'imagem',googleKey:'',googleCx:'',nomeProduto:'FRALDA PERSONAL HIPER G 60 UNI',
    marcaProduto:'PERSONAL'});
 assert.equal(r.ok,true);
 assert.equal(r.imagem.fonteEAN.fonte,'PreçoMelhor');
 assert.equal(r.imagem.fonteEAN.ean,original);
 assert.equal(r.imagem.fonteEAN.codigoNaFonte,varejo);
 assert.equal(r.imagem.fonteEAN.correspondencia,'gtin14-embalagem');
 assert.deepEqual(candidatosImagemEAN(r.imagem),[foto]);
 assert.equal(origemImagemPermitida(foto,original),false);
 assert.equal(origemImagemPermitida(foto,varejo),true);
 assert.ok(urls.includes('https://www.precomelhor.com.br/api/product/'+varejo));
});
test('rejeita correspondente de outro tamanho e não associa foto por chute',async()=>{
 for(const product of [
  {...baseProduto,product_name:'Fralda Personal XG 60 Unidades'},
  {...baseProduto,product_name:'Fralda Personal G 36 Unidades'},
  {...baseProduto,ean:'7896110011200'},
 ]){
  const r=await buscarDadosExternosEAN(original,{fetcher:mock({product}),
    somente:'imagem',googleKey:'',googleCx:'',
    nomeProduto:'FRALDA PERSONAL HIPER G 60 UNI',marcaProduto:'PERSONAL'});
  assert.equal(r.imagem,null);
 }
});
