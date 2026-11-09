import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Collection} from '../src/lib/store.js';
import {recomendarParaCarrinho} from '../src/lib/inteligencia-vendas.js';
import {secaoRecomendacoes} from '../src/views/recomendacoes.js';
import {htmlGavetaCarrinho} from '../src/views/cart.js';

function dbFake(){
  const cols=new Map();
  return {collection(name){
    if(!cols.has(name))cols.set(name,new Collection({_commit(){}},name));
    return cols.get(name);
  }};
}
function fixture(){
  const db=dbFake();
  db.collection('categories').insert({id:'infantil',nome:'Bebês e infantil',slug:'infantil'});
  db.collection('products').insert({
    id:'lenco',slug:'lenco-ume-piquitucho-hid-140un',nome:'LENCO UME PIQUITUXO HID 140UN',
    ativo:true,categoriaId:'infantil',precoCentavos:1390,
    estoque:{quantidade:10,reservado:0},imagens:[],sanitario:{classificacao:'nao_aplicavel'},
  });
  db.collection('products').insert({
    id:'fralda',slug:'fralda-babysec',nome:'FRALDA BABYSEC INFANTIL M',
    ativo:true,categoriaId:'infantil',precoCentavos:4590,
    estoque:{quantidade:10,reservado:0},imagens:[],sanitario:{classificacao:'nao_aplicavel'},
  });
  db.collection('products').insert({
    id:'esgotado',slug:'fralda-esgotada',nome:'FRALDA INFANTIL SEM ESTOQUE',
    ativo:true,categoriaId:'infantil',precoCentavos:3000,
    estoque:{quantidade:0,reservado:0},imagens:[],sanitario:{classificacao:'nao_aplicavel'},
  });
  return {db,cart:{id:'c-teste',itens:[{produtoId:'lenco',nome:'LENCO UME PIQUITUXO HID 140UN',
    slug:'lenco-ume-piquitucho-hid-140un',quantidade:1,precoUnitarioCentavos:1390}]}};
}
test('cesta com LENCO UME PIQUITUXO mostra fralda disponível como complemento',()=>{
  const {db,cart}=fixture();
  const sugestoes=recomendarParaCarrinho(db,cart,{limite:4});
  assert(sugestoes.some(x=>x.produto.id==='fralda'));
  assert(!sugestoes.some(x=>x.produto.id==='esgotado'));
  assert(!sugestoes.some(x=>x.produto.id==='lenco'));
  const cards=secaoRecomendacoes(sugestoes,{
    titulo:'✨ Você também pode precisar',id:'recomendacoesGavetaCards',
  });
  const corpo=htmlGavetaCarrinho(cart,{quantidadeItens:1},cards);
  assert.match(corpo,/LENCO UME PIQUITUXO HID 140UN/);
  assert.match(corpo,/Você também pode precisar/);
  assert.match(corpo,/FRALDA BABYSEC/);
  assert.match(corpo,/data-adicionar-carrinho="fralda"/);
  assert.match(corpo,/data-recomendacao-origem="lenco"/);
  assert(corpo.indexOf('FRALDA BABYSEC')>corpo.indexOf('LENCO UME PIQUITUXO'));
});
test('gaveta sem itens não insere cartões e nem altera rodapé de pagamento',()=>{
  const {db,cart}=fixture();
  const vazio={...cart,itens:[]};
  const corpo=htmlGavetaCarrinho(vazio,{quantidadeItens:0},'<p>Sugestão</p>');
  assert.doesNotMatch(corpo,/Sugestão/);
  const source=readFileSync(new URL('../src/views/cart.js',import.meta.url),'utf8');
  assert.match(source,/htmlRodapeCarrinho/);
  assert.match(source,/Finalizar compra/);
  assert.match(source,/Ver cesta completa/);
});
test('a API responde recomendações na gaveta e mantém recomendações da cesta completa',()=>{
  const source=readFileSync(new URL('../src/routes/api.js',import.meta.url),'utf8');
  assert.match(source,/htmlSugestoesGaveta/);
  assert.match(source,/corpo: htmlGavetaCarrinho\(normalizado\.cart, totais, htmlSugestoesGaveta\)/);
  assert.match(source,/recomendacoes: htmlSugestoesCarrinho/);
  assert.match(source,/registrarAdicaoRecomendada/);
  assert.match(source,/titulo:'✨ Você também pode precisar'/);
});
test('etapa entrega mostra recomendações antes de Ir para o pagamento',()=>{
  const source=readFileSync(new URL('../src/views/checkout.js',import.meta.url),'utf8');
  const render=source.indexOf('id="recomendacoesAntesPagamento"');
  const proximo=source.indexOf('id="botaoIrPagamento"');
  assert(render>0);
  assert(proximo>render);
  assert.match(source,/Esqueceu de alguma coisa\?/);
  assert.match(source,/recomendarParaCarrinho\(ctx\.db,ctx\.cart,\{limite:4\}\)/);
});
test('adicionar card na entrega recalcula frete; gaveta e CSS continuam mobile',()=>{
  const js=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../src/views/layout.js',import.meta.url),'utf8');
  assert.match(js,/origemRecomendacao/);
  assert.match(js,/window\.location\.pathname === '\/checkout\/endereco'/);
  assert.match(js,/window\.location\.reload\(\)/);
  assert.match(css,/\.gaveta \.recomendacoes-trilha/);
  assert.match(css,/overflow-x:\s*auto/);
  assert.match(css,/\.recomendacoes-antes-pagamento/);
  assert.match(layout,/gaveta-20261109/);
  assert.doesNotMatch(layout,/abrirModalRecomendacoes/);
});


test('cesta lateral usa cards horizontais baixos com botão visível em celular',()=>{
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../src/views/layout.js',import.meta.url),'utf8');
  const parte=css.slice(css.lastIndexOf('CESTA LATERAL COMPACTA'));
  assert(parte.length>500,'bloco específico da cesta compacta ausente');
  assert.match(parte,/\.gaveta \.recomendacao-card\s*\{[^}]*display:\s*grid/);
  assert.match(parte,/\.gaveta \.recomendacao-card\s*\{[^}]*grid-template-columns:\s*68px minmax\(0,1fr\)/);
  assert.match(parte,/\.gaveta \.recomendacao-imagem\s*\{[^}]*height:\s*69px/);
  assert.match(parte,/\.gaveta \.recomendacao-adicionar,[\s\S]*?min-height:\s*34px/);
  assert.match(parte,/\.gaveta \.recomendacoes-trilha\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(parte,/\.gaveta \.corpo\s*\{[^}]*overflow|\.gaveta \.corpo\s*\{[^}]*min-height:\s*0/);
  assert.match(layout,/styles\.css\?v=inteligencia-vendas-20261109-gaveta-20261109-compacta/);
});
test('rodapé da gaveta é compacto e cupom, total e finalizar permanecem disponíveis',()=>{
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const cart=readFileSync(new URL('../src/views/cart.js',import.meta.url),'utf8');
  const parte=css.slice(css.lastIndexOf('CESTA LATERAL COMPACTA'));
  assert.match(parte,/\.gaveta footer\s*\{[^}]*max-height:\s*min\(48dvh,\s*258px\)/);
  assert.match(parte,/\.gaveta footer\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(parte,/\.gaveta footer \[data-form-cupom\] \.entrada\s*\{[^}]*height:\s*40px/);
  assert.match(parte,/\.gaveta footer \.resumo-linha\.total\s*\{[^}]*font-size:\s*1rem/);
  assert.match(parte,/\.gaveta footer \.botao\.bloquinho\s*\{[^}]*min-height:\s*40px/);
  assert.match(cart,/Cupom de desconto/);
  assert.match(cart,/htmlResumoCarrinho\(cart, totais/);
  assert.match(cart,/href="\/checkout">Finalizar compra/);
  assert.match(cart,/href="\/carrinho">Ver cesta completa/);
  // As etapas de checkout continuam sendo as páginas e funções existentes.
  const checkout=readFileSync(new URL('../src/views/checkout.js',import.meta.url),'utf8');
  assert.match(checkout,/export function telaPagamentoPresencial/);
  assert.match(checkout,/export function telaPagamento\(/);
});
