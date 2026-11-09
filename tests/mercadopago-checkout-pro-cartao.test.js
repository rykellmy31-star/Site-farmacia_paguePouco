import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import {
  createPayment, getStatus, handleWebhook, refund, urlCheckoutMercadoPago,
} from '../src/lib/payments/mercadopago.js';
import { enabledMethods } from '../src/lib/payments/index.js';
import { config } from '../src/config.js';

class DB {
  constructor(){this.cols=new Map()}
  collection(name){
    if(!this.cols.has(name))this.cols.set(name,new Collection({_commit(){}},name));
    return this.cols.get(name);
  }
}
const conf={payments:{mp:{accessToken:'TEST_TOKEN_CARD_FAKE',webhookSecret:'WEBHOOK_SECRET_FAKE'}}};
const base='https://site.farmaciapaguepouco.app';
const urls={
 notificationUrl:base+'/webhooks/mercadopago',
 success:base+'/checkout/confirmacao/PP-CARTAO',
 failure:base+'/checkout/confirmacao/PP-CARTAO',
 pending:base+'/checkout/confirmacao/PP-CARTAO',
 checkoutProCartao:true,
};
function dbPedido(totalCentavos=19900){
 const db=new DB();
 const order=db.collection('orders').insert({
   id:'order-1',codigo:'PP-CARTAO',totalCentavos,metodoPagamento:'credit_card',
   statusFinanceiro:'pendente',pagamentoId:null,clienteId:'c1',
   itens:[{produtoId:'med',nome:'Medicamento Privado',precoUnitarioCentavos:19900,quantidade:1}],
 });
 return {db,order};
}
function fetchMock(responses,calls=[]){
 const pending=[...responses];
 return async (url,options)=>{
   calls.push({url:String(url),options});
   const status=200;
   const data=pending.shift();
   if(data===undefined)throw Error('Chamada MP inesperada '+url);
   return {ok:true,status,async text(){return JSON.stringify(data)}};
 };
}
function remota({id='123456789',valor=199,preferencia='PREFERENCE_SAFE_123',
  status='approved',tipo='credit_card',ref='PP-CARTAO'}={}){
 return {id,transaction_amount:valor,external_reference:ref,currency_id:'BRL',
   preference_id:preferencia,payment_type_id:tipo,status,metadata:{pedido_id:'order-1'},
   payment_method_id:'visa',card:{last_four_digits:'1234'},installments:2};
}
function headerAssinado(id){
 const ts='1762700000';
 const manifest='id:'+id+';request-id:request-1;ts:'+ts+';';
 const v1=crypto.createHmac('sha256',conf.payments.mp.webhookSecret).update(manifest).digest('hex');
 return {'x-request-id':'request-1','x-signature':'ts='+ts+',v1='+v1};
}
async function prepararPreferencia(db,order,configExtra={}){
 const original=globalThis.fetch;
 const requests=[];
 globalThis.fetch=fetchMock([{id:'PREFERENCE_SAFE_123',
   init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref=PREFERENCE_SAFE_123'}],requests);
 try {
   const r=await createPayment({db,order,method:'credit_card',
     payer:{nome:'Pessoa',email:'teste@example.invalid'},
     returnUrls:urls,config:{...conf,...configExtra}});
   if(r.ok)db.collection('orders').update(order.id,{pagamentoId:r.pagamento.id});
   return {r,requests};
 }finally{globalThis.fetch=original}
}
test('checkout pro cria preferência sem enviar produtos sensíveis nem dados de cartão',async()=>{
 const {db,order}=dbPedido();
 const {r,requests}=await prepararPreferencia(db,order);
 assert.equal(r.ok,true);
 assert.equal(r.pagamento.metodo,'credit_card');
 assert.equal(r.pagamento.checkoutProCartao,true);
 assert.equal(r.pagamento.status,'pending');
 assert.equal(db.collection('payments').count(),1);
 assert.match(requests[0].url,/\/checkout\/preferences/);
 assert.equal(requests[0].options.headers.Authorization,'Bearer TEST_TOKEN_CARD_FAKE');
 assert.equal(requests[0].options.headers['X-Idempotency-Key'],'preferencia-cartao-order-1');
 const body=JSON.parse(requests[0].options.body);
 assert.equal(body.items.length,1);
 assert.equal(body.items[0].unit_price,199);
 assert(!JSON.stringify(body).includes('Medicamento Privado'));
 assert.equal(body.payment_methods.installments,6);
 assert(body.payment_methods.excluded_payment_types.some(x=>x.id==='debit_card'));
 assert(body.payment_methods.excluded_payment_types.some(x=>x.id==='ticket'));
 assert.equal(body.external_reference,order.codigo);
 assert.equal(body.metadata.pedido_id,order.id);
 assert.equal(body.notification_url,urls.notificationUrl);
 assert.equal(body.back_urls.success,urls.success);
 assert.equal(r.checkoutUrl.startsWith('https://www.mercadopago.com.br/'),true);
});
test('limites de parcelamento fixos seguem regra de R$ 25/parcela e até 6x',async()=>{
 for(const [centavos,esperado] of [[1000,1],[4999,1],[5000,2],[7499,2],
  [7500,3],[14999,5],[15000,6],[50000,6]]){
   const {db,order}=dbPedido(centavos);
   const {requests}=await prepararPreferencia(db,order);
   const body=JSON.parse(requests[0].options.body);
   assert.equal(body.payment_methods.installments,esperado);
   assert.equal(body.items[0].unit_price,Number((centavos/100).toFixed(2)));
 }
});
test('somente links https de domínios oficiais MP podem redirecionar cliente',()=>{
 assert.equal(urlCheckoutMercadoPago('https://evil.mercadopago.com.br.attacker.test/fake'),null);
 assert.equal(urlCheckoutMercadoPago('javascript:alert(1)'),null);
 assert.equal(urlCheckoutMercadoPago('http://mercadopago.com.br/pay'),null);
 assert.equal(urlCheckoutMercadoPago('https://mercadopago.com.br.evil.com/pay'),null);
 assert(urlCheckoutMercadoPago('https://www.mercadopago.com.br/checkout/v1/redirect'));
});
test('webhook autenticado só vincula pagamento da preferência correta e valor exato',async()=>{
 const {db,order}=dbPedido();
 await prepararPreferencia(db,order);
 const original=globalThis.fetch;
 try {
   globalThis.fetch=fetchMock([remota()]);
   const r=await handleWebhook({db,headers:headerAssinado('123456789'),
     body:{type:'payment',data:{id:'123456789'}},config:conf});
   assert.equal(r.ok,true);
   assert.equal(r.status,'approved');
   assert.equal(r.pagamentoId,db.collection('orders').get('order-1').pagamentoId);
   const pay=db.collection('payments').get(r.pagamentoId);
   assert.equal(pay.transacaoId,'123456789');
   assert.equal(pay.status,'approved');
   assert.equal(pay.metodo,'credit_card');
   assert.equal(db.collection('payments').count(),1,'preferência não vira nova cobrança');
 }finally{globalThis.fetch=original}
});
test('não aprova pagamento diferente, outra preferência nem valor adulterado',async()=>{
 const {db,order}=dbPedido();await prepararPreferencia(db,order);
 const original=globalThis.fetch;
 try {
   for (const remoto of [remota({valor:190}),remota({preferencia:'PREF_OUTRA'}),
      remota({ref:'OUTRO_PEDIDO'}),remota({tipo:'pix'})]) {
     globalThis.fetch=fetchMock([remoto]);
     const r=await handleWebhook({db,headers:headerAssinado('123456789'),
       body:{type:'payment',data:{id:'123456789'}},config:conf});
     assert.equal(r.ok,false);
     assert.equal(db.collection('orders').get(order.id).statusFinanceiro,'pendente');
     assert.equal(db.collection('payments').all()[0].status,'pending');
   }
 }finally{globalThis.fetch=original}
});
test('webhook sem assinatura configurada obrigatória rejeita assinatura ausente',async()=>{
 const {db,order}=dbPedido();await prepararPreferencia(db,order);
 const r=await handleWebhook({db,headers:{},body:{type:'payment',data:{id:'123456789'}},config:conf});
 assert.equal(r.ok,false);
});
test('consulta autenticada de cartão pendente identifica transação pela referência e preferência',async()=>{
 const {db,order}=dbPedido();await prepararPreferencia(db,order);
 const original=globalThis.fetch;const calls=[];
 try {
   globalThis.fetch=fetchMock([
     {results:[remota({status:'pending'})]},
     remota({status:'approved'}),
   ],calls);
   const r=await getStatus({db,payment:db.collection('payments').all()[0],config:conf});
   assert.equal(r.ok,true);
   assert.equal(r.status,'approved');
   assert.equal(r.pagamento.transacaoId,'123456789');
   assert.equal(calls.length,2);
 }finally{globalThis.fetch=original}
});
test('retorno do comprador não confirma pagamento: só evento do provedor',()=>{
 const routes=readFileSync(new URL('../src/routes/checkout.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../src/views/checkout.js',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
 assert.match(routes,/returnUrls:\s*\{/);
 assert.match(routes,/cobranca\?\.pagamento\?\.checkoutProCartao/);
 assert.match(routes,/reconciliarPixAoConsultarPedido/);
 assert.match(html,/Continuar pagamento seguro no Mercado Pago/);
 assert.match(admin,/checkoutProCartaoHabilitado/);
 assert.doesNotMatch(routes,/req\.query\.get\('status'\).{0,80}aprovado/);
});
test('habilitação do cartão real começa desligada até marcação explícita',()=>{
 const db=new DB();
 db.collection('settings').insert({id:'pagamentos',provedor:'mercadopago',
   meios:{pix:true,credit_card:true},ambienteTestes:false});
 const previous={...config.payments.mp};
 try{
   config.payments.mp.accessToken='TEST_MP_FAKE_NO_NETWORK';
   assert.equal(enabledMethods(db).credit_card,false);
   assert.equal(enabledMethods(db).pix,true);
   db.collection('settings').update('pagamentos',{checkoutProCartaoHabilitado:true});
   assert.equal(enabledMethods(db).credit_card,true);
 }finally{config.payments.mp=previous}
});
