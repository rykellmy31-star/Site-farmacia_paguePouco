import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { addItem, setItemQuantity, removeItem, normalizeCart, calcularTotais } from '../src/lib/cart.js';
import { htmlParcelamentoCesta, htmlResumoCarrinho, htmlRodapeCarrinho } from '../src/views/cart.js';
import { telaCarrinho } from '../src/views/checkout.js';
import { installmentOptions } from '../src/lib/payments/index.js';

class DB {
  constructor(){this.cols=new Map();}
  collection(nome){
    if(!this.cols.has(nome))this.cols.set(nome,new Collection({_commit(){}},nome));
    return this.cols.get(nome);
  }
}
function criarCesta(valor=3324, outros=3324){
  const db=new DB(),products=db.collection('products');
  for(const [id,preco] of [['a',valor],['b',outros]]){
    products.insert({id,nome:'Produto '+id,slug:'produto-'+id,
      ativo:true,precoCentavos:preco,
      estoque:{quantidade:20,reservado:0},sanitario:{classificacao:'nao_aplicavel'}});
  }
  const cart=db.collection('carts').insert({id:'cesta',itens:[],cupom:null,frete:null});
  return {db,cart,adicionar:(id)=>addItem(db,db.collection('carts').get(cart.id),id,1),
    totais:()=> {
      const atualizado=normalizeCart(db,db.collection('carts').get(cart.id)).cart;
      return calcularTotais(db,atualizado,{});
    },
    atual:()=>db.collection('carts').get(cart.id),
  };
}
function render(t){return htmlRodapeCarrinho(t.atual(),t.totais(),t.db);}
test('foto real: dois produtos na cesta somando R$ 66,48 exibem 2x de R$ 33,24 sem juros',()=>{
  const c=criarCesta();c.adicionar('a');c.adicionar('b');
  const html=render(c);
  assert.equal(c.totais().totalCentavos,6648);
  assert.match(html,/até 2x de R\$\s+33,24 sem juros/);
  assert.doesNotMatch(html,/até 6x/);
  assert.match(html,/sobre os produtos após descontos/);
});
test('alterar quantidade e excluir recalcula parcelas; ao ficar abaixo de R$50 remove aviso',()=>{
  const c=criarCesta(2500,2500);c.adicionar('a');c.adicionar('b');
  assert.match(render(c),/até 2x de R\$\s+25,00 sem juros/);
  removeItem(c.db,c.atual(),'b');
  assert.doesNotMatch(render(c),/parcelamento-cesta/);
  const atualizado=setItemQuantity(c.db,c.atual(),'a',3);
  assert.equal(atualizado.ok,true);
  assert.match(render(c),/até 3x de R\$\s+25,00 sem juros/);
  setItemQuantity(c.db,c.atual(),'a',1);
  assert.doesNotMatch(render(c),/parcelamento-cesta/);
  removeItem(c.db,c.atual(),'a');
  assert.equal(render(c),'','carrinho vazio sem anúncio');
});
test('limiares comercial/checkout: abaixo de R$50 não aparece, R$75=3x, R$150=6x',()=>{
  const db=new DB();
  for(const [preco,vezes] of [[4999,0],[5000,2],[7499,2],[7500,3],
    [9999,3],[10000,4],[12500,5],[15000,6],[20000,6]]){
    const tot={quantidadeItens:1,subtotalCentavos:preco,descontoCupom:0,totalCentavos:preco};
    const html=htmlParcelamentoCesta(db,tot);
    const max=installmentOptions(db,preco).filter(x=>x.numero>=2&&!x.juros).at(-1)?.numero||0;
    assert.equal(max,vezes,'checkout R$'+preco/100);
    if(!vezes)assert.equal(html,'','R$'+preco/100);
    else assert.match(html,new RegExp('até '+vezes+'x'),'R$'+preco/100);
  }
});
test('cupom reduz base real: desconto que derruba compra abaixo de R$50 remove anúncio',()=>{
  const c=criarCesta();c.adicionar('a');c.adicionar('b');
  c.db.collection('carts').update(c.cart.id,{cupom:{codigo:'PROMO',desconto:2000}});
  const tot=c.totais();assert.equal(tot.totalCentavos,4648);
  const html=render(c);assert.match(html,/Desconto \(PROMO\)/);
  assert.doesNotMatch(html,/parcelamento-cesta/);
});
test('não confunde frete com base da cesta e não anuncia juros como sem juros',()=>{
  const db=new DB();
  db.collection('settings').insert({id:'pagamentos',parcelasSemJuros:2,taxaJurosMes:3});
  const totais={quantidadeItens:4,subtotalCentavos:15000,descontoCupom:0,
    freteCentavos:1000,totalCentavos:16000,freteGratis:false};
  const html=htmlResumoCarrinho({itens:[{}]},totais,{mostrarFrete:false,db,exibirParcelamento:true});
  assert.match(html,/até 2x de R\$\s+75,00 sem juros/);
  assert.doesNotMatch(html,/até 6x sem juros/);
  assert.match(html,/frete no checkout/);
});
test('centavo indivisível não divulga soma incorreta das parcelas',()=>{
  const db=new DB();
  const txt=htmlParcelamentoCesta(db,{quantidadeItens:1,subtotalCentavos:5001,
    descontoCupom:0,totalCentavos:5001});
  assert.match(txt,/até 2x sem juros/);
  assert.doesNotMatch(txt,/R\$\s+25,01/);
});
test('página minha cesta e API compartilham o aviso após mudança de quantidades/cupons',()=>{
  const c=criarCesta();c.adicionar('a');c.adicionar('b');
  const ctx={db:c.db,cart:c.atual(),csrf:'fake',req:{pathname:'/carrinho'},
    settings:{empresa:{nomeFantasia:'Farmácia Pague Pouco'},tema:{},seo:{},whatsapp:{},cookies:{}},
    arvore:[]};
  const html=telaCarrinho(ctx,{totais:c.totais()});
  assert.match(html,/até 2x de R\$\s+33,24 sem juros/);
  const api=readFileSync(new URL('../src/routes/api.js',import.meta.url),'utf8');
  assert.match(api,/htmlRodapeCarrinho\(normalizado\.cart, totais, db\)/);
  assert.match(api,/resumoSemFrete: htmlResumoCarrinho/);
  const script=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
  assert.match(script,/window\.location\.pathname === '\/carrinho'/);
  assert.match(script,/resumoEl\.innerHTML = resumoAtual/);
});
