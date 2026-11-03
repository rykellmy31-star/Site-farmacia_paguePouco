import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validarRecebimentoPresencial} from '../src/lib/recebimento-presencial.js';
import {dataDaLoja,periodoValido,relatorioOperacionalVendas} from '../src/lib/relatorio-operacional-vendas.js';
import {enfileirarEvolution} from '../src/lib/evolution-whatsapp.js';
import {can} from '../src/lib/permissions.js';
test('bandeira e parcelas exigidas em crédito/débito, à vista em débito',()=>{
  const basico={confirmouRecebimento:'1'};
  for(const metodo of ['pix','cash']){
    const r=validarRecebimentoPresencial({...basico,metodoRecebido:metodo});
    assert.equal(r.ok,true);assert.equal(r.recebimento.parcelas,1);
    assert.equal(r.recebimento.bandeira,null);
  }
  assert.equal(validarRecebimentoPresencial({...basico,metodoRecebido:'credit_card'}).ok,false);
  assert.equal(validarRecebimentoPresencial({...basico,metodoRecebido:'debit_card',
    bandeira:'visa',parcelas:'2'}).ok,false);
  assert.deepEqual(validarRecebimentoPresencial({...basico,metodoRecebido:'credit_card',
    bandeira:'mastercard',parcelas:'3'}).recebimento,
    {metodo:'credit_card',bandeira:'mastercard',parcelas:3,condicao:'parcelado'});
  const avista=validarRecebimentoPresencial({...basico,metodoRecebido:'credit_card',
    bandeira:'visa',parcelas:'1'});
  assert.equal(avista.recebimento.condicao,'a_vista');
  for(const invalid of ['14','1.5','0','-1','abc'])
    assert.equal(validarRecebimentoPresencial({...basico,metodoRecebido:'credit_card',
      bandeira:'visa',parcelas:invalid}).ok,false,invalid);
  assert.equal(validarRecebimentoPresencial({metodoRecebido:'cash'}).ok,false);
});
test('relatório filtra data real de pagamento, fuso Brasília e evita duplicidade por itens',()=>{
 const base={id:'p1',codigo:'PP1',statusFinanceiro:'aprovado',totalCentavos:10050,
   metodoPagamento:'pix',cliente:{nome:'Cliente'},itens:[
     {nome:'Produto A',quantidade:2,subtotalCentavos:5050},
     {nome:'Produto B',quantidade:1,subtotalCentavos:5000},
   ],criadoEm:'2026-11-02T16:00:00.000Z',
   historico:[{tipo:'financeiro',status:'aprovado',em:'2026-11-04T01:00:00Z'}]};
 // 01:00 UTC do dia 04 ainda pertence ao dia 03 em Brasília.
 assert.equal(dataDaLoja('2026-11-04T01:00:00Z'),'2026-11-03');
 const pedido2={...base,id:'p2',codigo:'PP2',statusFinanceiro:'pendente'};
 const pedido3={...base,id:'p3',codigo:'PP3',statusFinanceiro:'estornado'};
 const r=relatorioOperacionalVendas([base,pedido2,pedido3],
   {de:'2026-11-03',ate:'2026-11-03'});
 assert.equal(r.quantidade,1);
 assert.equal(r.receitaCentavos,10050);
 assert.equal(r.qtdItens,3);
 assert.equal(r.vendas[0].itens.length,2);
 assert.equal(relatorioOperacionalVendas([base],{de:'2026-11-04',ate:'2026-11-04'}).quantidade,0);
});
test('venda presencial usa meio efetivo recebido, bandeira e parcelas',()=>{
 const p={codigo:'PP9',statusFinanceiro:'aprovado',totalCentavos:8500,
   metodoPagamento:'cash',criadoEm:'2026-11-03T12:00:00Z',
   historico:[{tipo:'financeiro',status:'aprovado',em:'2026-11-03T15:00:00Z'}],
   itens:[{nome:'Produto',quantidade:1}],
   pagamentoPresencial:{recebimento:{metodo:'credit_card',bandeira:'elo',parcelas:2}}};
 const r=relatorioOperacionalVendas([p],{de:'2026-11-03',ate:'2026-11-03'});
 assert.deepEqual([r.vendas[0].forma,r.vendas[0].bandeira,r.vendas[0].parcelas],
   ['Crédito','Elo',2]);
 assert.equal(r.porMetodo['Crédito'],8500);
});
test('datas inválidas não liberam extração ilimitada ou resultado incompleto',()=>{
 for(const [de,ate] of [['2026-02-30','2026-03-02'],['2026-12-02','2026-11-03'],
   ['2026-01-01','2027-12-31'],['abc','2026-11-03']]){
   assert.equal(periodoValido(de,ate),false);
 }
 assert.equal(periodoValido('2026-11-03','2026-11-03'),true);
});
function dbFake(){
 const registros=new Map();
 const cfg={ativo:true,instancia:'farmacia1',avisarCliente:true,avisarResponsavel:true,
   numeroResponsavel:'5573999998888'};
 return {out:registros,collection:(name)=>{
   if(name==='settings')return {get:key=>key==='evolutionWhatsapp'?cfg:null};
   if(name==='evolutionWhatsappOutbox')return {
     get:id=>registros.get(id),insert:v=>(registros.set(v.id,v),v)};
   throw Error(name);
 }};
}
test('cliente e farmácia recebem quantidade e pagamento escolhido, sem envio duplicado',()=>{
 const db=dbFake();
 const pedido={id:'pedido_1',codigo:'PP2026000099',metodoPagamento:'cash',
   cliente:{nome:'Cliente Teste',telefone:'73999998888'},statusFinanceiro:'pendente',
   itens:[{nome:'Dipirona 1g',quantidade:2},{nome:'Sabonete',quantidade:1}],
   receberWhatsappPedido:true,enviarItensWhatsappPedido:true,
   totalCentavos:3500,pagamentoPresencial:{
     precisaTroco:true,trocoParaCentavos:10000,trocoCentavos:6500}};
 const cliente=enfileirarEvolution(db,pedido,'cliente_recebido');
 const responsavel=enfileirarEvolution(db,pedido,'responsavel_local');
 assert.equal(cliente.ok,true);assert.equal(responsavel.ok,true);
 assert.equal(db.out.size,2);
 const textos=[...db.out.values()].map(x=>x.texto);
 for(const t of textos){
   assert.match(t,/PP2026000099/);
   assert.match(t,/Quantidade de itens: 3/);
   assert.match(t,/Forma de pagamento escolhida: \*Dinheiro\*/);
   assert.match(t,/2x Dipirona/);
 }
 assert.match(textos.find(x=>x.includes('NOVO PEDIDO')),/TROCO A SEPARAR: R\\$ 65,00/);
 assert.match(textos.find(x=>x.startsWith('Olá')),/Nenhuma cobrança foi gerada/);
 enfileirarEvolution(db,pedido,'responsavel_local');
 assert.equal(db.out.size,2);
});
test('o relatório é visível ao separador sem conceder relatórios financeiros gerais',()=>{
 const operador={role:'operador_pedidos'};
 assert.equal(can(operador,'pedidos.ver'),true);
 assert.equal(can(operador,'pedidos.editar'),true);
 assert.equal(can(operador,'relatorios.ver'),false);
 const root=new URL('../',import.meta.url);
 const menu=readFileSync(new URL('src/views/admin/layout.js',root),'utf8');
 const admin=readFileSync(new URL('src/routes/admin.js',root),'utf8');
 const view=readFileSync(new URL('src/views/admin/vendas.js',root),'utf8');
 const js=readFileSync(new URL('public/js/admin.js',root),'utf8');
 assert.match(menu,/relatorio_vendas_operacional/);
 assert.match(admin,/guard\(req,res,'pedidos\.ver'\)/);
 assert.match(admin,/guardApi\(req,res,'pedidos\.ver'\)/);
 assert.match(admin,/validarRecebimentoPresencial/);
 assert.match(admin,/atualizarStatusFinanceiro\(db,p\.id,'aprovado'/);
 assert.match(admin,/entregarAgora/);
 assert.match(view,/id="formRecebimentoPresencial"/);
 assert.match(view,/Quantidade de parcelas/);
 assert.match(js,/detalhesCartaoPresencial/);
});
