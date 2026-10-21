import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { pendenciasFinanceiras, registrarCicloFinanceiro, diagnosticoFinanceiro } from '../src/lib/payments/ops-health.js';

class DB {
  constructor() { this.collections=new Map(); }
  collection(n){
    if(!this.collections.has(n))this.collections.set(n,new Collection({_commit(){}},n));
    return this.collections.get(n);
  }
}
function construir(){
  const db=new DB();
  const docs=[
    {id:'pix-1',metodoPagamento:'pix',statusFinanceiro:'pendente',pagamentoId:'mp-1'},
    {id:'pix-2',metodoPagamento:'pix',statusFinanceiro:'aprovado',pagamentoId:'mp-2'},
    {id:'estorno-1',statusFinanceiro:'estorno_solicitado'},
    {id:'checkout-1',statusFinanceiro:'pendente',metodoPagamento:'pix',pendenciaPagamento:'criacao_em_andamento'},
    {id:'manual-1',statusFinanceiro:'pendente',pendenciaPagamento:'conciliacao_necessaria'},
  ];
  for(const p of docs)db.collection('orders').insert(p);
  return db;
}

test('painel registra quantidades de pendências e não exporta dados dos clientes',()=>{
  const db=construir();
  assert.deepEqual(pendenciasFinanceiras(db),{
    pixPendentes:1,estornosPendentes:1,checkoutsInterrompidos:1,conferencias:1,
  });
  const antes=diagnosticoFinanceiro(db);
  assert.equal(antes.situacao,'sem_execucao_registrada');
  assert.equal(antes.ultimaExecucaoEm,null);
});

test('telemetria armazena somente contadores inteiros válidos sem pedidos, tokens ou mensagens externas',()=>{
  const db=construir();
  const res=registrarCicloFinanceiro(db,{
    resultados:{
      pedidos:{recuperados:1,sinalizados:0,segredo:'TOKEN-NAO-SALVAR'},
      pix:{verificados:3,erros:0,valorCentavos:9100,nomeCliente:'CONFIDENCIAL'},
      estornos:{verificados:2,confirmados:1,erros:0},
    },
    falhas:['pix','excecao-com-TOKEN','estornos'],
  });
  assert.equal(res.situacao,'atencao');
  assert.deepEqual(res.falhas,['pix','estornos']);
  assert.equal(db.collection('financeAlarmHealth').count(),1);
  const stored=JSON.stringify(db.collection('financeAlarmHealth').all());
  assert.doesNotMatch(stored,/CONFIDENCIAL|9100|TOKEN-NAO-SALVAR|excecao-com-TOKEN/);
  assert.equal(diagnosticoFinanceiro(db).resultados.pix.verificados,3);
  registrarCicloFinanceiro(db,{resultados:{pix:{verificados:2,erros:1}}});
  assert.equal(db.collection('financeAlarmHealth').count(),1);
  assert.equal(diagnosticoFinanceiro(db).situacao,'atencao');
  registrarCicloFinanceiro(db,{resultados:{pix:{verificados:1,erros:0}}});
  assert.equal(diagnosticoFinanceiro(db).situacao,'concluida');
});

test('Worker persiste ciclo antes de alarmes sem revelar mensagem de erro original',()=>{
  const c=readFileSync(new URL('../src/cloudflare/worker.js',import.meta.url),'utf8');
  assert.match(c,/registrarCicloFinanceiro\(this\.db, \{ resultados, falhas \}\)/);
  assert.match(c,/await this\.db\.flush\(\)/);
  assert.doesNotMatch(c,/console\.error\('\[worker\] falha ao atender requisição:', err\.message\)/);
  assert.match(c,/registrar: \(fluxo\)/);
});
