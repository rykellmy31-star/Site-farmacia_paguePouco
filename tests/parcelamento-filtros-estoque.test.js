import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installmentOptions, maxInstallments } from '../src/lib/payments/index.js';
import { filtrarProdutosPorEstoque } from '../src/lib/catalog.js';
import { telaProdutos } from '../src/views/admin/catalogo.js';

const pagamentos = (config={}) => ({
  collection(name){
    assert.equal(name,'settings');
    return {get:id=>id==='pagamentos'?config:null};
  },
});
const numeros = (db,centavos)=>installmentOptions(db,centavos).map(p=>p.numero);
test('parcelamento: ate seis vezes e R$ 25 por parcela exatamente nos limiares',()=>{
  const db=pagamentos();
  const exemplos=[
    [100,[1]],[2499,[1]],[2500,[1]],[4999,[1]],
    [5000,[1,2]],[7499,[1,2]],[7500,[1,2,3]],
    [9999,[1,2,3]],[10000,[1,2,3,4]],
    [12499,[1,2,3,4]],[12500,[1,2,3,4,5]],
    [14999,[1,2,3,4,5]],[15000,[1,2,3,4,5,6]],
    [500000,[1,2,3,4,5,6]],
  ];
  for(const [total,esperadas] of exemplos)
    assert.deepEqual(numeros(db,total),esperadas,'Compra '+(total/100));
  assert.equal(maxInstallments(db),6);
});

test('configuracao antiga de 12x e R$5 nao contorna politica nem juros elevam elegibilidade',()=>{
  const db=pagamentos({
    parcelamentoMaximo:12,parcelasSemJuros:2,
    valorMinimoParcela:500,taxaJurosMes:20,
  });
  assert.equal(maxInstallments(db),6);
  assert.deepEqual(numeros(db,4999),[1]);
  assert.deepEqual(numeros(db,5000),[1,2]);
  assert.deepEqual(numeros(db,7499),[1,2]);
  assert.deepEqual(numeros(db,7500),[1,2,3]);
  assert.deepEqual(numeros(db,14999),[1,2,3,4,5]);
  assert.deepEqual(numeros(db,15000),[1,2,3,4,5,6]);
});

test('estoque zerado e em estoque usam saldo fisico; preservam filtros existentes',()=>{
  const produtos=[
    {id:'zero',estoque:{quantidade:0},ativo:true},
    {id:'normal',estoque:{quantidade:5},ativo:true},
    {id:'inativo-com-saldo',estoque:{quantidade:1},ativo:false},
    {id:'reservado',estoque:{quantidade:2,reservado:2},ativo:true},
    {id:'sem-saldo',estoque:{}},
    {id:'negativo',estoque:{quantidade:-1}},
  ];
  assert.deepEqual(filtrarProdutosPorEstoque(produtos,'estoque_zerado').map(p=>p.id),
    ['zero','sem-saldo','negativo']);
  assert.deepEqual(filtrarProdutosPorEstoque(produtos,'em_estoque').map(p=>p.id),
    ['normal','inativo-com-saldo','reservado']);
  assert.equal(filtrarProdutosPorEstoque(produtos,'estoque_baixo'),produtos);
  assert.equal(filtrarProdutosPorEstoque(produtos,'ativo'),produtos);
});

test('painel traz dois novos filtros com selecao preservada e rotas server-side',()=>{
  const db={collection:()=>({get:()=>null})};
  const ctx={
    db,csrf:'CSRF_TESTE',adminUser:{role:'super_admin',nome:'Teste'},
    settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    req:{pathname:'/admin/produtos',query:new URLSearchParams()},
  };
  const html=telaProdutos(ctx,{
    produtos:[],total:0,pagina:1,porPagina:25,busca:'',categorias:[],
    filtros:{categoria:'',status:'em_estoque'},
  });
  assert.match(html, /value="estoque_zerado"[^>]*>Estoque zerado<\/option>/);
  assert.match(html, /value="em_estoque" selected>Em estoque<\/option>/);
  assert.match(html, /value="estoque_baixo"[^>]*>Estoque baixo<\/option>/);
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  assert.match(routes,/filtrarProdutosPorEstoque\(todos, status\)/);
  assert.match(routes,/parcelamentoMaximo:\s*6/);
  assert.match(routes,/valorMinimoParcela:\s*2500/);
  const screen=readFileSync(new URL('../src/views/admin/vendas.js',import.meta.url),'utf8');
  assert.match(screen,/6x \(limite fixo da farmácia\)/);
  assert.match(screen,/R\$ 25,00 \(regra fixa\)/);
  const order=readFileSync(new URL('../src/lib/orders.js',import.meta.url),'utf8');
  assert.match(order,/installmentOptions\(db, baseCentavos\)\.find/);
});
