import test from 'node:test';
import assert from 'node:assert/strict';
import {identificarPossivelControlado, avaliarUltimoRelatorioControlados} from '../src/lib/triagem-controlados.js';

function bd() {
  const dados = new Map();
  return {
    collection(nome) {
      if (!dados.has(nome)) dados.set(nome, new Map());
      const mapa = dados.get(nome);
      return {
        get: id => mapa.get(id) || null,
        insert: doc => mapa.set(doc.id, doc),
      };
    },
  };
}
test('identifica exemplo clonazepam e nomes compostos sem depender de tarja no CSV', () => {
  assert.deepEqual(identificarPossivelControlado('CLONAZEPAM 2MG 30 COMPRIMIDOS'), ['clonazepam']);
  assert.deepEqual(identificarPossivelControlado('Diazepam 10 mg + Clonazepam'), ['clonazepam','diazepam']);
  assert.deepEqual(identificarPossivelControlado('GENÉRICO', 'METILFENIDATO'), ['metilfenidato']);
});
test('evita combinação parcial de palavras e não inventa princípio ativo por marca', () => {
  assert.deepEqual(identificarPossivelControlado('clonazepamina'), []);
  assert.deepEqual(identificarPossivelControlado('Rivotril 2mg'), []);
  assert.deepEqual(identificarPossivelControlado('Vitamina C 500mg'), []);
});
test('produz apenas relatório de suspeitas; não altera o cadastro ou estoque', () => {
  const db = bd();
  db.collection('inovaRoboConfiguracao').insert({id:'principal',ultimaExecucao:'hash'});
  db.collection('inovaRoboExecucoes').insert({id:'hash',status:'concluido',blocos:1,total:3,geradoEm:'2026-10-29T12:00:00-03:00'});
  const items=[
    {codigoInterno:'1',nome:'Clonazepam 2mg',ean:'7890000000001'},
    {codigoInterno:'2',nome:'Sabonete líquido',ean:'7890000000002'},
    {codigoInterno:'3',nome:'Alprazolam 1mg',ean:'7890000000003'},
  ];
  db.collection('inovaRoboBlocos').insert({id:'hash:0',aplicadoEm:'2026-10-29T15:01:00Z',items});
  const res=avaliarUltimoRelatorioControlados(db,{pagina:2,porPagina:1});
  assert.equal(res.disponivel,true);
  assert.equal(res.analisados,3);
  assert.equal(res.total,2);
  assert.equal(res.paginas,2);
  assert.equal(res.itens.length,1);
  assert.deepEqual(db.collection('inovaRoboBlocos').get('hash:0').items,items);
});
test('não conclui triagem se arquivo incompleto', () => {
  const db = bd();
  db.collection('inovaRoboConfiguracao').insert({id:'principal',ultimaExecucao:'hash'});
  db.collection('inovaRoboExecucoes').insert({id:'hash',status:'aplicando',blocos:1,total:1});
  assert.equal(avaliarUltimoRelatorioControlados(db).disponivel,false);
  db.collection('inovaRoboExecucoes').insert({id:'hash',status:'concluido',blocos:1,total:1});
  assert.equal(avaliarUltimoRelatorioControlados(db).disponivel,false);
});
