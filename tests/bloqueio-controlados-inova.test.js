import test from 'node:test';
import assert from 'node:assert/strict';
import {adicionarListaControlados,prepararListaControlados,criarAvaliadorControlados,
  bloquearControladosExistentes} from '../src/lib/bloqueio-controlados-inova.js';
import {podeAtivarAposAprovacao} from '../src/lib/catalog.js';
import {configurarRoboInova,receberBlocoRoboInova,aplicarBlocoRoboInova}
  from '../src/lib/inovafarma-robo-sync.js';

function fakeDB(){
  const col = new Map();
  return {
    collections:new Map(),storage:null,
    collection(name) {
      if(!col.has(name))col.set(name,new Map());
      const map=col.get(name);
      return {
        get:id=>map.get(String(id))||null,
        all:()=>[...map.values()],
        count:()=>map.size,
        insert(doc) {
          const d={...doc,id:doc.id||'id_'+map.size};
          map.set(String(d.id),d);
          return d;
        },
        update(id,patch){
          const v=map.get(String(id));
          if(!v)return null;
          const r={...v,...patch};
          map.set(String(id),r);
          return r;
        },
        find:fn=>[...map.values()].filter(fn),
        findOne:fn=>[...map.values()].find(fn)||null,
      };
    },
  };
}
function item(n){
  return {codigoInterno:String(800000+n),ean:String(7891000000000+n),
    nome:'Produto comum '+n,marca:'Marca',quantidade:4,precoCentavos:500};
}
test('importação CSV aceita Código, Cod. Barra e Produto e permite só lista de nomes',()=>{
  const db=fakeDB();
  const csv=Buffer.from('Código;Cod. Barra;Produto\r\n1001;7891234567890;Psicotrópico Teste\r\n1002;;Outro Teste\r\n','utf8');
  const r=adicionarListaControlados(db,csv);
  assert.equal(r.novos,2);
  assert.equal(adicionarListaControlados(db,csv).novos,0);
  assert.equal(criarAvaliadorControlados(db)({codigoInterno:'1001',nome:'produto X'}).bloqueado,true);
  assert.equal(criarAvaliadorControlados(db)({ean:'7891234567890',nome:'produto Y'}).bloqueado,true);
  assert.equal(criarAvaliadorControlados(db)({nome:'PSICOTROPICO TESTE'}).bloqueado,true);
  assert.equal(prepararListaControlados(Buffer.from('Produto\nCLONAZEPAM 2MG\nRIVOTRIL 2MG\n')).length,2);
});
test('listagem malformada não altera a lista armazenada',()=>{
  const db=fakeDB();
  assert.throws(()=>adicionarListaControlados(db,Buffer.from('Produto\nA\n')),/Nome insuficiente/);
  assert.equal(db.collection('inovaControladosListaBloqueio').count(),0);
  assert.throws(()=>prepararListaControlados(Buffer.from('Sem cabeçalho\nabc\n')),/Colunas não reconhecidas/);
});
test('ativação de produto sinalizado continua barrada mesmo se ativado manualmente',()=>{
  const p={ativo:true,bloqueioControladoInova:{ativo:true},sanitario:{classificacao:'nao_aplicavel'}};
  assert.equal(podeAtivarAposAprovacao(p).codigo,'LISTA_CONTROLADOS');
});
test('bloqueio do catálogo existente preserva estoque e não depende de revisão',()=>{
  const db=fakeDB();
  const p={id:'p1',nome:'Clonazepam 2mg',ean:'',codigoInterno:'19',ativo:true,
    precoCentavos:1200,estoque:{quantidade:14},sanitario:{aprovadoFarmaceutico:true}};
  db.collection('products').insert(p);
  const r=bloquearControladosExistentes(db);
  assert.equal(r.bloqueados,1);
  const out=db.collection('products').get('p1');
  assert.equal(out.ativo,false);
  assert.equal(out.estoque.quantidade,14);
  assert.equal(out.precoCentavos,1200);
  assert.equal(out.bloqueioControladoInova.ativo,true);
  assert.equal(bloquearControladosExistentes(db).jaBloqueados,1);
});
test('robô não cadastra psicotrópicos listados, preserva produtos comuns e inativa controlado já existente',()=>{
  const db=fakeDB();
  configurarRoboInova(db);
  db.collection('products').insert({
    id:'existente-controlado',codigoInterno:'800001',
    ean:'7891000000001',nome:'Medicamento comercial sem princípio',ativo:true,
    precoCentavos:700,estoque:{quantidade:5,reservado:0,quarentena:0}
  });
  adicionarListaControlados(db,Buffer.from('Código;Cod. Barra;Produto\n800001;7891000000001;Med. comercial\n800002;7891000000002;Rivotril teste\n'));
  const lista=Array.from({length:3000},(_,i)=>item(i+1));
  lista[2].nome='CLONAZEPAM 2MG';
  const hash='c'.repeat(64),geradoEm=new Date(Date.now()-60000).toISOString();
  for(let n=0;n<15;n++){
    const resp=receberBlocoRoboInova(db,{
      arquivoHash:hash,total:3000,blocos:15,bloco:n,geradoEm,
      itens:lista.slice(n*200,(n+1)*200),
    });
    assert.equal(resp.ok,true,JSON.stringify(resp));
  }
  const result=aplicarBlocoRoboInova(db,{arquivoHash:hash,bloco:0});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.bloqueados,3);
  assert.equal(db.collection('products').get('existente-controlado').ativo,false);
  assert.equal(db.collection('products').get('existente-controlado').estoque.quantidade,5);
  assert.equal(db.collection('products').all().some(x=>x.codigoInterno==='800002'),false);
  assert.equal(db.collection('products').all().some(x=>x.codigoInterno==='800003'),false);
  assert.equal(db.collection('products').all().some(x=>x.codigoInterno==='800004'),true);
  assert.equal(db.collection('inovaRoboExecucoes').get(hash).bloqueados,3);
});
