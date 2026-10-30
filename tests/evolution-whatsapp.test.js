import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numeroWhatsapp, validarEvolutionConfig,enfileirarEvolution,processarFilaEvolution,
  resumoEvolution,possuiFilaEvolution
} from '../src/lib/evolution-whatsapp.js';
function dbFake(){
  const collections=new Map();
  return {collection(name){
    if(!collections.has(name))collections.set(name,new Map());
    const mapa=collections.get(name);
    return {
      get:id=>mapa.get(id)||null,
      all:()=>Array.from(mapa.values()),
      insert:v=>{mapa.set(v.id,v);return v;},
      update:(id,patch)=>{const old=mapa.get(id);if(!old)throw Error('id nao encontrado');
        const v={...old,...patch};mapa.set(id,v);return v;},
      count:()=>mapa.size,
    };
  }};
}
function ativar(db){
  db.collection('settings').insert({id:'evolutionWhatsapp',
    ativo:true,baseUrl:'https://whatsapp.exemplo.com',
    instancia:'farmacia-pague-pouco',numeroRemetente:'5573999998888',
    numeroResponsavel:'5573999888777',
    avisarResponsavel:true,avisarCliente:true});
}
const pedido=(opts={})=>({
  id:'pedido-1',codigo:'1058',statusFinanceiro:'pendente',
  receberWhatsappPedido:true,cliente:{nome:'Maria Silva',telefone:'73988887777'},
  itens:[{nome:'Produto de saúde sensível',quantidade:1}],
  endereco:{logradouro:'Informação privada'},...opts,
});
test('configuracao valida HTTPS e numeros, bloqueia IP local e chave no formulario',()=>{
  assert.equal(numeroWhatsapp('(73) 98888-7777'),'5573988887777');
  assert.equal(numeroWhatsapp('5573988887777'),'5573988887777');
  assert.equal(numeroWhatsapp('123'),'');
  const c={baseUrl:'https://evo.exemplo.com',instancia:'farmacia',
    numeroRemetente:'5573988887777',numeroResponsavel:'5573988886666',
    ativo:true,avisarCliente:true,avisarResponsavel:true};
  assert.equal(validarEvolutionConfig(c).ok,true);
  assert.equal(validarEvolutionConfig({...c,baseUrl:'http://evo.exemplo.com'}).ok,false);
  assert.equal(validarEvolutionConfig({...c,baseUrl:'https://127.0.0.1'}).ok,false);
  assert.equal(validarEvolutionConfig({...c,baseUrl:'https://evo.exemplo.com@localhost'}).ok,false);
  assert.equal(validarEvolutionConfig({...c,instancia:'../farmacia'}).ok,false);
});
test('cliente só recebe se autorizou; equipe só recebe apos aprovacao; sem vazamento clinico',()=>{
  const db=dbFake();ativar(db);
  assert.equal(enfileirarEvolution(db,pedido({receberWhatsappPedido:false}),'cliente_recebido').motivo,'sem_optin');
  assert.equal(enfileirarEvolution(db,pedido(),'responsavel_pago').motivo,'ainda_nao_pago');
  assert.equal(enfileirarEvolution(db,pedido(),'cliente_recebido').enfileirado,true);
  assert.equal(enfileirarEvolution(db,pedido(),'cliente_recebido').duplicado,true);
  assert.equal(enfileirarEvolution(db,pedido({statusFinanceiro:'aprovado'}),'responsavel_pago').enfileirado,true);
  const fila=db.collection('evolutionWhatsappOutbox').all();
  assert.equal(fila.length,2);
  assert.ok(fila.every(x=>!x.texto.includes('Produto de saúde sensível')&&!x.texto.includes('Informação privada')));
  assert.equal(fila.find(x=>x.tipo==='responsavel_pago').numero,'5573999888777');
});
test('despacha uma unica vez e registra envio aprovado em HTTPS /message/sendText/',async()=>{
  const db=dbFake();ativar(db);
  enfileirarEvolution(db,pedido(),'cliente_recebido');
  const chamadas=[];let persistencias=0;
  const enviar=async(url,options)=>{
    chamadas.push({url,options,gravadoAntes:persistencias>0});
    return {ok:true,status:200};
  };
  const r=await processarFilaEvolution(db,{apiKey:'chave-ficticia',enviar,
    persistir:async()=>{persistencias++;}});
  assert.equal(r.enviados,1);
  assert.equal(chamadas[0].gravadoAntes,true);
  assert.match(chamadas[0].url,/^https:\/\/whatsapp\.exemplo\.com\/message\/sendText\/farmacia-pague-pouco$/);
  assert.equal(chamadas[0].options.headers.apikey,'chave-ficticia');
  // Cloudflare Workers rejeita redirect:'error' antes de enviar a requisicao.
  // 'manual' evita seguir redirecionamentos e expor a chave a outro dominio.
  assert.equal(chamadas[0].options.redirect,'manual');
  assert.equal(JSON.parse(chamadas[0].options.body).number,'5573988887777');
  assert.equal(resumoEvolution(db).enviados,1);
  assert.equal(possuiFilaEvolution(db),false);
  await processarFilaEvolution(db,{apiKey:'chave-ficticia',enviar});
  assert.equal(chamadas.length,1);
});
test('erro de rede incerto nao repete mensagem para evitar duplicata',async()=>{
  const db=dbFake();ativar(db);enfileirarEvolution(db,pedido(),'cliente_recebido');
  let calls=0;
  const enviar=async()=>{calls++;throw Error('timeout');};
  await processarFilaEvolution(db,{apiKey:'x',enviar});
  await processarFilaEvolution(db,{apiKey:'x',enviar});
  assert.equal(calls,1);
  assert.equal(resumoEvolution(db).verificar,1);
});
test('sem chave ou desativado nenhum request externo e disparado',async()=>{
  const db=dbFake();ativar(db);
  enfileirarEvolution(db,pedido(),'cliente_recebido');
  const enviar=async()=>{throw Error('nao deve enviar');};
  assert.equal((await processarFilaEvolution(db,{apiKey:'',enviar})).ativo,false);
  assert.equal(resumoEvolution(db).fila,1);
});
