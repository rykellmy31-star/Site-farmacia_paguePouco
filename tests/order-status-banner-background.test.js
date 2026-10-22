import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { atualizarStatusFinanceiro, atualizarStatusOperacional, cancelarPedido, statusOperacionalExibido, concluirDevolucaoEstornada } from '../src/lib/orders.js';
import { telaConta, telaPedidoDetalhe } from '../src/views/account.js';
import { estoqueDisponivel } from '../src/lib/catalog.js';
import { telaPedido } from '../src/views/admin/vendas.js';
import { telaBanners } from '../src/views/admin/catalogo.js';

class DB {
  constructor(){this.cols=new Map()}
  collection(name){
    if(!this.cols.has(name)) this.cols.set(name,new Collection({_commit(){}},name));
    return this.cols.get(name);
  }
}
function criar(status='aprovado',operacional='em_separacao') {
  const db=new DB();
  db.collection('products').insert({id:'p1',nome:'Medicamento teste',estoque:{quantidade:8,reservado:0}});
  const pedido=db.collection('orders').insert({
    id:'o1',codigo:'PPTESTE123',statusFinanceiro:status,statusOperacional:operacional,
    pagamentoId:'pg',metodoPagamento:'pix',totalCentavos:190,
    criadoEm:'2026-10-21T17:21:00Z',
    itens:[{produtoId:'p1',quantidade:1}], historico:[],
    endereco:{cep:'45970000',nome:'Cliente Exemplo'},
  });
  db.collection('payments').insert({id:'pg',status:status==='aprovado'?'approved':'pending',
    pedidoId:'o1',provedor:'internal',metodo:'pix',valorCentavos:190});
  return {db,pedido};
}
const ctx=db=>({db,settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},whatsapp:{},cookies:{}},
  usuario:{nome:'Cliente Exemplo'},req:{pathname:'/conta'},arvore:[],csrf:'teste'});

test('estorno confirmado antes do despacho encerra entrega junto com pagamento',()=>{
  const {db}=criar();
  assert.equal(atualizarStatusFinanceiro(db,'o1','estornado').ok,false,
    'não concluir sem confirmação do banco');
  db.collection('payments').update('pg',{status:'refunded'});
  const r=atualizarStatusFinanceiro(db,'o1','estornado',{por:'conciliacao'});
  assert.equal(r.ok,true);
  assert.equal(r.pedido.statusOperacional,'cancelado');
  assert.equal(r.pedido.statusFinanceiro,'estornado');
  assert.equal(r.pedido.historico.filter(e=>e.tipo==='operacional'&&e.status==='cancelado').length,1);
  assert.equal(cancelarPedido(db,'o1').semAlteracao,true);
  assert.equal(atualizarStatusFinanceiro(db,'o1','estornado').semAlteracao,true);
  assert.equal(db.collection('products').get('p1').estoque.quantidade,8,
    'não inventar reposição física');
});

test('estorno após envio marca devolução em análise, sem mentir sobre entrega ou repor estoque',()=>{
  const {db}=criar('aprovado','saiu_para_entrega');
  db.collection('payments').update('pg',{status:'refunded'});
  const r=atualizarStatusFinanceiro(db,'o1','estornado');
  assert.equal(r.ok,true);
  assert.equal(r.pedido.statusOperacional,'devolucao_em_analise');
  assert.equal(db.collection('products').get('p1').estoque.quantidade,8);
  assert.equal(atualizarStatusOperacional(db,'o1','entregue').ok,false);
  assert.equal(cancelarPedido(db,'o1').ok,false);
  assert.equal(r.pedido.historico.filter(h=>h.status==='devolucao_em_analise').length,1);
});

test('pedido já entregue estornado exige conferência de devolução, preservando entregueEm',()=>{
  const {db}=criar('aprovado','entregue');
  db.collection('orders').update('o1',{entregueEm:'2026-10-21T16:00:00Z'});
  db.collection('payments').update('pg',{status:'refunded'});
  const r=atualizarStatusFinanceiro(db,'o1','estornado');
  assert.equal(r.pedido.statusOperacional,'devolucao_em_analise');
  assert.equal(r.pedido.entregueEm,'2026-10-21T16:00:00Z');
});

test('pedido antigo estornado aparece coerente no painel e conta sem mutação retroativa',()=>{
  const {db}=criar('estornado','saiu_para_entrega');
  const p=db.collection('orders').get('o1');
  assert.equal(statusOperacionalExibido(p),'devolucao_em_analise');
  const cliente=telaConta(ctx(db),{pedidos:[p]});
  assert.match(cliente,/Aguardando conferência de devolução/);
  assert.doesNotMatch(cliente,/saiu para entrega/i);
  const detalhe=telaPedidoDetalhe(ctx(db),{pedido:p});
  assert.match(detalhe,/Aguardando conferência de devolução/);
  const admin=telaPedido({...ctx(db),adminUser:{role:'super_admin',nome:'Admin'},permissoes:{podeEditarPedidos:true}},
    {pedido:p,pagamento:null,eventos:[]});
  assert.match(admin,/Aguardando conferência de devolução/);
  assert.equal(db.collection('orders').get('o1').statusOperacional,'saiu_para_entrega',
    'histórico armazenado preservado em pedidos antigos');
});

test('pedido expirado ou recusado aparece como cancelado; estorno pendente não é confirmado',()=>{
  for (const financeiro of ['expirado','recusado']) {
    assert.equal(statusOperacionalExibido({
      statusFinanceiro:financeiro,statusOperacional:'aguardando_pagamento',
    }),'cancelado');
  }
  assert.equal(statusOperacionalExibido({
    statusFinanceiro:'estorno_solicitado',statusOperacional:'saiu_para_entrega',
  }),'estorno_em_analise');
});

test('entregue possui ação explícita somente após envio de pedido pago e mantém bloqueios',()=>{
  const {db}=criar('aprovado','saiu_para_entrega');
  const p=db.collection('orders').get('o1');
  const adminCtx={...ctx(db),adminUser:{role:'super_admin',nome:'Admin'},
    permissoes:{podeEditarPedidos:true}};
  const html=telaPedido(adminCtx,{pedido:p,pagamento:null,eventos:[]});
  assert.match(html,/data-marcar-entregue="o1"/);
  const entregue=atualizarStatusOperacional(db,'o1','entregue');
  assert.equal(entregue.ok,true);
  assert.equal(entregue.pedido.statusOperacional,'entregue');
  assert.equal(entregue.pedido.entregueEm!=null,true);
  const html2=telaPedido(adminCtx,{pedido:entregue.pedido,pagamento:null,eventos:[]});
  assert.doesNotMatch(html2,/data-marcar-entregue=/);
  assert.equal(atualizarStatusOperacional(db,'o1','enviado').ok,false);
});

test('modelo vermelho pode ser baixado e reutilizado sem textos originais',()=>{
  const svg=readFileSync(new URL('../public/img/fundo-banner-vermelho.svg',import.meta.url),'utf8');
  assert.match(svg,/viewBox="0 0 1200 420"/);
  assert.match(svg,/#8b0000/);
  assert.doesNotMatch(svg,/<text\b|Ofertas do dia|Confira as ofertas|<script/i);
  const db=new DB();
  const html=telaBanners({...ctx(db),adminUser:{id:'adm',nome:'Admin',role:'super_admin'}},
    {banners:[],midias:[]});
  assert.match(html,/Baixar somente o fundo vermelho/);
  assert.match(html,/download="fundo-banner-vermelho-pague-pouco.svg"/);
  assert.match(html,/data-usar-fundo-banner="\/img\/fundo-banner-vermelho.svg"/);
  assert.match(html,/id="formNovoBanner"/);
  assert.match(html,/id="bannerDestino"/);
  assert.match(html,/option value="\/ofertas"/);
  assert.match(html,/option value="\/categorias"/);
  assert.match(html,/id="bannerLinkFinal"/);
  assert.match(html,/id="previewNovoBanner"/);
});

test('administrador confirma devolucao, registra estoque fisico em quarentena, sem liberar venda',()=>{
  const {db}=criar('aprovado','saiu_para_entrega');
  assert.equal(concluirDevolucaoEstornada(db,'o1',{decisao:'recebida',justificativa:'Devolvida pela transportadora'}).ok,false);
  db.collection('payments').update('pg',{status:'refunded'});
  atualizarStatusFinanceiro(db,'o1','estornado');
  assert.equal(concluirDevolucaoEstornada(db,'o1',{decisao:'recebida',justificativa:'curta'}).ok,false);
  const resultado=concluirDevolucaoEstornada(db,'o1',{decisao:'recebida',justificativa:'Recebida no balcão, lote segregado para avaliação.',por:'Gerente'});
  assert.equal(resultado.ok,true);
  assert.equal(resultado.pedido.statusOperacional,'devolucao_recebida');
  assert.equal(resultado.pedido.conferenciaDevolucao.por,'Gerente');
  assert.equal(resultado.pedido.statusFinanceiro,'estornado');
  const produto = db.collection('products').get('p1');
  assert.equal(produto.estoque.quantidade,9, 'quantidade física aumentou');
  assert.equal(produto.estoque.quarentena,1, 'devolução recebida segregada');
  assert.equal(estoqueDisponivel(produto),8, 'não colocar o devolvido à venda sem avaliação');
  const movimentos = db.collection('stockMovements').find(x => x.pedidoId === 'o1');
  assert.equal(movimentos.length,1);
  assert.equal(movimentos[0].tipo,'entrada_quarentena');
  assert.equal(movimentos[0].quantidade,1);
  const html = telaPedido({...ctx(db),adminUser:{role:'super_admin',nome:'Gerente'},
      permissoes:{podeEditarPedidos:true}}, {pedido:resultado.pedido,pagamento:null,eventos:[]});
  assert.match(html,/Conferência da devolução registrada/);
  assert.match(html,/Estoque físico atualizado em quarentena/);
  assert.match(html,/Gerente/);
  assert.doesNotMatch(html,/Registrar resultado da devolução/);
  assert.doesNotMatch(html,/Atualizar status operacional/);
  assert.equal(concluirDevolucaoEstornada(db,'o1',{decisao:'recebida',justificativa:'Tentativa duplicada'}).ok,false);
  assert.equal(atualizarStatusOperacional(db,'o1','entregue').ok,false);
  assert.equal(db.collection('products').get('p1').estoque.quantidade,9,'repetição não lança nova entrada');
});
test('pode encerrar sem retorno fisico documentado, sem criar nova cobrança',()=>{
  const {db}=criar('estornado','devolucao_em_analise');
  const r=concluirDevolucaoEstornada(db,'o1',{decisao:'nao_recebida',justificativa:'Transportadora confirmou extravio.',por:'Super Admin'});
  assert.equal(r.ok,true);
  assert.equal(statusOperacionalExibido(r.pedido),'encerrado_sem_devolucao');
  assert.equal(db.collection('products').get('p1').estoque.quantidade,8);
  const html=telaPedido({...ctx(db),adminUser:{role:'super_admin',nome:'Admin'},permissoes:{podeEditarPedidos:true}},
    {pedido:r.pedido,pagamento:null,eventos:[]});
  assert.match(html,/Encerrado sem devolução/);
  assert.doesNotMatch(html,/Registrar resultado da devolução/);
});

test('devolucao nao movimenta produtos inexistentes nem aceita quantidades incorretas',()=>{
  const {db}=criar('estornado','devolucao_em_analise');
  db.collection('orders').update('o1',{itens:[{produtoId:'sumiu',quantidade:2}]});
  const x=concluirDevolucaoEstornada(db,'o1',{decisao:'recebida',justificativa:'Mercadoria fisicamente devolvida',por:'Admin'});
  assert.equal(x.ok,false);
  assert.equal(db.collection('products').get('p1').estoque.quantidade,8);
  assert.equal(db.collection('stockMovements').count(),0);
  assert.equal(db.collection('orders').get('o1').statusOperacional,'devolucao_em_analise');
});
test('devolucao multiplos itens agrega entradas por produto de modo auditavel',()=>{
  const {db}=criar('estornado','devolucao_em_analise');
  db.collection('orders').update('o1',{itens:[{produtoId:'p1',quantidade:2},{produtoId:'p1',quantidade:1}]});
  const r=concluirDevolucaoEstornada(db,'o1',{decisao:'recebida',justificativa:'Tres itens conferidos no retorno',por:'Admin'});
  assert.equal(r.ok,true);
  assert.equal(db.collection('products').get('p1').estoque.quantidade,11);
  assert.equal(db.collection('products').get('p1').estoque.quarentena,3);
  assert.equal(estoqueDisponivel(db.collection('products').get('p1')),8);
  assert.equal(db.collection('stockMovements').count(),1);
  assert.equal(r.pedido.conferenciaDevolucao.itensRecebidos[0].quantidade,3);
});

test('seletor de banners mostra categorias reais e nao oferece categorias inativas',()=>{
  const db=new DB();
  const html=telaBanners({...ctx(db),adminUser:{role:'super_admin',nome:'Admin'}},{
    banners:[], midias:[], categorias:[
      {id:'cat1',nome:'Vitaminas',slug:'vitaminas',ativa:true},
      {id:'cat2',nome:'Oculta',slug:'oculta',ativa:false},
    ],
  });
  assert.match(html,/option value="\/categoria\/vitaminas"\s*(?:selected)?>Categoria: Vitaminas/);
  assert.doesNotMatch(html,/option value="\/categoria\/oculta"/);
  const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
  assert.match(js,/data-usar-fundo-banner/);
  assert.match(js,/querySelector\('#formNovoBanner \[name="imagem"\]'\)/);
  assert.match(js,/atualizarPreviaBanner\(url\)/);
  assert.match(js,/atualizarLinkBanner/);
});

test('banner padrão possui título, descrição, fundo sem upload e ordem automática',()=>{
  const db=new DB();
  const html=telaBanners({...ctx(db),adminUser:{role:'super_admin',nome:'Admin'}},{banners:[],midias:[],categorias:[]});
  assert.match(html,/Título que aparece no banner/);
  assert.match(html,/Descrição abaixo do título/);
  assert.match(html,/Ordem automática/);
  assert.doesNotMatch(html,/name="ordem"/);
  assert.match(html,/name="imagem" value="\/img\/fundo-banner-vermelho.svg"/);
});

test('banners cadastrados podem abrir edicao preenchida, mantendo id e ordem',()=>{
  const db=new DB();
  const banner={id:'banner-123',titulo:'Fraldas e cuidados',descricao:'Conheça as ofertas',
    imagem:'/img/fundo-banner-vermelho.svg',imagemMobile:'/img/fundo-banner-vermelho.svg',
    link:'/categoria/fraldas',posicao:'principal',ordem:4,ativo:true};
  const html=telaBanners({...ctx(db),csrf:'teste',adminUser:{role:'super_admin',nome:'Admin'}},
    {banners:[banner],midias:[],categorias:[{id:'c1',nome:'Fraldas',slug:'fraldas',ativa:true}],editando:banner});
  assert.match(html,/data-usar-fundo-banner/);
  assert.match(html,/href="\/admin\/banners\?editar=banner-123#formNovoBanner">Editar/);
  assert.match(html,/action="\/admin\/api\/banners\/banner-123\/editar"/);
  assert.match(html,/name="titulo" value="Fraldas e cuidados"/);
  assert.match(html,/Conheça as ofertas/);
  assert.match(html,/option value="\/categoria\/fraldas" selected/);
  assert.match(html,/Ordem atual: 4/);
  assert.match(html,/Salvar alterações/);
  assert.match(html,/Cancelar edição/);
});
