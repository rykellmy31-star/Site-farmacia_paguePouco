import test from 'node:test';
import {TOTAL_PSI_INOVA_20261029,constaPsicotropicoExportadoInova} from '../src/lib/psicotropicos-inova-20261029.js';
import {searchProducts,podeVender} from '../src/lib/catalog.js';
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

test('lista real de 280 codigos e EANs ignora psicotrópicos inclusive pelos nomes comerciais',()=>{
  assert.equal(TOTAL_PSI_INOVA_20261029,280);
  // Akineton: o nome não aparece no conjunto inicial de princípios ativos.
  assert.equal(constaPsicotropicoExportadoInova({codigoInterno:'846991'}),true);
  assert.equal(constaPsicotropicoExportadoInova({ean:'7898940448074'}),true);
  assert.equal(constaPsicotropicoExportadoInova({codigoInterno:'12345678999',ean:'9999999999999'}),false);
});
test('não importa medicamento da lista real do InovaFarma pelo robô e mantém SKU comum',()=>{
  const db=fakeDB();
  configurarRoboInova(db);
  const lista=Array.from({length:3000},(_,i)=>item(i+1));
  lista[0]={...lista[0],codigoInterno:'846991',ean:'7898940448074',
    nome:'AKINETON 4MG CX 30 COMP REV LIB RETARD'};
  const geradoEm=new Date(Date.now()-60000).toISOString(),hash='e'.repeat(64);
  for(let i=0;i<15;i++){
    const resp=receberBlocoRoboInova(db,{arquivoHash:hash,geradoEm,bloco:i,blocos:15,total:3000,
      itens:lista.slice(i*200,(i+1)*200)});
    assert.equal(resp.ok,true);
  }
  const resp=aplicarBlocoRoboInova(db,{arquivoHash:hash,bloco:0});
  assert.equal(resp.ok,true);
  assert.equal(resp.bloqueados,1);
  assert.equal(db.collection('products').all().some(p=>p.codigoInterno==='846991'),false,
    'o psicotrópico não deve ser inserido no cadastro do site');
  assert.equal(db.collection('products').all().some(p=>p.codigoInterno==='800002'),true);
});
test('medicamentos previamente cadastrados deixam de aparecer na loja, sem apagar o histórico',()=>{
  const db=fakeDB();
  const p={id:'psico',codigoInterno:'846991',ean:'7898940448074',slug:'akineton',
    nome:'AKINETON 4MG',ativo:true,precoCentavos:2300,
    estoque:{quantidade:5,reservado:0,quarentena:0},
    sanitario:{classificacao:'nao_aplicavel',aprovadoFarmaceutico:true}};
  const comum={id:'comum',codigoInterno:'999999999',ean:'9999999999999',nome:'Sabonete Teste',
    ativo:true,precoCentavos:400,estoque:{quantidade:5,reservado:0,quarentena:0},
    sanitario:{classificacao:'nao_aplicavel'}};
  db.collection('products').insert(p);
  db.collection('products').insert(comum);
  assert.equal(podeVender(p).ok,false);
  assert.equal(searchProducts(db).total,1);
  assert.equal(searchProducts(db).rows[0].id,'comum');
  assert.equal(db.collection('products').get('psico').estoque.quantidade,5);
  assert.equal(db.collection('products').get('psico').ativo,true);
});
test('CSV InovaFarma da classe PSICOTROPICO aceita capa e ignora os rodapes sem outros produtos',()=>{
  const csv=[
    'POSIÇÃO DE ESTOQUE;;;;;;;;;;;;;;;;;;;;',
    '"Tipo:\r\nEmpresa(s):\r\nClasse terapêutica:";;;"POSIÇÃO DO ESTOQUE\r\nFARMACIA PAGUE POUCO\r\nPSICOTROPICO";;;;;;;;;;;;;;;;;',
    'Código;Cod. Barra;;;Produto;Fabricante;Estoque',
    '846991;7898940448074;;;AKINETON 4MG;FABRICANTE;1',
    '792335;7896004718859;;;ALPRAZOLAM 0,25MG;FABRICANTE;2',
    'ESTOQUE:;;;;;;;;;;;;;;;;;3;;;',
    'Fonte: INOVAFARMA;;Origem: FARMACIA PAGUE POUCO',
  ].join('\r\n');
  const produtos=prepararListaControlados(Buffer.from(csv,'utf8'));
  assert.equal(produtos.length,2);
  assert.deepEqual(produtos.map(p=>p.codigoInterno),['846991','792335']);
  assert.throws(()=>prepararListaControlados(Buffer.from(csv.replace('PSICOTROPICO','ESTOQUE GERAL'))),
    /não está filtrado/);
});
