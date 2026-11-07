import test from 'node:test';
import assert from 'node:assert/strict';
import { homePage } from '../src/views/public.js';
import { vitrineProdutos, rankingVendasPagas } from '../src/lib/catalog.js';

const now = Date.now();
const novo = i => new Date(now - i * 3600000).toISOString();
function produto(id, {criadoEm=novo(1), destaque=false, promo=false, estoque=5}={}) {
  return { id,slug:id,nome:'Produto '+id,criadoEm,ativo:true,destaque,
    vendas:999, precoCentavos:2000, precoPromocionalCentavos:promo?1700:0,
    imagens:[],sanitario:{classificacao:'nao_aplicavel'},
    estoque:{quantidade:estoque,reservado:0,quarentena:0}};
}
function fixture(produtos,pedidos=[],showcases=[]) {
  const dados={products:produtos,orders:pedidos,showcases};
  return {collection: name => ({
    all:()=>dados[name]||[],get:id=>(dados[name]||[]).find(p=>p.id===id)||null,
  })};
}
function home(db,tipos=['mais_vendidos','novidades','destaques']) {
  const settings={
    empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},whatsapp:{},cookies:{},
    home:{secoes:tipos.map((tipo,ordem)=>({tipo,ativo:true,ordem,titulo:tipo,limite:8}))},
  };
  return homePage({db,arvore:[],req:{pathname:'/',query:new URLSearchParams()},settings});
}
function idsDaSecao(html,id) {
  const bloco=html.match(new RegExp('<section class="secao" id="'+id+'">([\\s\\S]*?)<\\/section>'));
  return bloco ? [...bloco[1].matchAll(/data-adicionar-carrinho="([^"]+)"/g)].map(m=>m[1]) : [];
}
const pedido=(id,itens,statusFinanceiro='aprovado')=>({id,statusFinanceiro,
  itens:itens.map(([produtoId,quantidade])=>({produtoId,quantidade}))});

test('cinco mais vendidos seguem unidades aprovadas, nunca contadores antigos nem pagamentos pendentes',()=>{
  const produtos=Array.from({length:10},(_,i)=>produto('p'+i));
  const pedidos=[
    pedido('pago1',[['p3',15],['p4',9],['p2',6],['p1',5],['p0',4],['p5',2]]),
    pedido('pago2',[['p2',6]]),
    pedido('pendente',[['p5',500]],'pendente'),
    pedido('recusado',[['p6',999]],'recusado'),
  ];
  const db=fixture(produtos,pedidos);
  assert.equal(rankingVendasPagas(db).get('p3'),15);
  assert.equal(rankingVendasPagas(db).get('p5'),2);
  assert.deepEqual(vitrineProdutos(db,'mais_vendidos',5).map(p=>p.id),
    ['p3','p2','p4','p1','p0']);
  assert.deepEqual(idsDaSecao(home(db), 'mais-vendidos'),['p3','p2','p4','p1','p0']);
});

test('novidades excluem os cinco mais vendidos mesmo se seção novidades vier primeiro',()=>{
  const produtos=Array.from({length:14},(_,i)=>produto('item'+i,{criadoEm:novo(i+1)}));
  const pedidos=[pedido('pago',Array.from({length:5},(_,i)=>['item'+i,10-i]))];
  const html=home(fixture(produtos,pedidos),['novidades','mais_vendidos']);
  const vendidos=idsDaSecao(html,'mais-vendidos');
  const novidades=idsDaSecao(html,'novidades');
  assert.equal(vendidos.length,5);
  assert.equal(novidades.length,5);
  assert.deepEqual(vendidos,['item0','item1','item2','item3','item4']);
  assert.deepEqual(novidades,['item5','item6','item7','item8','item9']);
  assert.equal(novidades.some(x=>vendidos.includes(x)),false);
});

test('sem vendas aprovadas não exibe título Mais Vendidos, sem produtos recentes não exibe Novidades',()=>{
  const velhos=Array.from({length:4},(_,i)=>produto('antigo'+i,{
    criadoEm:'2024-01-01T00:00:00.000Z'}));
  const html=home(fixture(velhos,[pedido('aguardando',[['antigo0',99]],'pendente')]));
  assert.deepEqual(idsDaSecao(html,'mais-vendidos'),[]);
  assert.deepEqual(idsDaSecao(html,'novidades'),[]);
  assert.doesNotMatch(html,/id="mais-vendidos"/);
  assert.doesNotMatch(html,/id="novidades"/);
});

test('produtos inativos e sem estoque não entram no ranking nem na vitrine',()=>{
  const db=fixture([
    produto('ativo'),
    {...produto('esgotado'),estoque:{quantidade:0,reservado:0,quarentena:0}},
    {...produto('inativo'),ativo:false},
  ],[pedido('pago',[['esgotado',50],['inativo',40],['ativo',3]])]);
  assert.deepEqual(vitrineProdutos(db,'mais_vendidos',5).map(p=>p.id),['ativo']);
});

test('ofertas continuam completas, destaques e vitrines extras não repetem itens',()=>{
  const produtos=[
    produto('oferta',{promo:true,destaque:true}),
    produto('campeao',{destaque:true}),
    produto('recente'),
    produto('destaque-especifico',{destaque:true,criadoEm:'2020-01-01T00:00:00Z'}),
    produto('custom-antigo',{criadoEm:'2020-01-01T00:00:00Z'}),
  ];
  const showcases=[{id:'mini',ativa:true,tipo:'manual',titulo:'Vitrine manual',
    produtosIds:['campeao','recente','custom-antigo','custom-antigo']}];
  const db=fixture(produtos,[pedido('ok',[['campeao',8]])],showcases);
  const html=home(db,['ofertas','mais_vendidos','novidades','destaques','vitrines']);
  assert.deepEqual(idsDaSecao(html,'ofertas'),['oferta']);
  assert.deepEqual(idsDaSecao(html,'mais-vendidos'),['campeao']);
  assert.deepEqual(idsDaSecao(html,'novidades'),['recente']);
  assert.deepEqual(idsDaSecao(html,'destaques'),['destaque-especifico']);
  assert.deepEqual(idsDaSecao(html,'vitrine-mini'),['custom-antigo']);
});

test('não preenche vagas com produtos antigos para simular novidade',()=>{
  const db=fixture([produto('novo',{criadoEm:novo(1)}),
    produto('velho',{criadoEm:'2020-01-01T00:00:00Z'})]);
  assert.deepEqual(idsDaSecao(home(db,['novidades']),'novidades'),['novo']);
});
