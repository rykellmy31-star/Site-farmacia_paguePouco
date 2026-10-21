import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync(new URL('../src/views/public.js', import.meta.url), 'utf8');
const cards = readFileSync(new URL('../src/views/partials.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('botão do detalhe mantém carrinho e contrato funcional de quantidade', () => {
  assert.match(detail, /class="botao destaque cresce botao-adicionar-cesta" data-adicionar-carrinho=/);
  assert.match(detail, /data-quantidade-input="quantidadeProduto"/);
  assert.match(detail, /\$\{ICONES\.carrinho\} Adicionar à cesta/);
});

test('cartões do catálogo oferecem ícone e texto sem alterar carrinho', () => {
  assert.match(cards, /class="botao bloquinho botao-adicionar-cesta" data-adicionar-carrinho=/);
  assert.match(cards, /\$\{ICONES\.carrinho\}<span>Adicionar à cesta<\/span>/);
});

test('desktop usa dimensões compactas, sem alterar botão da versão móvel', () => {
  const desktop = css.split('/* Botões de compra discretos no desktop')[1] || '';
  assert.match(desktop, /@media \(min-width: 768px\)/);
  assert.match(desktop, /\.produto-detalhe \.acoes-compra-produto \.botao-adicionar-cesta\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(desktop, /\.vitrine \.produto \.acoes \.botao-adicionar-cesta\s*\{[\s\S]*?width:\s*auto;/);
  assert.match(desktop, /\.vitrine \.produto \.acoes \.botao-adicionar-cesta svg\s*\{[\s\S]*?width:\s*15px;/);
  assert.match(desktop, /@media \(max-width: 767px\)/);
  assert.match(css, /\.botao\s*\{[\s\S]*?min-height:\s*44px;/);
});
