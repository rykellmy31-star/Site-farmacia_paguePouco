import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import {
  receberCatalogoInova, listarCandidatosInova, revisarCandidatoInova,
} from '../src/lib/inovafarma-catalog-import.js';
import { telaImportacaoCatalogoInova } from '../src/views/admin/inovafarma-catalog.js';
import { podeVender } from '../src/lib/catalog.js';
import { config } from '../src/config.js';
import { importarEstoqueInova } from '../src/lib/inovafarma-stock.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(n) {
    if(!this.cols.has(n)) this.cols.set(n,new Collection({_commit(){}},n));
    return this.cols.get(n);
  }
}
const ean='7891234567890', ean2='7891234567891';
const now=()=>new Date().toISOString();
const item=(e=ean,patch={})=>({
  ean:e,nome:'Sabonete de exemplo',codigoInterno:'00125',
  marca:'Marca Teste',precoCentavos:1299,quantidade:12,...patch,
});
const lote=(id='catalogo-20261021-001',items=[item()],stamp=now())=>({
  loteId:id,geradoEm:stamp,itens:items,
});
const receber=(db,payload=lote())=>receberCatalogoInova(db,payload);

test('primeira importação em lote cria só candidatos para revisão, nunca produtos públicos',()=>{
  const db=new DB();
  const r=receber(db,lote('catalogo-20261021-01',[item(),item(ean2,{quantidade:0})]));
  assert.equal(r.ok,true);
  assert.equal(r.novos,2);
  assert.equal(db.collection('products').count(),0);
  const lista=listarCandidatosInova(db);
  assert.equal(lista.total,1,'por padrão só mostra produtos com saldo no ERP');
  assert.equal(lista.candidatos[0].ean,ean);
  assert.equal(listarCandidatosInova(db,{saldo:'todos'}).total,2);
});

test('repetição de lote e sincronizações posteriores são idempotentes',()=>{
  const db=new DB();
  let r=receber(db);
  assert.equal(r.novos,1);
  r=receber(db);
  assert.equal(r.duplicado,true);
  r=receber(db,lote('catalogo-20261021-002',[item(ean,{quantidade:5,precoCentavos:1999})]));
  assert.equal(r.atualizados,1);
  const candidato=db.collection('inovaCatalogCandidates').get('inova-ean:'+ean);
  assert.equal(candidato.quantidade,5);
  assert.equal(candidato.precoCentavos,1999);
  assert.equal(db.collection('inovaCatalogCandidates').count(),1);
  assert.equal(receber(db,lote('catalogo-20261021-000',[item()],new Date(0).toISOString())).status,409);
});

test('lote inválido falha inteiro: EAN duplicado, saldo inválido e código suspeito',()=>{
  for(const itens of [
    [item(),item(ean)],
    [item('EAN-RUIM')],
    [item(ean,{nome:'<script>alert(1)</script>'})],
    [item(ean,{quantidade:-1})],
    [item(ean,{precoCentavos:1.90})],
    [item(ean,{codigoInterno:'<invalid>'})],
    [item(),item(ean2,{precoCentavos:-2})],
  ]){
    const db=new DB();
    const r=receber(db,lote('catalogo-20261021-001',itens));
    assert.equal(r.ok,false,'lote inválido aceito: '+JSON.stringify(itens));
    assert.equal(db.collection('inovaCatalogCandidates').count(),0);
    assert.equal(db.collection('inovaCatalogBatches').count(),0);
  }
});

test('superadmin importar: cria produto inicialmente inativo, zerado e com revisão sanitária obrigatória',()=>{
  const db=new DB();receber(db);
  const aprovado=revisarCandidatoInova(db,ean,'importar');
  assert.equal(aprovado.ok,true);
  assert.equal(aprovado.resultado,'importado');
  assert.equal(db.collection('products').count(),1);
  const p=db.collection('products').get(aprovado.produtoId);
  assert.equal(p.ativo,false);
  assert.equal(p.estoque.quantidade,0);
  assert.equal(p.estoque.reservado,0);
  assert.equal(p.precoCentavos,1299);
  assert.equal(p.codigoInterno,'00125');
  assert.equal(p.ean,ean);
  assert.equal(p.sanitario.requerReceita,true);
  assert.equal(p.sanitario.aprovadoFarmaceutico,false);
  assert.equal(podeVender(p).ok,false);
  assert.equal(revisarCandidatoInova(db,ean,'importar').ok,false);
  assert.equal(db.collection('products').count(),1);
  // Produtos importados podem receber saldo apenas do snapshot oficial autorizado.
  const old={...config.inova};
  try{
    config.inova={...old,enabled:true,maxAgeMinutes:15};
    const r=importarEstoqueInova(db,{
      loteId:'estoque-20261021-001',geradoEm:now(),
      itens:[{ean,quantidade:12}],pedidosRefletidos:[],
    });
    assert.equal(r.ok,true);
    assert.equal(db.collection('products').get(p.id).estoque.quantidade,12);
    assert.equal(db.collection('products').get(p.id).ativo,false);
  }finally{config.inova=old;}
});

test('produtos já existentes não têm nome, preço, estoque ou status sobrescritos',()=>{
  const db=new DB();
  db.collection('products').insert({id:'p-original',ean,nome:'Nome local',ativo:true,
    precoCentavos:3000,estoque:{quantidade:8,reservado:2}});
  receber(db);
  const r=revisarCandidatoInova(db,ean,'importar');
  assert.equal(r.resultado,'vinculado');
  assert.equal(r.produtoId,'p-original');
  assert.equal(db.collection('products').count(),1);
  const p=db.collection('products').get('p-original');
  assert.equal(p.nome,'Nome local');
  assert.equal(p.precoCentavos,3000);
  assert.equal(p.estoque.quantidade,8);
  assert.equal(p.ativo,true);
});

test('conflito de EAN duplicado no site bloqueia importação e nenhuma cópia é criada',()=>{
  const db=new DB();
  db.collection('products').insert({id:'a',ean,nome:'A'});
  db.collection('products').insert({id:'b',ean,nome:'B'});
  receber(db);
  assert.equal(listarCandidatosInova(db).candidatos[0].conflitoEAN,true);
  const r=revisarCandidatoInova(db,ean,'importar');
  assert.equal(r.ok,false);
  assert.equal(db.collection('products').count(),2);
});

test('ignorar só altera a fila e não reabre a seleção com lote novo',()=>{
  const db=new DB();receber(db);
  assert.equal(revisarCandidatoInova(db,ean,'ignorar').resultado,'ignorado');
  assert.equal(receber(db,lote('catalogo-20261021-002',[item(ean,{quantidade:7})])).ignorados,1);
  assert.equal(db.collection('inovaCatalogCandidates').get('inova-ean:'+ean).situacao,'ignorado');
  assert.equal(revisarCandidatoInova(db,ean,'importar').ok,false);
  assert.equal(db.collection('products').count(),0);
});

test('tela de revisão tem filtros, seleção em massa, sem publicação automática nem cliente',()=>{
  const db=new DB();receber(db);
  const html=telaImportacaoCatalogoInova({
    db,settings:{tema:{},empresa:{nomeFantasia:'Pague Pouco'}},
    adminUser:{id:'adm',role:'super_admin',nome:'Super'},
    csrf:'teste-seguro',req:{query:new URLSearchParams()},
  },{lista:listarCandidatosInova(db),busca:'',situacao:'',saldo:'disponivel'});
  assert.match(html,/Importação de produtos — InovaFarma/);
  assert.match(html,/action="\/admin\/produtos\/inovafarma\/revisar"/);
  assert.match(html,/name="eans\[\]"/);
  assert.match(html,/Importar selecionados \(inativos\)/);
  assert.match(html,/7891234567890/);
  assert.match(html,/estoque local zero/);
  assert.doesNotMatch(html,/publicado automaticamente/i);
});

test('rota privada só recebe lotes com conector autenticado e integração habilitada',()=>{
  const route=readFileSync(new URL('../src/routes/inovafarma.js',import.meta.url),'utf8');
  assert.match(route,/app\.post\('\/webhooks\/inovafarma\/catalogo'/);
  assert.match(route,/if \(!autenticar\(req, res\)\) return/);
  assert.match(route,/receberCatalogoInova\(db, req\.body\)/);
  const code=readFileSync(new URL('../src/lib/inovafarma-catalog-import.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(/);
});
