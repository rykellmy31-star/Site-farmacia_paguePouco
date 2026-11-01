import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { metricas, pedidosDoCliente, vendasPorDia } from '../src/lib/orders.js';
import { podeOcultarPedido, pedidoOcultoDoCliente, ocultarPedidoDoCliente,
  restaurarPedidoAoCliente } from '../src/lib/order-visibility.js';
import { can } from '../src/lib/permissions.js';
import { telaPedidos } from '../src/views/admin/vendas.js';

class DB {
  constructor() { this.cols=new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name,new Collection({_commit(){}},name));
    return this.cols.get(name);
  }
}
function setup(statusFinanceiro='recusado',statusOperacional='cancelado') {
  const db=new DB();
  const pedido=db.collection('orders').insert({
    id:'pedido1',codigo:'PPTESTE1',clienteId:'cliente1',
    criadoEm:'2026-10-21T17:00:00.000Z',
    statusFinanceiro,statusOperacional,totalCentavos:1900,
    itens:[{produtoId:'p1',quantidade:1}],historico:[{status:'cancelado',tipo:'operacional'}],
    pagamentoId:'pag1',
  });
  db.collection('payments').insert({id:'pag1',pedidoId:'pedido1',valorCentavos:1900,status:'rejected'});
  return {db,pedido};
}
test('ocultação só atinge pedidos encerrados sem pendências financeiras/operacionais',()=>{
  for(const [financeiro,operacional,esperado] of [
    ['recusado','cancelado',true],
    ['expirado','aguardando_pagamento',true],
    ['estornado','cancelado',true],
    ['pendente','cancelado',false],
    ['aprovado','cancelado',false],
    ['estorno_solicitado','cancelado',false],
    ['estornado','devolucao_em_analise',false],
    ['estornado','saiu_para_entrega',false],
    ['estornado','entregue',false],
    ['recusado','em_separacao',false],
  ]) {
    const {pedido}=setup(financeiro,operacional);
    assert.equal(podeOcultarPedido(pedido).ok,esperado,financeiro+'/'+operacional);
  }
  const {pedido}=setup('estornado','cancelado');
  assert.equal(podeOcultarPedido({...pedido,cancelamentoPendenteEstorno:{motivo:'x'}}).ok,false);
  assert.equal(podeOcultarPedido({...pedido,pendenciaPagamento:'conciliacao_necessaria'}).ok,false);
});

test('ocultar é reversível e nunca altera pedido, pagamento ou histórico de estoque',()=>{
  const {db,pedido}=setup();
  const antes=JSON.stringify(db.collection('payments').get('pag1'));
  const r=ocultarPedidoDoCliente(db,pedido.id,{por:'admin1'});
  assert.equal(r.ok,true);
  assert.equal(pedidoOcultoDoCliente(db.collection('orders').get(pedido.id)),true);
  assert.equal(pedidosDoCliente(db,'cliente1').length,0);
  assert.equal(db.collection('orders').count(),1);
  assert.equal(metricas(db).pedidosTotal,1);
  assert.equal(JSON.stringify(db.collection('payments').get('pag1')),antes);
  assert.deepEqual(db.collection('orders').get('pedido1').historico,pedido.historico);
  assert.equal(ocultarPedidoDoCliente(db,pedido.id).ok,false);
  assert.equal(restaurarPedidoAoCliente(db,pedido.id).ok,true);
  assert.equal(pedidosDoCliente(db,'cliente1').length,1);
  assert.equal(restaurarPedidoAoCliente(db,pedido.id).ok,false);
  assert.equal(db.collection('orders').count(),1);
});

test('separação de poderes: só Super Administrador pode ocultar via rota, nunca atendente',()=>{
  assert.equal(can({role:'super_admin'},'pedidos.editar'),true);
  assert.equal(can({role:'atendente'},'pedidos.editar'),true);
  // Teste confirma que checagem genérica de edição NÃO autoriza ocultação.
  const source=__source();
  assert.match(source,/req\.adminUser\.role !== 'super_admin'/);
  assert.match(source,/ocultou_pedido_do_cliente/);
  assert.match(source,/restaurou_pedido_ao_cliente/);
});
function __source(){return import.meta.url ? sourceRoute : ''}
import { readFileSync } from 'node:fs';
const sourceRoute=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');

test('lixeira aparece ao lado de Abrir apenas para superadmin, com CSRF e confirmação',()=>{
  const {db,pedido}=setup();
  const base={db,req:{pathname:'/admin/pedidos',query:new URLSearchParams()},csrf:'token123',
    settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{}},
    adminUser:{role:'super_admin',id:'admin1',nome:'Super'},
    permissoes:{podeOcultarPedidos:true}};
  const props={pedidos:[pedido],total:1,pagina:1,porPagina:25,
    filtros:{visibilidade:'visiveis',q:'',financeiro:'',operacional:'',periodo:''},vendedores:[],totalOcultos:0};
  const html=telaPedidos(base,props);
  assert.match(html,/aria-label="Ocultar pedido PPTESTE1 da conta do cliente"/);
  assert.match(html,/action="\/admin\/pedidos\/pedido1\/ocultar"/);
  assert.match(html,/name="_csrf" value="token123"/);
  assert.match(html,/Filtrar pedidos visíveis ou ocultos/);
  const atendente=telaPedidos({...base,adminUser:{role:'atendente'},permissoes:{podeOcultarPedidos:false}},props);
  assert.doesNotMatch(atendente,/pedidos\/pedido1\/ocultar/);
  assert.doesNotMatch(atendente,/Filtrar pedidos visíveis ou ocultos/);
  ocultarPedidoDoCliente(db,pedido.id);
  const oculto=telaPedidos(base,{...props,pedidos:[db.collection('orders').get('pedido1')],
    filtros:{...props.filtros,visibilidade:'ocultos'},totalOcultos:1});
  assert.match(oculto,/action="\/admin\/pedidos\/pedido1\/restaurar"/);
  assert.doesNotMatch(oculto,/pedidos\/pedido1\/ocultar/);
});

test('painel de loja reflete pedidos visíveis ao ocultar e restaurar, sem apagar o histórico',()=>{
  const {db,pedido}=setup();
  db.collection('orders').insert({
    id:'pedido2',codigo:'PPTESTE2',clienteId:'cliente1',
    criadoEm:'2026-10-21T18:00:00.000Z',
    statusFinanceiro:'pendente',statusOperacional:'aguardando_pagamento',totalCentavos:2600,
    itens:[],
  });
  db.collection('orders').insert({
    id:'pedido3',codigo:'PPTESTE3',clienteId:'cliente2',
    criadoEm:'2026-10-21T19:00:00.000Z',
    statusFinanceiro:'expirado',statusOperacional:'cancelado',totalCentavos:1300,
    itens:[],
  });
  const inicio=metricas(db,{apenasVisiveis:true});
  assert.equal(inicio.pedidosTotal,3);
  assert.equal(inicio.pedidosCancelados,2);
  assert.equal(inicio.pedidosPendentes,1);
  assert.equal(ocultarPedidoDoCliente(db,pedido.id).ok,true);
  assert.equal(ocultarPedidoDoCliente(db,'pedido3').ok,true);
  const tela=metricas(db,{apenasVisiveis:true});
  assert.equal(tela.pedidosTotal,1);
  assert.equal(tela.pedidosCancelados,0);
  assert.equal(tela.pedidosPendentes,1);
  assert.equal(metricas(db).pedidosTotal,3,'auditoria inclui arquivos ocultos');
  const dia=vendasPorDia(db,1,new Date('2026-10-21T20:00:00.000Z'),{apenasVisiveis:true});
  assert.equal(dia[0].pedidos,1);
  assert.equal(vendasPorDia(db,1,new Date('2026-10-21T20:00:00.000Z'))[0].pedidos,3);
  assert.equal(restaurarPedidoAoCliente(db,pedido.id).ok,true);
  assert.equal(metricas(db,{apenasVisiveis:true}).pedidosCancelados,1);
  const rotas=sourceRoute;
  assert.match(rotas,/metricas\(db, \{ apenasVisiveis: true \}\)/);
  assert.match(rotas,/pedidosRecentes: db\.collection\('orders'\)\.all\(\)\.filter\(p => !pedidoOcultoDoCliente\(p\)\)/);
});
