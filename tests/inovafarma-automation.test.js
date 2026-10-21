import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { config } from '../src/config.js';
import {
  avaliarAutomacaoInova, registrarAtividadeConectorInova, statusAutomaticoInova,
} from '../src/lib/inovafarma-automation.js';
import { confirmarVendasInova, vendasPendentesInova } from '../src/lib/inovafarma-stock.js';
import { diagnosticoInova } from '../src/lib/inovafarma-panel.js';
import { telaIntegracaoInova } from '../src/views/admin/inovafarma.js';

class DB {
  constructor() { this.cols=new Map(); }
  collection(n) {
    if(!this.cols.has(n))this.cols.set(n,new Collection({_commit(){}},n));
    return this.cols.get(n);
  }
}
const old = { ...config.inova };
test.after(()=>{config.inova={...old}});
function setup() {
  config.inova={...old,enabled:false,maxAgeMinutes:15};
  const db=new DB();
  db.collection('products').insert({id:'produto-1',nome:'Produto',ean:'7891234567890',
    ativo:true,estoque:{quantidade:7,inovaQuantidade:7}});
  db.collection('orders').insert({id:'venda-1',codigo:'PP1',inovaEnvioPendente:true,
    statusFinanceiro:'aprovado',statusOperacional:'em_separacao',criadoEm:'2026-10-21T18:00:00Z',
    vendedor:{id:'v1',nome:'Ana',codigoInova:'00125'},itens:[{produtoId:'produto-1',quantidade:2}],
    totalCentavos:4800});
  return db;
}

test('módulos automáticos não ligam integração nem consultam ERP apenas por ter URL/token',()=>{
  const db=setup();
  const r=avaliarAutomacaoInova(db,{persistir:true});
  assert.equal(r.status,'aguardando_homologacao');
  assert.equal(r.habilitada,false);
  assert.equal(db.collection('inovaAutomationMeta').all().length,0);
  assert.equal(db.collection('inovaAutomationEvents').all().length,0);
  const d=diagnosticoInova(db);
  assert.equal(d.ultimaConexaoValidada,null);
  assert.equal(d.status,'desativada');
  assert.equal(config.inova.enabled,false);
});

test('após ativação autorizada alarmes detectam estoque vencido, EAN e vendas problemáticas',()=>{
  const db=setup();config.inova.enabled=true;
  db.collection('orders').insert({id:'estornado',codigo:'PP2',inovaEnvioPendente:true,
    statusFinanceiro:'estornado',statusOperacional:'enviado',
    itens:[{produtoId:'produto-1',quantidade:1}]});
  db.collection('products').insert({id:'sem-ean',ativo:true,ean:'',estoque:{quantidade:5}});
  const primeira=avaliarAutomacaoInova(db,{agora:Date.parse('2026-10-21T19:00:00Z'),persistir:true});
  assert.equal(primeira.status,'atencao');
  assert.equal(primeira.estoqueDesatualizado,true);
  assert.equal(primeira.vendasAguardando,1);
  assert.equal(primeira.vendasParaConferir,1);
  assert(primeira.problemas.includes('estoque_desatualizado'));
  assert(primeira.problemas.includes('ean_incompleto'));
  assert.equal(db.collection('inovaAutomationEvents').all().length,1);
  avaliarAutomacaoInova(db,{agora:Date.parse('2026-10-21T19:01:00Z'),persistir:true});
  assert.equal(db.collection('inovaAutomationEvents').all().length,1,
    'alarme não pode criar log duplicado se estado não mudou');
  assert.equal(statusAutomaticoInova(db).ultimaAvaliacaoEm,'2026-10-21T19:01:00.000Z');
});

test('webhook autenticado e aceito atualiza última comunicação e contadores sem segredos',()=>{
  const db=setup();const data='2026-10-21T18:04:00.000Z';
  assert.equal(registrarAtividadeConectorInova(db,'estoque_recebido',{quantidade:12,data}).ok,true);
  assert.equal(registrarAtividadeConectorInova(db,'vendas_confirmadas',{quantidade:1,data}).ok,true);
  registrarAtividadeConectorInova(db,'falha_validacao_estoque',{data});
  const meta=db.collection('inovaAutomationMeta').get('inovafarma');
  assert.equal(meta.ultimaConexaoValidada,data);
  assert.equal(meta.ultimaSincronizacaoSucessoEm,data);
  assert.equal(meta.produtosAtualizadosAcumulado,12);
  assert.equal(meta.vendasConfirmadasAcumulado,1);
  assert.equal(meta.falhasValidacao,1);
  assert.equal(db.collection('inovaAutomationEvents').all().length,3);
  const html=JSON.stringify(db.collection('inovaAutomationEvents').all());
  assert(!html.includes('Authorization')&&!html.includes('TOKEN'));
  assert.throws(()=>registrarAtividadeConectorInova(db,'tipo_externo',{data}));
});

test('histórico automático fica limitado a 100 eventos mesmo com muitas tentativas',()=>{
  const db=setup();
  for(let i=0;i<104;i++)registrarAtividadeConectorInova(db,'falha_validacao_vendas',
    {data:new Date(1_790_000_000_000+i*1000).toISOString()});
  assert.equal(db.collection('inovaAutomationEvents').all().length,100);
  assert.equal(statusAutomaticoInova(db).falhasValidacao,104);
});

test('ERP nunca recebe venda estornada/cancelada e referências são únicas/idempotentes',()=>{
  const db=setup();
  for(const [id,statusFinanceiro,statusOperacional] of [
    ['estornada','estornado','enviado'],
    ['reembolso','estorno_solicitado','enviado'],
    ['cancelada','aprovado','cancelado'],
  ]) {
    db.collection('orders').insert({id,codigo:id,inovaEnvioPendente:true,
      statusFinanceiro,statusOperacional,itens:[{produtoId:'produto-1',quantidade:1}]});
  }
  config.inova.enabled=true;
  const pendentes=vendasPendentesInova(db);
  assert.deepEqual(pendentes.map(x=>x.pedidoId),['venda-1']);
  assert.equal(pendentes[0].vendedor.codigoInova,'00125');
  assert.equal(confirmarVendasInova(db,{vendas:[
    {pedidoId:'estornada',referenciaInova:'R1'}]}).status,409);
  assert.equal(confirmarVendasInova(db,{vendas:[
    {pedidoId:'venda-1',referenciaInova:'R-ABC'}]}).confirmadas,1);
  assert.equal(confirmarVendasInova(db,{vendas:[
    {pedidoId:'venda-1',referenciaInova:'R-ABC'}]}).duplicadas,1);
  db.collection('orders').insert({id:'venda-2',codigo:'PP2',inovaEnvioPendente:true,
    statusFinanceiro:'aprovado',statusOperacional:'enviado',itens:[]});
  assert.equal(confirmarVendasInova(db,{vendas:[
    {pedidoId:'venda-2',referenciaInova:'R-ABC'}]}).status,409);
  assert(!db.collection('orders').get('venda-2').inovaConfirmadoEm);
});

test('módulos 2-7 exibem estado dinâmico sem afirmar conexão falsa',()=>{
  const db=setup();config.inova.enabled=true;
  const antes=diagnosticoInova(db);
  assert.equal(antes.status,'aguardando_primeira_comunicacao');
  registrarAtividadeConectorInova(db,'estoque_recebido',{quantidade:1});
  db.collection('inovaSyncMeta').insert({id:'estoque',recebidoEm:new Date().toISOString()});
  const depois=diagnosticoInova(db);
  assert.equal(depois.status,'conectada_por_conector');
  assert(depois.ultimaConexaoValidada);
  const view=telaIntegracaoInova({
    db,settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{}},
    adminUser:{id:'admin',role:'super_admin'},csrf:'teste',req:{pathname:'/admin/inovafarma'},
  },{dados:depois});
  assert.match(view,/Última comunicação autenticada/);
  assert.match(view,/Vendedores ativos/);
  assert.match(view,/estoque_recebido/);
  assert.match(view,/Sincronizar estoque agora — aguardando homologação/);
});

test('Cloudflare agenda somente monitoramento local e conector continua dependente de homologação',()=>{
  const worker=readFileSync(new URL('../src/cloudflare/worker.js',import.meta.url),'utf8');
  assert.match(worker,/avaliarAutomacaoInova\(this\.db, \{ persistir: true \}\)/);
  assert.match(worker,/!config\.inova\?\.enabled/);
  const routes=readFileSync(new URL('../src/routes/inovafarma.js',import.meta.url),'utf8');
  assert.match(routes,/if \(!autenticar\(req, res\)\) return/);
  assert.match(routes,/registrarAtividadeConectorInova/);
  const code=readFileSync(new URL('../src/lib/inovafarma-automation.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(/);
  assert.doesNotMatch(code,/INOVA_STOCK_ENABLED\s*=\s*true/);
});
