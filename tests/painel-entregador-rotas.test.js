import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { createSession, csrfOk } from '../src/lib/security.js';
import { registrarMovimentoEstoque } from '../src/lib/orders.js';
import { processarFilaEvolution } from '../src/lib/evolution-whatsapp.js';
import {
  cpfValido, novoEntregador, editarEntregador, loginEntregador,
  entregasDisponiveis, iniciarRota, rotaAtiva, atualizarEntrega,
} from '../src/lib/entregadores.js';
import { telaPainelEntregador } from '../src/views/entregadores.js';

function dbFake() {
 const cols=new Map();
 return {collection(name){
   if(!cols.has(name))cols.set(name,new Collection({_commit(){}},name));
   return cols.get(name);
 }};
}
const cpf='52998224725',senha='Segura12345!';
function fixture(){
 const db=dbFake(),agora=new Date().toISOString();
 db.collection('settings').insert({id:'empresa',endereco:{cep:'45970000',cidade:'Itanhém',uf:'BA'}});
 db.collection('settings').insert({id:'evolutionWhatsapp',ativo:true,instancia:'loja',
   avisarResponsavel:true,avisarCliente:true});
 const customer=db.collection('customers').insert({
   id:'cliente-1',nome:'Cliente Teste',telefone:'73999998888',
   ativo:true,consentimentoWhatsappPedidos:{ativo:true,numero:'5573999998888',versao:1},
 });
 const driver=novoEntregador(db,{nome:'Motoboy Teste',cpf,senha}).entregador;
 db.collection('products').insert({id:'produto',nome:'Produto comum',
   ativo:true,precoCentavos:2500,estoque:{quantidade:100,reservado:0},
   sanitario:{classificacao:'nao_aplicavel'}});
 function pedido(id,{frete='entrega_local',cep='45970000',status='pendente',
   operacional='em_separacao',recebido=true,autorizou=true}={}){
   const x=db.collection('orders').insert({
     id,codigo:'PP-'+id,clienteId:customer.id,cliente:{
       nome:customer.nome,telefone:customer.telefone,email:'cliente@example.invalid',
     },endereco:{cep,logradouro:'Rua da Escola',numero:'15',bairro:'Centro',
       cidade:'Itanhém',uf:'BA'},freteOpcao:{id:frete,label:frete},
     pagamentoPresencial:{metodo:'cash',status:'aguardando_recebimento'},
     metodoPagamento:'cash',pagamentoId:null,
     receberWhatsappPedido:autorizou,criadoEm:agora,
     statusFinanceiro:status,statusOperacional:operacional,
     ...(recebido?{pedidoRecebidoEm:agora}:{}),
     totalCentavos:2500,itens:[{produtoId:'produto',nome:'Produto comum',
       quantidade:1,precoUnitarioCentavos:2500,subtotalCentavos:2500}],
     historico:[],
   });
   if(status==='pendente')
     registrarMovimentoEstoque(db,{
       produtoId:'produto',tipo:'reserva',quantidade:1,origem:'pedido',
       pedidoId:id,observacao:'Teste de reserva',
     });
   return x;
 }
 return {db,driver,pedido,customer};
}
test('CPF válido, senha scrypt e revogação de sessões independentes',()=>{
 const {db,driver}=fixture();
 assert(cpfValido('529.982.247-25'));
 assert(!cpfValido('111.111.111-11'));
 assert(!cpfValido('52998224726'));
 assert.equal(loginEntregador(db,cpf,senha).id,driver.id);
 assert.equal(loginEntregador(db,cpf,'senha-errada'),null);
 assert.equal(novoEntregador(db,{nome:'Duplicado',cpf,senha}).ok,false);
 const sid=createSession(db,'driver',driver.id);
 const customer=createSession(db,'customer','customer-one');
 assert.equal(editarEntregador(db,driver.id,{senha:'NovaSenha2026!'}).ok,true);
 assert.equal(db.collection('sessions').get(sid),null);
 assert(db.collection('sessions').get(customer));
 assert.equal(loginEntregador(db,cpf,senha),null);
 assert.equal(loginEntregador(db,cpf,'NovaSenha2026!').id,driver.id);
 assert.equal(editarEntregador(db,driver.id,{ativo:false}).ok,true);
 assert.equal(loginEntregador(db,cpf,'NovaSenha2026!'),null);
});
test('CSRF de entregador só aceita token da própria sessão',()=>{
 const req={path:'/entregador/rotas/iniciar',method:'POST',
   headers:{'x-csrf-token':'csrf-driver'},cookies:{pp_csrf:'csrf-visitante'},
   entregadorSession:{csrf:'csrf-driver'},session:{csrf:'csrf-cliente'}};
 assert.equal(csrfOk(req),true);
 req.headers['x-csrf-token']='csrf-cliente';
 assert.equal(csrfOk(req),false);
 req.headers['x-csrf-token']='csrf-visitante';
 assert.equal(csrfOk(req),false);
});
test('disponibiliza só entrega local pronta, não retirada/transportadora/cancelado',()=>{
 const {db,pedido}=fixture();
 pedido('local-1');
 pedido('retirada',{frete:'retirada'});
 pedido('externo',{frete:'me_correios',cep:'45970001'});
 pedido('sem-conferencia',{recebido:false});
 pedido('cancelado',{operacional:'cancelado'});
 const ids=entregasDisponiveis(db).map(x=>x.id);
 assert.deepEqual(ids,['local-1']);
});
test('cria rota na ordem clicada; atribuição é exclusiva e tem notificações consentidas',()=>{
 const {db,driver,pedido}=fixture();
 pedido('entrega-1');
 pedido('entrega-2');
 pedido('retirada',{frete:'retirada'});
 assert.equal(iniciarRota(db,driver.id,['entrega-1','entrega-1']).ok,false);
 assert.equal(iniciarRota(db,driver.id,['retirada']).ok,false);
 assert.equal(db.collection('rotasEntregadores').count(),0);
 const r=iniciarRota(db,driver.id,['entrega-2','entrega-1']);
 assert.equal(r.ok,true);
 assert.deepEqual(r.rota.itens.map(x=>[x.pedidoId,x.numero,x.status]),
   [['entrega-2',1,'indo'],['entrega-1',2,'aguardando']]);
 assert.equal(db.collection('orders').get('entrega-1').statusOperacional,'saiu_para_entrega');
 assert.equal(db.collection('orders').get('entrega-2').statusOperacional,'saiu_para_entrega');
 assert.equal(db.collection('evolutionWhatsappOutbox').count(),3);
 const textos=db.collection('evolutionWhatsappOutbox').all().map(x=>x.texto);
 assert(textos.some(t=>t.includes('1 entrega(s) antes da sua')));
 assert(textos.some(t=>t.includes('está indo para seu endereço')));
 assert.equal(iniciarRota(db,driver.id,['entrega-1']).ok,false);
 const outro=novoEntregador(db,{nome:'Outro Motoboy',cpf:'11144477735',senha}).entregador;
 assert.equal(iniciarRota(db,outro.id,['entrega-1']).ok,false);
});
test('primeira entrega exige chegada e pagamento recebido antes de finalizar',()=>{
 const {db,driver,pedido}=fixture();
 pedido('um');
 pedido('dois');
 const rota=iniciarRota(db,driver.id,['um','dois']).rota;
 assert.equal(atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'dois',acao:'cheguei',
 }).ok,false);
 assert.equal(atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'um',acao:'conclui',
 }).ok,false);
 const chegou=atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'um',acao:'cheguei',
 });
 assert.equal(chegou.ok,true);
 assert.equal(db.collection('orders').get('um').statusEntregaLocal,'chegou');
 const semConfirmar=atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'um',acao:'conclui',
   recebimento:{metodoRecebido:'cash'},
 });
 assert.equal(semConfirmar.ok,false);
 assert.equal(db.collection('orders').get('um').statusFinanceiro,'pendente');
 const concluido=atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'um',acao:'conclui',
   recebimento:{metodoRecebido:'cash',confirmouRecebimento:'1'},
 });
 assert.equal(concluido.ok,true);
 assert.equal(db.collection('orders').get('um').statusFinanceiro,'aprovado');
 assert.equal(db.collection('orders').get('um').statusOperacional,'entregue');
 assert.equal(concluido.rota.itens[1].status,'indo');
 assert.equal(db.collection('products').get('produto').estoque.reservado,1);
 assert.equal(atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'um',acao:'conclui',
   recebimento:{metodoRecebido:'cash',confirmouRecebimento:'1'},
 }).ok,false);
 const pedidoSeguinte=db.collection('orders').get('dois');
 assert.equal(pedidoSeguinte.statusEntregaLocal,'indo');
});
test('problema na entrega segue para a próxima, sem fingir pagamento nem conclusão',()=>{
 const {db,driver,pedido}=fixture();
 pedido('um');pedido('dois');
 const rota=iniciarRota(db,driver.id,['um','dois']).rota;
 const r=atualizarEntrega(db,{
   entregadorId:driver.id,rotaId:rota.id,pedidoId:'um',acao:'problema',
 });
 assert.equal(r.ok,true);
 assert.equal(db.collection('orders').get('um').statusFinanceiro,'pendente');
 assert.equal(db.collection('orders').get('um').statusOperacional,'saiu_para_entrega');
 assert.equal(db.collection('orders').get('um').statusEntregaLocal,'pendencia_entrega');
 assert.equal(r.rota.itens[1].status,'indo');
});
test('não expõe mensagem transacional sem autorização de WhatsApp',()=>{
 const {db,driver,pedido}=fixture();
 pedido('um',{autorizou:false});
 const rota=iniciarRota(db,driver.id,['um']).rota;
 assert(rota);
 assert.equal(db.collection('evolutionWhatsappOutbox').count(),0);
});
test('evita enviar mensagem atrasada depois de outra etapa ou revogação',async()=>{
 const {db,driver,pedido}=fixture();
 pedido('um');
 const rota=iniciarRota(db,driver.id,['um']).rota;
 db.collection('customers').update('cliente-1',{
   consentimentoWhatsappPedidos:{ativo:false,numero:'5573999998888'},
 });
 const enviados=[];
 const r=await processarFilaEvolution(db,{
   baseUrl:'https://evolution.example.com',apiKey:'fake',
   enviar:async(...args)=>{enviados.push(args);return {ok:true,status:200}},
 });
 assert.equal(r.enviados,0);
 assert.equal(enviados.length,0);
 assert(db.collection('evolutionWhatsappOutbox').all()
   .every(x=>x.status==='cancelado'));
});
test('tela mobile numera manualmente e não contém GPS ou mapa',()=>{
 const {db,driver,pedido}=fixture();
 pedido('um');pedido('dois');
 const html=telaPainelEntregador({
   entregador:driver,csrf:'csrf-driver',db,
   disponiveis:entregasDisponiveis(db),
 });
 assert.match(html,/data-driver-pedido="um"/);
 assert.match(html,/data-driver-pedido="dois"/);
 assert.match(html,/ordemEntregas/);
 assert.match(html,/Sair com entregas/);
 assert.doesNotMatch(html,/Google Maps|rota no GPS|geolocation/);
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const csrf=readFileSync(new URL('../src/lib/security.js',import.meta.url),'utf8');
 assert.match(app,/registrarRotasEntregador/);
 assert.match(app,/pp_entregador_sess/);
 assert.match(csrf,/req.entregadorSession/);
});
