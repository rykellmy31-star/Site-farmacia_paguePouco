import test from 'node:test';
import assert from 'node:assert/strict';
import {sugerirCategoriaProduto,planejarCategoriasProdutos,aplicarCategoriasProdutos}
  from '../src/lib/categorizar-produtos-sem-categoria.js';
const categorias=[
 {id:'hig',nome:'Higiene pessoal',slug:'higiene-pessoal',paiId:null,ativa:true},
 {id:'sab',nome:'Sabonetes',slug:'sabonetes',paiId:'hig',ativa:true},
 {id:'fral',nome:'Fraldas',slug:'fraldas',paiId:null,ativa:true},
 {id:'geri',nome:'Fraldas geriátricas',slug:'fraldas-geriatricas',paiId:'fral',ativa:true},
 {id:'desc',nome:'Fraldas descartáveis',slug:'fraldas-descartaveis',paiId:'fral',ativa:true},
 {id:'sol',nome:'Proteção solar',slug:'protecao-solar',paiId:null,ativa:true},
 {id:'fac',nome:'Protetor facial',slug:'protetor-facial',paiId:'sol',ativa:true},
 {id:'foto',nome:'Foto',slug:'foto',paiId:null,ativa:false}
];
const docs=[
 {id:'1',nome:'Sabonete Líquido Lavanda 250ml',categoriaId:null,subcategoriaId:null,precoCentavos:1050,estoque:{quantidade:4},imagens:[{url:'/foto1.png'}]},
 {id:'2',nome:'Fralda geriátrica tamanho G',categoriaId:null,subcategoriaId:null,precoCentavos:2000},
 {id:'3',nome:'Fralda bebê descartável Personal',categoriaId:null,subcategoriaId:null},
 {id:'4',nome:'Protetor solar facial FPS 50',categoriaId:null,subcategoriaId:null},
 {id:'5',nome:'Produto vitaminas <script>',categoriaId:null,subcategoriaId:null},
 {id:'6',nome:'Produto já categorizado',categoriaId:'hig',subcategoriaId:'sab'},
 {id:'7',nome:'Sabonete arquivado',categoriaId:null,inovaArquivado:{em:'2026-11-01'}},
 {id:'8',nome:'Fralda sabonete misto',categoriaId:null},
 {id:'9',nome:'Antibiótico em sabonete',categoriaId:null},
];
const db=()=>{
 const itens=docs.map(x=>structuredClone(x));const cats=categorias.map(x=>({...x}));
 const products={
  all:()=>itens.map(x=>({...x})),
  get:id=>itens.find(x=>x.id===id)||null,
  update(id,patch){const p=itens.find(x=>x.id===id);Object.assign(p,patch);return p;},
 };
 const category={all:()=>cats.map(x=>({...x}))};
 return {itens,cats,storage:{transactionSync:fn=>fn()},
  collections:new Map(),
  collection:n=>n==='products'?products:n==='categories'?category:null};
};
test('classifica somente correspondências sem ambiguidade, dentro das categorias existentes',()=>{
 assert.equal(sugerirCategoriaProduto(docs[0],categorias).subcategoriaId,'sab');
 assert.equal(sugerirCategoriaProduto(docs[1],categorias).subcategoriaId,'geri');
 assert.equal(sugerirCategoriaProduto(docs[2],categorias).subcategoriaId,'desc');
 assert.equal(sugerirCategoriaProduto(docs[3],categorias).subcategoriaId,'fac');
 for(const i of [4,5,6,7,8])assert.equal(sugerirCategoriaProduto(docs[i],categorias),null);
});
test('prévia não altera produtos, preserva preços/estoque/fotos e categorias prévias',()=>{
 const banco=db();
 const antes=structuredClone(banco.itens);
 const p=planejarCategoriasProdutos(banco);
 assert.equal(p.resumo.sugeridos,4);
 assert.equal(p.resumo.semCategoria,7);
 assert.equal(p.resumo.paraRevisao,3);
 assert.deepEqual(banco.itens,antes);
 assert.match(p.fingerprint,/^[a-f0-9]{64}$/);
});
test('aplicação exige frase e fingerprint, revalida mudanças antes da escrita',()=>{
 const banco=db();
 const p=planejarCategoriasProdutos(banco);
 assert.equal(aplicarCategoriasProdutos(banco,{
  fingerprint:p.fingerprint,confirmacao:'não',operadorId:'super_admin'
 }).status,400);
 assert.equal(banco.itens[0].categoriaId,null);
 banco.itens[0].nome='Produto alterado entre conferência e aplicação';
 const erro=aplicarCategoriasProdutos(banco,{
  fingerprint:p.fingerprint,confirmacao:'CLASSIFICAR PRODUTOS',operadorId:'super_admin'
 });
 assert.equal(erro.status,409);
 assert.equal(banco.itens[1].categoriaId,null);
});
test('aplicação confirma somente categoria/subcategoria sem modificar nenhum outro campo',()=>{
 const banco=db(),antes=structuredClone(banco.itens);
 const p=planejarCategoriasProdutos(banco);
 const saida=aplicarCategoriasProdutos(banco,{
  fingerprint:p.fingerprint,confirmacao:'CLASSIFICAR PRODUTOS',operadorId:'super_admin'
 });
 assert.equal(saida.ok,true);
 assert.equal(saida.atualizados,4);
 const campoExtraido=doc=>{const x={...doc};delete x.categoriaId;delete x.subcategoriaId;return x;};
 banco.itens.forEach((item,i)=>assert.deepEqual(campoExtraido(item),campoExtraido(antes[i])));
 assert.equal(banco.itens[5].categoriaId,'hig');
 assert.equal(banco.itens[6].categoriaId,null);
 assert.equal(banco.itens[7].categoriaId,null);
});
test('categoria desativada não é atribuída e informação de produto sem categoria não é inventada',()=>{
 const cats=categorias.filter(x=>x.id!=='sab');
 assert.equal(sugerirCategoriaProduto(docs[0],cats),null);
 assert.equal(sugerirCategoriaProduto({...docs[0],nome:'Dipirona 500mg'},categorias),null);
});
