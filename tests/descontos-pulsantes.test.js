import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cartaoProduto, vitrina, precoHtml } from '../src/views/partials.js';

const p = (id, desconto = 0) => ({
  id, slug: id, nome: 'Produto ' + id, ativo: true, marca: 'Farmácia Pague Pouco',
  precoCentavos: 5000, precoPromocionalCentavos: desconto ? 5000 - desconto : 0,
  estoque: { quantidade: 5, reservado: 0, quarentena: 0 },
  imagens: [], sanitario: { classificacao: 'nao_aplicavel' },
});

test('produto com desconto vigente exibe selo verde 20% OFF junto ao preco', () => {
  const html = cartaoProduto(p('oferta', 1000), { mostrarParcela: false });
  assert.match(html, /class="etiqueta-desconto oferta-pulsante">20% OFF<\/span>/);
  assert.ok(html.indexOf('class="foto"') < html.indexOf('class="preco-oferta"'), 'desconto fica abaixo da foto, junto ao preço');
  assert.match(html, /R\$\s40,00/);
});

test('produto sem desconto não recebe selo nem animação', () => {
  const html = cartaoProduto(p('normal'), { mostrarParcela: false });
  assert.doesNotMatch(html, /etiqueta-desconto|oferta-pulsante/);
});

test('vitrines mistas e preços de produtos exibem pulsação só em descontos', () => {
  const html = vitrina([p('sem-promocao'), p('com-promocao', 1500)], { db: null });
  assert.equal((html.match(/class="etiqueta-desconto oferta-pulsante"/g) || []).length, 1);
  assert.match(html, /30% OFF/);
  assert.match(precoHtml(p('detalhes', 1000), { grande: true }), /etiqueta-desconto oferta-pulsante/);
  assert.doesNotMatch(precoHtml(p('detalhes-sem-promocao')), /oferta-pulsante/);
});

test('CSS usa pulsação visível e respeita acessibilidade', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes oferta-desconto-pulsar/);
  assert.match(css, /transform: scale\(1\.16\)/);
  assert.match(css, /animation: oferta-desconto-pulsar 1\.35s/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.preco-oferta \.etiqueta-desconto\.oferta-pulsante/);
  const publico = readFileSync(new URL('../src/views/public.js', import.meta.url), 'utf8');
  assert.match(publico, /precoHtml\(produto, \{ db: ctx\.db \}\)/);
  const pagina = readFileSync(new URL('../src/views/layout.js', import.meta.url), 'utf8');
  assert.match(pagina, /styles\.css\?v=[a-z0-9-]+/i);
});


test('contagem aparece somente após pagamentos aprovados e soma unidades reais', () => {
  const pedidos = [
    { statusFinanceiro: 'aprovado', itens: [{ produtoId: 'oferta', quantidade: 14 }] },
    { statusFinanceiro: 'aprovado', itens: [{ produtoId: 'oferta', quantidade: 11 }] },
    { statusFinanceiro: 'pendente', itens: [{ produtoId: 'oferta', quantidade: 500 }] },
    { statusFinanceiro: 'recusado', itens: [{ produtoId: 'oferta', quantidade: 600 }] },
    { statusFinanceiro: 'estornado', itens: [{ produtoId: 'oferta', quantidade: 700 }] },
  ];
  const db = { collection: (name) => ({ get: () => null, all: () => name === 'orders' ? pedidos : [] }) };
  const oferta = { ...p('oferta', 1000), vendas: 9999 };
  const html = cartaoProduto(oferta, { db, mostrarParcela: false });
  assert.match(html, /\+25 vendidos/);
  assert.doesNotMatch(html, /9999|500 vendidos|700 vendidos/);
  assert.match(precoHtml(oferta, { db, grande: true }), /\+25 vendidos/);
  assert.match(vitrina([oferta, p('sem-vendas')], { db }), /\+25 vendidos/);
  assert.doesNotMatch(cartaoProduto(p('sem-vendas'), { db, mostrarParcela: false }), /produto-vendidos/);
});

test('zero vendas oculto e uma venda usa singular, sem promoção mantém preço normal', () => {
  const db = { collection: () => ({ get: () => null, all: () => [
    { statusFinanceiro: 'aprovado', itens: [{ produtoId: 'normal', quantidade: 1 }] },
  ] }) };
  const html = cartaoProduto({ ...p('normal'), vendas: 80 }, { db, mostrarParcela: false });
  assert.match(html, /\+1 vendido/);
  assert.doesNotMatch(html, /% OFF|preco-antigo/);
  assert.doesNotMatch(cartaoProduto(p('zerado'), { db, mostrarParcela: false }), /produto-vendidos|vendidos/);
});
