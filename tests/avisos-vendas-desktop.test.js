import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {listarVendasPagasParaAviso} from '../src/lib/avisos-vendas.js';

const agora=Date.parse('2026-10-25T17:00:00.000Z');
const data='2026-10-25T16:59:00.000Z';
const pedido=(id,status='aprovado',em=data)=>({
  id,codigo:'PP'+id,totalCentavos:2500,statusFinanceiro:status,
  cliente:{nome:'Pessoa Exemplo',email:'cliente@example.invalid',cpf:'00000000000'},
  historico:[{tipo:'operacional',status:'em_separacao',em:data},
    {tipo:'financeiro',status:'aprovado',em}],
});
const db=pedidos=>({collection:(nome)=>{
  assert.equal(nome,'orders');return {all:()=>pedidos};
}});
test('nenhum aviso para pendente, estornado, aprovação não comprovada ou antiga',()=>{
  const pedidos=[
    pedido('1'),pedido('2','pendente'),pedido('3','estornado'),
    {...pedido('4'),historico:[{tipo:'operacional',status:'aprovado',em:data}]},
    pedido('5','aprovado','2026-10-20T10:00:00.000Z'),
  ];
  assert.deepEqual(listarVendasPagasParaAviso(db(pedidos),{agoraMs:agora}).map(x=>x.id),['1']);
});
test('retorna apenas id, código, valor e data de aprovação; sem dados pessoais',()=>{
  const lista=listarVendasPagasParaAviso(db([pedido('1')]),{agoraMs:agora});
  assert.deepEqual(Object.keys(lista[0]).sort(),['aprovadoEm','codigo','id','totalCentavos']);
  assert.doesNotMatch(JSON.stringify(lista),/Pessoa Exemplo|cliente@example|00000000000/);
});
test('limita o resultado, ordena os mais recentes e respeita histórico financeiro',()=>{
  const lista=listarVendasPagasParaAviso(db([
    pedido('old','aprovado','2026-10-25T15:00:00.000Z'),
    pedido('new','aprovado','2026-10-25T16:59:50.000Z'),
    pedido('last','aprovado','2026-10-25T16:58:50.000Z'),
  ]),{agoraMs:agora,limite:2});
  assert.deepEqual(lista.map(x=>x.id),['new','last']);
});
test('rota autentica pedidos.ver, só GET, sem cache; botão pede permissão por clique',()=>{
  const route=fs.readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const layout=fs.readFileSync(new URL('../src/views/admin/layout.js',import.meta.url),'utf8');
  const client=fs.readFileSync(new URL('../public/js/avisos-vendas.js',import.meta.url),'utf8');
  assert.match(route,/app\.get\('\/admin\/api\/avisos-vendas'/);
  assert.match(route,/guardApi\(req, res, 'pedidos\.ver'\)/);
  assert.match(route,/private, no-store/);
  assert.match(layout,/can\(usuario, "pedidos\.ver"\)/);
  assert.match(client,/Notification\.requestPermission\(\)/);
  assert.match(client,/botao\.addEventListener\('click'/);
  assert.match(client,/credentials: 'same-origin'/);
  assert.doesNotMatch(client,/serviceWorker\.register|cliente\.email/);
});
test('primeiro acesso não avisa vendas antigas; nova venda dispara somente uma notificação',async()=>{
  const codigo=fs.readFileSync(new URL('../public/js/avisos-vendas.js',import.meta.url),'utf8');
  const eventos=[];
  const storage=new Map();
  let venda=[{id:'1',codigo:'PP1',totalCentavos:1250,aprovadoEm:data}];
  let botaoClick;
  const botao={
    addEventListener(ev,fn){if(ev==='click')botaoClick=fn;},
    textContent:'',title:'',
  };
  const intervalo=[];
  class Aviso {
    static permission='granted';
    constructor(title,options){eventos.push({title,options});}
    close(){}
  }
  const ctx={
    document:{getElementById:()=>botao},
    window:{Notification:Aviso,isSecureContext:true,focus(){},
      location:{assign(){}}},
    Notification:Aviso,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    setInterval(fn){intervalo.push(fn);return intervalo.length;},
    clearInterval(){},
    fetch:async()=>({status:200,ok:true,json:async()=>({ok:true,vendas:venda})}),
    console,
  };
  vm.runInNewContext(codigo,ctx);
  assert.equal(typeof botaoClick,'function');
  botaoClick();
  await new Promise(r=>setImmediate(r));
  assert.equal(eventos.length,0,'primeiro acesso não deveria notificar pedidos antigos');
  venda=[...venda,{id:'2',codigo:'PP2',totalCentavos:1990,aprovadoEm:'2026-10-25T17:00:01.000Z'}];
  assert.equal(intervalo.length,1);
  await intervalo[0]();
  assert.equal(eventos.length,1);
  assert.match(eventos[0].title,/PP2/);
  assert.match(eventos[0].options.body,/R\$\s*19,90/);
  await intervalo[0]();
  assert.equal(eventos.length,1,'não pode notificar o mesmo pedido duas vezes');
});
