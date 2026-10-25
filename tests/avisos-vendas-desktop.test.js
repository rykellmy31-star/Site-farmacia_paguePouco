import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {listarVendasPagasParaAviso} from '../src/lib/avisos-vendas.js';
const agora=Date.parse('2026-10-25T17:00:00Z');
const em='2026-10-25T16:59:00Z';
const pedido=(id,patch={})=>({
  id,codigo:'PP'+id,statusFinanceiro:'aprovado',totalCentavos:1990,
  historico:[{tipo:'financeiro',status:'aprovado',em}],...patch,
});
const db=pedidos=>({collection:n=>{assert.equal(n,'orders');return {all:()=>pedidos};}});
test('somente vendas pagas e não recebidas continuam no alerta',()=>{
  const pedidos=[pedido('1'),pedido('2',{pedidoRecebidoEm:em}),
    pedido('3',{statusFinanceiro:'pendente'}),pedido('4',{statusFinanceiro:'estornado'}),
    pedido('5',{historico:[]}),pedido('6',{historico:[{tipo:'financeiro',status:'aprovado',em:'2026-10-01T12:00:00Z'}]})];
  assert.deepEqual(listarVendasPagasParaAviso(db(pedidos),{agoraMs:agora}).map(x=>x.id),['1','6']);
});
test('API omite dados pessoais e não muda status financeiro',()=>{
  const lista=listarVendasPagasParaAviso(db([pedido('1',{cliente:{cpf:'00000000000'}})]),{agoraMs:agora});
  assert.deepEqual(Object.keys(lista[0]).sort(),['aprovadoEm','codigo','id','totalCentavos']);
  assert.doesNotMatch(JSON.stringify(lista),/00000000000/);
});
test('recebimento exige permissão, grava funcionário e evita repetição',()=>{
  const rota=fs.readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const vista=fs.readFileSync(new URL('../src/views/admin/vendas.js',import.meta.url),'utf8');
  assert.match(rota,/app\.post\('\/admin\/pedidos\/:id\/recebido'/);
  assert.match(rota,/guard\(req, res, 'pedidos\.editar'\)/);
  assert.match(rota,/if \(!pedido\.pedidoRecebidoEm\)/);
  assert.match(rota,/pedidoRecebidoPor: req\.adminUser\.id/);
  assert.match(rota,/logAdmin\(db, req\.adminUser, 'pedido_recebido'/);
  assert.match(vista,/Pedido Recebido/);
  assert.match(vista,/pedidoRecebidoNome/);
});
test('cliente usa ciclo de um minuto e som após ativação por clique',()=>{
  const script=fs.readFileSync(new URL('../public/js/avisos-vendas.js',import.meta.url),'utf8');
  assert.match(script,/MINUTO = 60000/);
  assert.match(script,/agora-ultima>=MINUTO/);
  assert.match(script,/function som\(\)/);
  assert.match(script,/new Notification/);
  assert.match(script,/Notification\.requestPermission\(\)/);
  assert.match(script,/botao\.addEventListener\('click'/);
  assert.match(script,/credentials:'same-origin'/);
});
