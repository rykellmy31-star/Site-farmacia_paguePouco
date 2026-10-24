import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {melhorParcelamentoSemJuros,installmentOptions} from '../src/lib/payments/index.js';
import {produtoPage,homePage,buscaPage,paginaOfertas} from '../src/views/public.js';
import {cartaoProduto,vitrina,secaoVitrina} from '../src/views/partials.js';

const produtos = (centavos,patch={})=>({
  id:'p1',slug:'produto-teste',nome:'Produto teste',
  ativo:true,estoque:{quantidade:7,reservado:0},
  precoCentavos:centavos,imagens:[],sanitario:{classificacao:'nao_aplicavel'},
  ...patch,
});
const db=(pagamentos={})=>({
  collection(name){
    return {
      get:(key)=>name==='settings'&&key==='pagamentos'?pagamentos:null,
      all:()=>[],
    };
  },
});
function context(banco) {
  return {
    db:banco,
    req:{pathname:'/produto/produto-teste',query:new URLSearchParams()},
    settings:{
      empresa:{nomeFantasia:'Farmácia Pague Pouco'},
      tema:{},seo:{},whatsapp:{},cookies:{},
      home:{secoes:[{tipo:'destaques',ativo:true,ordem:1}]},
    },arvore:[],csrf:'CSRF_TESTE',
  };
}
const render=(ctx,price,extra={})=>produtoPage(ctx,{
  produto:produtos(price,extra),categoria:null,relacionados:[],configLoja:{},
});
const de=(html)=>html.match(/Em até (\d+)x sem juros nos cartões/)?.[1]||null;
test('produto de R$7,21 não anuncia parcelamento; primeiro limiar é R$50',()=>{
  const ctx=context(db());
  for(const cents of [721,2499,2500,4999]){
    const html=render(ctx,cents);
    assert.equal(de(html),null,'não anunciar parcelamento em R$ '+cents/100);
    assert.doesNotMatch(html,/Consulte as condições no checkout\./);
    assert.doesNotMatch(cartaoProduto(produtos(cents),{db:ctx.db}),/class="parcela"/);
  }
});
test('vitrine, busca e pagina de detalhe mostram a mesma quantidade permitida',()=>{
  const ctx=context(db());
  for(const [cents,vezes] of [[5000,2],[7499,2],[7500,3],
    [10000,4],[12500,5],[15000,6],[20000,6]]){
    const detalhe=render(ctx,cents);
    assert.equal(de(detalhe),String(vezes),'detalhe para R$'+cents/100);
    assert.match(cartaoProduto(produtos(cents),{db:ctx.db}),
      new RegExp('ou até '+vezes+'x sem juros'));
    assert.match(vitrina([produtos(cents)],{db:ctx.db}),
      new RegExp('ou até '+vezes+'x sem juros'));
    assert.match(secaoVitrina({id:'teste',titulo:'Ofertas',produtos:[produtos(cents)],db:ctx.db}),
      new RegExp('ou até '+vezes+'x sem juros'));
    assert.equal(melhorParcelamentoSemJuros(ctx.db,cents).numero,vezes);
  }
});
test('preço com promoção vigente prevalece sobre preço normal para parcelar',()=>{
  const ctx=context(db());
  const promocao=produtos(10000,{precoPromocionalCentavos:4999});
  assert.doesNotMatch(cartaoProduto(promocao,{db:ctx.db}),/class="parcela"/);
  assert.equal(de(render(ctx,10000,{precoPromocionalCentavos:4999})),null);
  const promocao2=produtos(15000,{precoPromocionalCentavos:7500});
  assert.match(cartaoProduto(promocao2,{db:ctx.db}),/ou até 3x sem juros/);
});
test('se houver juros após a terceira parcela, só anunciar até 3x sem juros',()=>{
  const ctx=context(db({parcelasSemJuros:3,taxaJurosMes:2}));
  const allowed=installmentOptions(ctx.db,15000);
  assert.equal(allowed.at(-1).numero,6);
  assert.equal(allowed.at(-1).juros,true);
  assert.equal(de(render(ctx,15000)), '3');
  assert.match(cartaoProduto(produtos(15000),{db:ctx.db}),/ou até 3x sem juros/);
  assert.doesNotMatch(cartaoProduto(produtos(15000),{db:ctx.db}),/6x sem juros/);
});
test('sem db nao presume condicoes de pagamento para exibir propaganda',()=>{
  assert.doesNotMatch(cartaoProduto(produtos(15000)),/class="parcela"/);
  assert.equal(melhorParcelamentoSemJuros(null,15000),null);
});
test('paginas publicas propagam banco de configuracoes para cards',()=>{
  const ctx=context(db());
  const p=produtos(7500);
  ctx.db.collection=(name)=>({
    get:(key)=>name==='settings'&&key==='pagamentos'?{}:null,
    all:()=>name==='products'?[p]:[],
  });
  const busca=buscaPage(ctx,{termo:'Teste',produtos:[p],total:1,pagina:1,porPagina:24,
    ordenar:'relevancia',filtros:{},marcas:[]});
  assert.match(busca,/ou até 3x sem juros/);
  const ofertas=paginaOfertas(ctx,{produtos:[p],total:1,pagina:1,porPagina:24});
  assert.match(ofertas,/ou até 3x sem juros/);
  const fonte=readFileSync(new URL('../src/views/public.js',import.meta.url),'utf8');
  assert.doesNotMatch(fonte,/Em até 6x sem juros nos cartões/);
  assert.match(fonte,/parcelamentoSemJuros\.numero/);
});
