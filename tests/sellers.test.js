import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { cadastrarVendedor, editarVendedor, vendedoresAtivos, selecionarVendedorPedido, metricasVendedores } from '../src/lib/sellers.js';
import { can } from '../src/lib/permissions.js';
import { telaPagamento, telaConfirmacao } from '../src/views/checkout.js';
import { telaPedidoDetalhe } from '../src/views/account.js';
import { telaPedido } from '../src/views/admin/vendas.js';
import { telaVendedores } from '../src/views/admin/sellers.js';
import { config } from '../src/config.js';
import { vendasPendentesInova } from '../src/lib/inovafarma-stock.js';

class DB { constructor(){this.cols=new Map()} collection(name){
  if(!this.cols.has(name))this.cols.set(name,new Collection({_commit(){}},name));
  return this.cols.get(name);
}}
const setup=()=>{
 const db=new DB(),settings={empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},
    whatsapp:{},cookies:{},pagamentos:{},loja:{}};
 const ctx={db,settings,csrf:'teste',req:{pathname:'/checkout/pagamento'},
  cart:{itens:[]},usuario:null,arvore:[],infoPagamento:{real:false}};
 return {db,ctx};
};
test('cadastro preserva zeros e rejeita nome/código vazio ou duplicados',()=>{
 const {db}=setup();
 for(const nome of ['', ' '])assert.equal(cadastrarVendedor(db,{nome,codigoInova:'00125'}).ok,false);
 for(const codigoInova of ['', ' ', ' 00125', '00125 '])assert.equal(cadastrarVendedor(db,{nome:'João',codigoInova}).ok,false);
 const a=cadastrarVendedor(db,{nome:'João Silva',codigoInova:'00125',ativo:true});
 assert.equal(a.ok,true);
 assert.equal(a.vendedor.codigoInova,'00125');
 assert.notEqual(a.vendedor.id,'00125');
 assert.equal(cadastrarVendedor(db,{nome:'Outro',codigoInova:'00125'}).ok,false);
 assert.equal(cadastrarVendedor(db,{nome:'Outro',codigoInova:'00126'}).ok,true);
 assert.equal(editarVendedor(db,a.vendedor.id,{nome:'João A.',codigoInova:'00126',ativo:true}).ok,false);
 assert.equal(db.collection('sellers').get(a.vendedor.id).codigoInova,'00125');
});

test('apenas vendedor ativo é aceito; sem ativos há atendimento geral e IDs manipulados rejeitados',()=>{
 const {db}=setup();
 assert.deepEqual(selecionarVendedorPedido(db,null),{ok:true,vendedor:null});
 assert.equal(selecionarVendedorPedido(db,'inventado').ok,false);
 const s=cadastrarVendedor(db,{nome:'Maria Santos',codigoInova:'00126',ativo:true}).vendedor;
 assert.equal(selecionarVendedorPedido(db,null).ok,false);
 assert.equal(selecionarVendedorPedido(db,'00126').ok,false);
 assert.equal(selecionarVendedorPedido(db,s.id).vendedor.codigoInova,'00126');
 assert.equal(editarVendedor(db,s.id,{nome:'Maria',codigoInova:'00126',ativo:false}).ok,true);
 assert.equal(vendedoresAtivos(db).length,0);
 assert.equal(selecionarVendedorPedido(db,s.id).ok,false);
 assert.deepEqual(selecionarVendedorPedido(db,null),{ok:true,vendedor:null});
});

test('permissões: super/admin podem administrar, gerente apenas ler; operador e cliente sem acesso',()=>{
 assert.equal(can({role:'super_admin'},'vendedores.editar'),true);
 assert.equal(can({role:'admin'},'vendedores.editar'),true);
 assert.equal(can({role:'gerente'},'vendedores.ver'),true);
 assert.equal(can({role:'gerente'},'vendedores.editar'),false);
 assert.equal(can({role:'operador_pedidos'},'vendedores.editar'),false);
 assert.equal(can({role:'atendente'},'vendedores.ver'),false);
 assert.equal(can(null,'vendedores.editar'),false);
});

test('checkout mostra só vendedores ativos e exige seleção quando existem',()=>{
 const {db,ctx}=setup();
 const ativo=cadastrarVendedor(db,{nome:'João Silva',codigoInova:'00125'}).vendedor;
 cadastrarVendedor(db,{nome:'Vendedor Oculto',codigoInova:'00126',ativo:false});
 const opts={totais:{totalCentavos:190,subtotalCentavos:190,freteCentavos:0},
   parcelas:[],formasPagamento:{pix:true},endereco:{cep:'45970000'},
   frete:{label:'Retirar na farmácia'},vendedores:vendedoresAtivos(db)};
 const html=telaPagamento(ctx,opts);
 assert.match(html,/SELECIONE SEU VENDEDOR/);
 assert.match(html,/name="vendedorId" required/);
 assert.match(html,/João Silva/);
 assert.doesNotMatch(html,/Vendedor Oculto|00125|00126/);
 assert.match(html,new RegExp('value="'+ativo.id+'"'));
 const vazio=telaPagamento(ctx,{...opts,vendedores:[]});
 assert.match(vazio,/Atendimento geral/);
 assert.doesNotMatch(vazio,/name="vendedorId"/);
});

test('snapshot no pedido não muda com edição; cliente não recebe código, painel recebe',()=>{
 const {db,ctx}=setup();
 const s=cadastrarVendedor(db,{nome:'Maria Santos',codigoInova:'00126'}).vendedor;
 const escolhido=selecionarVendedorPedido(db,s.id).vendedor;
 const pedido={id:'pedido1',codigo:'PPTESTE',clienteId:'cliente1',
  criadoEm:new Date().toISOString(),statusFinanceiro:'aprovado',statusOperacional:'em_separacao',
  metodoPagamento:'pix',itens:[],totalCentavos:190,subtotalCentavos:190,freteCentavos:0,
  endereco:{nome:'Comprador Teste',cep:'45970000'},vendedor:escolhido};
 db.collection('orders').insert(pedido);
 assert.equal(editarVendedor(db,s.id,{nome:'Maria Atualizada',codigoInova:'00999',ativo:false}).ok,true);
 const registro=db.collection('orders').get('pedido1');
 assert.equal(registro.vendedor.nome,'Maria Santos');
 assert.equal(registro.vendedor.codigoInova,'00126');
 const conf=telaConfirmacao(ctx,{pedido:registro,pagamento:null});
 const cliente=telaPedidoDetalhe(ctx,{pedido:registro});
 assert.match(conf,/Maria Santos/);assert.match(cliente,/Maria Santos/);
 assert.doesNotMatch(conf,/00126|00999/);assert.doesNotMatch(cliente,/00126|00999/);
 const interno=telaPedido({...ctx,adminUser:{role:'super_admin'},permissoes:{}},
   {pedido:registro,pagamento:null,eventos:[]});
 assert.match(interno,/Maria Santos/);assert.match(interno,/00126/);
 const page=telaVendedores({...ctx,adminUser:{role:'super_admin'},permissoes:{podeEditarVendedores:true}},
   {vendedores:vendedoresAtivos(db),metricas:metricasVendedores(db)});
 assert.match(page,/Vendedores/);
});

test('totais por vendedor só consideram receita aprovada, excluindo estorno e cancelamento',()=>{
 const {db}=setup();
 const s=cadastrarVendedor(db,{nome:'Vendedor',codigoInova:'00125'}).vendedor;
 for(const [id,statusFinanceiro,statusOperacional,valor] of [
  ['a','aprovado','em_separacao',1000],['b','pendente','aguardando_pagamento',3000],
  ['c','estornado','enviado',5000],['d','estorno_solicitado','enviado',8000],
  ['e','aprovado','cancelado',13000],['f','aprovado','entregue',2000]]) {
  db.collection('orders').insert({id,vendedor:{id:s.id,nome:s.nome,codigoInova:s.codigoInova},statusFinanceiro,statusOperacional,totalCentavos:valor});
 }
 const m=metricasVendedores(db).get(s.id);assert.deepEqual(m,{pedidos:2,totalCentavos:3000});
});

test('payload Inova conserva código textual, idempotência, frete e preços; não liga ERP',()=>{
 const {db}=setup();
 const s=cadastrarVendedor(db,{nome:'João',codigoInova:'00125'}).vendedor;
 db.collection('products').insert({id:'p1',ean:'7891234567890'});
 db.collection('orders').insert({id:'o1',codigo:'PPINOVA1',criadoEm:'2026-10-21T00:00:00Z',
  atualizadoEm:'2026-10-21T00:01:00Z',vendedor:{id:s.id,nome:s.nome,codigoInova:s.codigoInova},
  inovaEnvioPendente:true,statusFinanceiro:'aprovado',subtotalCentavos:4500,
  descontoCentavos:500,freteCentavos:800,totalCentavos:4800,metodoPagamento:'pix',
  itens:[{produtoId:'p1',ean:'7891234567890',quantidade:2,precoUnitarioCentavos:1000,subtotalCentavos:2000}]});
 const antes=config.inova?.enabled;
 try{
  config.inova.enabled=false;
  const fila=vendasPendentesInova(db);
  assert.equal(fila.length,1);assert.equal(fila[0].vendedor.codigoInova,'00125');
  assert.equal(fila[0].chaveIdempotencia,'venda-online:PPINOVA1');
  assert.equal(fila[0].valores.freteCentavos,800);
  assert.equal(fila[0].valores.totalPagoCentavos,4800);
  assert.equal(fila[0].itens[0].precoUnitarioCentavos,1000);
 }finally{config.inova.enabled=antes}
});
