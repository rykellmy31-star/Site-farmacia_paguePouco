import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { reconciliarPixAoConsultarPedido } from '../src/lib/payments/reconciliation.js';
import { config } from '../src/config.js';
import { telaConfirmacao } from '../src/views/checkout.js';

const TOKEN = 'TOKEN_FALSO_APENAS_TESTES_AUTOMATICOS';
const ID_MP = '876543210';
function fixture({ provider='mercadopago', paymentStatus='pending', total=190 } = {}) {
  const colecoes = new Map();
  const db = { collection(name) {
    if (!colecoes.has(name)) colecoes.set(name, new Collection({ _commit() {} }, name));
    return colecoes.get(name);
  }};
  db.collection('products').insert({ id:'produto-1', nome:'Produto teste', estoque:{ quantidade:5, reservado:1 }, vendas:0 });
  db.collection('orders').insert({
    id:'pedido-1', codigo:'PP2026000005', clienteId:'cliente-1',
    metodoPagamento:'pix', statusFinanceiro:'pendente', statusOperacional:'aguardando_pagamento',
    pagamentoId:'mp_'+ID_MP, totalCentavos:total, subtotalCentavos:total, freteCentavos:0, descontoCentavos:0,
    cliente:{email:'teste@example.invalid'}, itens:[{produtoId:'produto-1',nome:'Produto teste',quantidade:1,subtotalCentavos:total}],
    historico:[],
  });
  db.collection('stockMovements').insert({ produtoId:'produto-1',pedidoId:'pedido-1',tipo:'reserva',quantidade:1 });
  db.collection('payments').insert({
    id:'mp_'+ID_MP, transacaoId:ID_MP, pedidoId:'pedido-1',metodo:'pix',provedor:provider,
    valorCentavos:total,status:paymentStatus,eventos:[],pixCodigo:'PIX-DE-TESTE',
  });
  return db;
}
function mockApi(status='approved', overrides={}) {
  const payload = { id:Number(ID_MP), status, external_reference:'PP2026000005',
    transaction_amount:1.90,currency_id:'BRL',metadata:{pedido_id:'pedido-1'}, ...overrides };
  return async (url,options={}) => {
    assert.equal(url,'https://api.mercadopago.com/v1/payments/'+ID_MP);
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
    return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
  };
}
async function isolated(cb) {
  const oldFetch=globalThis.fetch, oldToken=config.payments.mp.accessToken;
  try{
    config.payments.mp.accessToken=TOKEN;
    return await cb();
  }finally{
    globalThis.fetch=oldFetch;config.payments.mp.accessToken=oldToken;
  }
}

test('pedido Pix de produção aprovado pelo provedor entra em separação sem nova cobrança',async()=>{
  await isolated(async()=>{
    const db=fixture();let calls=0;
    globalThis.fetch=async (...args)=>{calls++;return mockApi()(...args)};
    const r=await reconciliarPixAoConsultarPedido(db,'pedido-1',{agora:Date.now()});
    assert.equal(r.consultado,true);
    assert.equal(r.atualizados,1);
    assert.equal(db.collection('orders').get('pedido-1').statusFinanceiro,'aprovado');
    assert.equal(db.collection('orders').get('pedido-1').statusOperacional,'em_separacao');
    assert.equal(db.collection('products').get('produto-1').estoque.quantidade,4);
    assert.equal(db.collection('products').get('produto-1').estoque.reservado,0);
    assert.equal(db.collection('stockMovements').find(x=>x.tipo==='saida').length,1);
    const novamente=await reconciliarPixAoConsultarPedido(db,'pedido-1');
    assert.equal(novamente.consultado,false);
    assert.equal(calls,1);
    assert.equal(db.collection('products').get('produto-1').estoque.quantidade,4);
  });
});

test('Pix pendente consulta no máximo uma vez por minuto entre páginas',async()=>{
  await isolated(async()=>{
    const db=fixture();let calls=0;const agora=Date.now();
    globalThis.fetch=async (...args)=>{calls++;return mockApi('pending')(...args)};
    await reconciliarPixAoConsultarPedido(db,'pedido-1',{agora});
    assert.equal(calls,1);
    let r=await reconciliarPixAoConsultarPedido(db,'pedido-1',{agora:agora+10_000});
    assert.equal(r.motivo,'intervalo_minimo');
    r=await reconciliarPixAoConsultarPedido(db,'pedido-1',{agora:agora+60_100});
    assert.equal(r.consultado,true);
    assert.equal(calls,2);
    assert.equal(db.collection('orders').get('pedido-1').statusFinanceiro,'pendente');
  });
});

test('consulta autenticada de outro pedido/valor nunca aprova venda nem estoque',async()=>{
  await isolated(async()=>{
    for(const overrides of [{external_reference:'PEDIDO_DIFERENTE'},{transaction_amount:2.9},{currency_id:'USD'},{metadata:{pedido_id:'fraude'}}]){
      const db=fixture();
      globalThis.fetch=mockApi('approved',overrides);
      const r=await reconciliarPixAoConsultarPedido(db,'pedido-1');
      assert.equal(r.atualizados,0);
      assert.equal(r.erros,1);
      assert.equal(db.collection('orders').get('pedido-1').statusFinanceiro,'pendente');
      assert.equal(db.collection('products').get('produto-1').estoque.quantidade,5);
    }
  });
});

test('falha na API não considera dinheiro pago nem libera reserva',async()=>{
  await isolated(async()=>{
    const db=fixture();
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'unauthorized'}),{status:401});
    const r=await reconciliarPixAoConsultarPedido(db,'pedido-1');
    assert.equal(r.erros,1);
    assert.equal(db.collection('orders').get('pedido-1').statusFinanceiro,'pendente');
    assert.equal(db.collection('products').get('produto-1').estoque.reservado,1);
  });
});

test('rotina de consulta do cliente não toca em cobranças simuladas ou desconhecidas',async()=>{
  await isolated(async()=>{
    const db=fixture({provider:'internal'});
    globalThis.fetch=async()=>{throw new Error('não é permitido contatar provedor')};
    assert.equal((await reconciliarPixAoConsultarPedido(db,'pedido-1')).consultado,false);
    assert.equal((await reconciliarPixAoConsultarPedido(db,'pedido-inexistente')).consultado,false);
  });
});

test('pedido registrado usa check pequeno, link de consulta Pix e refresh somente em Pix real pendente',()=>{
  const db=fixture(), settings={tema:{},seo:{},empresa:{nomeFantasia:'Farmácia Pague Pouco'},whatsapp:{},cookies:{}};
  const ctx={db,settings,req:{pathname:'/checkout/confirmacao/PP2026000005'},
    arvore:[],cartCount:0,csrf:'teste'};
  const pendente=telaConfirmacao(ctx,{pedido:db.collection('orders').get('pedido-1'),
    pagamento:db.collection('payments').get('mp_'+ID_MP)});
  assert.match(pendente,/class="confirmacao-titulo"/);
  assert.match(pendente,/class="confirmacao-icone"/);
  assert.match(pendente,/data-pix-status-auto="true"/);
  assert.match(pendente,/Atualizar situação do Pix/);
  assert.doesNotMatch(pendente,/<h1><svg/);
  db.collection('orders').update('pedido-1',{statusFinanceiro:'aprovado',statusOperacional:'em_separacao'});
  const aprovado=telaConfirmacao(ctx,{pedido:db.collection('orders').get('pedido-1'),
    pagamento:db.collection('payments').get('mp_'+ID_MP)});
  assert.match(aprovado,/Pagamento confirmado!/);
  assert.doesNotMatch(aprovado,/data-pix-status-auto="true"/);
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.confirmacao-icone svg\s*\{[^}]*width: 19px;/);
  const js=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
  assert.match(js,/iniciarAtualizacaoPix/);
  assert.match(js,/window.location.reload\(\)/);
});
