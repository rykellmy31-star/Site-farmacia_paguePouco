import test from 'node:test';
import assert from 'node:assert/strict';
import {constaAntimicrobianoExportadoInova,TOTAL_ANTIMICRO_INOVA_20261029}
  from '../src/lib/antimicrobianos-inova-20261029.js';
import {criarAvaliadorControlados} from '../src/lib/bloqueio-controlados-inova.js';
import {podeAtivarAposAprovacao,podeVender,searchProducts} from '../src/lib/catalog.js';
import {metricas,produtoComEstoqueParaPainel} from '../src/lib/orders.js';

function banco(produtos=[]){
  const data=new Map([['products',produtos],['orders',[]],['customers',[]]]);
  return {collection(name){
    const rows=data.get(name)||[];
    return {all:()=>rows, count:()=>rows.length, get:id=>rows.find(p=>p.id===id)||null};
  }};
}
const produto=(id,alteracoes={})=>({
  id, nome:'Item '+id, codigoInterno:'999'+id, ean:'',ativo:true,
  precoCentavos:1000, estoque:{quantidade:3,reservado:0,quarentena:0,minimo:5},
  sanitario:{classificacao:'nao_aplicavel',requerReceita:false},
  ...alteracoes,
});

test('163 identificadores antimicrobianos são filtrados por código e EAN',()=>{
  assert.equal(TOTAL_ANTIMICRO_INOVA_20261029,163);
  assert.equal(constaAntimicrobianoExportadoInova({codigoInterno:'1460'}),true);
  assert.equal(constaAntimicrobianoExportadoInova({ean:'7896004703428'}),true);
  assert.equal(constaAntimicrobianoExportadoInova({codigoInterno:'794287'}),true);
  assert.equal(constaAntimicrobianoExportadoInova({codigoInterno:'107158'}),true);
  assert.equal(constaAntimicrobianoExportadoInova({codigoInterno:'123498765'}),false);
  const b=banco();
  assert.equal(criarAvaliadorControlados(b)({codigoInterno:'1460',nome:'comercial'}).bloqueado,true);
});

test('medicamentos antimicrobianos não ficam disponíveis na busca, links nem venda',()=>{
  const anti=produto('anti',{codigoInterno:'1460',ean:'7896004703428',nome:'AMOX+CLAV 250MG'});
  const normal=produto('normal');
  const b=banco([anti,normal]);
  assert.equal(podeAtivarAposAprovacao(anti).codigo,'ANTIMICROBIANO_INOVA');
  assert.equal(podeVender(anti).ok,false);
  assert.equal(searchProducts(b,{q:'AMOX'}).total,0);
  assert.equal(searchProducts(b).total,1);
  assert.equal(searchProducts(b).rows[0].id,'normal');
  assert.equal(b.collection('products').get('anti').estoque.quantidade,3);
});

test('Visão Geral conta apenas ativos, estoque positivo e sem bloqueio',()=>{
  const p=[
    produto('sabonete',{estoque:{quantidade:1,reservado:0,minimo:2}}),
    produto('zerado',{estoque:{quantidade:0}}),
    produto('negativo',{estoque:{quantidade:-2}}),
    produto('inativo',{ativo:false}),
    produto('psico',{codigoInterno:'846991'}),
    produto('antimicro',{codigoInterno:'1460'}),
    produto('bloqueado',{bloqueioControladoInova:{ativo:true}}),
    produto('arquivado',{inovaArquivado:{em:'2026-10-29T12:00:00Z'}}),
    produto('receita',{sanitario:{classificacao:'nao_aplicavel',requerReceita:true}})
  ];
  const b=banco(p);
  const m=metricas(b);
  assert.equal(m.produtosComEstoque,1);
  assert.equal(m.estoqueBaixoComEstoque,1);
  assert.equal(produtoComEstoqueParaPainel(p[0]),true);
  assert.equal(produtoComEstoqueParaPainel(p[1]),false);
  assert.equal(produtoComEstoqueParaPainel(p[2]),false);
  assert.equal(produtoComEstoqueParaPainel(p[4]),false);
  assert.equal(produtoComEstoqueParaPainel(p[5]),false);
  assert.equal(p[5].ativo,true,'não deve alterar estado do cadastro');
  assert.equal(p[5].estoque.quantidade,3,'não deve apagar o estoque');
});
