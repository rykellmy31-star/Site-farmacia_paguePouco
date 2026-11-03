import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarImagemDisponivel, candidatosImagemEAN, origemImagemPermitida }
  from '../src/lib/ean-image-download.js';
import { buscarDadosExternosEAN } from '../src/lib/enriquecimento-ean.js';

const principal='https://images.openfoodfacts.org/images/products/789/100/010/0103/front_pt.32.400.jpg';
const full=principal.replace('.400.jpg','.full.jpg');
const outro='https://images.openbeautyfacts.org/images/products/789/100/010/0103/front_pt.9.400.jpg';
const foto=Buffer.from([0xff,0xd8,0xff,0xe0,0,8,0,0,0,0,0,0]);
const headers=(map={})=>({get:k=>Object.entries(map).find(([a])=>a.toLowerCase()===k.toLowerCase())?.[1]??null});
const rsp=(status,bytes=foto,head={})=>({
 status,ok:status>=200&&status<300,
 headers:headers({'content-type':'image/jpeg',...head}),
 arrayBuffer:async()=>bytes,
});
test('origem permitida é exclusivamente Open Facts HTTPS sem dados na URL',()=>{
 assert.equal(origemImagemPermitida(principal),true);
 for(const url of [
   'https://evil.tld/images/products/1.jpg',
   'http://images.openfoodfacts.org/images/products/1.jpg',
   'https://images.openfoodfacts.org.evil.tld/images/products/1.jpg',
   'https://images.openfoodfacts.org/not-products/1.jpg',
   'https://images.openfoodfacts.org/images/products/1.jpg?url=evil',
   'https://images.openfoodfacts.org/images/products/1.svg',
 ])assert.equal(origemImagemPermitida(url),false,url);
});
test('prioriza original de alta resolução e permite variantes/fonte alternativa',()=>{
 const c=candidatosImagemEAN({url:principal,alternativas:[outro]});
 assert.deepEqual(c,[full,principal,outro.replace('.400.jpg','.full.jpg'),outro]);
});
test('quando original retorna 404 tenta variante publicada sem erro genérico',async()=>{
 const calls=[];
 const fetcher=async url=>{calls.push(url);return url===full?rsp(404):rsp(200);};
 const r=await buscarImagemDisponivel({url:principal},{fetcher});
 assert.equal(r.ok,true);
 assert.equal(r.mime,'image/jpeg');
 assert.equal(r.tentativas,2);
 assert.deepEqual(calls,[full,principal]);
});
test('redirecionamento CDN Open Facts autorizado, externo bloqueado',async()=>{
 const calls=[];
 const fetcher=async url=>{
   calls.push(url);
   if(url===full)return rsp(302,foto,{location:full.replace('images.','static.')});
   return rsp(200);
 };
 const r=await buscarImagemDisponivel({url:principal},{fetcher});
 assert.equal(r.ok,true);
 assert.equal(calls.length,2);
 assert.match(calls[1],/static\.openfoodfacts/);
 let externalCalled=false;
 const invalid=await buscarImagemDisponivel({url:principal},{fetcher:async url=>{
   if(!url.includes('openfoodfacts.org'))externalCalled=true;
   return rsp(302,foto,{location:'https://servidor-privado.example/image.jpg'});
 }});
 assert.equal(invalid.ok,false);
 assert.equal(externalCalled,false);
});
test('imagem >12MB em uma fonte tenta alternativa sem carregar arquivo imenso',async()=>{
 const calls=[];
 const fetcher=async url=>{
   calls.push(url);
   return url.includes('openfoodfacts.org')?rsp(200,foto,{'content-length':String(13*1024*1024)})
     :rsp(200);
 };
 const r=await buscarImagemDisponivel({url:principal,alternativas:[outro]},{fetcher});
 assert.equal(r.ok,true);
 assert.match(r.origem,/openbeautyfacts/);
 assert.ok(calls.length>=3);
});
test('não aceita HTML mascarado como imagem, ou fotos sem cabeçalho válido',async()=>{
 const r=await buscarImagemDisponivel({url:principal},{
   fetcher:async()=>rsp(200,Buffer.from('<html>login</html>'))});
 assert.equal(r.ok,false);
 assert.equal(r.erros.formato,2);
});
test('coleta URLs alternativas apenas para o MESMO EAN em fontes independentes',async()=>{
 const urls=[];
 const fetcher=async url=>{
   urls.push(url);
   if(url.includes('openfoodfacts.org'))return rspJson({product:{
     code:'7891000100103',image_front_url:principal}});
   if(url.includes('openbeautyfacts.org'))return rspJson({product:{
     code:'7891000100103',image_front_url:outro}});
   return rspJson({product:{code:'7891000100104',image_front_url:outro}});
 };
 function rspJson(data){return {ok:true,json:async()=>data};}
 const r=await buscarDadosExternosEAN('7891000100103',{
   fetcher,googleKey:'',googleCx:'',somente:'imagem'});
 assert.equal(r.imagem.url,principal);
 assert.deepEqual(r.imagensCandidatas.map(i=>i.url),[principal,outro]);
 assert.equal(r.imagensCandidatas[1].fonteEAN.fonte,'Open Beauty Facts');
 assert.equal(urls.length,7); // 4 catálogos Open Facts + PreçoMelhor + Commons + Openverse
});
