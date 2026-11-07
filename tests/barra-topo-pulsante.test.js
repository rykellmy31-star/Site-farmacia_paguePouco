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

test('faixa padrão é verde e branca abaixo do menu sem alterar as demais cores', () => {
  const html = paginaPublica(ctx(), { conteudo: '<h1>Oferta</h1>' });
  assert.match(html, /class="barra-topo barra-topo-pulsante"/);
  assert.match(html, /--barra-topo-fundo:#16803c;--barra-topo-texto:#ffffff/);
  assert.ok(html.indexOf('class="menu-departamentos"') < html.indexOf('class="barra-topo barra-topo-pulsante"'));
  assert.ok(html.indexOf('class="barra-topo barra-topo-pulsante"') < html.indexOf('</header>'));
  assert.ok(html.indexOf('class="barra-topo barra-topo-pulsante"') > html.indexOf('</nav>'));
  assert.equal((html.match(/class="barra-topo barra-topo-pulsante"/g) || []).length, 1);
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
  assert.match(malicioso, /--barra-topo-fundo:#16803c;--barra-topo-texto:#ffffff/);
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
  assert.match(html, /Ativar pulsação na faixa de avisos/);
  assert.match(html, /Faixa de avisos abaixo do menu/);
  assert.match(html, /value="#16803c"/);
  assert.match(html, /value="#ffffff"/);
});

test('CSS da barra é isolado e reduz o movimento quando solicitado', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body \.barra-topo\s*\{[^}]+--barra-topo-fundo/);
  assert.match(css, /body \.barra-topo, body \.barra-topo \*[\s\S]*?--barra-topo-texto/);
  assert.match(css, /@keyframes pulso-barra-superior/);
  assert.match(css, /brightness\(\.57\)/, 'a barra precisa ter pulso perceptível até em fundo branco');
  assert.match(css, /@keyframes pulso-barra-texto/, 'texto precisa pulsar');
  assert.match(css, /scale\(1\.065\)/, 'o texto precisa aumentar em cada batida');
  const html = paginaPublica(ctx(), { conteudo: 'Loja' });
  assert.match(html, /<span class="barra-topo-conteudo">/, 'deve renderizar o texto animável');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /body \.cabecalho\s*\{\s*position:\s*sticky;\s*top:\s*0/);
  assert.match(css, /body \.cabecalho > \.barra-topo\s*\{/);
  const js = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  assert.match(js, /atualizarPreviaBarra/);
});


test('cores antigas padrão são migradas visualmente, escolhas personalizadas não são sobrescritas', () => {
  const legado = paginaPublica(ctx({
    barraTopoCorFundo: '#fff0f0',
    barraTopoCorTexto: '#8b0000',
  }), { conteudo: '' });
  assert.match(legado, /--barra-topo-fundo:#16803c;--barra-topo-texto:#ffffff/);
  const editado = paginaPublica(ctx({
    barraTopoCorFundo: '#fff0f0',
    barraTopoCorTexto: '#8b0000',
    barraTopoEstiloVersao: 'abaixo-menu-verde-20261107',
  }), { conteudo: '' });
  assert.match(editado, /--barra-topo-fundo:#fff0f0;--barra-topo-texto:#8b0000/);
  const personalizado = paginaPublica(ctx({
    barraTopoCorFundo: '#112233',
    barraTopoCorTexto: '#aabbcc',
  }), { conteudo: '' });
  assert.match(personalizado, /--barra-topo-fundo:#112233;--barra-topo-texto:#aabbcc/);
});

test('barra é exibida apenas dentro de cabeçalho sticky e pode ser desabilitada', () => {
  const html = paginaPublica(ctx(), { conteudo: '<section>Banner principal</section>' });
  const bar = html.indexOf('class="barra-topo barra-topo-pulsante"');
  assert.ok(bar > html.indexOf('class="menu-departamentos"'));
  assert.ok(bar < html.indexOf('</header>'));
  assert.ok(bar < html.indexOf('<main id="conteudo">'));
  assert.ok(html.indexOf('<body') < html.indexOf('<header class="cabecalho">'));
  assert.doesNotMatch(paginaPublica(ctx({barraTopoAtiva:false}), {conteudo:'Banner'}), /class="barra-topo/);
  const route = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(route, /barraTopoEstiloVersao: 'abaixo-menu-verde-20261107'/);
});
