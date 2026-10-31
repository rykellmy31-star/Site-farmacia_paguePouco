import test from 'node:test';
import assert from 'node:assert/strict';
import {Collection} from '../src/lib/store.js';
import {temReceitaAutomaticaInova,corrigirReceitaAutomaticaInova}
  from '../src/lib/inovafarma-receita-automatica.js';
import {podeAtivarAposAprovacao} from '../src/lib/catalog.js';

function dbTeste(){
  const c=new Map();
  return {collection(nome){
    if(!c.has(nome))c.set(nome,new Collection({_commit(){}},nome));
    return c.get(nome);
  }};
}
const original=(id,extra={})=>({
  id,nome:'Produto do Inova',ativo:false,
  inovaCatalogo:{revisaoSanitariaPendente:true,origem:'substituicao_total_csv'},
  sanitario:{classificacao:'nao_aplicavel',requerReceita:true,
    registroMS:'',aprovadoFarmaceutico:false,controlado:false},
  ...extra,
});
test('corrige somente placeholder automático importado sem publicar nem aprovar',()=>{
  const db=dbTeste();
  const col=db.collection('products');
  col.insert(original('sem-revisao'));
  col.insert(original('controlado',{sanitario:{
    ...original('x').sanitario,controlado:true}}));
  col.insert(original('revisado',{sanitario:{
    ...original('x').sanitario,aprovadoFarmaceutico:true}}));
  col.insert(original('manual',{sanitario:{
    ...original('x').sanitario,principioAtivo:'substancia',registroMS:'123'}}));
  col.insert(original('ativo',{ativo:true}));
  col.insert(original('fora-inova',{inovaCatalogo:null}));
  assert.equal(temReceitaAutomaticaInova(col.get('sem-revisao')),true);
  const r=corrigirReceitaAutomaticaInova(db);
  assert.equal(r.corrigidos,1);
  assert.equal(col.get('sem-revisao').sanitario.requerReceita,false);
  assert.equal(col.get('sem-revisao').ativo,false);
  assert.equal(col.get('sem-revisao').inovaCatalogo.revisaoSanitariaPendente,true);
  assert.equal(podeAtivarAposAprovacao(col.get('sem-revisao')).codigo,'REVISAO_SANITARIA_INOVA');
  for(const id of ['controlado','revisado','manual','ativo','fora-inova'])
    assert.equal(col.get(id).sanitario.requerReceita,true,id);
  assert.equal(corrigirReceitaAutomaticaInova(db).jaExecutada,true);
  assert.equal(db.collection('__meta').get('inova-receita-placeholder-v1').corrigidos,1);
});
