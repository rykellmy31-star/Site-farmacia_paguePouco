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

test('produto com desconto real e vigente exibe selo -20% pulsante', () => {
  const html = cartaoProduto(p('oferta', 1000), { mostrarParcela: false });
  assert.match(html, /class="etiqueta-desconto oferta-pulsante">-20%<\/span>/);
  assert.match(html, /R\$\s40,00/);
});

test('produto sem desconto não recebe selo nem animação', () => {
  const html = cartaoProduto(p('normal'), { mostrarParcela: false });
  assert.doesNotMatch(html, /etiqueta-desconto|oferta-pulsante/);
});

test('vitrines mistas e preços de produtos exibem pulsação só em descontos', () => {
  const html = vitrina([p('sem-promocao'), p('com-promocao', 1500)], { db: null });
  assert.equal((html.match(/class="etiqueta-desconto oferta-pulsante"/g) || []).length, 1);
  assert.match(html, /-30%/);
  assert.match(precoHtml(p('detalhes', 1000), { grande: true }), /etiqueta laranja oferta-pulsante/);
  assert.doesNotMatch(precoHtml(p('detalhes-sem-promocao')), /oferta-pulsante/);
});

test('CSS usa pulsação visível e respeita acessibilidade', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes oferta-desconto-pulsar/);
  assert.match(css, /transform: scale\(1\.16\)/);
  assert.match(css, /animation: oferta-desconto-pulsar 1\.35s/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.etiqueta\.laranja\.oferta-pulsante/);
  const publico = readFileSync(new URL('../src/views/public.js', import.meta.url), 'utf8');
  assert.match(publico, /class="etiqueta laranja oferta-pulsante"/);
  const pagina = readFileSync(new URL('../src/views/layout.js', import.meta.url), 'utf8');
  assert.match(pagina, /styles\.css\?v=descontos-pulsantes-20261105/);
});
