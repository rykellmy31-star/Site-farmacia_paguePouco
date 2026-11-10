import test from 'node:test';
import assert from 'node:assert/strict';
import {Collection} from '../src/lib/store.js';
import {configBoasVindas, validarConfigBoasVindas, iniciarBoasVindas,
  confirmarBoasVindas, listarBoasVindas} from '../src/lib/boas-vindas.js';
import {validarCupom} from '../src/lib/cart.js';

function memoria() {
  const collections=new Map();
  const db={
    collection(name) {
      if (!collections.has(name))
        collections.set(name,new Collection({_commit(){}},name));
      return collections.get(name);
    }
  };
  db.collection('settings').insert({
    id:'boasVindas',ativo:true,tipo:'percentual',valor:10,
    validadeHoras:24,compraMinimaCentavos:5000,maxCadastrosIpDia:4,
    titulo:'Cupom especial',subtitulo:'Cadastre-se para ganhar um cupom',
  });
  db.collection('settings').insert({id:'evolutionWhatsapp',ativo:true,instancia:'loja',baseUrl:'https://evo.example.com'});
  return db;
}
const dados={
  nome:'Maria Silva', email:'maria@example.com', telefone:'(73) 99999-1234',
  politica:'1',marketing:'1',receberCupomWhatsapp:'1'
};
function codigoDaFila(db, desafio) {
  const item=db.collection('evolutionWhatsappOutbox').get('boas_vindas_otp:'+desafio);
  return item?.texto?.match(/\b\d{6}\b/)?.[0];
}

test('campanha vem desligada e exige ativação explícita do admin',()=>{
  const db=memoria();
  db.collection('settings').update('boasVindas',{ativo:false});
  assert.equal(configBoasVindas(db).ativo,false);
  assert.equal(iniciarBoasVindas(db,dados,{dispositivo:'a'.repeat(32)}).ok,false);
});

test('painel valida horas inteiras, desconto, limite e mínimo',()=>{
  const base={titulo:'Ganhe um cupom',subtitulo:'Cadastre-se para receber',tipo:'percentual',
    valor:'10',validadeHoras:'24',compraMinima:'50',maxCadastrosIpDia:'4',ativo:'1'};
  assert.equal(validarConfigBoasVindas(base).ok,true);
  for (const validadeHoras of ['0','24.5','721','Infinity'])
    assert.equal(validarConfigBoasVindas({...base,validadeHoras}).ok,false);
  assert.equal(validarConfigBoasVindas({...base,valor:'101'}).ok,false);
  assert.equal(validarConfigBoasVindas({...base,compraMinima:'-10'}).ok,false);
});

test('WhatsApp precisa confirmar e cupom vence em horas, ligado a e-mail e número',()=>{
  const db=memoria();
  const agora=Date.now();
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:'x'.repeat(32),ip:'203.0.113.8',agora});
  assert.equal(iniciou.ok,true);
  const codigo=codigoDaFila(db,iniciou.desafio);
  assert.match(codigo,/^\d{6}$/);
  const errado=confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo:'999999'===codigo?'000000':'999999'},{agora:agora+1000});
  assert.equal(errado.ok,false);
  const ok=confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo},{agora:agora+2000});
  assert.equal(ok.ok,true);
  assert.equal(db.collection('cadastrosBoasVindas').get(iniciou.desafio).codigoHash,null);
  const cupom=db.collection('coupons').findOne(c=>c.codigo===ok.codigo);
  assert.equal(cupom.usoMaximo,1);
  assert.equal(cupom.expiraEm,new Date(agora+2000+24*3600000).toISOString());
  const cliente=db.collection('customers').insert({id:'cliente',nome:'Maria Silva',email:dados.email,
    telefone:dados.telefone,ativo:true});
  const contexto={subtotalCentavos:10000,clienteId:cliente.id,itens:[]};
  assert.equal(validarCupom(db,ok.codigo,contexto).ok,true);
  assert.equal(validarCupom(db,ok.codigo,{...contexto,clienteId:null}).ok,false);
  db.collection('customers').update(cliente.id,{telefone:'(73) 98888-2222'});
  assert.equal(validarCupom(db,ok.codigo,contexto).ok,false);
  db.collection('customers').update(cliente.id,{telefone:dados.telefone});
  db.collection('orders').insert({clienteId:cliente.id,statusFinanceiro:'aprovado'});
  assert.equal(validarCupom(db,ok.codigo,contexto).ok,false);
  assert.equal(listarBoasVindas(db).metricas.confirmados,1);
});

test('impede múltiplos benefícios por telefone, e-mail e mesmo navegador',()=>{
  const db=memoria(),dispositivo='z'.repeat(32);
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo,ip:'203.0.113.5'});
  assert.equal(iniciou.ok,true);
  assert.equal(confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo:codigoDaFila(db,iniciou.desafio)}).ok,true);
  for (const outro of [
    {...dados,email:'outro@example.com'},
    {...dados,telefone:'(73) 99999-9999'},
    {...dados,email:'outro@example.com',telefone:'(73) 99999-9999'}
  ]) assert.equal(iniciarBoasVindas(db,outro,{dispositivo,ip:'203.0.113.5'}).ok,false);
  assert.equal(db.collection('coupons').count(),1);
});

test('código expira em dez minutos e limita tentativas',()=>{
  const db=memoria(),agora=Date.now()-700000;
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:'q'.repeat(32),agora});
  const codigo=codigoDaFila(db,iniciou.desafio);
  assert.equal(confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo}).ok,false);
  assert.equal(db.collection('coupons').count(),0);
});

test('não envia promoção futura sem consentimento separado',()=>{
  const db=memoria();
  const iniciou=iniciarBoasVindas(db,{...dados,marketing:'0',receberCupomWhatsapp:'0'},
    {dispositivo:'u'.repeat(32)});
  assert.equal(iniciou.ok,true);
  const concluiu=confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo:codigoDaFila(db,iniciou.desafio)});
  assert.equal(concluiu.ok,true);
  assert.equal(db.collection('cadastrosBoasVindas').get(iniciou.desafio).marketing,false);
  assert.equal(db.collection('evolutionWhatsappOutbox').get('boas_vindas_cupom:'+iniciou.desafio),null);
});

test('pré-visualização administrativa ignora ocultação sem reativar a campanha', async () => {
  const fs = await import('node:fs');
  const layout = fs.readFileSync(new URL('../src/views/layout.js', import.meta.url),'utf8');
  const script = fs.readFileSync(new URL('../public/js/boas-vindas.js', import.meta.url),'utf8');
  const painel = fs.readFileSync(new URL('../src/routes/boas-vindas.js', import.meta.url),'utf8');
  assert.match(layout,/visualizarBoasVindas/);
  assert.match(layout,/mostrarBoasVindas/);
  assert.match(script,/!previsualizacao && !podeAbrir\(\)/);
  assert.match(painel,/Pré-visualizar pop-up no site/);
  assert.match(painel,/cfg.ativo \?/);
});
