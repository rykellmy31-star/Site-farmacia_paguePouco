import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/img/favicon.svg', import.meta.url), 'utf8');

test('favicon mantém cruz de farmácia vermelha sobre fundo claro', () => {
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /<path[^>]+fill="#8b0000"/i);
  assert.match(svg, /<rect[^>]+fill="#fff0f0"/i);
  assert.doesNotMatch(svg, /#0f8b5f|#0a6b48/i);
  assert.match(svg, /aria-label="Farmácia Pague Pouco"/);
});

test('arquivo favicon é SVG simples, sem código externo e sem recursos remotos', () => {
  assert.match(svg, /^<svg\s/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.doesNotMatch(svg, /<script\b|<foreignObject\b|<image\b|<use\b|href=|onload=|javascript:/i);
});
