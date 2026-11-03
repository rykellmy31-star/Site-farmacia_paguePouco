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

test('leitor usa quadro completo, resolução preferida e escolhe câmera principal no iPhone',()=>{
 assert.doesNotMatch(scanner,/qrbox\s*:/);
 assert.doesNotMatch(scanner,/aspectRatio\s*:/);
 assert.match(scanner,/videoConstraints:configuracaoVideo\(idCamera\)/);
 assert.match(scanner,/width:\{ideal:1280\}/);
 assert.match(scanner,/height:\{ideal:720\}/);
 assert.match(scanner,/useBarCodeDetectorIfSupported:true/);
 const a=scanner.indexOf('  function escolherCamera(cameras){');
 const b=scanner.indexOf('  function atualizarCameras(cameras,selecionada){');
 assert.ok(a>0&&b>a);
 const fn=vm.runInNewContext(scanner.slice(a,b)+' escolherCamera;');
 const cameras=[
   {id:'ultra',label:'Back Ultra Wide Camera'},
   {id:'main',label:'Back Wide Camera'},
   {id:'tele',label:'Back Telephoto Camera'},
 ];
 assert.equal(fn(cameras),'main');
 assert.equal(fn([{id:'only',label:'Câmera traseira'}]),'only');
});
test('fluxo de câmera inicia sem crop, lê EAN e encerra stream antes de sair',async()=>{
 const handlers={},elems={},instances=[];
 let enviado=0;
 const modal={
   open:false,innerHTML:'',listeners:{},
   setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},
   showModal(){this.open=true;},
   close(){this.open=false;this.listeners.close?.();},
 };
 const destino={
   value:'',dispatchEvent(){},focus(){},
   closest(){return {matches:()=>true,requestSubmit(){enviado++;}};},
 };
 elems.leitorCodigoCamera={value:'',options:[],
   replaceChildren(){this.options=[];},
   append(o){this.options.push(o);},
   addEventListener(name,fn){handlers['select-'+name]=fn;}
 };
 elems.leitorCameraControle={hidden:true};
 elems.leitorCodigoStatus={textContent:''};
 for(const id of ['fecharLeitorCodigo','leitorEscolherFoto','leitorFotoArquivo']){
   elems[id]={addEventListener(){},click(){}};
 }
 const document={
   head:{appendChild(){}},body:{append(){}},hidden:false,
   querySelector(sel){
     return sel==='[data-leitor-codigo]'?{}:
       sel==='form[action="/admin/produtos"] input[name="q"]'?destino:null;
   },
   getElementById(id){return elems[id]||null;},
   createElement(tag){
     if(tag==='dialog')return modal;
     if(tag==='style')return {textContent:''};
     return {value:'',textContent:''};
   },
   addEventListener(name,fn){handlers[name]=fn;}
 };
 class FakeScanner{
   constructor(id,cfg){this.id=id;this.cfg=cfg;this.running=false;instances.push(this);}
   static async getCameras(){return [
     {id:'ultra',label:'Back Ultra Wide Camera'},
     {id:'main',label:'Back Wide Camera'}];}
   async start(camera,options,onSuccess){
     this.camera=camera;this.options=options;this.success=onSuccess;this.running=true;
   }
   getState(){return this.running?2:0;}
   async stop(){this.running=false;this.stopped=true;}
   clear(){this.cleared=true;}
 }
 const context={document,
   navigator:{mediaDevices:{getUserMedia(){}}},
   window:{Html5Qrcode:FakeScanner,isSecureContext:true,
     Html5QrcodeSupportedFormats:{EAN_13:1,EAN_8:2,UPC_A:3,UPC_E:4,ITF:5,CODE_128:6},
     addEventListener(){}},
   Event:class Event{constructor(type){this.type=type;}},
   setTimeout,clearTimeout,console,Promise};
 vm.runInNewContext(scanner,context);
 const botao={disabled:false,dataset:{leitorCodigo:'form[action="/admin/produtos"] input[name="q"]'}};
 handlers.click({target:{closest:()=>botao},preventDefault(){}});
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(instances.length,1);
 assert.equal(instances[0].camera,'main');
 assert.ok(instances[0].options.videoConstraints);
 assert.equal(instances[0].options.videoConstraints.width.ideal,1280);
 assert.equal(instances[0].options.qrbox,undefined);
 assert.equal(instances[0].options.aspectRatio,undefined);
 assert.equal(elems.leitorCameraControle.hidden,false);
 await instances[0].success('7894222042381');
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(destino.value,'7894222042381');
 assert.equal(enviado,1);
 assert.equal(modal.open,false);
 assert.equal(instances[0].stopped,true);
});
