import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';
import { intensidadeSeloDesconto, variaveisSeloDesconto, estiloSeloDesconto }
  from '../src/lib/efeito-selo-desconto.js';
import { paginaPublica } from '../src/views/layout.js';
import { telaConfiguracoes } from '../src/views/admin/config.js';

const db = { collection() { return { all: () => [], get: () => null }; } };
const ctx = (intensidade = 100) => {
  const settings = DEFAULT_SETTINGS();
  settings.tema.seloDescontoPulsoIntensidade = intensidade;
  return {
    db, settings, arvore: [], csrf: 'csrf-teste',
    req: { pathname: '/', query: new URLSearchParams() },
    adminUser: { id: 'admin', nome: 'Administrador', role: 'super_admin' },
  };
};

test('100 mantém efeito atual, 0 fixa selo e 200 intensifica sem modificar preço', () => {
  assert.equal(DEFAULT_SETTINGS().tema.seloDescontoPulsoIntensidade, 100);
  assert.equal(intensidadeSeloDesconto(undefined), 100);
  const atual = variaveisSeloDesconto(100);
  assert.equal(atual['--oferta-escala-forte'], '1.160');
  assert.equal(atual['--oferta-sombra-amarela-forte'], '0.680');
  assert.match(atual['--oferta-pulso-animacao'], /1.35s/);
  const fixo = variaveisSeloDesconto(0);
  assert.equal(fixo['--oferta-pulso-animacao'], 'none');
  assert.equal(fixo['--oferta-escala-forte'], '1.000');
  assert.equal(fixo['--oferta-sombra-amarela-forte'], '0.000');
  const forte = variaveisSeloDesconto(200);
  assert.equal(forte['--oferta-escala-forte'], '1.320');
  assert.equal(forte['--oferta-sombra-amarela-forte'], '1.000');
  assert.ok(Number(forte['--oferta-escala-forte']) > Number(atual['--oferta-escala-forte']));
});

test('valor malicioso ou fora do intervalo não injeta CSS', () => {
  assert.equal(intensidadeSeloDesconto('200;background:url(javascript:alert(1))'), 100);
  assert.equal(intensidadeSeloDesconto(Infinity), 100);
  assert.equal(intensidadeSeloDesconto(-1), 0);
  assert.equal(intensidadeSeloDesconto(77777), 200);
  assert.doesNotMatch(estiloSeloDesconto('a;--hack:1'), /hack|javascript|background:url/);
});

test('HTML público recebe intensidade da configuração em todas as páginas', () => {
  const fixo = paginaPublica(ctx(0), { titulo: 'Ofertas', conteudo: 'Teste' });
  assert.match(fixo, /--oferta-pulso-animacao:none;/);
  assert.match(fixo, /--oferta-escala-forte:1\.000/);
  const forte = paginaPublica(ctx(200), { titulo: 'Produto', conteudo: 'Produto' });
  assert.match(forte, /--oferta-escala-forte:1\.320/);
  assert.match(forte, /--oferta-pulso-animacao:oferta-desconto-pulsar 1\.35s/);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /animation: var\(--oferta-pulso-animacao/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
});

test('painel permite slider, botões fixo/padrão e prévia instantânea antes de salvar', () => {
  const c = ctx(0);
  const html = telaConfiguracoes(c, { settings: c.settings });
  assert.match(html, /action="\/admin\/api\/config\/tema"/);
  assert.match(html, /name="seloDescontoPulsoIntensidade"/);
  assert.match(html, /min="0" max="200" step="10" value="0"/);
  assert.match(html, /id="seloDescontoFixo"/);
  assert.match(html, /id="seloDescontoPadrao"/);
  assert.match(html, /id="previewSeloDesconto"/);
  assert.match(html, /Fixo \(sem pulsação\)/);
  assert.match(html, /33% OFF/);
  assert.match(html, /admin-selo-desconto\.js/);
  const script = readFileSync(new URL('../public/js/admin-selo-desconto.js', import.meta.url),'utf8');
  assert.match(script, /addEventListener\('input', atualizar\)/);
  assert.match(script, /setProperty\(nome, valor\)/);
});

test('salvamento valida a intensidade e preserva antigas configurações de tema', () => {
  const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url),'utf8');
  assert.match(routes, /seloDescontoPulsoIntensidade: novaIntensidade === undefined/);
  assert.match(routes, /guardApi\(req, res, 'configuracoes\.editar'\)/);
  assert.match(routes, /intensidade do selo deve ficar entre 0 e 200%/);
});
