import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avisoImagemProduto, cartaoProduto, vitrina } from '../src/views/partials.js';
import { produtoPage } from '../src/views/public.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

const foto = '/uploads/2026/11/absorvente-intimus.avif';
const produto = (id, ativo = true, imagens = [{ url: foto, principal: true }]) => ({
  id, slug: id, nome: 'Absorvente Intimus 80 unidades',
  ativo, imagens, precoCentavos: 3324,
  estoque: { quantidade: 2, reservado: 0, quarentena: 0 },
  sanitario: { classificacao: 'nao_aplicavel' },
});
const db = { collection() { return { all: () => [], get: () => null }; } };
const ctx = {
  db, settings: DEFAULT_SETTINGS(), req: { pathname: '/produto/absorvente' },
  arvore: [], csrf: 'teste',
};
const aviso = 'Imagem meramente ilustrativa. A embalagem pode variar.';

test('todo card de produto ativo com foto real exibe aviso abaixo da imagem', () => {
  const html = cartaoProduto(produto('produto-ativo'));
  assert.match(html, /<img src="\/uploads\/2026\/11\/absorvente-intimus\.avif"[^>]*>/);
  assert.match(html, /class="aviso-imagem-produto"/);
  assert.match(html, new RegExp(aviso.replaceAll('.', '\\.')));
  assert.ok(html.indexOf('class="aviso-imagem-produto"') > html.indexOf('class="foto"'));
  assert.ok(html.indexOf('class="aviso-imagem-produto"') < html.indexOf('class="nome"'));
  assert.match(html, /Adicionar à cesta/);
});

test('o aviso acompanha produtos em todas as vitrines e não duplica em cards', () => {
  const html = vitrina([produto('primeiro'), produto('segundo')]);
  assert.equal((html.match(/class="aviso-imagem-produto"/g) || []).length, 2);
});

test('produto aberto exibe aviso sob a foto principal e mantém miniaturas', () => {
  const item = produto('detalhe');
  item.imagens.push({ url: '/uploads/2026/11/detalhe.jpg' });
  const html = produtoPage(ctx, { produto: item, categoria: null, relacionados: [], configLoja: {} });
  assert.match(html, /id="imagemPrincipal"/);
  assert.match(html, /<div class="principal">[\s\S]*?<\/div>\s*<p class="aviso-imagem-produto">[\s\S]*?Imagem meramente ilustrativa\. A embalagem pode variar\.<\/p>\s*<div class="miniaturas">/);
  assert.match(html, /data-miniatura="\/uploads\/2026\/11\/detalhe\.jpg"/);
  assert.match(html, /Adicionar à cesta/);
});

test('não informar ilustração para produtos inativos ou com imagem provisória', () => {
  assert.equal(avisoImagemProduto(produto('inativo', false)), '');
  assert.equal(avisoImagemProduto(produto('sem-foto', true, [])), '');
  assert.equal(avisoImagemProduto(produto('placeholder', true, [{url:'/img/produto-sem-foto.svg'}])), '');
  assert.doesNotMatch(cartaoProduto(produto('sem-foto', true, [])), /aviso-imagem-produto/);
  assert.match(avisoImagemProduto(produto('foto-string', true, ['/uploads/2026/11/produto.png'])), /embalagem pode variar/);
});

test('aviso permanece legível no celular, sem sobrepor o produto e sem afetar imagem', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.aviso-imagem-produto\s*\{[^}]*font-size: 10px/);
  assert.match(css, /\.galeria > \.aviso-imagem-produto\s*\{[^}]*font-size: 12px/);
  const layout = readFileSync(new URL('../src/views/layout.js', import.meta.url), 'utf8');
  assert.match(layout, /styles\.css\?v=aviso-imagens-produtos-20261106/);
});
