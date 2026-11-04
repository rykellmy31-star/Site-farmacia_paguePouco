import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DIAS_PROMOCAO,diasPromocaoProduto,diasPromocaoMarcados,diasPromocaoInova,
  filtrarPromocoesPorDia,alterarMarcacoesPromocao}
  from '../src/lib/promocoes-semanais-organizacao.js';
import {precoPromocaoInovaVigente} from '../src/lib/inovafarma-promocoes-precos.js';
import {telaProdutos} from '../src/views/admin/catalogo.js';

const p1={id:'produto_1',nome:'Produto Segunda',sku:'1',slug:'produto-segunda',
  inovaPromocoes:[{inicio:'2026-11-02',fim:'2026-11-30',diaSemana:'segunda',
    precoVendaCentavos:2000,precoPromocionalCentavos:1700}],
  precoCentavos:2000,estoque:{quantidade:10,minimo:1},ativo:true,imagens:[]};
const p2={id:'produto_2',nome:'Produto Terça',sku:'2',slug:'produto-terca',
  inovaPromocoes:[{inicio:'2026-11-02',fim:'2026-11-30',diaSemana:'terca',
    precoVendaCentavos:1800,precoPromocionalCentavos:1600}],
  precoCentavos:1800,estoque:{quantidade:5,minimo:2},ativo:true,imagens:[]};
const p3={id:'produto_3',nome:'Produto sem promo',sku:'3',slug:'produto-sem-promo',
  precoCentavos:1000,imagens:[],ativo:true,estoque:{quantidade:5,minimo:1}};
function banco(){
 const itens=[p1,p2,p3].map(p=>structuredClone(p));
 const col={all:()=>itens,get:id=>itens.find(p=>p.id===id)||null,
  update(id,patch){const p=itens.find(p=>p.id===id);Object.assign(p,patch);return p;}};
 const db={storage:{transactionSync:fn=>fn()},collections:new Map(),
  collection:n=>n==='products'?col:n==='categories'?{get:()=>null,all:()=>[]}:null};
 return {db,itens};
}
test('filtrar segunda a domingo reflete dia da campanha real do Inova',()=>{
 assert.equal(DIAS_PROMOCAO.length,7);
 assert.deepEqual(diasPromocaoInova(p1),['segunda']);
 assert.deepEqual(filtrarPromocoesPorDia([p1,p2,p3],'segunda').map(p=>p.id),[p1.id]);
 assert.deepEqual(filtrarPromocoesPorDia([p1,p2,p3],'terca').map(p=>p.id),[p2.id]);
 assert.deepEqual(filtrarPromocoesPorDia([p1,p2,p3],'sem_dia').map(p=>p.id),[p3.id]);
 assert.equal(filtrarPromocoesPorDia([p1,p2,p3],'domingo').length,0);
});
test('marcação manual para organizar não afeta promoções nem preços do InovaFarma',()=>{
 const {db,itens}=banco();
 const antes=structuredClone(itens);
 const r=alterarMarcacoesPromocao(db,{
   produtoIds:[p1.id,p3.id],dia:'quarta',acao:'marcar'
 });
 assert.deepEqual(r,{ok:true,atualizados:2,dia:'quarta',acao:'marcar'});
 assert.deepEqual(diasPromocaoProduto(itens[0]),['segunda','quarta']);
 assert.deepEqual(diasPromocaoProduto(itens[2]),['quarta']);
 for(let i=0;i<itens.length;i++){
   const a={...itens[i]},b={...antes[i]};
   delete a.diasPromocaoOrganizacao;delete b.diasPromocaoOrganizacao;
   assert.deepEqual(a,b);
 }
 assert.equal(precoPromocaoInovaVigente(itens[0],new Date('2026-11-02T15:00:00Z')),1700);
 assert.equal(precoPromocaoInovaVigente(itens[0],new Date('2026-11-04T15:00:00Z')),null);
 assert.equal(precoPromocaoInovaVigente(itens[2],new Date('2026-11-04T15:00:00Z')),null);
});
test('desmarcar não apaga promoção oficial importada da InovaFarma',()=>{
 const {db,itens}=banco();
 alterarMarcacoesPromocao(db,{produtoIds:[p1.id],dia:'segunda',acao:'marcar'});
 const r=alterarMarcacoesPromocao(db,{produtoIds:[p1.id],dia:'segunda',acao:'desmarcar'});
 assert.equal(r.ok,true);
 assert.deepEqual(diasPromocaoMarcados(itens[0]),[]);
 assert.deepEqual(diasPromocaoProduto(itens[0]),['segunda']);
});
test('falhas de validação e arquivos arquivados não fazem escrita parcial',()=>{
 const {db,itens}=banco();
 const arquivado={...p3,id:'produto_4',inovaArquivado:{em:'2026-10-30'}};
 const proxy=db.collection('products');
 const oldGet=proxy.get.bind(proxy);
 proxy.get=id=>id===arquivado.id?arquivado:oldGet(id);
 const before=structuredClone(itens);
 for(const args of [
   {produtoIds:[p1.id,p2.id],dia:'feriado',acao:'marcar'},
   {produtoIds:[p1.id],dia:'segunda',acao:'criar_desconto'},
   {produtoIds:[],dia:'segunda',acao:'marcar'},
   {produtoIds:[p1.id,p1.id],dia:'terca',acao:'marcar'},
   {produtoIds:[p1.id,arquivado.id],dia:'terca',acao:'marcar'},
   {produtoIds:Array.from({length:26},(_,i)=>'produto_'+i),dia:'segunda',acao:'marcar'}
 ]){
   assert.equal(alterarMarcacoesPromocao(db,args).ok,false);
   assert.deepEqual(itens,before);
 }
});
test('lista mostra filtro por dia, seletores de produtos e formulário com CSRF sem preços novos',()=>{
 const {db}=banco();
 const ctx={db,adminUser:{role:'super_admin',id:'super'},csrf:'TOKEN123',
   settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{}},
   req:{pathname:'/admin/produtos',query:new URLSearchParams()}};
 const html=telaProdutos(ctx,{produtos:[p1,p2],total:2,pagina:1,porPagina:25,
   busca:'',categorias:[],filtros:{categoria:'',status:'',diaPromocao:'terca'}});
 assert.match(html,/Promoções por dia/);
 assert.match(html,/value="segunda"/);
 assert.match(html,/value="domingo"/);
 assert.match(html,/value="sem_dia"/);
 assert.match(html,/name="produtoIds\[\]"/);
 assert.match(html,/id="selecionarTodosPromocoes"/);
 assert.match(html,/action="\/admin\/produtos\/promocoes-dias"/);
 assert.match(html,/name="_csrf" value="TOKEN123"/);
 assert.match(html,/Marcar para este dia/);
 assert.match(html,/Remover marcação/);
 assert.match(html,/não cria nem modifica descontos/);
 assert.match(html,/Toda terça-feira/);
 const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
 assert.match(routes,/app\.post\('\/admin\/produtos\/promocoes-dias'/);
 assert.match(routes,/role!=='super_admin'/);
 assert.match(js,/selecionarTodosPromocoes/);
 assert.match(js,/checkboxes\.some\(el=>el\.checked/);
 const partial=ctx.adminUser.role='atendente';
 const other=telaProdutos(ctx,{produtos:[p1],total:1,pagina:1,porPagina:25,
   busca:'',categorias:[],filtros:{categoria:'',status:'',diaPromocao:''}});
 assert.doesNotMatch(other,/id="formPromocoesDias"/);
});
