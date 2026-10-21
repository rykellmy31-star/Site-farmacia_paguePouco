import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { produtoPage, homePage } from '../src/views/public.js';
import { cartaoProduto } from '../src/views/partials.js';

const db = { collection: () => ({ all: () => [] }) };
const settings = {
  empresa: { nomeFantasia: 'Farmácia Pague Pouco' },
  tema: {}, seo: {}, whatsapp: {}, cookies: {},
  home: { secoes: [{ tipo: 'entregas', ativo: true, ordem: 1 }] },
};
const ctx = { db, settings, req:{ pathname:'/' }, arvore:[],csrf:'teste' };
const produto = {
  id:'produto-teste', slug:'produto-teste', nome:'Absorvente com abas',
  ativo:true, imagens:[], precoCentavos:190,
  estoque:{ quantidade:5, reservado:0 },
  sanitario:{ classificacao:'nao_aplicavel' },
};

test('detalhe do produto usa cesta compacta sem flex-grow e preserva funcionalidade',()=>{
  const html = produtoPage(ctx, { produto,categoria:null,relacionados:[],configLoja:{} });
  assert.match(html, /class="linha centro compra-produto"/);
  assert.match(html, /class="botao destaque botao-adicionar-cesta"/);
  assert.match(html, /class="icone-cesta" aria-hidden="true"><svg/);
  assert.match(html, /data-adicionar-carrinho="produto-teste"/);
  assert.match(html, /data-quantidade-input="quantidadeProduto"/);
  assert.match(html, /<span>Adicionar à cesta<\/span>/);
  assert.doesNotMatch(html, /class="botao destaque cresce" data-adicionar-carrinho=/);
});

test('cards de produtos mostram cesta pequena, sem perder os atributos de compra',()=>{
  const html = cartaoProduto(produto);
  assert.match(html, /class="botao bloquinho botao-adicionar-cesta"/);
  assert.match(html, /<span class="icone-cesta" aria-hidden="true"><svg/);
  assert.match(html, /data-adicionar-carrinho="produto-teste"/);
});

test('home exibe benefícios de frete e compra segura em selos discretos',()=>{
  const html=homePage(ctx);
  assert.match(html, /class="beneficios-entrega"/);
  assert.match(html, /class="beneficio-entrega"><svg[\s\S]*?Frete fixo por estado/);
  assert.match(html, /Compra segura/);
  assert.match(html, /beneficio-link/);
  assert.match(html, /href="\/pagina\/entregas-e-fretes"/);
});

test('ícones SVG de compra e frete têm tamanho limitado em CSS, desktop e mobile',()=>{
  const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css, /\.botao-adicionar-cesta \.icone-cesta svg\s*\{[^}]*width: 18px;[^}]*height: 18px;/);
  assert.match(css, /@media \(min-width: 768px\)[\s\S]*?\.produto \.acoes \.botao-adicionar-cesta\s*\{[^}]*width: auto;/);
  assert.match(css, /\.beneficio-entrega svg\s*\{[^}]*width: 15px;[^}]*height: 15px;/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.compra-produto \.botao-adicionar-cesta/);
});
