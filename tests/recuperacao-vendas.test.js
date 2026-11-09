import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minimoLembreteRecuperacao, executarRecuperacao, expirarCuponsRecuperacao, configRecuperacao, configRecuperacaoLocal, validarConfigRecuperacao, validarConfigRecuperacaoLocal, painelRecuperacao, diagnosticoCarrinhosRecuperacao, configRecuperacaoPedido, validarConfigRecuperacaoPedido, pedidoOnlineRecuperavel, enfileirarRecuperacaoCancelamentoCliente } from '../src/lib/recuperacao-vendas.js';
import { processarFilaEvolution } from '../src/lib/evolution-whatsapp.js';
import { validarCupom, normalizeCart, addItem } from '../src/lib/cart.js';
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
test('medicamento liberado para venda online não é bloqueado pela categoria',()=>{
  const {db,agora}=fixture({categoria:'medicamentos-isentos-de-prescricao'});
  const p=db.collection('products').get('p1');
  db.collection('products').update('p1',{sanitario:{classificacao:'isento_prescricao',
    registroMS:'1234567890123',aprovadoFarmaceutico:true}});
  const r=executarRecuperacao(db,{agora});
  assert.equal(r.cupons,1);
  assert.equal(db.collection('evolutionWhatsappOutbox').count(),1);
  assert.doesNotMatch(db.collection('evolutionWhatsappOutbox').all()[0].texto,/Fralda Desc/);
});
test('mensagem com cupom é curta e não expõe itens mesmo com detalhes autorizados',()=>{
  const {db,agora}=fixture({detalhes:true});
  assert.equal(executarRecuperacao(db,{agora}).cupons,1);
  const msg=db.collection('evolutionWhatsappOutbox').all()[0].texto;
  assert.doesNotMatch(msg,/Fralda Desc|esquecendo alguma coisa|TEMOS UM PRESENTE/i);
  assert.match(msg,/5% de desconto/);
  assert.match(msg,/🎟️ \*Cupom:\*/);
  assert.match(msg,/mínimo.*R\$/);
  assert.match(msg,/Validade.*48h/);
  assert.match(msg,/recuperar-carrinho/);
  assert(msg.length<420,'cupom global não deve ficar comprido');
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
 assert.match(outbox[0].texto,/Pague na retirada ou na entrega local/);
 assert.match(outbox[0].texto,/❤️ \*Farmácia Pague Pouco, cuidando da sua saúde\.\*/);
 assert.match(outbox[0].texto,/7% de desconto/);
 assert.match(outbox[0].texto,/\b2h após o envio/);
 assert(outbox[0].texto.length<430,'cupom local não deve ficar longo');
 assert.doesNotMatch(outbox[0].texto,/produtinhos|TEMOS UM PRESENTE|Sua seleção/i);
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
 assert.match(item.texto,/7% de desconto/);
 assert.match(item.texto,/\b24h após o envio/);
 assert.match(item.texto,/anterior não foi concluído/i);
 assert(item.texto.length<430,'cupom de pagamento não concluído não deve ficar longo');
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


test('consulta e reabertura da cesta não reiniciam o relógio da recuperação',()=>{
 const {db,agora}=fixture({idade:1.2});
 const antes=db.collection('carts').get('c-1');
 assert.equal(normalizeCart(db,antes).cart.atualizadoEm,antes.atualizadoEm);
 assert.equal(normalizeCart(db,db.collection('carts').get('c-1')).cart.atualizadoEm,
   antes.atualizadoEm,'segunda visita não altera o horário');
 const r=executarRecuperacao(db,{agora});
 assert.equal(r.lembretes,1,'cesta inativa por mais de uma hora recebe lembrete');
 const diag=diagnosticoCarrinhosRecuperacao(db,{agora});
 assert.equal(diag[0].situacao,'Na fila do WhatsApp');
});
test('alteração real de quantidade da cesta reinicia o prazo',()=>{
 const {db,agora}=fixture({idade:1.2});
 const carrinho=db.collection('carts').get('c-1');
 const r=addItem(db,carrinho,'p1',1);
 assert.equal(r.ok,true);
 const depois=db.collection('carts').get('c-1');
 assert(Date.parse(depois.atualizadoEm)>Date.parse(carrinho.atualizadoEm));
 const normalizado=normalizeCart(db,depois);
 assert.equal(normalizado.cart.atualizadoEm,depois.atualizadoEm);
 assert.equal(executarRecuperacao(db,{agora:Date.now()}).lembretes,0);
});
test('pedido antigo pendente de outra cesta não bloqueia carrinho novo',()=>{
 const {db,agora,iso}=fixture({idade:2});
 db.collection('orders').insert({id:'pedido-antigo',clienteId:'cliente-1',
   carrinhoId:'outra-cesta',statusFinanceiro:'pendente',
   metodoPagamento:'pix',criadoEm:iso(8)});
 const r=executarRecuperacao(db,{agora});
 assert.equal(r.lembretes,1);
 assert.match(diagnosticoCarrinhosRecuperacao(db,{agora})[0].situacao,/Na fila do WhatsApp/);
});
test('pedido pendente novo e mesma cesta impedem duplicação de recuperação',()=>{
 const {db,agora,iso}=fixture({idade:2});
 db.collection('orders').insert({id:'pedido-novo',clienteId:'cliente-1',
   carrinhoId:'outro-carrinho',statusFinanceiro:'pendente',
   metodoPagamento:'pix',criadoEm:iso(1)});
 assert.equal(executarRecuperacao(db,{agora}).lembretes,0);
 assert.match(diagnosticoCarrinhosRecuperacao(db,{agora})[0].situacao,
   /Pagamento posterior à cesta/);
});
test('diagnóstico explica ausência de consentimento sem divulgar itens e números',()=>{
 const {db,agora}=fixture({idade:2,marketing:false});
 const d=diagnosticoCarrinhosRecuperacao(db,{agora});
 assert.equal(d[0].situacao,'Cliente não autorizou mensagens promocionais');
 assert(!JSON.stringify(d).includes('73999998888'));
 assert(!JSON.stringify(d).includes('Fralda Desc'));
 const view=readFileSync(new URL('../src/views/admin/recuperacao-vendas.js',import.meta.url),'utf8');
 assert.match(view,/Diagnóstico de envio e prazo dos carrinhos/);
});
test('cesta de categoria não listada gera lembrete após uma hora quando vende online',()=>{
 const {db,agora}=fixture({idade:2,categoria:'vitaminas-e-suplementos'});
 assert.equal(executarRecuperacao(db,{agora}).lembretes,1);
 assert.match(diagnosticoCarrinhosRecuperacao(db,{agora})[0].situacao,
   /Na fila do WhatsApp/);
});


test('R$ 10 da loja libera lembrete mesmo com cupom configurado para R$ 60',async()=>{
 const x=fixture({idade:2,categoria:'suplementos'});
 x.db.collection('settings').insert({id:'loja',valorMinimoPedido:1000});
 assert.equal(minimoLembreteRecuperacao(x.db),1000);
 x.db.collection('products').update('p1',{precoCentavos:999});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,0);
 assert.match(diagnosticoCarrinhosRecuperacao(x.db,{agora:x.agora})[0].situacao,/abaixo do valor mínimo da loja/);
 x.db.collection('products').update('p1',{precoCentavos:1500});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
 const mensagem=x.db.collection('evolutionWhatsappOutbox').all()[0];
 assert.equal(mensagem.tipo,'recuperacao_lembrete');
 assert.equal((await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>({ok:true,status:200}),
 })).enviados,1,'WhatsApp deve enviar lembrete de R$ 15 apesar do mínimo R$ 60 do cupom');
 const y=fixture({idade:26,categoria:'suplementos'});
 y.db.collection('products').update('p1',{precoCentavos:1500});
 assert.equal(executarRecuperacao(y.db,{agora:y.agora}).cupons,0,'cupom ainda exige R$ 60');
 y.db.collection('products').update('p1',{precoCentavos:6000});
 assert.equal(executarRecuperacao(y.db,{agora:y.agora}).cupons,1);
});
test('três produtos de categorias diferentes contam juntos sem exigir categoria especial',async()=>{
 const {db,agora}=fixture({idade:2,categoria:'higiene-pessoal'});
 const novo=(id,categoriaId,slug,preco)=> {
   db.collection('categories').insert({id:categoriaId,nome:slug,slug});
   db.collection('products').insert({id,ativo:true,nome:'Produto '+id,
     categoriaId,precoCentavos:preco,estoque:{quantidade:50,reservado:0},
     sanitario:{classificacao:'nao_aplicavel'}});
 };
 novo('p2','cat2','suplementos',2000);
 novo('p3','cat3','testes-e-aparelhos',2000);
 db.collection('products').update('p1',{precoCentavos:1900});
 db.collection('carts').update('c-1',{itens:[
   {produtoId:'p1',quantidade:1,precoUnitarioCentavos:1900},
   {produtoId:'p2',quantidade:1,precoUnitarioCentavos:2000},
   {produtoId:'p3',quantidade:1,precoUnitarioCentavos:2000},
 ]});
 assert.equal(executarRecuperacao(db,{agora}).lembretes,1,'R$ 59,00 supera R$ 10 da loja; os três itens contam');
 db.collection('products').update('p3',{precoCentavos:2200});
 assert.equal(executarRecuperacao(db,{agora}).lembretes,0,'não duplica lembrete de cesta já processada');
 const msg=await processarFilaEvolution(db,{apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>({ok:true,status:200})});
 assert.equal(msg.enviados,1);
});
test('cliente recorrente recebe lembrete mesmo com cupom de primeira compra ativo',()=>{
 const x=fixture({idade:2});
 x.db.collection('orders').insert({id:'antigo-aprovado',clienteId:'cliente-1',
   carrinhoId:'outro',statusFinanceiro:'aprovado'});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
 const y=fixture({idade:26});
 y.db.collection('orders').insert({id:'antigo-aprovado',clienteId:'cliente-1',
   carrinhoId:'outro',statusFinanceiro:'aprovado'});
 assert.equal(executarRecuperacao(y.db,{agora:y.agora}).cupons,0);
});
test('carrinho com medicamento sujeito a receita e bloqueado para venda permanece fora',()=>{
 const x=fixture({idade:2,categoria:'medicamentos'});
 x.db.collection('products').update('p1',{sanitario:{classificacao:'controlado',requerReceita:true}});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,0);
 assert.match(diagnosticoCarrinhosRecuperacao(x.db,{agora:x.agora})[0].situacao,
   /bloqueados para venda online/);
});


test('valor mínimo do checkout pode ser alterado e não segue desconto do cupom',()=>{
 const x=fixture({idade:2});
 x.db.collection('settings').insert({id:'loja',valorMinimoPedido:2000});
 x.db.collection('products').update('p1',{precoCentavos:1500});
 assert.equal(minimoLembreteRecuperacao(x.db),2000);
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,0);
 x.db.collection('products').update('p1',{precoCentavos:2100});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
});
test('recuperação local usa R$ 10 para lembrete e R$ 60 para cupom',()=>{
 const x=fixture({idade:2,cepDestino:'45970000',localAtivo:true});
 x.db.collection('settings').insert({id:'loja',valorMinimoPedido:1000});
 x.db.collection('products').update('p1',{precoCentavos:1200});
 const result=executarRecuperacao(x.db,{agora:x.agora});
 assert.equal(result.lembretes,1);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').all()[0].modo,'local');
 const y=fixture({idade:26,cepDestino:'45970000',localAtivo:true});
 y.db.collection('products').update('p1',{precoCentavos:1200});
 assert.equal(executarRecuperacao(y.db,{agora:y.agora}).cupons,0);
});
test('pagamento pendente R$ 15 gera lembrete, cupom somente acima do mínimo promocional',()=>{
 const x=pixOnlineFixture({idade:2});
 x.db.collection('products').update('p1',{precoCentavos:1500});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).pedidosLembretes,1);
 const y=pixOnlineFixture({idade:6,estado:'expirado'});
 y.db.collection('products').update('p1',{precoCentavos:1500});
 assert.equal(executarRecuperacao(y.db,{agora:y.agora}).pedidosCupons,0);
});
test('painel descreve mínimo da loja separadamente do valor de liberar cupom',()=>{
 const view=readFileSync(new URL('../src/views/admin/recuperacao-vendas.js',import.meta.url),'utf8');
 assert.match(view,/Compra mínima para liberar cupom/);
 assert.match(view,/mínimo de compra da loja/);
 assert.doesNotMatch(view,/Valor mínimo da cesta para lembrete e cupom/);
});


test('carrinho de R$ 15 ainda recebe lembrete quando cupom venceu antes do ciclo',()=>{
 const x=fixture({idade:26,categoria:'vitaminas'});
 x.db.collection('products').update('p1',{precoCentavos:1500});
 const r=executarRecuperacao(x.db,{agora:x.agora});
 assert.equal(r.lembretes,1);
 assert.equal(r.cupons,0);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').all()[0].tipo,'recuperacao_lembrete');
});
test('pedido antigo pendente não cancela lembrete após entrar na fila',async()=>{
 const x=fixture({idade:2,categoria:'higiene'});
 x.db.collection('products').update('p1',{precoCentavos:1500});
 x.db.collection('orders').insert({id:'pedido-antigo-pendente',clienteId:'cliente-1',
   carrinhoId:'outro-carrinho',criadoEm:x.iso(7),
   statusFinanceiro:'pendente',metodoPagamento:'pix'});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
 const r=await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>({ok:true,status:200}),
 });
 assert.equal(r.enviados,1);
});


test('alterar produtos cancela lembrete antigo e agenda novo após 1 hora, sem duplicar',async()=>{
 const x=fixture({idade:2});
 const primeira=executarRecuperacao(x.db,{agora:x.agora});
 assert.equal(primeira.lembretes,1);
 const antiga=x.db.collection('evolutionWhatsappOutbox').all()[0];
 const antes=x.db.collection('carts').get('c-1');
 // O cliente modifica a cesta enquanto a mensagem antiga ainda está na fila.
 const editada=new Date(x.agora+30_000).toISOString();
 x.db.collection('carts').update('c-1',{itens:[...antes.itens,{produtoId:'p1',quantidade:1}],
   atualizadoEm:editada});
 const enviadas=[];
 const cancelamento=await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async(...args)=>{enviadas.push(args);return {ok:true,status:200};},
 });
 assert.equal(cancelamento.enviados,0);
 assert.equal(enviadas.length,0);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').get(antiga.id).status,'cancelado');
 const antesDoPrazo=executarRecuperacao(x.db,{agora:Date.parse(editada)+59*60_000});
 assert.equal(antesDoPrazo.lembretes,0,'não antecipa o envio após alteração');
 const diag=diagnosticoCarrinhosRecuperacao(x.db,{agora:Date.parse(editada)+59*60_000});
 assert.equal(diag[0].situacao,'Aguardando completar prazo de inatividade',
   'diagnóstico deve ignorar o lembrete cancelado do ciclo anterior');
 const depois=executarRecuperacao(x.db,{agora:Date.parse(editada)+61*60_000});
 assert.equal(depois.lembretes,1,'enfileira novo lembrete depois do novo prazo');
 const novas=x.db.collection('evolutionWhatsappOutbox').all();
 assert.equal(novas.length,2);
 const segunda=novas.find(i=>i.id!==antiga.id);
 assert.notEqual(segunda.id,antiga.id);
 assert.equal(segunda.carrinhoAtualizadoEm,editada);
 assert.equal(segunda.status,'fila');
 assert.equal(executarRecuperacao(x.db,{agora:Date.parse(editada)+70*60_000}).lembretes,0);
 const envio=await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async(...args)=>{enviadas.push(args);return {ok:true,status:200};},
 });
 assert.equal(envio.enviados,1);
 assert.equal(enviadas.length,1);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').get(segunda.id).status,'enviado');
 assert.equal(executarRecuperacao(x.db,{agora:Date.parse(editada)+80*60_000}).lembretes,0);
});
test('lembrete já entregue só é enviado de novo após edição e nova hora completa',async()=>{
 const x=fixture({idade:2});
 executarRecuperacao(x.db,{agora:x.agora});
 const calls=[];
 assert.equal((await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async(url,o)=>{calls.push(JSON.parse(o.body));return {ok:true,status:200};},
 })).enviados,1);
 const oldId=x.db.collection('evolutionWhatsappOutbox').all()[0].id;
 const editada=new Date(x.agora+60_000).toISOString();
 x.db.collection('carts').update('c-1',{atualizadoEm:editada});
 assert.equal(executarRecuperacao(x.db,{agora:Date.parse(editada)+59*60_000}).lembretes,0);
 assert.equal(executarRecuperacao(x.db,{agora:Date.parse(editada)+60*60_000}).lembretes,1);
 const fila=x.db.collection('evolutionWhatsappOutbox').all();
 assert.equal(fila.length,2);
 assert.notEqual(fila[1].id,oldId);
 assert.equal((await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async(url,o)=>{calls.push(JSON.parse(o.body));return {ok:true,status:200};},
 })).enviados,1);
 assert.equal(calls.length,2);
});
test('recuperação local também reinicia prazo após alteração de produtos',async()=>{
 const x=fixture({idade:2,cepDestino:'45970000',localAtivo:true});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
 const antiga=x.db.collection('evolutionWhatsappOutbox').all()[0];
 const novaAtividade=new Date(x.agora+1000).toISOString();
 x.db.collection('carts').update('c-1',{atualizadoEm:novaAtividade});
 await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>{throw Error('mensagem antiga não pode sair')},
 });
 assert.equal(x.db.collection('evolutionWhatsappOutbox').get(antiga.id).status,'cancelado');
 assert.equal(executarRecuperacao(x.db,{agora:Date.parse(novaAtividade)+61*60_000}).lembretes,1);
 const nova=x.db.collection('evolutionWhatsappOutbox').all()[1];
 assert.equal(nova.modo,'local');
 assert.notEqual(nova.id,antiga.id);
 assert.equal(nova.carrinhoAtualizadoEm,novaAtividade);
});
test('cupom cancelado por alteração não impede novo cupom e não ativa o antigo',async()=>{
 const x=fixture({idade:26});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).cupons,1);
 const antiga=x.db.collection('evolutionWhatsappOutbox').all()[0];
 const cupomAntigo=x.db.collection('coupons').get(antiga.cupomId);
 const editada=new Date(x.agora+10_000).toISOString();
 x.db.collection('carts').update('c-1',{atualizadoEm:editada});
 const r=await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>{throw Error('cupom antigo não pode ser enviado')},
 });
 assert.equal(r.enviados,0);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').get(antiga.id).status,'cancelado');
 assert.equal(x.db.collection('coupons').get(cupomAntigo.id).ativo,false);
 const posterior=Date.parse(editada)+26*3_600_000;
 assert.equal(executarRecuperacao(x.db,{agora:posterior}).cupons,1,
  'cupom cancelado não consome 15 dias e não bloqueia a versão atual');
 const novos=x.db.collection('evolutionWhatsappOutbox').all();
 assert.equal(novos.length,2);
 const novo=novos[1];
 assert.equal(novo.status,'fila');
 assert.notEqual(novo.cupomId,antiga.cupomId);
});
test('campanha antiga de recuperação local não bloqueia nova global após troca de CEP',async()=>{
 const x=fixture({idade:2,cepDestino:'45970000',localAtivo:true});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
 const anterior=x.db.collection('evolutionWhatsappOutbox').all()[0];
 const editada=new Date(x.agora+1_000).toISOString();
 x.db.collection('carts').update('c-1',{atualizadoEm:editada});
 x.db.collection('customers').update('cliente-1',{
   enderecos:[{id:'end-externo',cep:'29885000',cidade:'Ponto Belo',uf:'ES',padrao:true}],
 });
 await processarFilaEvolution(x.db,{
   apiKey:'teste',baseUrl:'https://evolution.example.com',
   enviar:async()=>{throw Error('campanha antiga não pode ser enviada')},
 });
 assert.equal(x.db.collection('evolutionWhatsappOutbox').get(anterior.id).status,'cancelado');
 const r=executarRecuperacao(x.db,{agora:Date.parse(editada)+61*60_000});
 assert.equal(r.lembretes,1);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').all()[1].modo,'nacional');
});
test('legado já enviado na versão atual não é reenviado após atualização do código',()=>{
 const x=fixture({idade:2});
 const c=x.db.collection('carts').get('c-1');
 x.db.collection('evolutionWhatsappOutbox').insert({id:'recuperacao:lembrete:c-1',
   tipo:'recuperacao_lembrete',status:'enviado',criadoEm:new Date(x.agora-30*60_000).toISOString(),
   clienteId:'cliente-1',carrinhoId:'c-1',modo:'nacional'});
 assert(Date.parse(x.db.collection('evolutionWhatsappOutbox').all()[0].criadoEm)>Date.parse(c.atualizadoEm));
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,0);
 assert.equal(x.db.collection('evolutionWhatsappOutbox').count(),1);
});
test('legado cancelado antes da última edição não bloqueia a nova versão',()=>{
 const x=fixture({idade:2});
 x.db.collection('evolutionWhatsappOutbox').insert({id:'recuperacao:lembrete:c-1',
   tipo:'recuperacao_lembrete',status:'cancelado',criadoEm:x.iso(3),
   clienteId:'cliente-1',carrinhoId:'c-1',modo:'nacional'});
 assert.equal(executarRecuperacao(x.db,{agora:x.agora}).lembretes,1);
 const mensagens=x.db.collection('evolutionWhatsappOutbox').all();
 assert.equal(mensagens.length,2);
 assert.notEqual(mensagens[1].id,mensagens[0].id);
});
test('pedido já criado impede reagendamento mesmo se o carrinho for alterado',()=>{
 const x=fixture({idade:2});
 executarRecuperacao(x.db,{agora:x.agora});
 x.db.collection('orders').insert({id:'pedido-pago',carrinhoId:'c-1',
   clienteId:'cliente-1',statusFinanceiro:'aprovado'});
 const novoHorario=new Date(x.agora+10_000).toISOString();
 x.db.collection('carts').update('c-1',{atualizadoEm:novoHorario});
 assert.equal(executarRecuperacao(x.db,{agora:Date.parse(novoHorario)+3_600_000}).lembretes,0);
});


function prepararCancelamentoCliente({
  marketing=true, local=false, ativa=true, ultimoStatus='pending',
}={}) {
 const x=fixture({idade:0.05,marketing,localAtivo:local,
   cepDestino:local?'45970000':'29885000'});
 x.db.collection('settings').insert({id:'recuperacaoPedidoOnline',
   ativo:ativa,primeiroLembreteHoras:1});
 if(local) x.db.collection('settings').update('recuperacaoVendasLocal',{ativo:ativa});
 const agora=new Date().toISOString();
 x.db.collection('orders').insert({id:'pedido-cancelado',codigo:'PP-CANCELADO',
   clienteId:'cliente-1',carrinhoId:'c-1',
   metodoPagamento:local?'cash':'credit_card',
   statusFinanceiro:'recusado',statusOperacional:'cancelado',
   pagamentoId:local?null:'mp_pref_123',
   pagamentoPresencial:local?{metodo:'cash'}:null,
   criadoEm:agora,canceladoPeloClienteEm:agora,
   itens:[{produtoId:'p1',quantidade:1}],totalCentavos:15000});
 if(!local)x.db.collection('payments').insert({id:'mp_pref_123',
   pedidoId:'pedido-cancelado',metodo:'credit_card',provedor:'mercadopago',
   valorCentavos:15000,status:ultimoStatus});
 return x;
}
test('cancelamento voluntário do cartão enfileira WhatsApp imediatamente, sem aguardar uma hora',async()=>{
 const {db}=prepararCancelamentoCliente();
 const r=enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado');
 assert.equal(r.ok,true);
 assert.equal(r.enfileirado,true);
 assert.equal(db.collection('evolutionWhatsappOutbox').count(),1);
 const item=db.collection('evolutionWhatsappOutbox').all()[0];
 assert.equal(item.tipo,'recuperacao_cancelamento_cliente');
 assert.match(item.texto,/Refazer minha compra/);
 assert.match(item.texto,/recuperar-carrinho/);
 assert.match(item.texto,/Não utilize o link de pagamento anterior/);
 assert.doesNotMatch(item.texto,/Fralda Desc|cupom|desconto/i);
 assert(item.texto.length<400);
 assert.equal(db.collection('coupons').count(),0,'não cria cupom no cancelamento');
 assert.equal(enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado').duplicado,true);
 const requests=[];
 const response=await processarFilaEvolution(db,{
   baseUrl:'https://evolution.example.com',apiKey:'teste',
   enviar:async(url,options)=>{
     requests.push(JSON.parse(options.body));
     return {ok:true,status:200};
   },
 });
 assert.equal(response.enviados,1);
 assert.equal(requests.length,1);
 assert.equal(db.collection('evolutionWhatsappOutbox').all()[0].status,'enviado');
});
test('cancelamento local também envia aviso imediato, sem cupom e sem cobrança nova',async()=>{
 const {db}=prepararCancelamentoCliente({local:true});
 assert.equal(enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado').ok,true);
 const x=await processarFilaEvolution(db,{
   baseUrl:'https://evolution.example.com',apiKey:'teste',
   enviar:async()=>({ok:true,status:200}),
 });
 assert.equal(x.enviados,1);
 assert.equal(db.collection('payments').count(),0);
 assert.equal(db.collection('coupons').count(),0);
});
test('sem autorização de marketing não envia tentativa de recuperação de venda cancelada',()=>{
 const {db}=prepararCancelamentoCliente({marketing:false});
 const x=enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado');
 assert.equal(x.ok,false);
 assert.equal(db.collection('evolutionWhatsappOutbox').count(),0);
});
test('campanha desligada ou cancelamento automático não geram WhatsApp de recuperação',()=>{
 const x=prepararCancelamentoCliente({ativa:false});
 assert.equal(enfileirarRecuperacaoCancelamentoCliente(x.db,'pedido-cancelado').ok,false);
 const y=prepararCancelamentoCliente();
 y.db.collection('orders').update('pedido-cancelado',{canceladoPeloClienteEm:null});
 assert.equal(enfileirarRecuperacaoCancelamentoCliente(y.db,'pedido-cancelado').ok,false);
});
test('pagamento em análise ou aprovado não autoriza oferta imediata após cancelar',()=>{
 for(const ultimoStatus of ['approved','authorized','in_process','refunded']){
   const {db}=prepararCancelamentoCliente({ultimoStatus});
   assert.equal(enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado').ok,false);
   assert.equal(db.collection('evolutionWhatsappOutbox').count(),0);
 }
});
test('cliente que fizer outro pedido antes do envio não recebe tentativa de recuperação',async()=>{
 const {db}=prepararCancelamentoCliente();
 assert.equal(enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado').ok,true);
 const cancelado=db.collection('orders').get('pedido-cancelado');
 db.collection('orders').insert({id:'pedido-seguinte',clienteId:'cliente-1',
   criadoEm:new Date(Date.parse(cancelado.canceladoPeloClienteEm)+1000).toISOString(),
   statusFinanceiro:'pendente'});
 const response=await processarFilaEvolution(db,{
   baseUrl:'https://evolution.example.com',apiKey:'teste',
   enviar:async()=>{throw Error('não deve enviar')},
 });
 assert.equal(response.enviados,0);
 assert.equal(db.collection('evolutionWhatsappOutbox').all()[0].status,'cancelado');
});
test('cliente que desativa marketing na fila não recebe mensagem de cancelamento',async()=>{
 const {db}=prepararCancelamentoCliente();
 assert.equal(enfileirarRecuperacaoCancelamentoCliente(db,'pedido-cancelado').ok,true);
 db.collection('customers').update('cliente-1',{marketing:false});
 const r=await processarFilaEvolution(db,{
   baseUrl:'https://evolution.example.com',apiKey:'teste',
   enviar:async()=>{throw Error('não deve enviar')},
 });
 assert.equal(r.enviados,0);
 assert.equal(db.collection('evolutionWhatsappOutbox').all()[0].status,'cancelado');
});
test('link de cancelamento restaura cesta nova autenticada e só uma vez',()=>{
 const account=readFileSync(new URL('../src/routes/account.js',import.meta.url),'utf8');
 assert.match(account,/canceladoPeloClienteEm:new Date\(\)\.toISOString\(\)/);
 assert.match(account,/enfileirarRecuperacaoCancelamentoCliente\(db,pedido\.id\)/);
 assert.match(account,/campanha\?\.modo==='cancelamento'/);
 assert.match(account,/carrinhoRestauradoId/);
 assert.match(account,/id:novoCarrinhoId\(\),clienteId:req\.user\.id/);
 assert.match(account,/cupom:null,frete:null/);
 assert.doesNotMatch(account,/cobranca\.checkoutUrl.*recuperar-carrinho/);
});
