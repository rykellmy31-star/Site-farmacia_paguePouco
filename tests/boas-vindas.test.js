import test from 'node:test';
import assert from 'node:assert/strict';
import {Collection} from '../src/lib/store.js';
import {configBoasVindas, validarConfigBoasVindas, iniciarBoasVindas,
  confirmarBoasVindas, listarBoasVindas, excluirCadastroBoasVindas,
  jaConfirmouBoasVindasNesteNavegador} from '../src/lib/boas-vindas.js';
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
    valor:'10',validadeHoras:'24',intervaloReexibicaoHoras:'6',compraMinima:'50',maxCadastrosIpDia:'4',ativo:'1'};
  assert.equal(validarConfigBoasVindas(base).ok,true);
  for (const validadeHoras of ['0','24.5','721','Infinity'])
    assert.equal(validarConfigBoasVindas({...base,validadeHoras}).ok,false);
  for (const intervaloReexibicaoHoras of ['0','1.5','169','Infinity'])
    assert.equal(validarConfigBoasVindas({...base,intervaloReexibicaoHoras}).ok,false);
  assert.equal(validarConfigBoasVindas({...base,intervaloReexibicaoHoras:'1'}).ok,true);
  assert.equal(validarConfigBoasVindas({...base,intervaloReexibicaoHoras:'168'}).ok,true);
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

test('administrador exclui pré-cadastro pendente e limpa o código de WhatsApp',()=>{
  const db=memoria();
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:'p'.repeat(32)});
  assert.equal(iniciou.ok,true);
  const msg=db.collection('evolutionWhatsappOutbox').get('boas_vindas_otp:'+iniciou.desafio);
  assert.equal(msg.status,'fila');
  const result=excluirCadastroBoasVindas(db,iniciou.desafio);
  assert.equal(result.ok,true);
  assert.equal(result.cupomId,null);
  assert.equal(db.collection('cadastrosBoasVindas').get(iniciou.desafio),null);
  assert.equal(listarBoasVindas(db).metricas.iniciados,0);
  assert.equal(db.collection('evolutionWhatsappOutbox').get(msg.id).status,'cancelado');
  assert.equal(db.collection('evolutionWhatsappOutbox').get(msg.id).numero,null);
  assert.equal(db.collection('evolutionWhatsappOutbox').get(msg.id).texto,null);
  assert.equal(db.collection('coupons').count(),0);
  assert.equal(confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo:'123456'}).ok,false);
  assert.equal(iniciarBoasVindas(db,dados,{dispositivo:'p'.repeat(32)}).ok,true);
});

test('exclusão de cadastro confirmado revoga cupom e limpa carrinho sem apagar conta ou pedidos',()=>{
  const db=memoria();
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:'t'.repeat(32)});
  const codigo=codigoDaFila(db,iniciou.desafio);
  assert.equal(confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo}).ok,true);
  const cupom=db.collection('coupons').findOne(c=>c.leadBoasVindasId===iniciou.desafio);
  assert.equal(cupom.ativo,true);
  db.collection('carts').insert({id:'c1',cupom:{cupomId:cupom.id,codigo:cupom.codigo,desconto:1000}});
  db.collection('carts').insert({id:'c2',cupom:{cupomId:'outro',codigo:'OUTRO',desconto:200}});
  db.collection('customers').insert({id:'clienteReal',nome:'Maria Silva',
    email:dados.email,telefone:dados.telefone,ativo:true});
  db.collection('orders').insert({id:'pedidoReal',clienteId:'clienteReal',statusFinanceiro:'aprovado'});
  const resultado=excluirCadastroBoasVindas(db,iniciou.desafio);
  assert.equal(resultado.ok,true);
  assert.equal(resultado.cupomUtilizado,false);
  const revogado=db.collection('coupons').get(cupom.id);
  assert.equal(revogado.ativo,false);
  assert.equal(revogado.clienteExclusivoEmail,null);
  assert.equal(revogado.clienteExclusivoTelefone,null);
  assert.equal(validarCupom(db,cupom.codigo,{subtotalCentavos:10000,clienteId:'clienteReal'}).ok,false);
  assert.equal(db.collection('carts').get('c1').cupom,null);
  assert.equal(db.collection('carts').get('c2').cupom.codigo,'OUTRO');
  assert.equal(db.collection('customers').get('clienteReal').email,dados.email);
  assert.equal(db.collection('orders').get('pedidoReal').clienteId,'clienteReal');
  assert.equal(db.collection('evolutionWhatsappOutbox').get('boas_vindas_cupom:'+iniciou.desafio).status,'cancelado');
  assert.equal(db.collection('evolutionWhatsappOutbox').get('boas_vindas_cupom:'+iniciou.desafio).texto,null);
  assert.equal(listarBoasVindas(db).metricas.confirmados,0);
});

test('cupom já usado mantém histórico e impede novo benefício após exclusão',()=>{
  const db=memoria(),device='w'.repeat(32);
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:device});
  assert.equal(confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo:codigoDaFila(db,iniciou.desafio)}).ok,true);
  const cupom=db.collection('coupons').findOne(c=>c.leadBoasVindasId===iniciou.desafio);
  db.collection('coupons').update(cupom.id,{usos:1});
  const excluido=excluirCadastroBoasVindas(db,iniciou.desafio);
  assert.equal(excluido.ok,true);
  assert.equal(excluido.cupomUtilizado,true);
  assert.equal(db.collection('coupons').get(cupom.id).usos,1);
  assert.equal(db.collection('bloqueiosCupomBoasVindas').count(),1);
  assert.equal(db.collection('bloqueiosCupomBoasVindas').all()[0].telefoneHash?.includes(dados.telefone),false);
  assert.equal(iniciarBoasVindas(db,{...dados,email:'outra@example.com'},
    {dispositivo:'a'.repeat(32)}).ok,false);
  assert.equal(iniciarBoasVindas(db,{...dados,telefone:'(73) 99999-9876'},
    {dispositivo:'b'.repeat(32)}).ok,false);
  assert.equal(iniciarBoasVindas(db,{...dados,email:'nova@example.com',telefone:'(73) 99999-9876'},
    {dispositivo:device}).ok,false);
});

test('exclusão inexistente não altera dados e ação exige permissão e CSRF',async()=>{
  const db=memoria();
  assert.equal(excluirCadastroBoasVindas(db,'id-inexistente').ok,false);
  assert.equal(db.collection('cadastrosBoasVindas').count(),0);
  const fs=await import('node:fs');
  const source=fs.readFileSync(new URL('../src/routes/boas-vindas.js',import.meta.url),'utf8');
  assert.match(source,/app\.post\('\/admin\/boas-vindas\/:id\/excluir'/);
  assert.match(source,/can\(req\.adminUser,'promocoes\.excluir'\)/);
  assert.match(source,/name="_csrf"/);
  assert.match(source,/onsubmit="return confirm\(/);
  assert.match(source,/logAdmin\(db,req\.adminUser,'excluiu_cadastro_boas_vindas'/);
});

test('o navegador com WhatsApp confirmado deixa de receber o pop-up',()=>{
  const db=memoria(),device='n'.repeat(32);
  assert.equal(jaConfirmouBoasVindasNesteNavegador(db,device),false);
  assert.equal(jaConfirmouBoasVindasNesteNavegador(db,'invalido'),false);
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:device});
  assert.equal(iniciou.ok,true);
  assert.equal(jaConfirmouBoasVindasNesteNavegador(db,device),false);
  assert.equal(confirmarBoasVindas(db,{
    desafio:iniciou.desafio,codigo:codigoDaFila(db,iniciou.desafio)
  }).ok,true);
  assert.equal(jaConfirmouBoasVindasNesteNavegador(db,device),true);
  assert.equal(jaConfirmouBoasVindasNesteNavegador(db,'m'.repeat(32)),false);
});

test('após resgate e exclusão, navegador ainda sabe que já ganhou o benefício',()=>{
  const db=memoria(),device='b'.repeat(32);
  const iniciou=iniciarBoasVindas(db,dados,{dispositivo:device});
  assert.equal(confirmarBoasVindas(db,{desafio:iniciou.desafio,codigo:codigoDaFila(db,iniciou.desafio)}).ok,true);
  const cupom=db.collection('coupons').findOne(c=>c.leadBoasVindasId===iniciou.desafio);
  db.collection('coupons').update(cupom.id,{usos:1});
  assert.equal(excluirCadastroBoasVindas(db,iniciou.desafio).ok,true);
  assert.equal(jaConfirmouBoasVindasNesteNavegador(db,device),true);
});

test('o painel e a página expõem frequência configurável sem mudar a validade do cupom',async()=>{
  const fs=await import('node:fs');
  const admin=fs.readFileSync(new URL('../src/routes/boas-vindas.js',import.meta.url),'utf8');
  const view=fs.readFileSync(new URL('../src/views/boas-vindas.js',import.meta.url),'utf8');
  const layout=fs.readFileSync(new URL('../src/views/layout.js',import.meta.url),'utf8');
  assert.match(admin,/nome:'intervaloReexibicaoHoras'/);
  assert.match(view,/data-intervalo-horas/);
  assert.match(layout,/jaConfirmouBoasVindasNesteNavegador/);
  assert.match(layout,/20261110-reexibicao/);
});
