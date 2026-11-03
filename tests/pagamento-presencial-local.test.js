import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pedidoPresencialPorCEP,validarPagamentoPresencial} from '../src/lib/pagamento-presencial.js';
import {defaultFreightConfig,calcularFrete} from '../src/lib/freight.js';
const loja='45970-000';
test('somente CEP idêntico à sede permite pagamento local',()=>{
 assert.equal(pedidoPresencialPorCEP('45970000',loja),true);
 for(const cep of ['45970001','29885000','',null,'4597000','459700001'])
   assert.equal(pedidoPresencialPorCEP(cep,loja),false,String(cep));
 assert.equal(pedidoPresencialPorCEP('45970000',''),false);
 const cfg=defaultFreightConfig();
 const a=calcularFrete({config:cfg,cep:'45970000',cepFarmacia:loja,
   uf:'BA',cidade:'Itanhém',items:[],subtotalCents:2500});
 assert.deepEqual(a.opcoes.map(x=>x.id),['entrega_local','retirada']);
 const b=calcularFrete({config:cfg,cep:'45970001',cepFarmacia:loja,
   uf:'BA',cidade:'Itanhém',items:[],subtotalCents:2500});
 assert.deepEqual(b.opcoes.map(x=>x.id),['_padrao']);
});
test('Pix, débito, crédito e dinheiro válidos para pagamento no atendimento',()=>{
 for(const metodo of ['pix','credit_card','debit_card','cash']){
   const r=validarPagamentoPresencial({metodo,precisaTroco:'0',trocoPara:'',totalCentavos:2590});
   assert.equal(r.ok,true,metodo);
   assert.equal(r.presencial.precisaTroco,false);
 }
 assert.equal(validarPagamentoPresencial({metodo:'boleto',totalCentavos:1000}).ok,false);
});
test('dinheiro: campo vazio = não precisa de troco, sem selecionar opção',()=>{
  const vazio=validarPagamentoPresencial({metodo:'cash',trocoPara:'',totalCentavos:3545});
  assert.equal(vazio.ok,true);
  assert.equal(vazio.presencial.precisaTroco,false);
  assert.equal(vazio.presencial.trocoParaCentavos,null);
  assert.equal(vazio.presencial.trocoCentavos,null);
  const espacos=validarPagamentoPresencial({metodo:'cash',trocoPara:'  ',totalCentavos:3545});
  assert.equal(espacos.ok,true);
  assert.equal(espacos.presencial.precisaTroco,false);
});
test('dinheiro: valor informado gera a diferença exata em centavos',()=>{
  let r=validarPagamentoPresencial({metodo:'cash',
    trocoPara:'100,00',totalCentavos:3545});
  assert.equal(r.ok,true);assert.equal(r.presencial.trocoParaCentavos,10000);
  assert.equal(r.presencial.trocoCentavos,6455);
  assert.equal(r.presencial.precisaTroco,true);
  for(const trocoPara of ['20','10,0x','-50','1.000.000,00','100,001']){
    r=validarPagamentoPresencial({metodo:'cash',
      trocoPara,totalCentavos:3545});
    assert.equal(r.ok,false,trocoPara);
  }
  const exato=validarPagamentoPresencial({metodo:'cash',
    trocoPara:'35,45',totalCentavos:3545});
  assert.equal(exato.ok,true);assert.equal(exato.presencial.trocoCentavos,0);
  assert.equal(validarPagamentoPresencial({metodo:'pix',
    trocoPara:'100',totalCentavos:5000}).ok,false);
});
test('alteração no navegador não permite dinheiro em CEP diferente e nem MP no mesmo CEP',()=>{
 const base=new URL('../',import.meta.url);
 const orders=readFileSync(new URL('src/lib/orders.js',base),'utf8');
 const checkout=readFileSync(new URL('src/routes/checkout.js',base),'utf8');
 const tela=readFileSync(new URL('src/views/checkout.js',base),'utf8');
 assert.match(orders,/pedidoPresencialPorCEP\(endereco\.cep,cepFarmacia\)/);
 assert.match(orders,/if\(local&&!pagamentoLocal\)/);
 assert.match(orders,/if\(!local&&pagamentoLocal\)/);
 assert.match(orders,/if\(!local&&metodoPagamento==='cash'\)/);
 assert.match(orders,/validarPagamentoPresencial/);
 assert.match(checkout,/if\(local\)\{/);
 assert.match(checkout,/\/\/ Cria a cobrança no provedor configurado/);
 assert.match(tela,/data-pagamento-presencial/);
 assert.doesNotMatch(tela,/name="precisaTroco"/);
 assert.match(tela,/id="resumoTroco"/);
 assert.match(tela,/Se não precisa de troco, deixe em branco/);
 assert.match(tela,/name="trocoPara"/);
});
test('pedido local conserva reserva, histórico e pagamento pendente sem cobrança externa',()=>{
 const base=new URL('../',import.meta.url);
 const orders=readFileSync(new URL('src/lib/orders.js',base),'utf8');
 const checkout=readFileSync(new URL('src/routes/checkout.js',base),'utf8');
 const admin=readFileSync(new URL('src/routes/admin.js',base),'utf8');
 const view=readFileSync(new URL('src/views/admin/vendas.js',base),'utf8');
 const evo=readFileSync(new URL('src/lib/evolution-whatsapp.js',base),'utf8');
 assert.match(orders,/pendenciaPagamento: local\?null:'criacao_em_andamento'/);
 assert.match(orders,/statusFinanceiro: 'pendente'/);
 assert.match(orders,/statusOperacional: local\?'em_separacao'/);
 assert.match(orders,/registrarMovimentoEstoque\(db/);
 assert.match(checkout,/enfileirarEvolution\(db,salvo,'responsavel_local'\)/);
 assert.match(admin,/confirmar-pagamento-presencial/);
 assert.match(admin,/guard\(req,res,'pedidos\.editar'\)/);
 assert.match(admin,/atualizarStatusFinanceiro\(db,p\.id,'aprovado'/);
 assert.match(view,/Troco estimado:/);
 assert.match(evo,/Nenhuma cobrança foi gerada pelo site/);
});
test('formulário de dinheiro só aparece quando dinheiro está selecionado',()=>{
 const base=new URL('../',import.meta.url);
 const js=readFileSync(new URL('public/js/app.js',base),'utf8');
 assert.match(js,/marcado\?\.value==='cash'/);
 assert.match(js,/if\(dinheiro\)dinheiro.hidden=!usaDinheiro/);
 assert.match(js,/valorTroco\.required=false/);
 assert.match(js,/resumoTroco\.textContent/);
 assert.match(js,/troco a separar/i);
 assert.doesNotMatch(js,/troco\?\.addEventListener/);
});

test('conciliador Pix jamais classifica pagamento local como checkout interrompido',()=>{
 const base=new URL('../',import.meta.url);
 const fonte=readFileSync(new URL('src/lib/payments/reconciliation.js',base),'utf8');
 assert.equal((fonte.match(/!p\.pagamentoPresencial/g)||[]).length,2);
});

test('cliente vê confirmação de modalidade e troco em Meus pedidos',()=>{
 const base=new URL('../',import.meta.url);
 const conta=readFileSync(new URL('src/views/account.js',base),'utf8');
 assert.match(conta,/pedido\.pagamentoPresencial/);
 assert.match(conta,/Troco para:/);
 assert.match(conta,/pagamento será realizado presencialmente/);
});

test('separador de pedidos vê troco calculado e WhatsApp informa valor a separar',()=>{
 const base=new URL('../',import.meta.url);
 const painel=readFileSync(new URL('src/views/admin/vendas.js',base),'utf8');
 const evo=readFileSync(new URL('src/lib/evolution-whatsapp.js',base),'utf8');
 assert.match(painel,/SEPARAR TROCO:/);
 assert.match(painel,/money\(local\.trocoCentavos\)/);
 assert.match(painel,/Cliente vai entregar:/);
 assert.match(evo,/TROCO A SEPARAR: R\$/);
 assert.match(evo,/pagamentoPresencial\.trocoCentavos/);
});
