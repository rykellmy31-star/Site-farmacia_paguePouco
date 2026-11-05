import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { paginaPublica } from '../src/views/layout.js';
import { telaConfiguracoes } from '../src/views/admin/config.js';

const db = { collection() { return { all: () => [], get: () => null }; } };
const ctx = (tema = {}) => ({
  db, arvore: [], csrf: 'token',
  req: { pathname: '/', query: new URLSearchParams() },
  adminUser: { id: 'adm', nome: 'Administrador', role: 'super_admin' },
  settings: { ...DEFAULT_SETTINGS(), tema: { ...DEFAULT_SETTINGS().tema, ...tema } },
});

test('barra superior padrão é pulsante sem alterar cor do menu ou conteúdo', () => {
  const html = paginaPublica(ctx(), { conteudo: '<h1>Oferta</h1>' });
  assert.match(html, /class="barra-topo barra-topo-pulsante"/);
  assert.match(html, /--barra-topo-fundo:#fff0f0;--barra-topo-texto:#8b0000/);
  assert.match(html, /Entregamos para todo o Brasil/);
  assert.match(html, /<h1>Oferta<\/h1>/);
});

test('cor e texto personalizados são exibidos com validação contra injeção de CSS', () => {
  const html = paginaPublica(ctx({
    barraTopoCorFundo: '#031c57',
    barraTopoCorTexto: '#ffffff',
    barraTopoTexto: 'Novembro Azul 💙',
  }), { conteudo: '' });
  assert.match(html, /--barra-topo-fundo:#031c57;--barra-topo-texto:#ffffff/);
  assert.match(html, /Novembro Azul 💙/);
  const malicioso = paginaPublica(ctx({
    barraTopoCorFundo: '#000000;background:url(https://exemplo.com)',
    barraTopoCorTexto: 'red;',
  }), { conteudo: '' });
  assert.match(malicioso, /--barra-topo-fundo:#fff0f0;--barra-topo-texto:#8b0000/);
  assert.doesNotMatch(malicioso, /background:url\(https:\/\/exemplo\.com\)/);
});

test('efeito pulsante pode ser desativado e barra escondida', () => {
  const off = paginaPublica(ctx({ barraTopoPulsante: false }), { conteudo: '' });
  assert.match(off, /class="barra-topo" style=/);
  assert.doesNotMatch(off, /barra-topo-pulsante/);
  const hidden = paginaPublica(ctx({ barraTopoAtiva: false }), { conteudo: '' });
  assert.doesNotMatch(hidden, /<div class="barra-topo/);
});

test('editor oferece seletor de cor, controle de pulsação e prévia no painel', () => {
  const html = telaConfiguracoes(ctx(), { settings: ctx().settings });
  for (const input of ['barraTopoCorFundo', 'barraTopoCorTexto', 'barraTopoPulsante',
    'barraTopoPulsanteDefinida', 'barraTopoTexto']) {
    assert.match(html, new RegExp('name="' + input + '"'));
  }
  assert.match(html, /id="previewBarraTopo"/);
  assert.match(html, /id="previewTextoBarraTopo"/);
  assert.match(html, /Ativar pulsação suave na barra superior/);
});

test('CSS da barra é isolado e reduz o movimento quando solicitado', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body \.barra-topo\s*\{[^}]+--barra-topo-fundo/);
  assert.match(css, /body \.barra-topo, body \.barra-topo \*[\s\S]*?--barra-topo-texto/);
  assert.match(css, /@keyframes pulso-barra-superior/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const js = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  assert.match(js, /atualizarPreviaBarra/);
});
