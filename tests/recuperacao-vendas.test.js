import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executarRecuperacao, expirarCuponsRecuperacao, configRecuperacao, configRecuperacaoLocal, validarConfigRecuperacao, validarConfigRecuperacaoLocal, painelRecuperacao, configRecuperacaoPedido, validarConfigRecuperacaoPedido, pedidoOnlineRecuperavel } from '../src/lib/recuperacao-vendas.js';
import { processarFilaEvolution } from '../src/lib/evolution-whatsapp.js';
import { validarCupom } from '../src/lib/cart.js';
import { destinoRecuperacao } from '../src/lib/recuperacao-destino.js';

function dbFake() {
  const mapa=new Map();
  return {collection(nome){
    if(!mapa.has(nome))mapa.set(nome,new Map());
    const c=mapa.get(nome);
    return {
      get:id=>c.get(String(id))||null,
      all:()=>Array.from(c.values()),
      findOne:f=>Array.from(c.values()).find(f)||null,
      insert:x=>{const v={...x,id:String(x.id||'auto-'+(c.size+1))};c.set(v.id,v);return v;},
      update:(id,p)=>{const x=c.get(String(id));if(!x)return null;const v={...x,...p};c.set(String(id),v);return v;},
      remove:id=>c.delete(String(id)),
      count:f=>f?Array.from(c.values()).filter(f).length:c.size,
    };
  }};
}
function fixture({categoria='fraldas-descartaveis',marketing=true,detalhes=false,idade=26,ativadoHa=48,cepDestino='29885000',localAtivo=false}={}) {
  const db=dbFake(),agora=Date.now();
  const iso=n=>new Date(agora-n*3_600_000).toISOString();
  db.collection('settings').insert({id:'recuperacaoVendas',ativo:true,ativadoEm:iso(ativadoHa),
    primeiroLembreteHoras:1,enviarCupomAposHoras:24,descontoPercentual:5,
    descontoMaximoCentavos:1500,compraMinimaCentavos:6000,
    validadeHoras:48,intervaloDias:15,apenasPrimeiraCompra:true,maximoPorCiclo:8});
  db.collection('settings').insert({id:'empresa',endereco:{cep:'45970000',cidade:'Itanhém',uf:'BA'}});
  db.collection('settings').insert({id:'recuperacaoVendasLocal',ativo:localAtivo,ativadoEm:localAtivo?iso(ativadoHa):null,
    primeiroLembreteHoras:1,enviarCupomAposHoras:4,descontoPercentual:7,
    descontoMaximoCentavos:1000,compraMinimaCentavos:6000,
    validadeHoras:2,intervaloDias:15,apenasPrimeiraCompra:true,maximoPorCiclo:8});
  db.collection('settings').insert({id:'evolutionWhatsapp',ativo:true,
    instancia:'numero-farmacia',avisarCliente:true,avisarResponsavel:true});
  db.collection('customers').insert({id:'cliente-1',nome:'Maria',telefone:'73999998888',
    ativo:true,marketing,consentimentoWhatsappMarketingDetalhes:detalhes,
    enderecos:[{id:'end1',cep:cepDestino,cidade:cepDestino==='45970000'?'Itanhém':'Ponto Belo',
      uf:cepDestino==='45970000'?'BA':'ES',padrao:true}]});
  db.collection('categories').insert({id:'cat-1',slug:categoria,nome:'Fraldas descartáveis'});
  db.collection('products').insert({id:'p1',nome:'Fralda Desc 50 unidades',ativo:true,
    categoriaId:'cat-1',estoque:{quantidade:80,reservado:0},precoCentavos:15000,
    sanitario:{classificacao:'nao_aplicavel'}});
  db.collection('carts').insert({id:'c-1',clienteId:'cliente-1',
    itens:[{produtoId:'p1',quantidade:1,precoUnitarioCentavos:15000}],
    atualizadoEm:iso(idade),criadoEm:iso(idade+2)});
  return {db,agora,iso};
}
test('cupom fica individual, inativo até confirmação do envio, usa mesma instância Evolution',async()=>{
  const {db,agora}=fixture();
  const result=executarRecuperacao(db,{agora});
  assert.equal(result.cupons,1);
  assert.equal(result.lembretes,0,'não enviar os dois contatos no mesmo instante');
  const item=db.collection('evolutionWhatsappOutbox').all()[0];
  assert.equal(item.tipo,'recuperacao_cupom');
  assert.match(item.texto,/❤️ \*Farmácia Pague Pouco, cuidando da sua saúde\.\*/);
  assert.doesNotMatch(item.texto,/responda sair/i);
  assert.doesNotMatch(item.texto,/Fralda Desc/,'não divulgar itens sem autorização específica');
  const cupom=db.collection('coupons').get(item.cupomId);
  assert.equal(cupom.ativo,false);
  assert.equal(cupom.usoMaximo,1);
  assert.equal(cupom.clienteExclusivoId,'cliente-1');
  const requests=[];
  const env=await processarFilaEvolution(db,{apiKey:'teste',baseUrl:'https://evolution.example.com',
    enviar:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return {ok:true,status:200};}});
  assert.equal(env.enviados,1);
  assert.match(requests[0].url,/\/message\/sendText\/numero-farmacia$/);
  assert.equal(requests[0].body.number,'5573999998888');
  const ativo=db.collection('coupons').get(cupom.id);
  assert.equal(ativo.ativo,true);
  assert.equal(Date.parse(ativo.expiraEm)-Date.parse(ativo.emitidoEm),48*3600_000);
  const itens=[{produtoId:'p1',categoriaId:'cat-1',quantidade:1,precoUnitarioCentavos:15000}];
  const ok=validarCupom(db,ativo.codigo,{subtotalCentavos:15000,itens,clienteId:'cliente-1'});
  assert.equal(ok.ok,true);
  assert.equal(ok.desconto,750);
  assert.equal(validarCupom(db,ativo.codigo,{subtotalCentavos:15000,itens,clienteId:'outro'}).ok,false);
  assert.equal(validarCupom(db,ativo.codigo,{subtotalCentavos:15000,itens:[],clienteId:'cliente-1'}).ok,false);
  db.collection('coupons').update(ativo.id,{expiraEm:new Date(Date.now()-1_000).toISOString()});
  assert.equal(validarCupom(db,ativo.codigo,{subtotalCentavos:15000,itens,clienteId:'cliente-1'}).ok,false);
});
test('primeiro lembrete após 1 hora, cupom depois de 24 horas, sem duplicação',()=>{
  const {db,agora}=fixture({idade:2});
  const a=executarRecuperacao(db,{agora});
  assert.equal(a.lembretes,1);assert.equal(a.cupons,0);
  const b=executarRecuperacao(db,{agora:agora+1000});
  assert.equal(b.lembretes,0);assert.equal(db.collection('evolutionWhatsappOutbox').count(),1);
  db.collection('carts').update('c-1',{atualizadoEm:new Date(agora-26*3600_000).toISOString()});
  const c=executarRecuperacao(db,{agora});
  assert.equal(c.cupons,1);
  assert.equal(db.collection('evolutionWhatsappOutbox').count(),2);
  const d=executarRecuperacao(db,{agora});
  assert.equal(d.cupons,0);
});
test('cliente que recusou ofertas ou pedido em andamento nunca é contatado',()=>{
  const a=fixture({marketing:false});
  assert.equal(executarRecuperacao(a.db,{agora:a.agora}).cupons,0);
  assert.equal(a.db.collection('evolutionWhatsappOutbox').count(),0);
  const b=fixture();
  b.db.collection('orders').insert({id:'pedido1',clienteId:'cliente-1',
    carrinhoId:'c-1',statusFinanceiro:'pendente'});
  assert.equal(executarRecuperacao(b.db,{agora:b.agora}).cupons,0);
  const c=fixture();
  c.db.collection('orders').insert({id:'pedido2',clienteId:'cliente-1',
    carrinhoId:'c-antigo',statusFinanceiro:'aprovado'});
  assert.equal(executarRecuperacao(c.db,{agora:c.agora}).cupons,0);
});
test('não oferece itens sanitários sensíveis nem medicamentos, mesmo com marketing aceito',()=>{
  const {db,agora}=fixture({categoria:'medicamentos-isentos-de-prescricao'});
  assert.equal(executarRecuperacao(db,{agora}).cupons,0);
  assert.equal(db.collection('evolutionWhatsappOutbox').count(),0);
});
test('o nome do produto só aparece se houver autorização explícita adicional',()=>{
  const {db,agora}=fixture({detalhes:true});
  assert.equal(executarRecuperacao(db,{agora}).cupons,1);
  assert.match(db.collection('evolutionWhatsappOutbox').all()[0].texto,/Fralda Desc 50 unidades/);
});
test('limites dos cupons e controle de ativação não aceitam valores arbitrários',()=>{
  const ok=validarConfigRecuperacao({
    ativo:'1',primeiroLembreteHoras:'1',enviarCupomAposHoras:'24',
    descontoPercentual:'7,5',descontoMaximo:'15,00',compraMinima:'60,00',
    validadeHoras:'2',intervaloDias:'15',apenasPrimeiraCompra:'1',
  });
  assert.equal(ok.ok,true);
  assert.equal(ok.config.descontoPercentual,7.5);
  assert.equal(ok.config.descontoMaximoCentavos,1500);
  assert.equal(ok.config.validadeHoras,2);
  assert.ok(ok.config.ativadoEm);
  assert.equal(validarConfigRecuperacao({...{
    ativo:'1',primeiroLembreteHoras:'1',enviarCupomAposHoras:'24',
    descontoMaximo:'15',compraMinima:'60',validadeHoras:'48',intervaloDias:'15',
  },descontoPercentual:'1000'}).ok,false);
  assert.equal(configRecuperacao(dbFake()).ativo,false,'automações começam desativadas');
});
test('a interface e o login restrito protegem o painel e recuperação',()=>{
  const admin=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const account=readFileSync(new URL('../src/routes/account.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/cloudflare/worker.js',import.meta.url),'utf8');
  assert.match(admin,/app\.get\('\/admin\/recuperacao-vendas'/);
  assert.match(admin,/app\.post\('\/admin\/recuperacao-vendas\/configurar'/);
  assert.match(account,/app\.get\('\/conta\/recuperar-carrinho\/:token'/);
  assert.match(account,/c\.clienteId===req\.user\.id/);
  assert.match(worker,/executarRecuperacao\(this\.db\)/);
  assert.match(worker,/temRecuperacaoMonitoravel\(this\.db\)/);
});
test('indicador de receita só soma pedidos com cupom recuperado e pagamento aprovado',()=>{
  const {db,agora}=fixture();
  executarRecuperacao(db,{agora});
  const cupom=db.collection('coupons').all()[0];
  db.collection('orders').insert({id:'p1',cupom:{cupomId:cupom.id},totalCentavos:15000,statusFinanceiro:'pendente'});
  db.collection('orders').insert({id:'p2',cupom:{cupomId:cupom.id},totalCentavos:14500,statusFinanceiro:'aprovado'});
  const resumo=painelRecuperacao(db);
  assert.equal(resumo.recuperados,1);
  assert.equal(resumo.receitaRecuperadaCentavos,14500);
});

test('cupom vira expirado no banco automaticamente e permanece inválido',async()=>{
 const {db,agora}=fixture();
 executarRecuperacao(db,{agora});
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 await processarFilaEvolution(db,{apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>({ok:true,status:200})});
 const cupom=db.collection('coupons').get(item.cupomId);
 assert.equal(cupom.ativo,true);
 const expira=Date.parse(cupom.expiraEm);
 assert.equal(expirarCuponsRecuperacao(db,{agora:expira+1}),1);
 assert.equal(db.collection('coupons').get(cupom.id).ativo,false);
 assert.equal(expirarCuponsRecuperacao(db,{agora:expira+2}),0);
});
test('fila cancela envio se o cliente voltou e atualizou o carrinho',async()=>{
 const {db,agora}=fixture({idade:2});
 executarRecuperacao(db,{agora});
 let enviou=false;
 db.collection('carts').update('c-1',{atualizadoEm:new Date(agora+30_000).toISOString()});
 const r=await processarFilaEvolution(db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>{enviou=true;return {ok:true};},
 });
 assert.equal(r.enviados,0);
 assert.equal(enviou,false);
 assert.equal(db.collection('evolutionWhatsappOutbox').all()[0].status,'cancelado');
});


test('modalidade local usa mesmo CEP da farmácia, sem confundir cliente de outro CEP',()=>{
 const l=fixture({cepDestino:'45970000',localAtivo:true,idade:2});
 const n=fixture({cepDestino:'29885000',localAtivo:true,idade:2});
 const inc=fixture({cepDestino:'',localAtivo:true,idade:2});
 const cliente=id=>id.db.collection('customers').get('cliente-1');
 const carrinho=id=>id.db.collection('carts').get('c-1');
 assert.equal(destinoRecuperacao(l.db,carrinho(l),cliente(l)),'local');
 assert.equal(destinoRecuperacao(n.db,carrinho(n),cliente(n)),'nacional');
 assert.equal(destinoRecuperacao(inc.db,carrinho(inc),cliente(inc)),'indefinido');
 const r=executarRecuperacao(l.db,{agora:l.agora});
 assert.equal(r.lembretes,1);
 assert.equal(l.db.collection('evolutionWhatsappOutbox').all()[0].modo,'local');
 assert.match(l.db.collection('evolutionWhatsappOutbox').all()[0].texto,/pagar na retirada ou no recebimento/);
 assert.equal(executarRecuperacao(inc.db,{agora:inc.agora}).lembretes,0);
});

test('local gera cupom exclusivo com desconto e prazo próprios, mesmo com nacional desligado',async()=>{
 const {db,agora}=fixture({cepDestino:'45970000',localAtivo:true,idade:5});
 db.collection('settings').update('recuperacaoVendas',{ativo:false,ativadoEm:null});
 assert.equal(configRecuperacao(db).ativo,false);
 const r=executarRecuperacao(db,{agora});
 assert.equal(r.cupons,1);
 assert.equal(r.locais,1);
 const outbox=db.collection('evolutionWhatsappOutbox').all();
 assert.equal(outbox.length,1);
 assert.equal(outbox[0].modo,'local');
 assert.match(outbox[0].texto,/pague apenas na retirada ou no recebimento/);
 assert.match(outbox[0].texto,/❤️ \*Farmácia Pague Pouco, cuidando da sua saúde\.\*/);
 const cupom=db.collection('coupons').get(outbox[0].cupomId);
 assert.match(cupom.codigo,/^PP-LOCAL-/);
 assert.equal(cupom.valor,7);
 assert.equal(cupom.descontoMaximoCentavos,1000);
 assert.equal(cupom.validadeHoras,2);
 assert.equal(cupom.ativo,false);
 assert.equal(cupom.modoRecuperacao,'local');
 const request=[];
 const x=await processarFilaEvolution(db,{
   apiKey:'fake',baseUrl:'https://evolution.example.com',
   enviar:async(url,opt)=>{request.push({url,body:JSON.parse(opt.body)});return {ok:true};},
 });
 assert.equal(x.enviados,1);
 assert.match(request[0].url,/message\/sendText\/numero-farmacia$/);
 assert.equal(request[0].body.number,'5573999998888');
 assert.equal(db.collection('coupons').get(cupom.id).ativo,true);
 const ativo=db.collection('coupons').get(cupom.id);
 assert.equal(Date.parse(ativo.expiraEm)-Date.parse(ativo.emitidoEm),2*3600_000);
 const itens=[{produtoId:'p1',categoriaId:'cat-1',quantidade:1,precoUnitarioCentavos:15000}];
 const usado=validarCupom(db,ativo.codigo,{subtotalCentavos:15000,itens,clienteId:'cliente-1'});
 assert.equal(usado.ok,true);
 assert.equal(usado.desconto,1000,'respeita teto local');
 assert.equal(validarCupom(db,ativo.codigo,{subtotalCentavos:15000,itens,clienteId:'cliente-2'}).ok,false);
 assert.equal(executarRecuperacao(db,{agora}).cupons,0,'não repete cupom');
});

test('pedido presencial pendente interrompe contatos, mas não aparece como receita paga',async()=>{
 const {db,agora}=fixture({cepDestino:'45970000',localAtivo:true,idade:5});
 executarRecuperacao(db,{agora});
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 const cupom=db.collection('coupons').get(item.cupomId);
 db.collection('orders').insert({id:'pedido-local',carrinhoId:'c-1',clienteId:'cliente-1',
   pagamentoPresencial:{metodo:'cash',confirmadoEm:null},
   cupom:{cupomId:cupom.id},statusFinanceiro:'pendente',totalCentavos:14000});
 const sent=[];
 const x=await processarFilaEvolution(db,{
   apiKey:'fake',baseUrl:'https://evolution.example.com',
   enviar:async()=>{sent.push(1);return {ok:true};},
 });
 assert.equal(x.enviados,0);
 assert.deepEqual(sent,[]);
 assert.equal(db.collection('evolutionWhatsappOutbox').get(item.id).status,'cancelado');
 const inicio=painelRecuperacao(db);
 assert.equal(inicio.pedidosLocaisGerados,1);
 assert.equal(inicio.pedidosLocaisPagos,0);
 assert.equal(inicio.receitaLocalCentavos,0);
 db.collection('orders').update('pedido-local',{
   statusFinanceiro:'aprovado',pagamentoPresencial:{metodo:'cash',confirmadoEm:new Date().toISOString()},
 });
 const fim=painelRecuperacao(db);
 assert.equal(fim.pedidosLocaisPagos,1);
 assert.equal(fim.receitaLocalCentavos,14000);
 assert.equal(executarRecuperacao(db,{agora}).cupons,0);
});

test('opções locais salvam com validação independente e preservam a nacional',()=>{
 const antes={...configRecuperacaoLocal(dbFake()),ativo:true,ativadoEm:'2026-11-01T12:00:00Z'};
 const ret=validarConfigRecuperacaoLocal({
   ativo:'1',primeiroLembreteHoras:'2',enviarCupomAposHoras:'5',
   descontoPercentual:'6,5',descontoMaximo:'12,90',compraMinima:'49,90',
   validadeHoras:'48',intervaloDias:'15',apenasPrimeiraCompra:'1',
 },antes);
 assert.equal(ret.ok,true);
 assert.equal(ret.config.descontoPercentual,6.5);
 assert.equal(ret.config.descontoMaximoCentavos,1290);
 assert.equal(ret.config.compraMinimaCentavos,4990);
 assert.equal(ret.config.ativadoEm,antes.ativadoEm);
 assert.equal(configRecuperacaoLocal(dbFake()).ativo,false);
 assert.equal(validarConfigRecuperacaoLocal({
   ativo:'1',primeiroLembreteHoras:'4',enviarCupomAposHoras:'4',
   descontoPercentual:'5',descontoMaximo:'15',compraMinima:'60',
   validadeHoras:'48',intervaloDias:'15',
 }).ok,false);
 const admin=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
 const view=readFileSync(new URL('../src/views/admin/recuperacao-vendas.js',import.meta.url),'utf8');
 assert.match(admin,/app\.post\('\/admin\/recuperacao-vendas\/local\/configurar'/);
 assert.match(admin,/patchSetting\(db,'recuperacaoVendasLocal'/);
 assert.match(view,/Recuperação local — configurações e cupons/);
});

test('mudança de destino antes do envio cancela campanha local e não entrega desconto errado',async()=>{
 const {db,agora}=fixture({cepDestino:'45970000',localAtivo:true,idade:5});
 executarRecuperacao(db,{agora});
 db.collection('customers').update('cliente-1',{
   enderecos:[{id:'end1',cep:'29885000',cidade:'Ponto Belo',uf:'ES',padrao:true}],
 });
 let called=0;
 const r=await processarFilaEvolution(db,{
   apiKey:'fake',baseUrl:'https://evolution.example.com',
   enviar:async()=>{called++;return {ok:true};},
 });
 assert.equal(r.enviados,0);
 assert.equal(called,0);
 assert.equal(db.collection('evolutionWhatsappOutbox').all()[0].status,'cancelado');
});


function pixOnlineFixture({idade=2,estado='pendente',consentido=true,cepPedido='29885000',metodo='pix'}={}) {
  const x=fixture({idade:26,cepDestino:'45970000',localAtivo:true});
  const {db,agora,iso}=x;
  db.collection('settings').insert({id:'recuperacaoPedidoOnline',ativo:true,
    ativadoEm:iso(48),primeiroLembreteHoras:1,enviarCupomAposHoras:4,
    descontoPercentual:7,descontoMaximoCentavos:2000,compraMinimaCentavos:6000,
    validadeHoras:24,intervaloDias:15,apenasPrimeiraCompra:true,maximoPorCiclo:8});
  db.collection('customers').update('cliente-1',{marketing:consentido});
  const pedido=db.collection('orders').insert({id:'pedido-online',codigo:'PP-1234',
    clienteId:'cliente-1',carrinhoId:'c-1',
    criadoEm:iso(idade),metodoPagamento:metodo,pagamentoId:'mp_101',
    pagamentoPresencial:null,pendenciaPagamento:null,
    statusFinanceiro:estado,totalCentavos:15200,
    endereco:{cep:cepPedido,cidade:'Ponto Belo',uf:'ES'},
  });
  const pago=estado==='expirado'?'expired':estado==='recusado'?'rejected':'pending';
  const pagamento=db.collection('payments').insert({id:'mp_101',
    pedidoId:pedido.id,metodo,provedor:'mercadopago',valorCentavos:15200,
    status:pago,ultimoStatusConfirmado:pago,
    ultimaConfirmacaoProvedorEm:new Date(agora-60_000).toISOString(),
  });
  return {...x,pedido,pagamento};
}
test('pedido online usa CEP do pedido e não o CEP local cadastrado no perfil',()=>{
 const {db,pedido,agora}=pixOnlineFixture();
 const cliente=db.collection('customers').get('cliente-1');
 assert.equal(cliente.enderecos[0].cep,'45970000');
 assert.equal(pedido.endereco.cep,'29885000');
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora}),true);
 const res=executarRecuperacao(db,{agora});
 assert.equal(res.pedidosLembretes,1);
 assert.equal(res.lembretes,0,'carrinho com pedido não recebe lembrete duplicado');
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 assert.equal(item.tipo,'recuperacao_pedido_lembrete');
 assert.match(item.texto,/pagamento do seu pedido/i);
 assert.match(item.texto,/\/conta\/pedidos\/PP-1234/);
 assert.doesNotMatch(item.texto,/Fralda Desc/);
 const msg=[];
 return processarFilaEvolution(db,{
   apiKey:'fake',baseUrl:'https://evolution.example.com',
   enviar:async(url,opts)=>{msg.push(JSON.parse(opts.body));return {ok:true};},
 }).then(r=>{
   assert.equal(r.enviados,1);
   assert.equal(msg[0].number,'5573999998888');
 });
});
test('Pix pendente após prazo de cupom não cria cobrança nem cupom enquanto válido',()=>{
 const {db,agora}=pixOnlineFixture({idade:6});
 const res=executarRecuperacao(db,{agora});
 assert.equal(res.pedidosCupons,0);
 assert.equal(db.collection('coupons').count(),0);
 assert.equal(db.collection('evolutionWhatsappOutbox').count(),0);
});
test('Pix encerrado por provedor cria cupom próprio sem reativar carrinho abandonado',async()=>{
 const {db,agora,pedido}=pixOnlineFixture({idade:6,estado:'expirado'});
 const res=executarRecuperacao(db,{agora});
 assert.equal(res.pedidosCupons,1);
 assert.equal(res.cupons,0);
 assert.equal(db.collection('evolutionWhatsappOutbox').count(),1);
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 assert.equal(item.tipo,'recuperacao_pedido_cupom');
 assert.match(item.texto,/novo pagamento/i);
 const cupom=db.collection('coupons').get(item.cupomId);
 assert.match(cupom.codigo,/^PP-PAGO-/);
 assert.equal(cupom.valor,7);
 assert.equal(cupom.descontoMaximoCentavos,2000);
 assert.equal(cupom.pedidoOrigemId,pedido.id);
 assert.equal(cupom.ativo,false);
 const out=[];
 const result=await processarFilaEvolution(db,{
   apiKey:'fake',baseUrl:'https://evolution.example.com',
   enviar:async(url,opt)=>{out.push(JSON.parse(opt.body));return {ok:true};},
 });
 assert.equal(result.enviados,1);
 assert.equal(out.length,1);
 assert.match(out[0].text,/recuperar-carrinho/);
 const ativo=db.collection('coupons').get(cupom.id);
 assert.equal(ativo.ativo,true);
 assert.equal(Date.parse(ativo.expiraEm)-Date.parse(ativo.emitidoEm),24*3_600_000);
 const itens=[{produtoId:'p1',categoriaId:'cat-1',quantidade:1,precoUnitarioCentavos:15000}];
 assert.equal(validarCupom(db,cupom.codigo,{subtotalCentavos:15000,
   clienteId:'cliente-1',itens}).desconto,1050);
 assert.equal(validarCupom(db,cupom.codigo,{subtotalCentavos:15000,
   clienteId:'outro',itens}).ok,false);
 assert.equal(executarRecuperacao(db,{agora}).pedidosCupons,0);
});
test('confirmação de pagamento antes do disparo cancela aviso e desconto',async()=>{
 const {db,agora}=pixOnlineFixture({idade:6,estado:'expirado'});
 executarRecuperacao(db,{agora});
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 const cupom=db.collection('coupons').get(item.cupomId);
 db.collection('orders').update('pedido-online',{statusFinanceiro:'aprovado'});
 const sent=[];
 const r=await processarFilaEvolution(db,{
   apiKey:'fake',baseUrl:'https://evolution.example.com',
   enviar:async()=>{sent.push(1);return {ok:true};},
 });
 assert.equal(r.enviados,0);
 assert.equal(sent.length,0);
 assert.equal(db.collection('evolutionWhatsappOutbox').get(item.id).status,'cancelado');
 assert.equal(db.collection('coupons').get(cupom.id).ativo,false);
});
test('consulta Pix antiga ou indefinida nunca afirma pagamento pendente',()=>{
 const {db,agora,pedido,pagamento}=pixOnlineFixture();
 db.collection('payments').update(pagamento.id,{
   ultimaConfirmacaoProvedorEm:new Date(agora-20*60_000).toISOString(),
 });
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora}),false);
 assert.equal(executarRecuperacao(db,{agora}).pedidosLembretes,0);
 db.collection('payments').update(pagamento.id,{
   ultimaConfirmacaoProvedorEm:new Date(agora).toISOString(),
   ultimoStatusConfirmado:'in_process',
 });
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora}),false);
});
test('pagar no recebimento, falta de marketing, provider interno e outra compra não disparam',()=>{
 const local=pixOnlineFixture({cepPedido:'45970000'});
 assert.equal(executarRecuperacao(local.db,{agora:local.agora}).pedidosLembretes,0);
 const sem=pixOnlineFixture({consentido:false});
 assert.equal(executarRecuperacao(sem.db,{agora:sem.agora}).pedidosLembretes,0);
 const fake=pixOnlineFixture();
 fake.db.collection('payments').update('mp_101',{provedor:'internal'});
 assert.equal(executarRecuperacao(fake.db,{agora:fake.agora}).pedidosLembretes,0);
 const nova=pixOnlineFixture();
 nova.db.collection('orders').insert({id:'pedido-novo',clienteId:'cliente-1',
   criadoEm:nova.iso(1),statusFinanceiro:'pendente'});
 assert.equal(executarRecuperacao(nova.db,{agora:nova.agora}).pedidosLembretes,0);
});
test('configuração de pedido online isolada, desligada de fábrica e limites comerciais',()=>{
 assert.equal(configRecuperacaoPedido(dbFake()).ativo,false);
 const ok=validarConfigRecuperacaoPedido({
   ativo:'1',primeiroLembreteHoras:'1',enviarCupomAposHoras:'6',
   descontoPercentual:'9,5',descontoMaximo:'20',compraMinima:'60',
   validadeHoras:'12',intervaloDias:'15',apenasPrimeiraCompra:'1',
 });
 assert.equal(ok.ok,true);
 assert.equal(ok.config.descontoPercentual,9.5);
 const admin=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/views/admin/recuperacao-vendas.js',import.meta.url),'utf8');
 const conta=readFileSync(new URL('../src/routes/account.js',import.meta.url),'utf8');
 const recon=readFileSync(new URL('../src/lib/payments/reconciliation.js',import.meta.url),'utf8');
 assert.match(admin,/app\.post\('\/admin\/recuperacao-vendas\/pedidos\/configurar'/);
 assert.match(ui,/Cupom de pedido não pago após/);
 assert.match(conta,/novoCarrinhoId\(\)/);
 assert.match(recon,/ultimaConfirmacaoProvedorEm/);
});


test('recuperação de pagamento aceita cartão de crédito pendente quando provedor confirma',()=>{
 const {db,agora,pedido,pagamento}=pixOnlineFixture({metodo:'credit_card',idade:2});
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora}),true);
 const r=executarRecuperacao(db,{agora});
 assert.equal(r.pedidosLembretes,1);
 assert.equal(r.lembretes,0);
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 assert.equal(item.tipo,'recuperacao_pedido_lembrete');
 assert.match(item.texto,/pagamento do seu pedido/);
 assert.doesNotMatch(item.texto,/pix/i);
 db.collection('payments').update(pagamento.id,{ultimoStatusConfirmado:'approved'});
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora}),false);
});
test('recuperação de cartão de débito recusado permite cupom só após status terminal confirmado',()=>{
 const {db,agora,pedido,pagamento}=pixOnlineFixture({
   metodo:'debit_card',idade:6,estado:'recusado'
 });
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora,cupom:true}),true);
 const r=executarRecuperacao(db,{agora});
 assert.equal(r.pedidosCupons,1);
 const cupom=db.collection('coupons').all()[0];
 assert.equal(cupom.modoRecuperacao,'pedido');
 assert.equal(cupom.valor,7);
 db.collection('payments').update(pagamento.id,{ultimoStatusConfirmado:'pending'});
 assert.equal(pedidoOnlineRecuperavel(db,pedido,{agora,cupom:true}),false);
});
test('nunca mistura método de pagamento do pedido com cobrança e não inclui dinheiro presencial',()=>{
 const x=pixOnlineFixture({metodo:'credit_card',idade:2});
 x.db.collection('payments').update('mp_101',{metodo:'pix'});
 assert.equal(pedidoOnlineRecuperavel(x.db,x.pedido,{agora:x.agora}),false);
 const y=pixOnlineFixture({metodo:'credit_card',idade:2});
 y.db.collection('orders').update(y.pedido.id,{pagamentoPresencial:{metodo:'card_machine'}});
 assert.equal(pedidoOnlineRecuperavel(y.db,y.db.collection('orders').get(y.pedido.id),{agora:y.agora}),false);
});
test('painel e testador não exibem modalidade limitada a Pix',()=>{
 const ui=readFileSync(new URL('../src/views/admin/recuperacao-vendas.js',import.meta.url),'utf8');
 const testador=readFileSync(new URL('../src/lib/recuperacao-teste-whatsapp.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../src/cloudflare/worker.js',import.meta.url),'utf8');
 assert.match(ui,/Pagamento global pendente/);
 assert.match(ui,/Lembretes de pagamento/);
 assert.doesNotMatch(ui,/Lembretes de Pix|Pedido global Pix|Pix não pago/);
 assert.match(testador,/Pagamento global pendente/);
 assert.doesNotMatch(testador,/Pedido global Pix pendente/);
 assert.match(worker,/reconciliarPagamentoOnline/);
 assert.match(worker,/temPagamentoOnlinePendente/);
});
