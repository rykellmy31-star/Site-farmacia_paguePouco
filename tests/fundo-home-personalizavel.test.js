import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { normalizarFundoHome, corHexValida, urlImagemFundoValida } from '../src/lib/fundo-home.js';
import { paginaPublica } from '../src/views/layout.js';
import { telaConfiguracoes } from '../src/views/admin/config.js';

const imagem = '/uploads/2026/11/ABC_123-fundo.webp';
const db = { collection() { return { all: () => [], get: () => null }; } };

function contexto(fundoHome) {
  const settings = DEFAULT_SETTINGS();
  settings.tema.fundoHome = fundoHome;
  return {
    db, settings, arvore: [], csrf: 'csrf-fundo-home',
    req: { pathname: '/', query: new URLSearchParams() },
    adminUser: { id: 'admin-teste', nome: 'Administrador', role: 'super_admin' },
  };
}

test('configuração padrão mantém a aparência original sem camada sazonal', () => {
  const html = paginaPublica(contexto({ modo: 'padrao' }), {
    titulo: 'Página inicial', corpoClasse: 'pagina-inicial', conteudo: '<p>Olá</p>',
  });
  assert.match(html, /class="com-menu-mobile pagina-inicial"/);
  assert.doesNotMatch(html, /fundo-imagem::before/);
  assert.doesNotMatch(html, /fundo-personalizado/);
});

test('fundo de cor é exclusivo da home, sem contaminar as páginas internas', () => {
  const ctx = contexto({ modo: 'cor', cor: '#001f50', imagemUrl: '' });
  const home = paginaPublica(ctx, { titulo: '', corpoClasse: 'pagina-inicial', conteudo: 'Home' });
  assert.match(home, /fundo-personalizado fundo-cor/);
  assert.match(home, /--fundo-home-cor:#001f50/);
  const interna = paginaPublica(ctx, { titulo: 'Busca', conteudo: 'Busca' });
  assert.doesNotMatch(interna, /fundo-personalizado/);
  assert.doesNotMatch(interna, /--fundo-home-cor/);
});

test('imagem local ajusta enquadramento e recusa URLs externas ou CSS injetado', () => {
  const home = paginaPublica(contexto({
    modo: 'imagem', cor: '#080808', imagemUrl: imagem, posicao: 'topo',
  }), { corpoClasse: 'pagina-inicial', conteudo: '' });
  assert.match(home, /fundo-personalizado fundo-imagem/);
  assert.match(home, /background-image:url\("\/uploads\/2026\/11\/ABC_123-fundo\.webp"\)/);
  assert.match(home, /background-position:center top/);
  assert.equal(corHexValida('red; background:url(https://example.com)'), false);
  assert.equal(urlImagemFundoValida('https://externo.exemplo/imagem.jpg'), '');
  assert.equal(urlImagemFundoValida('/uploads/2026/11/abc.svg'), '');
  assert.equal(normalizarFundoHome({ modo: 'imagem', imagemUrl: 'javascript:alert(1)' }).modo, 'padrao');
});

test('painel oferece cor, imagem, prévia e restaurar padrão sem modificar logotipo', () => {
  const html = telaConfiguracoes(contexto({
    modo: 'imagem', cor: '#000000', imagemUrl: imagem, posicao: 'centro',
  }), { settings: contexto({ modo: 'padrao' }).settings });
  assert.match(html, /action="\/admin\/api\/config\/fundo-home"/);
  assert.match(html, /name="imagemFundoHome"/);
  assert.match(html, /name="modoFundoHome"/);
  assert.match(html, /id="previewFundoHome"/);
  assert.match(html, /Padrão do site/);
  assert.match(html, /name="logo"/);
});
