import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paginaPublica } from '../src/views/layout.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

const settings = DEFAULT_SETTINGS();
settings.whatsapp.ativo = true;
settings.whatsapp.numero = '5573999999999';
const db = { collection() { return { all: () => [], get: () => null }; } };
const ctx = { settings, db, arvore: [], req: { pathname: '/' }, csrf: 'teste' };

test('rodapé mostra botão compacto Falar no WhatsApp, com ícone e link preservado', () => {
  const html = paginaPublica(ctx, { conteudo: 'Home' });
  assert.match(html, /<a class="rodape-whatsapp-link" href="https:\/\/wa\.me\/5573999999999\?text=/);
  assert.match(html, /aria-label="Falar no WhatsApp"/);
  assert.match(html, /<span class="rodape-whatsapp-icone" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span>Falar no WhatsApp<\/span>/);
  assert.doesNotMatch(html, /WhatsApp \(dúvidas\)/);
  assert.match(html, /class="whatsapp-flutuante/);
});

test('se WhatsApp estiver desativado, não mostrar contato no rodapé', () => {
  const offline = { ...ctx, settings: { ...settings, whatsapp: { ...settings.whatsapp, ativo: false } } };
  const html = paginaPublica(offline, { conteudo: 'Home' });
  assert.doesNotMatch(html, /class="rodape-whatsapp-link"/);
});

test('ícone do rodapé tem largura e altura de 20px e botão cabe no celular', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.rodape \.rodape-whatsapp-icone svg\s*\{[^}]*width: 20px !important;[^}]*height: 20px !important;/);
  assert.match(css, /\.rodape \.rodape-whatsapp-link\s*\{[^}]*max-width: 100%/);
  assert.match(css, /@media\(max-width: 640px\)\s*\{\s*\.rodape \.rodape-whatsapp-link/);
  const html = paginaPublica(ctx, { conteudo: 'Home' });
  assert.match(html, /styles\.css\?v=whatsapp-rodape-compacto-20261106/);
});
