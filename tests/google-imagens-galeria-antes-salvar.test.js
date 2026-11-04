import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const admin=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');

test('botão Google usa querySelectorAll e nunca tenta .forEach em um único elemento',()=>{
  const inicio=admin.indexOf("salvar.addEventListener('click',async()=>{");
  const fim=admin.indexOf('card.appendChild(salvar)',inicio);
  assert.ok(inicio>0&&fim>inicio);
  const action=admin.slice(inicio,fim);
  assert.match(action,/const botoes=\$\$\('button',lista\)/);
  assert.doesNotMatch(action,/const botoes=\$\('button',lista\)/);
  assert.match(action,/finally\s*\{[\s\S]*botoes\.forEach\(b=>b\.disabled=false\)/);
  assert.match(action,/if\(salvandoFotoGoogle\)return;/);
  assert.match(action,/salvandoFotoGoogle=false;/);
});
test('clique adiciona na galeria do produto e NÃO grava cadastro sem Salvar alterações',()=>{
  const inicio=admin.indexOf("salvar.addEventListener('click',async()=>{");
  const fim=admin.indexOf('card.appendChild(salvar)',inicio);
  const action=admin.slice(inicio,fim);
  assert.match(action,/enviarPNG\(ean,0,contextoBuscaImagemEAN\(\),proxy\)/);
  assert.match(action,/definirFotoGoogleFormulario\(midia,item\.pagina\|\|item\.url\)/);
  assert.match(action,/galeriaProduto/);
  assert.match(action,/Salvar alterações/);
  assert.doesNotMatch(action,/vincular-imagem-google/);
  assert.doesNotMatch(action,/post\('\/admin\/api\/produtos\/[^']+'/,);
  assert.match(admin,/body: new FormData\(form\)/);
});
test('troca somente fotos (preserva vídeos), usa inputs do formulário, e não trava por DOM singleton',()=>{
  const inicio=admin.indexOf('function definirFotoGoogleFormulario(');
  const fim=admin.indexOf('async function pesquisarGoogleImagensEAN(',inicio);
  assert.ok(inicio>0&&fim>inicio);
  const fragmento=admin.slice(inicio,fim);
  assert.match(fragmento,/querySelectorAll\('\.item-midia\[data-tipo="image"\]'\)/);
  assert.doesNotMatch(fragmento,/querySelectorAll\('\.item-midia\[data-tipo="video"\]'\)/);
  assert.match(fragmento,/\$\$\('\[name="imagens\[\]"\],\[name="imagemLegenda\[\]"\]',formEAN\)\.forEach/);
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
  const formEAN={};
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
