import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { autorPublicoDoEventoPedido } from '../src/lib/order-history-public.js';
import { telaPedidoDetalhe } from '../src/views/account.js';
import { telaPedido } from '../src/views/admin/vendas.js';

const equipe = 'Funcionário Exemplo da Loja';
const administrador = 'Administrador Nome Reservado';
const clienteNome = 'Comprador Nome Reservado';
const data = '2026-10-21T16:59:00.000Z';
const historico = [
  { tipo:'operacional',status:'aguardando_pagamento',por:clienteNome,em:data,obs:'Pedido registrado.' },
  { tipo:'financeiro',status:'pendente',por:'sistema',em:data,obs:'Cobrança criada no provedor de pagamento.' },
  { tipo:'financeiro',status:'aprovado',por:'conciliacao',em:data,obs:'Pagamento confirmado.' },
  { tipo:'operacional',status:'preparando_envio',por:equipe,em:data,obs:'Separação iniciada.' },
  { tipo:'operacional',status:'enviado',por:equipe,em:data,obs:'Enviado.' },
  { tipo:'operacional',status:'saiu_para_entrega',por:administrador,em:data,obs:'A caminho.' },
  { tipo:'financeiro',status:'estornado',por:administrador,em:data,obs:'Solicitação de estorno pelo painel.' },
];

function fixture() {
  const tables=new Map();
  const db={collection(name){
    if(!tables.has(name))tables.set(name,new Collection({_commit(){}},name));
    return tables.get(name);
  }};
  const pedido={
    id:'pedido-1',codigo:'PP2026000005',clienteId:'cliente-1',
    criadoEm:data, statusFinanceiro:'estornado',statusOperacional:'saiu_para_entrega',
    metodoPagamento:'pix',subtotalCentavos:190,freteCentavos:0,totalCentavos:190,
    itens:[],historico,cliente:{nome:clienteNome},endereco:{nome:clienteNome,cep:'45970000'},
  };
  db.collection('orders').insert(pedido);
  const settings={empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},whatsapp:{},cookies:{}};
  const common={db,settings,req:{pathname:'/conta/pedidos/PP2026000005'},arvore:[],csrf:'teste'};
  return {pedido,db,ctx:common};
}

test('histórico visível ao cliente jamais utiliza campo por, nem nomes arbitrários',()=>{
  const cases=[
    ...historico,
    {tipo:'operacional',status:'cancelado',por:'colaborador@empresa.com'},
    {tipo:'operacional',status:'preparando_envio',por:'<script>segredo</script>'},
    {tipo:'operacional',status:'enviado',por:'12345-IDENTIFICADOR-INTERNO'},
    {tipo:'operacional',status:'enviado',por:null},
  ];
  for(const evt of cases) {
    const label=autorPublicoDoEventoPedido(evt);
    assert(['Sistema','Farmácia Pague Pouco'].includes(label));
    assert.notEqual(label,evt.por);
  }
  assert.equal(autorPublicoDoEventoPedido(historico[0]),'Sistema');
  assert.equal(autorPublicoDoEventoPedido(historico[2]),'Sistema');
  assert.equal(autorPublicoDoEventoPedido(historico[3]),'Farmácia Pague Pouco');
  assert.equal(autorPublicoDoEventoPedido(historico[5]),'Farmácia Pague Pouco');
  assert.equal(autorPublicoDoEventoPedido(historico[6]),'Sistema');
});

test('pedido existente exibe farmácia e sistema no histórico público sem nomes da equipe',()=>{
  const {pedido,ctx}=fixture();
  const html=telaPedidoDetalhe(ctx,{pedido});
  const match=html.match(/<ul class="linha-tempo">([\s\S]*?)<\/ul>/);
  assert(match,'timeline pública não encontrada');
  const linhaDoTempo=match[1];
  assert.match(linhaDoTempo,/saiu para entrega/);
  assert.match(linhaDoTempo,/preparando envio/);
  assert.match(linhaDoTempo,/Pagamento confirmado/);
  assert.match(linhaDoTempo,/Farmácia Pague Pouco/);
  assert.match(linhaDoTempo,/Sistema/);
  assert.doesNotMatch(linhaDoTempo,new RegExp(equipe));
  assert.doesNotMatch(linhaDoTempo,new RegExp(administrador));
  assert.doesNotMatch(linhaDoTempo,new RegExp(clienteNome));
  assert.equal(pedido.historico[3].por,equipe,'não pode reescrever registros originais');
});

test('painel interno preserva quem operou o pedido para auditoria',()=>{
  const {pedido,db,ctx}=fixture();
  const html=telaPedido({
    ...ctx,adminUser:{id:'admin-1',role:'super_admin',nome:administrador},
    permissoes:{podeEditarPedidos:true,podeEstornar:true,podeSimularPagamento:false},
  },{pedido,pagamento:null,eventos:[]});
  const match=html.match(/<ul class="linha-tempo">([\s\S]*?)<\/ul>/);
  assert(match,'timeline administrativa não encontrada');
  assert.match(match[1],new RegExp(equipe));
  assert.match(match[1],new RegExp(administrador));
  assert.match(match[1],new RegExp(clienteNome));
  assert.equal(db.collection('orders').get('pedido-1').historico[5].por,administrador);
});
