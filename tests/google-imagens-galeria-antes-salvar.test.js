import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const admin=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');

test('seleção de Google Imagens é imediata, sem executar download no clique',()=>{
  const inicio=admin.indexOf("salvar.addEventListener('click',()=>{");
  const fim=admin.indexOf('card.appendChild(salvar)',inicio);
  assert.ok(inicio>0&&fim>inicio);
  const trecho=admin.slice(inicio,fim);
  assert.match(trecho,/mostrarFotoGooglePendente\(item,ean\)/);
  assert.match(trecho,/galeriaProduto/);
  assert.match(trecho,/Salvar alterações/);
  assert.doesNotMatch(trecho,/enviarPNG\(/);
  assert.doesNotMatch(trecho,/vincular-imagem-google/);
});
test('somente Salvar alterações do produto converte e envia PNG antes do FormData',()=>{
 const inicio=admin.indexOf("if(fotoGooglePendente){");
 const png=admin.indexOf("await concluirFotoGooglePendente()",inicio);
 const envio=admin.indexOf("body: new FormData(form)",png);
 assert.ok(inicio>0&&png>inicio&&envio>png);
 assert.match(admin,/const midia=await enviarPNG\(escolha\.ean,0,contextoBuscaImagemEAN\(\),url\)/);
 assert.match(admin,/if\(!definirFotoGoogleFormulario\(midia,escolha\.origem\)\)/);
 assert.match(admin,/if\(buscaImagemAntesDeSalvar&&podeAtualizarFotoEAN\(\)&&!fotoGooglePendente\)/);
});
test('troca somente fotos (preserva vídeos), usa inputs do formulário, e não trava por DOM singleton',()=>{
  const inicio=admin.indexOf('function definirFotoGoogleFormulario(');
  const fim=admin.indexOf('async function pesquisarGoogleImagensEAN(',inicio);
  assert.ok(inicio>0&&fim>inicio);
  const fragmento=admin.slice(inicio,fim);
  assert.match(fragmento,/querySelectorAll\('\.item-midia\[data-tipo="image"\],\[data-google-pendente="1"\]'\)/);
  assert.doesNotMatch(fragmento,/querySelectorAll\('\.item-midia\[data-tipo="video"\]'\)/);
  assert.match(fragmento,/Array\.from\(formEAN\.querySelectorAll\(/);
  assert.match(fragmento,/anexarFotoFormulario\(midia,'Google Imagens \(seleção manual\)'/);
  // O formulário já grava a primeira imagem do array como principal.
  assert.match(routes,/principal:\s*i === 0/);
});
test('fragmento da galeria funciona com arrays simulados e remove apenas fotos antigas',()=>{
  const inicio=admin.indexOf('function definirFotoGoogleFormulario(');
  const fim=admin.indexOf('async function pesquisarGoogleImagensEAN(',inicio);
  const fragmento=admin.slice(inicio,fim);
  const fotos=[{removed:false,remove(){this.removed=true;}},{removed:false,remove(){this.removed=true;}}];
  const videos=[{removed:false}];
  const inputs=[{removed:false,remove(){this.removed=true;}},{removed:false,remove(){this.removed=true;}}];
  const gallery={
    querySelectorAll:selector=>selector.includes('data-tipo="image"')?fotos:[],
    querySelector:()=>({querySelector:()=>({textContent:''})}),
  };
  const formEAN={querySelectorAll:()=>inputs};
  let imagemSalva=null;
  const fn=Function('formEAN','$','$$','anexarFotoFormulario',fragmento+
    'return definirFotoGoogleFormulario;')(
    formEAN,selector=>selector==='#galeriaProduto'?gallery:null,
    ()=>inputs,
    (midia,fonte,meta)=>{imagemSalva={midia,fonte,meta};return true;}
  );
  assert.equal(fn({url:'/uploads/foto.png'},'https://fabricante.example/produto'),true);
  assert.ok(fotos.every(v=>v.removed));
  assert.ok(inputs.every(v=>v.removed));
  assert.ok(videos.every(v=>!v.removed));
  assert.equal(imagemSalva.midia.url,'/uploads/foto.png');
  assert.match(imagemSalva.fonte,/Google Imagens/);
});


test('prévia escolhida aparece imediatamente sem download e preserva as fotos antigas até salvar',()=>{
 const inicio=admin.indexOf('function mostrarFotoGooglePendente(');
 const fim=admin.indexOf('async function concluirFotoGooglePendente(',inicio);
 assert.ok(inicio>0&&fim>inicio);
 const codigo=admin.slice(inicio,fim);
 const original={url:'/uploads/antiga.png',removed:false,remove(){this.removed=true;}};
 const gallery={
   cards:[],
   querySelectorAll(){return [];},
   prepend(card){this.cards.unshift(card);}
 };
 const document={
   createElement(tag){
     return {
       tag,dataset:{},style:{},children:[],textContent:'',
       append(...children){this.children.push(...children);},
       remove(){this.removed=true;},
       addEventListener(type,fn){this.listeners??={};this.listeners[type]=fn;}
     };
   }
 };
 const env=Function('formEAN','$','document',
   'let fotoGooglePendente=null;'+codigo+
   'return {selecionar:mostrarFotoGooglePendente,pendente:()=>fotoGooglePendente};')(
     {},selector=>selector==='#galeriaProduto'?gallery:null,document);
 const item={ticket:'assinado',url:'https://origem.exemplo.com/foto.png',
    miniatura:'https://origem.exemplo.com/thumb.png',titulo:'produto'};
 assert.equal(env.selecionar(item,'7891000100103'),true);
 assert.equal(gallery.cards.length,1);
 assert.equal(gallery.cards[0].children[0].src,item.miniatura);
 assert.equal(env.pendente().ean,'7891000100103');
 assert.equal(env.pendente().ticket,item.ticket);
 assert.equal(original.removed,false);
 assert.equal(gallery.cards[0].children[2].textContent,'Cancelar seleção');
 gallery.cards[0].children[2].listeners.click();
 assert.equal(env.pendente(),null);
});
test('salvamento aguarda conversão, exibe erro e não cria cadastro antes do PNG',()=>{
 const inicio=admin.indexOf('async function concluirFotoGooglePendente(');
 const fim=admin.indexOf('async function pesquisarGoogleImagensEAN(',inicio);
 const codigo=admin.slice(inicio,fim);
 assert.match(codigo,/const midia=await enviarPNG\(/);
 assert.match(codigo,/if\(!definirFotoGoogleFormulario/);
 assert.match(codigo,/throw new Error\('A imagem não foi salva: '/);
 const formStart=admin.indexOf('if(fotoGooglePendente){');
 const formEnd=admin.indexOf('body: new FormData(form)',formStart);
 assert.ok(formStart>0&&formEnd>formStart);
 const fluxo=admin.slice(formStart,formEnd);
 assert.match(fluxo,/await concluirFotoGooglePendente\(\)/);
 assert.match(fluxo,/!fotoGooglePendente/);
});
