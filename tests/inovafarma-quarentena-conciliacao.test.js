import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {conciliarQuarentenaSubstituicaoInova,
  identificarBloqueiosSubstituicaoInova} from '../src/lib/inovafarma-catalogo-substituicao.js';
import {detalhesPendenciasSubstituicao,
  telaPendenciasSubstituicaoInova} from '../src/views/admin/substituir-catalogo-inova.js';

const form={
  destino:'divergencia_inventario',
  justificativa:'Contagem fisica assinada: unidade nao localizada no estoque da loja.',
  confirmacao:'CONCILIAR QUARENTENA',
  conferenciaFisica:'1',backupConfirmado:'1',
  saldoAnterior:'3',quarentenaAnterior:'1',
};
const cancelado=(id)=>({id,statusFinanceiro:'recusado',statusOperacional:'cancelado',
  itens:[{produtoId:'p1',quantidade:1}]});
function dbFake({saldo=3,quarentena=1,reservado=0,inovaPendente=0,
  pedidos=[cancelado('pedido01'),cancelado('pedido02')]}={}){
  let inserted=0,shouldFail=false;
  const collections=new Map([
    ['products',[{id:'p1',codigoInterno:'PP-1036',nome:'Absorvente noturno 24 unidades',
      estoque:{quantidade:saldo,quarentena,reservado,inovaPendente}}]],
    ['orders',structuredClone(pedidos)],['carts',[]],['stockMovements',[]],
  ]);
  const db={
    collections:new Map(),
    collection(name){
      if(!collections.has(name))collections.set(name,[]);
      return{
        all:()=>collections.get(name).slice(),
        get:id=>collections.get(name).find(x=>x.id===id)||null,
        update:(id,patch)=>{
          const doc=collections.get(name).find(x=>x.id===id);
          if(!doc)return null;
          Object.assign(doc,patch);return doc;
        },
        insert:doc=>{
          if(shouldFail)throw new Error('Falha simulada no movimento');
          const x={...doc,id:doc.id||'auto'+(++inserted)};
          collections.get(name).push(x);return x;
        },
      };
    },
    storage:{
      transactionSync(fn){
        const before=structuredClone([...collections.entries()]);
        try{return fn();}
        catch(e){
          collections.clear();
          for(const [name,data] of before)collections.set(name,data);
          throw e;
        }
      }
    },
  };
  return {db,failInsert:()=>{shouldFail=true;}};
}
test('pedidos recusados e cancelados nao bloqueiam baixa fisica comprovada',()=>{
  const {db}=dbFake();
  const pendencias=identificarBloqueiosSubstituicaoInova(db);
  assert.equal(pendencias.pedidos.length,0);
  assert.equal(pendencias.produtos[0].quarentena,1);
  assert.equal(pendencias.produtos[0].saldo,3);
  const antes=structuredClone(db.collection('orders').all());
  const r=conciliarQuarentenaSubstituicaoInova(db,'p1',form,'super1');
  assert.equal(r.baixa,1);
  assert.equal(r.saldoAtual,2);
  assert.deepEqual(db.collection('orders').all(),antes,'pedidos intactos');
  assert.equal(db.collection('products').get('p1').estoque.quarentena,0);
  const movimento=db.collection('stockMovements').all()[0];
  assert.equal(movimento.tipo,'baixa_quarentena');
  assert.equal(movimento.quarentenaAntes,1);
  assert.equal(movimento.quarentenaDepois,0);
  assert.equal(movimento.usuarioId,'super1');
  assert.equal(movimento.destino,'divergencia_inventario');
  assert.equal(identificarBloqueiosSubstituicaoInova(db).produtos.length,0);
  assert.throws(()=>conciliarQuarentenaSubstituicaoInova(db,'p1',form,'super1'),
    /inconsistente ou ainda comprometido/,'nao pode repetir baixa');
});

test('sem evidencia, backup e frase de consentimento nao altera estoque',()=>{
  const {db}=dbFake();
  for(const patch of [
    {confirmacao:''},{backupConfirmado:''},{conferenciaFisica:''},
    {destino:'liberar_para_venda'},{justificativa:'x'},
  ]){
    assert.throws(()=>conciliarQuarentenaSubstituicaoInova(
      db,'p1',{...form,...patch},'super1'),/Confirme a contagem fisica/);
  }
  assert.equal(db.collection('products').get('p1').estoque.quantidade,3);
  assert.equal(db.collection('stockMovements').all().length,0);
});

test('produto reservado, pedido em aberto e saldo fisico inconsistente impedem baixa',()=>{
  for(const overrides of [
    {reservado:1},{inovaPendente:1},{saldo:0},
    {pedidos:[{id:'pix',statusFinanceiro:'pendente',statusOperacional:'aguardando_pagamento'}]},
    {pedidos:[{id:'pago',statusFinanceiro:'aprovado',statusOperacional:'enviado'}]},
  ]){
    const {db}=dbFake(overrides);
    assert.throws(()=>conciliarQuarentenaSubstituicaoInova(db,'p1',form,'super1'));
    assert.equal(db.collection('stockMovements').all().length,0);
  }
});

test('previa desatualizada bloqueia alteracao; falha reverte movimento e produto',()=>{
  const {db}=dbFake();
  assert.throws(()=>conciliarQuarentenaSubstituicaoInova(db,'p1',{
    ...form,saldoAnterior:'9'},'super1'),/Saldo alterado/);
  const novo=dbFake();
  novo.failInsert();
  assert.throws(()=>conciliarQuarentenaSubstituicaoInova(
    novo.db,'p1',form,'super1'),/transação foi revertida/);
  assert.equal(novo.db.collection('products').get('p1').estoque.quarentena,1);
  assert.equal(novo.db.collection('products').get('p1').estoque.quantidade,3);
  assert.equal(novo.db.collection('stockMovements').all().length,0);
});

test('o botao so e exposto na consulta protegida e exige confirmacoes',()=>{
  const {db}=dbFake();
  const pend=identificarBloqueiosSubstituicaoInova(db);
  const basico=detalhesPendenciasSubstituicao(pend);
  assert.doesNotMatch(basico,/estoque\/quarentena\/conciliar/);
  const ctx={adminUser:{role:'super_admin',nome:'Super'},
    csrf:'TOKEN_SEGURO',settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
    req:{pathname:'/admin/produtos/substituir-catalogo/pendencias',query:new URLSearchParams()}};
  const html=telaPendenciasSubstituicaoInova(ctx,pend);
  assert.match(html,/\/admin\/api\/estoque\/quarentena\/conciliar/);
  assert.match(html,/name="backupConfirmado" value="1"/);
  assert.match(html,/name="conferenciaFisica" value="1"/);
  assert.match(html,/value="TOKEN_SEGURO"/);
  assert.match(html,/CONCILIAR QUARENTENA/);
  const adminSource=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const route=adminSource.split("app.post('/admin/api/estoque/quarentena/conciliar'")[1]
    .split("app.post('/admin/api/estoque/movimentar'")[0];
  assert.match(route,/guardApi\(req,res,'estoque.movimentar'\)/);
  assert.match(route,/req.adminUser.role!=='super_admin'/);
  assert.match(route,/can\(req.adminUser,'produtos.excluir'\)/);
});
