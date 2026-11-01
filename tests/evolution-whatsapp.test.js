import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Collection} from '../src/lib/store.js';
import {atualizarStatusFinanceiro} from '../src/lib/orders.js';
import {
  numeroWhatsapp, validarEvolutionConfig,enfileirarEvolution,processarFilaEvolution,
  resumoEvolution,possuiFilaEvolution,autorizouWhatsappPedidos,autorizouWhatsappProdutos,atualizarAutorizacaoItensPedidosPendentes,decidirAvisosWhatsappPedido
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
  assert.equal(enfileirarEvolution(db,pedido(),'cliente_pago').motivo,'ainda_nao_pago');
  assert.equal(enfileirarEvolution(db,pedido({statusFinanceiro:'aprovado',receberWhatsappPedido:false}),'cliente_pago').motivo,'sem_optin');
  assert.equal(enfileirarEvolution(db,pedido(),'cliente_recebido').enfileirado,true);
  assert.equal(enfileirarEvolution(db,pedido(),'cliente_recebido').duplicado,true);
  assert.equal(enfileirarEvolution(db,pedido({statusFinanceiro:'aprovado'}),'responsavel_pago').enfileirado,true);
  assert.equal(enfileirarEvolution(db,pedido({statusFinanceiro:'aprovado'}),'cliente_pago').enfileirado,true);
  assert.equal(enfileirarEvolution(db,pedido({statusFinanceiro:'aprovado'}),'cliente_pago').duplicado,true);
  const fila=db.collection('evolutionWhatsappOutbox').all();
  assert.equal(fila.length,3);
  const pago=fila.find(x=>x.tipo==='cliente_pago');
  assert.equal(pago.numero,'5573988887777');
  assert.match(pago.texto,/pagamento.*confirmado/i);
  assert.match(pago.texto,/1058/);
  assert.ok(fila.filter(x=>x.tipo!=='responsavel_pago').every(x=>!x.texto.includes('Produto de saúde sensível')));
  assert.ok(fila.every(x=>!x.texto.includes('Informação privada')));
  assert.match(fila.find(x=>x.tipo==='responsavel_pago').texto,/Produto de saúde sensível/);
  assert.equal(fila.find(x=>x.tipo==='responsavel_pago').numero,'5573999888777');
});
test('responsável recebe itens para separação, cliente sem nova autorização recebe só código',()=>{
  const db=dbFake();ativar(db);
  const legado=pedido({enviarItensWhatsappPedido:false,itens:[{nome:'Shampoo 250ml',quantidade:2}]});
  assert.equal(enfileirarEvolution(db,legado,'cliente_recebido').enfileirado,true);
  assert.equal(enfileirarEvolution(db,{...legado,statusFinanceiro:'aprovado'},'responsavel_pago').enfileirado,true);
  const avisos=db.collection('evolutionWhatsappOutbox').all();
  assert.doesNotMatch(avisos.find(x=>x.tipo==='cliente_recebido').texto,/Shampoo 250ml/);
  assert.match(avisos.find(x=>x.tipo==='responsavel_pago').texto,/#1058 \(2x Shampoo 250ml\)/);
});
test('nova autorização explícita atualiza apenas pedidos pendentes do mesmo telefone',()=>{
  const colecoes=new Map();
  const db={collection(name){
    if(!colecoes.has(name))colecoes.set(name,new Collection({_commit(){}},name));
    return colecoes.get(name);
  }};
  ativar(db);
  const cliente={id:'u1',telefone:'73988887777',
    consentimentoWhatsappPedidos:{ativo:true,numero:'5573988887777',versao:2}};
  const pendente=pedido({clienteId:'u1',enviarItensWhatsappPedido:false});
  db.collection('orders').insert(pendente);
  db.collection('orders').insert({...pedido(),id:'diferente',clienteId:'u2',enviarItensWhatsappPedido:false});
  db.collection('orders').insert({...pedido(),id:'outro-numero',clienteId:'u1',
    cliente:{nome:'Maria',telefone:'71999999999'},enviarItensWhatsappPedido:false});
  db.collection('orders').insert({...pedido(),id:'aprovado',clienteId:'u1',
    statusFinanceiro:'aprovado',enviarItensWhatsappPedido:false});
  assert.equal(atualizarAutorizacaoItensPedidosPendentes(db,cliente),1);
  assert.equal(db.collection('orders').get(pendente.id).enviarItensWhatsappPedido,true);
  for(const id of ['diferente','outro-numero','aprovado'])
    assert.equal(db.collection('orders').get(id).enviarItensWhatsappPedido,false);
  assert.equal(enfileirarEvolution(db,db.collection('orders').get(pendente.id),'cliente_recebido').enfileirado,true);
  assert.match(db.collection('evolutionWhatsappOutbox').all()[0].texto,/Produto de saúde sensível/);
  const recusado={...cliente,consentimentoWhatsappPedidos:{ativo:true,numero:'5573988887777',versao:1}};
  assert.equal(atualizarAutorizacaoItensPedidosPendentes(db,recusado),0);
});
test('nomes e quantidades aparecem entre parenteses nas tres mensagens quando autorizados',()=>{
  const db=dbFake();ativar(db);
  const p=pedido({enviarItensWhatsappPedido:true,itens:[
    {nome:'Dipirona 500mg',quantidade:2},
    {nome:'Shampoo infantil',quantidade:1},
  ]});
  for(const tipo of ['cliente_recebido','cliente_pago','responsavel_pago']){
    const atual=tipo==='cliente_recebido'?p:{...p,statusFinanceiro:'aprovado'};
    assert.equal(enfileirarEvolution(db,atual,tipo).enfileirado,true);
  }
  const avisos=db.collection('evolutionWhatsappOutbox').all();
  for(const aviso of avisos){
    assert.match(aviso.texto,/#1058 \(2x Dipirona 500mg, Shampoo infantil\)/);
    assert.doesNotMatch(aviso.texto,/Informação privada/);
  }
  assert.match(avisos.find(x=>x.tipo==='cliente_recebido').texto,
    /Quando o pagamento for confirmado pelo site \(até 10 minutos\), seu pedido será enviado para separação!/);
});
test('nomes sao filtrados contra formatacao, linhas extras e pedidos antigos',()=>{
  const db=dbFake();ativar(db);
  const p=pedido({enviarItensWhatsappPedido:true,itens:[
    {nome:'Produto\n*inedito* <teste>',quantidade:1},
    {nome:'',quantidade:1},
  ]});
  assert.equal(enfileirarEvolution(db,p,'cliente_recebido').enfileirado,true);
  const texto=db.collection('evolutionWhatsappOutbox').all()[0].texto;
  assert.match(texto,/#1058 \(Produto inedito teste\)/);
  assert.doesNotMatch(texto,/\n\*inedito/);
  const dbLegado=dbFake();ativar(dbLegado);
  enfileirarEvolution(dbLegado,pedido(),'cliente_recebido');
  assert.doesNotMatch(dbLegado.collection('evolutionWhatsappOutbox').all()[0].texto,
    /Produto de saúde sensível/);
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

function pedidoRealWhatsapp({optin=true,provedor='mercadopago',avisarCliente=true}={}){
  const colecoes=new Map();
  const db={collection(name){
    if(!colecoes.has(name)) colecoes.set(name,new Collection({_commit(){}},name));
    return colecoes.get(name);
  }};
  db.collection('settings').insert({
    id:'evolutionWhatsapp',ativo:true,baseUrl:'https://whatsapp.exemplo.com',
    instancia:'farmacia-pague-pouco',numeroRemetente:'5573999998888',
    numeroResponsavel:'5573999888777',avisarResponsavel:true,avisarCliente,
  });
  db.collection('products').insert({
    id:'produto',estoque:{quantidade:5,reservado:1},vendas:0,
  });
  db.collection('orders').insert({
    ...pedido({statusFinanceiro:'pendente',receberWhatsappPedido:optin}),
    statusOperacional:'aguardando_pagamento',pagamentoId:'pagamento',
    itens:[{produtoId:'produto',nome:'Medicamento confidencial',quantidade:1}],
    historico:[],totalCentavos:1000,
  });
  db.collection('payments').insert({
    id:'pagamento',pedidoId:'pedido-1',provedor,metodo:'pix',
    status:'approved',valorCentavos:1000,
  });
  db.collection('stockMovements').insert({
    id:'reserva',pedidoId:'pedido-1',produtoId:'produto',tipo:'reserva',quantidade:1,
  });
  return db;
}

test('aprovacao real do Mercado Pago envia eventos separados ao cliente e responsavel, uma vez',()=>{
  const db=pedidoRealWhatsapp();
  const antes=db.collection('evolutionWhatsappOutbox').all();
  assert.equal(antes.length,0);
  const confirmado=atualizarStatusFinanceiro(db,'pedido-1','aprovado',{por:'conciliacao'});
  assert.equal(confirmado.ok,true);
  assert.equal(confirmado.pedido.statusFinanceiro,'aprovado');
  const outbox=db.collection('evolutionWhatsappOutbox').all();
  assert.deepEqual(outbox.map(x=>x.tipo).sort(),['cliente_pago','responsavel_pago']);
  assert.equal(outbox.find(x=>x.tipo==='cliente_pago').numero,'5573988887777');
  assert.equal(outbox.find(x=>x.tipo==='responsavel_pago').numero,'5573999888777');
  assert.ok(outbox.every(x=>x.status==='fila'));
  assert.ok(outbox.filter(x=>x.tipo==='cliente_pago').every(x=>!x.texto.includes('Medicamento confidencial'))); // legado sem autorização v2 para cliente
  assert.match(outbox.find(x=>x.tipo==='responsavel_pago').texto,/Medicamento confidencial/);
  assert.equal(atualizarStatusFinanceiro(db,'pedido-1','aprovado').semAlteracao,true);
  assert.equal(db.collection('evolutionWhatsappOutbox').count(),2);
  assert.equal(db.collection('products').get('produto').estoque.quantidade,4);
});

test('aprovacao do Mercado Pago envia itens de pedido autorizado v2 ao cliente e responsavel',()=>{
  const db=pedidoRealWhatsapp();
  db.collection('orders').update('pedido-1',{enviarItensWhatsappPedido:true});
  assert.equal(atualizarStatusFinanceiro(db,'pedido-1','aprovado').ok,true);
  const outbox=db.collection('evolutionWhatsappOutbox').all();
  assert.equal(outbox.length,2);
  assert.ok(outbox.every(x=>x.texto.includes('#1058 (Medicamento confidencial)')));
});
test('sem opt-in ou canal de cliente, nao envia pagamento ao cliente; provedor interno nao gera WhatsApp',()=>{
  for(const opcoes of [
    {optin:false,provedor:'mercadopago'},
    {optin:true,provedor:'mercadopago',avisarCliente:false},
    {optin:true,provedor:'internal'},
  ]){
    const db=pedidoRealWhatsapp(opcoes);
    assert.equal(atualizarStatusFinanceiro(db,'pedido-1','aprovado').ok,true);
    const tipos=db.collection('evolutionWhatsappOutbox').all().map(x=>x.tipo);
    assert.equal(tipos.includes('cliente_pago'),false);
    assert.equal(tipos.includes('responsavel_pago'),opcoes.provedor==='mercadopago');
  }
});

test('nao confirma cliente pago sem status aprovado ou numero valido',()=>{
  const db=pedidoRealWhatsapp();
  assert.equal(enfileirarEvolution(db,db.collection('orders').get('pedido-1'),'cliente_pago').motivo,'ainda_nao_pago');
  db.collection('orders').update('pedido-1',{statusFinanceiro:'aprovado',cliente:{nome:'Maria',telefone:'invalido'}});
  assert.equal(enfileirarEvolution(db,db.collection('orders').get('pedido-1'),'cliente_pago').motivo,'sem_numero');
  assert.equal(db.collection('evolutionWhatsappOutbox').count(),0);
});

test('autorizacao anterior nao permite divulgar medicamentos; v2 permite',()=>{
  const cliente={telefone:'73988887777',
    consentimentoWhatsappPedidos:{ativo:true,numero:'5573988887777',versao:1}};
  assert.equal(autorizouWhatsappPedidos(cliente),true);
  assert.equal(autorizouWhatsappProdutos(cliente),false);
  assert.equal(decidirAvisosWhatsappPedido(cliente,{ativo:true,avisarCliente:true},'autorizar_detalhes').autorizouAgora,true);
  cliente.consentimentoWhatsappPedidos.versao=2;
  assert.equal(autorizouWhatsappProdutos(cliente),true);
  cliente.consentimentoWhatsappPedidos.ativo=false;
  assert.equal(autorizouWhatsappProdutos(cliente),false);
});
test('aceite WhatsApp uma unica vez vale em novos pedidos sem nova caixa',()=>{
  const cfg={ativo:true,avisarCliente:true};
  const cliente={id:'c1',telefone:'(73) 98888-7777'};
  assert.equal(autorizouWhatsappPedidos(cliente),false);
  assert.equal(decidirAvisosWhatsappPedido(cliente,cfg,'').avisarCliente,false);
  const primeiro=decidirAvisosWhatsappPedido(cliente,cfg,'autorizar');
  assert.equal(primeiro.autorizouAgora,true);
  assert.equal(primeiro.avisarCliente,true);
  cliente.consentimentoWhatsappPedidos={ativo:true,numero:'5573988887777',aceitoEm:'2026-10-30T00:00:00Z'};
  assert.equal(autorizouWhatsappPedidos(cliente),true);
  assert.equal(decidirAvisosWhatsappPedido(cliente,cfg).avisarCliente,true);
  assert.equal(decidirAvisosWhatsappPedido(cliente,cfg,'sem').avisarCliente,false);
  assert.equal(decidirAvisosWhatsappPedido(cliente,{ativo:false,avisarCliente:true}).avisarCliente,false);
  assert.equal(decidirAvisosWhatsappPedido(cliente,{ativo:true,avisarCliente:false}).avisarCliente,false);
});

test('telefone diferente, revogacao e opt-in de marketing nao autorizam mensagens',()=>{
  const cfg={ativo:true,avisarCliente:true};
  const cliente={telefone:'73988887777',marketing:true};
  assert.equal(autorizouWhatsappPedidos(cliente),false);
  cliente.consentimentoWhatsappPedidos={ativo:true,numero:'5573988887777'};
  cliente.telefone='73999996666';
  assert.equal(autorizouWhatsappPedidos(cliente),false);
  assert.equal(decidirAvisosWhatsappPedido(cliente,cfg).avisarCliente,false);
  cliente.telefone='73988887777';
  cliente.consentimentoWhatsappPedidos.ativo=false;
  assert.equal(decidirAvisosWhatsappPedido(cliente,cfg).avisarCliente,false);
});

test('checkout usa escolha visivel sem checkbox, e perfil permite revogar',()=>{
  const checkout=readFileSync(new URL('../src/views/checkout.js',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
  const account=readFileSync(new URL('../src/routes/account.js',import.meta.url),'utf8');
  const view=readFileSync(new URL('../src/views/account.js',import.meta.url),'utf8');
  assert.doesNotMatch(checkout,/type="checkbox" name="aceitaWhatsAppPedido"/);
  assert.match(checkout,/Finalizar e receber avisos no WhatsApp/);
  assert.match(checkout,/Finalizar sem avisos no WhatsApp/);
  assert.match(checkout,/autorizouWhatsappPedidos\(ctx\.usuario\)/);
  assert.match(checkout,/name="acaoWhatsappPedido" value="autorizar"/);
  assert.match(checkout,/name="acaoWhatsappPedido" value="autorizar_detalhes"/);
  assert.match(js,/event\.submitter\?\.name === 'acaoWhatsappPedido'/);
  assert.match(account,/post\('\/conta\/dados\/whatsapp-pedidos'/);
  assert.match(account,/revogou_whatsapp_pedidos/);
  assert.match(view,/Desativar avisos no WhatsApp/);
});
