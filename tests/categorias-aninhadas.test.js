import test from 'node:test';
import assert from 'node:assert/strict';
import { categoriaPage } from '../src/views/public.js';
import { Collection } from '../src/lib/store.js';
class DB {
  constructor(){ this.cols = new Map(); }
  collection(name){
    if(!this.cols.has(name)) this.cols.set(name, new Collection({_commit(){}},name));
    return this.cols.get(name);
  }
}
test('subcategorias aparecem em todos os niveis e somem somente no ultimo', () => {
  const db=new DB();
  const cats=[
    {id:'raiz',slug:'saude',nome:'Saúde',ativa:true},
    {id:'nivel1',paiId:'raiz',slug:'aparelhos',nome:'Aparelhos de pressão',ativa:true},
    {id:'nivel2',paiId:'nivel1',slug:'digitais',nome:'Digitais',ativa:true},
    {id:'nivel3',paiId:'nivel2',slug:'braco',nome:'Braço',ativa:true},
    {id:'oculto',paiId:'nivel2',slug:'oculto',nome:'Oculto',ativa:false},
  ];
  for(const c of cats) db.collection('categories').insert(c);
  const ctx={db,settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},whatsapp:{},cookies:{}}, req:{pathname:'/categoria/saude'},arvore:[],csrf:'teste'};
  const gerar=cat=>categoriaPage(ctx,{categoria:cat,produtos:[],total:0,pagina:1,porPagina:24,ordenar:'relevancia',filtros:{}});
  assert.match(gerar(cats[0]),/href="\/categoria\/aparelhos"/);
  assert.match(gerar(cats[1]),/href="\/categoria\/digitais"/);
  assert.match(gerar(cats[2]),/href="\/categoria\/braco"/);
  assert.doesNotMatch(gerar(cats[2]),/href="\/categoria\/oculto"/);
  assert.doesNotMatch(gerar(cats[3]),/<h3>Subcategorias<\/h3>/);
});

test('ao acessar lenços permanecem fraldas descartáveis e geriátricas, com breadcrumb completo',()=>{
  const db=new DB();
  const cats=[
    {id:'dep',nome:'Fraldas',slug:'fraldas',ativa:true},
    {id:'lencos',paiId:'dep',nome:'Lenços umedecidos',slug:'lencos-umedecidos',ativa:true},
    {id:'desc',paiId:'dep',nome:'Fraldas descartáveis',slug:'fraldas-descartaveis',ativa:true},
    {id:'ger',paiId:'dep',nome:'Fraldas geriátricas',slug:'fraldas-geriatricas',ativa:true},
    {id:'neto',paiId:'lencos',nome:'Lenços sem perfume',slug:'sem-perfume',ativa:true},
  ];for(const c of cats)db.collection('categories').insert(c);
  const ctx={db,settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},whatsapp:{},cookies:{}},req:{pathname:'/categoria/lencos-umedecidos'},arvore:[],csrf:'teste'};
  const html=categoriaPage(ctx,{categoria:cats[1],produtos:[],total:0,pagina:1,porPagina:24,ordenar:'relevancia',filtros:{}});
  assert.match(html,/Outras categorias de Fraldas/);
  assert.match(html,/href="\/categoria\/fraldas-descartaveis"/);
  assert.match(html,/href="\/categoria\/fraldas-geriatricas"/);
  assert.match(html,/href="\/categoria\/sem-perfume"/);
  assert.match(html,/Fraldas<\/a>/);
});
