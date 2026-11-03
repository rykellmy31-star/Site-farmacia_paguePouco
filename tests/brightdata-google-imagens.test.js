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
 assert.equal(url.searchParams.get('tbm'),'isch');
 assert.equal(url.searchParams.get('gl'),'br');
 assert.equal(url.searchParams.get('brd_json'),'1');
 assert.doesNotMatch(payload.url,/SEGREDO/);
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
test('erros de autenticação não vazam segredo',async()=>{
 const r=await consultarGoogleImagensEAN(ean,{apiToken:'SEGREDO',zone:'cr_farmacia_imagens',
   fetcher:async()=>({ok:false,status:401})});
 assert.equal(r.ok,false);
 assert.doesNotMatch(r.erro,/SEGREDO/);
});
