import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=fs.readFileSync(new URL('../public/js/boas-vindas.js',import.meta.url),'utf8');

function navegador({store=new Map(),agora,horas=6,preview=false}={}){
  const eventos={},controladores={};
  const elemento=()=>({
    hidden:false,disabled:false,textContent:'',value:'123456',
    addEventListener(tipo,fn){this.eventos??={};this.eventos[tipo]=fn;},
    focus(){this.focado=true;},
    querySelector(){return null;},
  });
  const botao=elemento(), fechar=elemento(),campoCodigo=elemento();
  const cupom=elemento(),validade=elemento(),feedback=elemento();
  const iniciar=elemento(),confirmar=elemento(),sucesso=elemento();
  const inputs={};
  iniciar.querySelector=sel=>sel==='button[type="submit"]'?botao:inputs[sel]||elemento();
  confirmar.querySelector=sel=>sel==='button[type="submit"]'?botao:
    sel==='[name="codigo"]'?campoCodigo:elemento();
  sucesso.querySelector=sel=>sel==='[data-bv-cupom]'?cupom:
    sel==='[data-bv-validade]'?validade:elemento();
  iniciar.hidden=false;
  confirmar.hidden=true;
  sucesso.hidden=true;
  feedback.hidden=true;
  const modal={
    hidden:true,
    dataset:{intervaloHoras:String(horas)},
    classList:new Set(['ppbv-fundo']),
    addEventListener(tipo,fn){eventos[tipo]=fn;},
    querySelector(sel){
      return ({
        '[data-bv-iniciar]':iniciar,
        '[data-bv-confirmar]':confirmar,
        '[data-bv-concluido]':sucesso,
        '[data-bv-feedback]':feedback,
        '[data-bv-fechar]':fechar
      })[sel]||null;
    },
  };
  const bodyClasses=new Set();
  bodyClasses.add=Set.prototype.add.bind(bodyClasses);
  bodyClasses.remove=Set.prototype.delete.bind(bodyClasses);
  const document={
    getElementById:()=>modal,
    activeElement:{focus(){}},
    body:{classList:bodyClasses},
    addEventListener(tipo,fn){controladores[tipo]=fn;},
  };
  let fnTimer=null;
  const Datas=class extends Date{static now(){return agora;}};
  const sandbox={
    document,
    location:{search:preview?'?visualizarBoasVindas=1':''},
    localStorage:{
      getItem:k=>store.has(k)?store.get(k):null,
      setItem:(k,v)=>store.set(k,String(v)),
      removeItem:k=>store.delete(k),
    },
    setTimeout:(fn)=>{fnTimer=fn;},
    window:{PP_CONFIG:{csrf:'fake-csrf'}},
    Date:Datas,
    URLSearchParams,
    FormData:class {get(name){return {nome:'Maria Silva',email:'maria@example.com',telefone:'(73) 99999-1234'}[name]||null;} has(){return true;}},
    fetch:async url=>({ok:true,json:async()=>url.includes('/iniciar')?
      {ok:true,desafio:'desafio-1'}:
      {ok:true,codigo:'BEMVTESTE',expiraEm:new Date(agora+24*3_600_000).toISOString(),validadeHoras:24}}),
  };
  vm.runInNewContext(script,sandbox,{timeout:2000,filename:'boas-vindas.js'});
  return {
    modal,store,fechar,iniciar,confirmar,sucesso,botao,cupom,validade,
    iniciarTimer(){fnTimer?.();},
    async confirmarCadastro(){
      await iniciar.eventos.submit({preventDefault(){}});
      await confirmar.eventos.submit({preventDefault(){}});
    }
  };
}

test('fechar sem cadastro reapresenta somente após o intervalo configurado',()=>{
  const store=new Map(),t=1_900_000_000_000;
  const primeira=navegador({store,agora:t,horas:6});
  primeira.iniciarTimer();
  assert.equal(primeira.modal.hidden,false);
  primeira.fechar.eventos.click();
  assert.equal(primeira.modal.hidden,true);
  assert.equal(Number(store.get('pp_bv_proxima_exibicao_v2')),t+6*3_600_000);
  const cedo=navegador({store,agora:t+3*3_600_000,horas:6});
  cedo.iniciarTimer();
  assert.equal(cedo.modal.hidden,true);
  const hora=navegador({store,agora:t+6*3_600_000,horas:6});
  hora.iniciarTimer();
  assert.equal(hora.modal.hidden,false);
});

test('intervalo editável e prévia não alteram a configuração do cliente',()=>{
  const store=new Map(),t=1_900_000_000_000;
  const modal=navegador({store,agora:t,horas:1});
  modal.iniciarTimer();
  modal.fechar.eventos.click();
  assert.equal(Number(store.get('pp_bv_proxima_exibicao_v2')),t+3_600_000);
  const previa=navegador({store,agora:t+1000,horas:1,preview:true});
  previa.iniciarTimer();
  assert.equal(previa.modal.hidden,false);
  previa.fechar.eventos.click();
  assert.equal(Number(store.get('pp_bv_proxima_exibicao_v2')),t+3_600_000);
});

test('cadastro confirmado impede retorno permanente no navegador, inclusive após meses',async()=>{
  const store=new Map(),t=1_900_000_000_000;
  const primeira=navegador({store,agora:t});
  primeira.iniciarTimer();
  await primeira.confirmarCadastro();
  assert.equal(primeira.sucesso.hidden,false);
  assert.equal(primeira.cupom.textContent,'BEMVTESTE');
  assert.equal(store.get('pp_bv_cadastro_confirmado_v2'),'1');
  assert.equal(store.has('pp_bv_proxima_exibicao_v2'),false);
  const depois=navegador({store,agora:t+400*86400000});
  depois.iniciarTimer();
  assert.equal(depois.modal.hidden,true);
});

test('chave v2 não mantém antiga pausa de sete dias de um visitante não cadastrado',()=>{
  const t=1_900_000_000_000;
  const store=new Map([['pp_bv_exibir_apos',String(t+7*86400000)]]);
  const modal=navegador({store,agora:t});
  modal.iniciarTimer();
  assert.equal(modal.modal.hidden,false);
});
