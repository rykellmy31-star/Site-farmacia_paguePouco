import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import {
  recomendarParaProduto, recomendarParaCarrinho, recomendarNaCategoria,
  registrarAdicaoRecomendada, relatorioInteligenciaVendas,
} from '../src/lib/inteligencia-vendas.js';
import { secaoRecomendacoes } from '../src/views/recomendacoes.js';
import { dataDaLoja } from '../src/lib/relatorio-operacional-vendas.js';

class DB {
  constructor(){this.cols=new Map()}
  collection(name){
    if(!this.cols.has(name))this.cols.set(name,new Collection({_commit(){}},name));
    return this.cols.get(name);
  }
}
function criarProduto(db,id,nome,categoriaId,{ativo=true,estoque=9,sanitario=null}={}){
  return db.collection('products').insert({
    id,nome,slug:id,categoriaId,ativo,precoCentavos:2500,
    estoque:{quantidade:estoque,reservado:0},
    sanitario:sanitario||{classificacao:'nao_aplicavel'},
  });
}
function setup(){
  const db=new DB();
  db.collection('categories').insert({id:'bebes',slug:'bebes',nome:'Bebês e infantil'});
  db.collection('categories').insert({id:'fraldas',slug:'fraldas',nome:'Fraldas',paiId:'bebes'});
  db.collection('categories').insert({id:'higiene',slug:'higiene-infantil',nome:'Higiene infantil',paiId:'bebes'});
  db.collection('categories').insert({id:'capilar',slug:'cabelos',nome:'Cuidados capilares'});
  db.collection('categories').insert({id:'saude',slug:'saude',nome:'Medicamentos'});
  const fralda=criarProduto(db,'fralda','Fralda Babysec tamanho M','fraldas');
  criarProduto(db,'lenco','Lenço umedecido bebê','higiene');
  criarProduto(db,'pomada','Creme preventivo para assaduras bebê','higiene');
  criarProduto(db,'sabonete','Sabonete infantil','higiene');
  criarProduto(db,'shampoo','Shampoo capilar','capilar');
  criarProduto(db,'condicionador','Condicionador capilar','capilar');
  criarProduto(db,'fora','Lenço umedecido infantil esgotado','higiene',{estoque:0});
  criarProduto(db,'inativo','Lenço umedecido infantil inativo','higiene',{ativo:false});
  criarProduto(db,'controlado','Medicamento controlado','saude',{sanitario:{
    classificacao:'controlado',requerReceita:true}});
  criarProduto(db,'medicamento','Medicamento OTC','saude',{sanitario:{
    classificacao:'isento_prescricao',registroMS:'12345',aprovadoFarmaceutico:true}});
  return {db,fralda};
}
test('fralda recomenda lenço e creme para assaduras, não algo de cabelo nem medicamento',()=>{
 const {db,fralda}=setup();
 const resultados=recomendarParaProduto(db,fralda,{limite:8});
 const ids=resultados.map(x=>x.produto.id);
 assert(ids.includes('lenco'));
 assert(ids.includes('pomada'));
 assert(!ids.includes('shampoo'));
 assert(!ids.includes('controlado'));
 assert(!ids.includes('medicamento'));
 assert(!ids.includes('fora'));
 assert(!ids.includes('inativo'));
 assert(ids.indexOf('lenco')<ids.indexOf('sabonete'));
});
test('cartão de produtos infantis não repete itens já presentes na cesta',()=>{
 const {db}=setup();
 const itens=recomendarParaCarrinho(db,{
   itens:[{produtoId:'fralda',quantidade:1},{produtoId:'lenco',quantidade:1}],
 });
 const ids=itens.map(x=>x.produto.id);
 assert(!ids.includes('fralda'));
 assert(!ids.includes('lenco'));
 assert(ids.includes('pomada'));
 assert(itens.every(x=>x.origemId==='fralda'||x.origemId==='lenco'));
});
test('ao entrar no departamento infantil surgem complementos de categorias relacionadas',()=>{
 const {db}=setup();
 const resultado=recomendarNaCategoria(db,db.collection('categories').get('fraldas'));
 assert(resultado.some(x=>x.produto.id==='lenco'));
 assert(resultado.every(x=>x.produto.id!=='fralda'));
});
test('produto desativado ou medicamento nunca vira recomendação personalizada',()=>{
 const {db}=setup();
 assert.deepEqual(recomendarParaProduto(db,db.collection('products').get('inativo')),[]);
 assert.deepEqual(recomendarParaProduto(db,db.collection('products').get('medicamento')),[]);
});
test('adição válida registra vínculo da cesta; fraude ou produto irrelevante não contam',()=>{
 const {db}=setup();
 assert.equal(registrarAdicaoRecomendada(db,{
   carrinhoId:'cart-1',origemId:'fralda',produtoId:'shampoo'}),false);
 assert.equal(db.collection('recomendacoesAdicoes').count(),0);
 assert.equal(registrarAdicaoRecomendada(db,{
   carrinhoId:'cart-1',origemId:'fralda',produtoId:'lenco'}),true);
 assert.equal(registrarAdicaoRecomendada(db,{
   carrinhoId:'cart-1',origemId:'fralda',produtoId:'lenco'}),true);
 assert.equal(db.collection('recomendacoesAdicoes').count(),1);
});
test('inteligência separa receita paga, ticket médio, cancelados e itens recomendados',()=>{
 const {db}=setup();
 const hoje=dataDaLoja(new Date());
 registrarAdicaoRecomendada(db,{carrinhoId:'cart-1',origemId:'fralda',produtoId:'lenco'});
 db.collection('recomendacoesAdicoes').update('sug_cart-1_lenco',{
   adicionadoEm:hoje+'T09:00:00Z',
 });
 db.collection('orders').insert({id:'pago1',codigo:'P1',criadoEm:hoje+'T10:00:00Z',
   statusFinanceiro:'aprovado',clienteId:'cliente-1',carrinhoId:'cart-1',
   totalCentavos:7000,metodoPagamento:'pix',itens:[
     {produtoId:'fralda',nome:'Fralda',quantidade:1,subtotalCentavos:4500},
     {produtoId:'lenco',nome:'Lenço',quantidade:1,subtotalCentavos:2500},
   ]});
 db.collection('orders').insert({id:'pago2',codigo:'P2',criadoEm:hoje+'T13:00:00Z',
   statusFinanceiro:'aprovado',clienteId:'cliente-1',carrinhoId:'cart-2',
   totalCentavos:3000,metodoPagamento:'credit_card',itens:[]});
 db.collection('orders').insert({id:'cancel',criadoEm:hoje+'T15:00:00Z',
   statusFinanceiro:'recusado',statusOperacional:'cancelado',totalCentavos:9000,
   carrinhoId:'cart-1',itens:[{produtoId:'lenco',quantidade:2,subtotalCentavos:9000}]});
 db.collection('orders').insert({id:'pending',criadoEm:hoje+'T16:00:00Z',
   statusFinanceiro:'pendente',totalCentavos:4000});
 const r=relatorioInteligenciaVendas(db,{de:hoje,ate:hoje});
 assert.equal(r.pedidosPagos,2);
 assert.equal(r.pedidosPendentes,1);
 assert.equal(r.pedidosCancelados,1);
 assert.equal(r.receitaCentavos,10000);
 assert.equal(r.ticketMedioCentavos,5000);
 assert.equal(r.pedidosComRecomendacao,1);
 assert.equal(r.itensRecomendadosVendidos,1);
 assert.equal(r.valorBrutoItensRecomendadosCentavos,2500);
 assert.equal(r.taxaConversaoRecomendacoes,50);
 assert.equal(r.clientesRecorrentes,1);
 assert.equal(r.pagamentos.length,2);
});
test('compra não é atribuída a clique posterior; campanha apenas criada não vira venda recuperada',()=>{
 const {db}=setup();
 const hoje=dataDaLoja(new Date());
 registrarAdicaoRecomendada(db,{carrinhoId:'cart-1',origemId:'fralda',produtoId:'lenco'});
 db.collection('orders').insert({
   id:'pedido1',clienteId:'cliente-1',carrinhoId:'cart-1',
   criadoEm:hoje+'T08:00:00Z',statusFinanceiro:'aprovado',
   totalCentavos:2500,itens:[{produtoId:'lenco',nome:'Lenço',quantidade:1,
     subtotalCentavos:2500}],
 });
 db.collection('recuperacoesVendas').insert({
   id:'campanha-1',clienteId:'cliente-1',carrinhoId:'cart-1',
 });
 db.collection('evolutionWhatsappOutbox').insert({
   id:'campanha-1',status:'fila',criadoEm:hoje+'T06:00:00Z',
 });
 let r=relatorioInteligenciaVendas(db,{de:hoje,ate:hoje});
 assert.equal(r.pedidosComRecomendacao,0);
 assert.equal(r.vendasRecuperadas,0);
 db.collection('evolutionWhatsappOutbox').update('campanha-1',{
   status:'enviado',enviadoEm:hoje+'T09:00:00Z',
 });
 r=relatorioInteligenciaVendas(db,{de:hoje,ate:hoje});
 assert.equal(r.vendasRecuperadas,0,'envio posterior ao pedido não recupera venda');
 db.collection('evolutionWhatsappOutbox').update('campanha-1',{
   enviadoEm:hoje+'T07:00:00Z',
 });
 r=relatorioInteligenciaVendas(db,{de:hoje,ate:hoje});
 assert.equal(r.vendasRecuperadas,1);
});
test('cards compactos possuem preço e botão real de adicionar, sem pop-up',()=>{
 const {db,fralda}=setup();
 const html=secaoRecomendacoes(recomendarParaProduto(db,fralda));
 assert.match(html,/Combine com sua compra/);
 assert.match(html,/data-adicionar-carrinho="lenco"/);
 assert.match(html,/data-recomendacao-origem="fralda"/);
 assert.match(html,/Adicionar à cesta/);
 assert.match(html,/R\$\s25,00/);
 assert.doesNotMatch(html,/onclick=|modal|pop-up/i);
});
test('integração é nova e não altera checkout nem APIs antigas',()=>{
 const api=readFileSync(new URL('../src/routes/api.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
 const pub=readFileSync(new URL('../src/views/public.js',import.meta.url),'utf8');
 const cart=readFileSync(new URL('../src/views/checkout.js',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../src/views/admin/layout.js',import.meta.url),'utf8');
 const route=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
 assert.match(api,/registrarAdicaoRecomendada/);
 assert.match(api,/!antes && req\.body\.origemRecomendacao/);
 assert.match(app,/data-recomendacao-origem/);
 assert.match(pub,/Combine com este produto/);
 assert.match(pub,/Combina com esta categoria/);
 assert.match(cart,/recomendacoesCarrinho/);
 assert.match(admin,/\/admin\/inteligencia-vendas/);
 assert.match(route,/relatorioInteligenciaVendas/);
 assert.match(css,/@media\(max-width:767px\)/);
 assert.match(css,/scroll-snap-type: x mandatory/);
});
