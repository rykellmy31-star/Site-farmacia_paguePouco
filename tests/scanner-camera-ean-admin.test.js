import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const raiz=new URL('../',import.meta.url);
const view=readFileSync(new URL('src/views/admin/catalogo.js',raiz),'utf8');
const layout=readFileSync(new URL('src/views/admin/layout.js',raiz),'utf8');
const scanner=readFileSync(new URL('public/js/barcode-scanner.js',raiz),'utf8');
const vendor=readFileSync(new URL('public/js/vendor/html5-qrcode.min.js',raiz),'utf8');

test('camera em busca e formulario sem submeter produto automaticamente',()=>{
 assert.ok(view.includes("data-leitor-codigo='form[action=\"/admin/produtos\"] input[name=\"q\"]'"));
 assert.ok(view.includes('data-leitor-codigo="#formProduto input[name=ean]"'));
 assert.match(view,/📷 Bipar com a câmera/);
 assert.match(view,/📷 Ler EAN/);
 assert.match(layout,/barcode-scanner\.js\?v=/);
 assert.match(scanner,/requestSubmit\?\.\(\)/);
 assert.match(scanner,/destino\.dispatchEvent\(new Event\('change'/);
 assert.doesNotMatch(scanner,/fetch\(/);
 assert.doesNotMatch(scanner,/localStorage|sessionStorage/);
});
test('scanner hospedado na própria loja, com licença e sem leitura silenciosa',()=>{
 assert.ok(vendor.length>350000);
 assert.ok(vendor.includes('Html5QrcodeSupportedFormats'));
 assert.match(scanner,/\/js\/vendor\/html5-qrcode\.min\.js/);
 assert.match(scanner,/document\.querySelector\('\[data-leitor-codigo\]'\)/);
 assert.match(scanner,/navigator\.mediaDevices\?\.getUserMedia/);
 assert.match(scanner,/navigator\.mediaDevices/);
 assert.match(scanner,/getState\(\)===2/);
 assert.match(scanner,/document\.hidden&&modal\?\.open/);
 assert.match(scanner,/accept="image\/\*"/);
 assert.match(scanner,/capture="environment"/);
});
test('scanner verifica check-digit GTIN 8, 12, 13 e 14; rejeita número inválido',()=>{
 const markers=['const style=document.createElement','  function validoEAN(c){','  function status(msg){'];
 const a=scanner.indexOf(markers[1]), b=scanner.indexOf(markers[2]);
 assert.ok(a>0&&b>a);
 const fun=scanner.slice(a,b);
 const valido=vm.runInNewContext(fun+' validoEAN;');
 for(const cod of ['7894222042381','07894222042381','7896110011202','17896110011209'])
   assert.equal(valido(cod),true,cod);
 for(const cod of ['7894222042382','123','123456789012345','17896110011200','https://evil.com'])
   assert.equal(valido(cod),false,cod);
});
test('biblioteca local de código de barras é Apache 2.0',()=>{
 const lic=readFileSync(new URL('public/js/vendor/LICENSE-html5-qrcode.txt',raiz),'utf8');
 assert.match(lic,/Apache License/);
 assert.match(lic,/Version 2\.0/);
});
