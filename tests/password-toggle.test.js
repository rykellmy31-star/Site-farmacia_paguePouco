import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const js=readFileSync(new URL('../public/js/password-toggle.js',import.meta.url),'utf8');
const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../src/views/admin/layout.js',import.meta.url),'utf8');
const site=readFileSync(new URL('../src/views/layout.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

function element(tag) {
  const events={},attrs={},children=[];
  return {tag,events,attrs,children,parentNode:null,dataset:{},id:'',
    type:tag==='input'?'password':'',
    addEventListener(name,fn){events[name]=fn;},
    setAttribute(k,v){attrs[k]=v;}, getAttribute(k){return attrs[k];},
    insertBefore(node,ref){children.splice(children.indexOf(ref),0,node);node.parentNode=this;},
    appendChild(node){
      const p=node.parentNode;
      if(p){const i=p.children.indexOf(node);if(i>=0)p.children.splice(i,1);}
      children.push(node);node.parentNode=this;
    }
  };
}
function navegador(){
  const form=element('form'),parent=element('div'),input=element('input'),events={};
  input.id='senha';input.name='senha';input.value='SenhaTeste123';
  input.autocomplete='current-password';input.form=form;parent.appendChild(input);
  const doc={readyState:'complete',hidden:false,events,
    querySelectorAll(q){return q==='input[type="password"]'?[input]:[];},
    createElement:element,addEventListener(k,fn){events[k]=fn;}};
  const globals={document:doc};
  runInNewContext(js,globals,{timeout:2000});
  return {form,parent,input,doc,globals,wrap:parent.children[0],button:parent.children[0].children[1]};
}
test('olho começa oculto e alterna a visibilidade sem alterar a senha nem enviar o formulário',()=>{
  const {input,wrap,button}=navegador();
  assert.equal(wrap.className,'campo-senha-visivel');
  assert.equal(button.type,'button');
  assert.equal(input.type,'password');
  assert.equal(button.getAttribute('aria-label'),'Mostrar senha');
  button.events.click();
  assert.equal(input.type,'text');
  assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.equal(button.getAttribute('aria-label'),'Ocultar senha');
  button.events.click();
  assert.equal(input.type,'password');
  assert.equal(input.value,'SenhaTeste123');
  assert.equal(input.name,'senha');
  assert.equal(input.autocomplete,'current-password');
  assert.equal(button.getAttribute('aria-controls'),'senha');
});
test('senha visível torna a ocultar ao enviar ou sair da aba',()=>{
  const {input,form,button,doc,wrap,globals}=navegador();
  button.events.click();
  form.events.submit();
  assert.equal(input.type,'password');
  button.events.click();
  doc.hidden=true;doc.events.visibilitychange();
  assert.equal(input.type,'password');
  runInNewContext(js,globals,{timeout:2000});
  assert.equal(wrap.children.length,2,'não duplica o olho');
});
test('recurso está no login, na troca de senha e no painel, com toque acessível',()=>{
  assert.equal((routes.match(/password-toggle\.js\?v=20261107/g)||[]).length,2);
  assert.match(admin,/password-toggle\.js\?v=20261107/);
  assert.match(site,/password-toggle\.js\?v=20261107/);
  assert.match(css,/\.campo-senha-visivel > \.alternar-visibilidade-senha/);
  assert.match(css,/width:44px; height:44px/);
  assert.match(css,/font-size:max\(16px,1rem\)/);
  assert.doesNotMatch(js,/fetch\(|localStorage|sessionStorage/);
});
