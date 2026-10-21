import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { config } from '../src/config.js';
import {
  salvarCredenciaisMercadoPago, credenciaisMercadoPago, estadoCredenciaisMercadoPago,
  removerCredenciaisMercadoPago,
} from '../src/lib/payments/credentials.js';
import { can } from '../src/lib/permissions.js';
import { getProviderInfo, enabledMethods, createPayment } from '../src/lib/payments/index.js';

const CHAVE = 'teste-chave-cofre-de-pagamentos-64-caracteres-aleatorios-2026';
class DB {
  constructor(){this.cols = new Map();}
  collection(name){
    if (!this.cols.has(name)) this.cols.set(name,new Collection({_commit(){}},name));
    return this.cols.get(name);
  }
}
const payload = (extras={}) => ({
  accessToken:'TEST-0123456789abcdefghijklmnopqrstuvwxyz',
  publicKey:'TEST-public-key-example',
  webhookSecret:'webhook-secret-para-testes',
  ambiente:'testes', ...extras,
});
function environment(t) {
  const oldKey=config.payments.credentialsKey, oldToken=config.payments.mp.accessToken;
  config.payments.credentialsKey=CHAVE;config.payments.mp.accessToken='';
  return async()=>{config.payments.credentialsKey=oldKey;config.payments.mp.accessToken=oldToken;};
}

test('credenciais ficam cifradas no banco, nunca em texto plano',async()=>{
 const cleanup=environment();try{
  const db=new DB();const p=payload();
  assert.equal(salvarCredenciaisMercadoPago(db,p).ok,true);
  const doc=db.collection('paymentSecrets').get('mercadopago');
  assert.equal(doc.versao,1);
  for(const v of Object.values(p)) if(typeof v==='string' && v!=='testes')
    assert.equal(JSON.stringify(doc).includes(v),false);
  assert.equal(credenciaisMercadoPago(db).accessToken,p.accessToken);
  assert.deepEqual(estadoCredenciaisMercadoPago(db),{
    cofrePreparado:true,origem:'painel',legivel:true,tokenConfigurado:true,
    webhookConfigurado:true,publicKeyConfigurada:true,ambiente:'testes',
  });
 }finally{await cleanup();}
});

test('sem chave externa o painel recusa gravar qualquer segredo',async()=>{
 const cleanup=environment();try{
  config.payments.credentialsKey='';
  const db=new DB();
  assert.equal(salvarCredenciaisMercadoPago(db,payload()).ok,false);
  assert.equal(db.collection('paymentSecrets').count(),0);
 }finally{await cleanup();}
});

test('alteração de chave ou adulteração causa bloqueio seguro, nunca fallback',async()=>{
 const cleanup=environment();try{
  const db=new DB();salvarCredenciaisMercadoPago(db,payload());
  db.collection('settings').insert({id:'pagamentos',provedor:'mercadopago',ambienteTestes:true});
  config.payments.credentialsKey='outra-chave-de-criptografia-incompatível-para-ensaio';
  assert.equal(credenciaisMercadoPago(db).legivel,false);
  assert.equal(getProviderInfo(db).configurado,false);
  config.payments.credentialsKey=CHAVE;
  db.collection('paymentSecrets').update('mercadopago',{tag:Buffer.alloc(16).toString('base64')});
  assert.equal(credenciaisMercadoPago(db).legivel,false);
 }finally{await cleanup();}
});

test('token APP_USR aceita ambiente de teste; produção exige assinatura de webhook',async()=>{
 const cleanup=environment();try{
  const db=new DB();
  // Credenciais oficiais de teste do Mercado Pago também podem começar por APP_USR.
  assert.equal(salvarCredenciaisMercadoPago(db,payload({accessToken:'APP_USR-0123456789abcdefghijklmnopqrstuvwxyz'})).ok,true);
  assert.equal(credenciaisMercadoPago(db).sandbox,true);
  assert.equal(salvarCredenciaisMercadoPago(db,payload({accessToken:'APP_USR-0123456789abcdefghijklmnopqrstuvwxyz',ambiente:'producao',webhookSecret:''})).ok,false);
  assert.equal(salvarCredenciaisMercadoPago(db,payload({accessToken:'TEST-0123456789abcdefghijklmnopqrstuvwxyz',ambiente:'producao'})).ok,false);
  assert.equal(salvarCredenciaisMercadoPago(db,payload({accessToken:'APP_USR-0123456789abcdefghijklmnopqrstuvwxyz',ambiente:'producao'})).ok,true);
  assert.equal(credenciaisMercadoPago(db).sandbox,false);
  db.collection('settings').insert({id:'pagamentos',provedor:'mercadopago',ambienteTestes:true});
  assert.equal(getProviderInfo(db).configurado,false,'nao habilita produção com checkbox de teste');
  db.collection('settings').update('pagamentos',{ambienteTestes:false});
  assert.equal(getProviderInfo(db).configurado,true);
 }finally{await cleanup();}
});

test('Pix real libera após configuração de teste mas cartão real segue desabilitado',async()=>{
 const cleanup=environment();try{
  const db=new DB();
  db.collection('settings').insert({id:'pagamentos',provedor:'mercadopago',ambienteTestes:true,meios:{pix:true,credit_card:true,debit_card:true}});
  assert.equal(getProviderInfo(db).configurado,false);
  assert.equal(salvarCredenciaisMercadoPago(db,payload()).ok,true);
  assert.equal(getProviderInfo(db).configurado,true);
  assert.equal(enabledMethods(db).pix,true);
  assert.equal(enabledMethods(db).credit_card,false);
  assert.equal(enabledMethods(db).debit_card,false);
 }finally{await cleanup();}
});

test('cobrança Pix usa Access Token decifrado apenas no backend (API simulada)',async()=>{
 const cleanup=environment();
 const originalFetch=globalThis.fetch;
 try{
  const db=new DB();salvarCredenciaisMercadoPago(db,payload());
  db.collection('settings').insert({id:'pagamentos',provedor:'mercadopago',ambienteTestes:true,meios:{pix:true}});
  let recebido=null;
  globalThis.fetch=async(url,opts)=>{
    recebido={url,token:opts.headers.Authorization,method:opts.method,body:JSON.parse(opts.body)};
    return new Response(JSON.stringify({
      id:123456, status:'pending',installments:1,point_of_interaction:{
        transaction_data:{qr_code:'codigo-pix-de-teste',qr_code_base64:'YQ=='},
      },
    }),{status:201,headers:{'Content-Type':'application/json'}});
  };
  const res=await createPayment(db,{
    order:{id:'order-sim',codigo:'PP-TESTE',totalCentavos:4200},
    method:'pix',payer:{email:'cliente@example.com',nome:'Teste Cliente'},
    returnUrls:{notificationUrl:'https://test.example/webhooks/mercadopago'},
  });
  assert.equal(res.ok,true);
  assert.equal(res.pagamento.pixCodigo,'codigo-pix-de-teste');
  assert.equal(recebido.token,'Bearer '+payload().accessToken);
  assert.equal(recebido.url,'https://api.mercadopago.com/v1/payments');
  assert.equal(recebido.body.payment_method_id,'pix');
  assert.equal(recebido.body.transaction_amount,42);
  assert.equal(recebido.body.notification_url,'https://test.example/webhooks/mercadopago');
  assert.equal(res.pagamento.simulado,false,'simulação do HTTP remoto nunca altera tipo de cobrança');
 }finally{globalThis.fetch=originalFetch;await cleanup();}
});

test('somente superadministrador pode cadastrar ou remover chave da API',()=>{
 assert.equal(can({role:'super_admin'},'integracoes.editar'),true);
 for(const role of ['admin','gerente','atendente','farmaceutico','operador_pedidos']){
  assert.equal(can({role},'integracoes.editar'),false,role);
 }
});

test('remoção deixa cofre vazio e não revela token anteriormente armazenado',async()=>{
 const cleanup=environment();try{
  const db=new DB();salvarCredenciaisMercadoPago(db,payload());
  assert.equal(removerCredenciaisMercadoPago(db),true);
  assert.equal(estadoCredenciaisMercadoPago(db).tokenConfigurado,false);
  assert.equal(removerCredenciaisMercadoPago(db),false);
 }finally{await cleanup();}
});
