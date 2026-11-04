import test from 'node:test';
import assert from 'node:assert/strict';
import {consultarGoogleImagensEAN,candidatosGoogleImagens} from '../src/lib/brightdata-google-imagens.js';

const ean='7891000100103';
test('pesquisa pelo EAN somente no Google Imagens BR, sem expor token na URL',async()=>{
 let chamada;
 const fetcher=async(url,opcoes)=>{
   chamada={url,opcoes};
   return {ok:true,json:async()=>({images:[{
     original:'https://cdn.fabricante.com.br/produto.png',
     thumbnail:'https://cdn.fabricante.com.br/miniatura.png',
     title:'Embalagem '+ean,
     source_url:'https://fabricante.com.br/produtos/'+ean,
   }]})};
 };
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',fetcher});
 assert.equal(r.ok,true);
 assert.equal(r.imagens.length,1);
 assert.equal(r.imagens[0].revisaoObrigatoria,true);
 assert.equal(chamada.url,'https://api.brightdata.com/request');
 assert.equal(chamada.opcoes.headers.Authorization,'Bearer SEGREDO');
 const payload=JSON.parse(chamada.opcoes.body);
 assert.equal(payload.zone,'cr_farmacia_imagens');
 const url=new URL(payload.url);
 assert.equal(url.hostname,'www.google.com');
 assert.equal(url.searchParams.get('udm'),'2');
 assert.equal(url.searchParams.get('gl'),'br');
 assert.equal(url.searchParams.get('brd_json'),'1');
 assert.doesNotMatch(payload.url,/SEGREDO/);
});
test('interpreta campos nativos images[].original_image e image_alt da Bright Data',()=>{
 const imagens=candidatosGoogleImagens({images:[{
   original_image:'https://cdn.fabricante.com.br/7891000100103.jpg',
   image_alt:'Foto frontal do produto '+ean,
   link:'https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.fabricante.com.br%2F7891000100103.jpg'
 }]},ean);
 assert.equal(imagens.length,1);
 assert.match(imagens[0].url,/7891000100103\.jpg$/);
 assert.match(imagens[0].titulo,/Foto frontal/);
});
test('rejeita EAN inválido antes da consulta e exige a configuração',async()=>{
 const fetcher=()=>{throw Error('não deveria consultar')};
 assert.equal((await consultarGoogleImagensEAN('999',{fetcher})).status,400);
 assert.equal((await consultarGoogleImagensEAN(ean,{fetcher})).status,503);
});
test('não aceita HTTP nem URL com credenciais e não duplica imagens',()=>{
 const imagens=candidatosGoogleImagens({images:[
   {original:'http://dominio.com/foto.jpg'},
   {original:'https://usuario:senha@dominio.com/foto.jpg'},
   {original:'https://dominio.com/foto.jpg',title:ean},
   {original:'https://dominio.com/foto.jpg',title:ean},
 ]},ean);
 assert.equal(imagens.length,1);
 assert.equal(imagens[0].eanMencionado,true);
});
test('uma busca de imagens usa timeout estendido de 55 segundos',async()=>{
 let tempo=0;
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
  fetcher:async(_url,opt)=>{
    // Não acessa a rede: garante que timeout não seja 12 segundos.
    tempo=opt.signal?55000:0;
    return {ok:true,json:async()=>({images:[]})};
  }});
 assert.equal(r.ok,true);
 assert.equal(tempo,55000);
});
test('timeout informa causa sem expor segredo nem repetir consultas',async()=>{
 let tentativas=0;
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
  fetcher:async()=>{tentativas++;throw Object.assign(new Error('SEGREDO'),{name:'TimeoutError'})}});
 assert.equal(r.status,504);
 assert.equal(r.codigo,'BD_TIMEOUT');
 assert.equal(tentativas,1);
 assert.doesNotMatch(r.erro,/SEGREDO/);
 assert.match(r.erro,/55 segundos/);
});
test('falha de rede é distinta de credenciais inválidas',async()=>{
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
  fetcher:async()=>{throw Object.assign(new Error('SEGREDO'),{name:'TypeError'})}});
 assert.equal(r.codigo,'BD_REDE');
 assert.equal(r.status,502);
 assert.doesNotMatch(r.erro,/SEGREDO/);
});
test('zona inválida retorna diagnóstico sem vazar resposta do provedor',async()=>{
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
  fetcher:async()=>({ok:false,status:400,headers:new Headers({'x-brd-error-code':'zone_missing'})})});
 assert.equal(r.codigo,'BD_CONFIGURACAO');
 assert.equal(r.referencia,'zone_missing');
 assert.equal(r.status,503);
});
test('HTTP 200 com corpo de erro não simula pesquisa vazia',async()=>{
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
  fetcher:async()=>({ok:true,status:200,json:async()=>({error:'zone not found'})})});
 assert.equal(r.codigo,'BD_RESPOSTA_ERRO');
 assert.equal(r.ok,false);
});
test('erros de autenticação não vazam segredo',async()=>{
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
   fetcher:async()=>({ok:false,status:401})});
 assert.equal(r.ok,false);
 assert.doesNotMatch(r.erro,/SEGREDO/);
});
