import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIPOS_TESTE_RECUPERACAO, prepararTesteRecuperacao, enviarTesteRecuperacao,
} from '../src/lib/recuperacao-teste-whatsapp.js';

function dbFake() {
  const mapa=new Map();
  return {
    collection(nome) {
      if(!mapa.has(nome))mapa.set(nome,new Map());
      const col=mapa.get(nome);
      return {
        get:id=>col.get(String(id))||null,
        all:()=>[...col.values()],
        insert:x=>{const v={...x,id:String(x.id||'auto-'+(col.size+1))};col.set(v.id,v);return v;},
        update:(id,p)=>{const x=col.get(String(id));if(!x)return null;
          const v={...x,...p};col.set(String(id),v);return v;},
        count:()=>col.size,
      };
    },
  };
}
function fixture() {
  const db=dbFake();
  db.collection('settings').insert({id:'evolutionWhatsapp',ativo:true,instancia:'farmacia-pague-pouco'});
  db.collection('settings').insert({id:'recuperacaoVendas',descontoPercentual:5,
    descontoMaximoCentavos:1500,compraMinimaCentavos:6000,validadeHoras:48});
  db.collection('settings').insert({id:'recuperacaoVendasLocal',descontoPercentual:4,
    descontoMaximoCentavos:1200,compraMinimaCentavos:5000,validadeHoras:36});
  db.collection('settings').insert({id:'recuperacaoPedidoOnline',descontoPercentual:7,
    descontoMaximoCentavos:2000,compraMinimaCentavos:6000,validadeHoras:24});
  return {db,env:{EVOLUTION_API_URL:'https://evolution.example.com',
    EVOLUTION_API_KEY:'chave-somente-do-teste'}};
}
const numero='73999998888';
test('os seis modelos de teste são reais exemplos, sem cupom ou cobrança',()=>{
 const {db}=fixture();
 assert.equal(Object.keys(TIPOS_TESTE_RECUPERACAO).length,6);
 for(const tipo of Object.keys(TIPOS_TESTE_RECUPERACAO)){
   const r=prepararTesteRecuperacao(db,{numero,tipo,confirmado:true});
   assert.equal(r.ok,true,tipo);
   assert.equal(r.telefone,'5573999998888');
   assert.match(r.texto,/🧪 \*TESTE DE RECUPERAÇÃO/);
   assert.match(r.texto,/Farmácia Pague Pouco, cuidando da sua saúde/);
   assert.match(r.texto,/nenhum pedido, pagamento ou cupom foi criado/);
   assert.doesNotMatch(r.texto,/Fralda Desc|access_token|apikey|cpf/i);
 }
 const global=prepararTesteRecuperacao(db,{numero,tipo:'carrinho_global_cupom',confirmado:true});
 const local=prepararTesteRecuperacao(db,{numero,tipo:'carrinho_local_cupom',confirmado:true});
 const pagamento=prepararTesteRecuperacao(db,{numero,tipo:'pix_encerrado_cupom',confirmado:true});
 assert.match(global.texto,/5%/);
 assert.match(local.texto,/4%/);
 assert.match(pagamento.texto,/7%/);
 assert.match(pagamento.texto,/novo pagamento/);
});
test('somente número válido, tipo fechado e confirmação explícita são aceitos',async()=>{
 const {db,env}=fixture();
 let chamados=0;
 const enviar=async()=>{chamados++;return {ok:true};};
 for (const dados of [
  {numero:'123',tipo:'carrinho_global_lembrete',confirmado:true},
  {numero,tipo:'__proto__',confirmado:true},
  {numero,tipo:'carrinho_global_lembrete',confirmado:false},
  {numero,tipo:'carrinho_global_lembrete',confirmado:'1'},
 ]) {
   assert.equal((await enviarTesteRecuperacao(db,env,dados,{enviar})).ok,false);
 }
 assert.equal(chamados,0,'nenhum destinatário sem confirmação recebe mensagem');
 assert.equal(db.collection('settings').get('testeRecuperacaoWhatsapp'),null);
});
test('um clique envia uma mensagem apenas para número escolhido usando Evolution existente',async()=>{
 const {db,env}=fixture();
 const pedidosAntes=db.collection('orders').count();
 const cuponsAntes=db.collection('coupons').count();
 const carrinhosAntes=db.collection('carts').count();
 const campanhaAntes=db.collection('recuperacoesVendas').count();
 const enviadas=[];
 const agora=Date.now();
 const enviar=async(url,opts)=>{enviadas.push({url,opts});return {ok:true,status:200};};
 const dados={numero,tipo:'pix_pendente_lembrete',confirmado:true};
 const r=await enviarTesteRecuperacao(db,env,dados,{enviar,agora});
 assert.deepEqual(r,{ok:true,codigo:'enviado'});
 assert.equal(enviadas.length,1);
 assert.equal(enviadas[0].url,'https://evolution.example.com/message/sendText/farmacia-pague-pouco');
 assert.equal(enviadas[0].opts.method,'POST');
 assert.equal(enviadas[0].opts.headers.apikey,env.EVOLUTION_API_KEY);
 assert.equal(enviadas[0].opts.redirect,'manual');
 const body=JSON.parse(enviadas[0].opts.body);
 assert.equal(body.number,'5573999998888');
 assert.match(body.text,/pedido de exemplo/);
 assert.match(body.text,/simulação administrativa/i);
 assert.doesNotMatch(JSON.stringify(db.collection('settings').get('testeRecuperacaoWhatsapp')),
   /5573999998888|73999998888|chave-somente-do-teste/);
 assert.equal(db.collection('orders').count(),pedidosAntes);
 assert.equal(db.collection('coupons').count(),cuponsAntes);
 assert.equal(db.collection('carts').count(),carrinhosAntes);
 assert.equal(db.collection('recuperacoesVendas').count(),campanhaAntes);
 const repeat=await enviarTesteRecuperacao(db,env,dados,{enviar,agora:agora+30_000});
 assert.equal(repeat.codigo,'intervalo');
 assert.equal(enviadas.length,1);
 assert.equal((await enviarTesteRecuperacao(db,env,dados,{enviar,agora:agora+61_000})).ok,true);
 assert.equal(enviadas.length,2);
});
test('sem conexão ativa ou sem credenciais, o teste não faz chamada externa',async()=>{
 const {db,env}=fixture();
 let chamados=0;
 const enviar=async()=>{chamados++;return {ok:true};};
 const dados={numero,tipo:'carrinho_local_lembrete',confirmado:true};
 assert.equal((await enviarTesteRecuperacao(db,{},dados,{enviar})).codigo,'evolution');
 db.collection('settings').update('evolutionWhatsapp',{ativo:false});
 assert.equal((await enviarTesteRecuperacao(db,env,dados,{enviar})).codigo,'evolution');
 assert.equal(chamados,0);
});
test('falhas HTTP ou timeout são relatados sem resposta bruta e sem segunda tentativa',async()=>{
 const {db,env}=fixture();
 const dados={numero,tipo:'carrinho_global_lembrete',confirmado:true};
 const agora=Date.now();
 let chamados=0;
 const falha=await enviarTesteRecuperacao(db,env,dados,{
   agora,enviar:async()=>{chamados++;return {ok:false,status:401,text:async()=> 'apikey vaza se lido'};
 });
 assert.deepEqual(falha,{ok:false,codigo:'recusado'});
 assert.equal(chamados,1);
 assert.equal(db.collection('settings').get('testeRecuperacaoWhatsapp').ultimaSituacao,'recusado');
 const incerto=await enviarTesteRecuperacao(db,env,dados,{
   agora:agora+61_000,enviar:async()=>{chamados++;throw new Error('token secreto');},
 });
 assert.deepEqual(incerto,{ok:false,codigo:'verificar'});
 assert.equal(chamados,2);
 assert.equal(db.collection('settings').get('testeRecuperacaoWhatsapp').ultimaSituacao,'verificar');
});
test('painel e rota exigem privilégio, formulário tem CSRF e não recebe texto livre',()=>{
 const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/views/admin/recuperacao-vendas.js',import.meta.url),'utf8');
 assert.match(routes,/app\.post\('\/admin\/recuperacao-vendas\/testar-whatsapp'/);
 assert.match(routes,/guard\(req,res,'whatsapp\.editar'\)/);
 assert.match(routes,/enviarTesteRecuperacao\(db,req\.ctx\?\.env/);
 assert.match(ui,/name="_csrf"/);
 assert.match(ui,/id="teste-whatsapp-recuperacao"/);
 assert.match(ui,/name="numero"/);
 assert.match(ui,/name="tipo"/);
 assert.match(ui,/name="confirmado"/);
 assert.doesNotMatch(ui,/name="texto"/);
});
