import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/lib/http.js';
import { dispatchFetch } from '../src/cloudflare/http-adapter.js';
import { adicionarCreditoDesenvolvedor, NOME_DESENVOLVEDOR } from '../src/lib/developer-credit.js';

const marcador = 'data-credito-desenvolvedor="true"';
const conta = (s, valor) => s.split(valor).length - 1;

test('rodapé identifica o desenvolvedor em página pública completa exatamente uma vez', () => {
  const html = '<!doctype html><html lang="pt-BR"><body><main>Loja</main></body></html>';
  const result = adicionarCreditoDesenvolvedor(html);
  assert.ok(result.includes('Projeto desenvolvido por <strong>' + NOME_DESENVOLVEDOR + '</strong>'));
  assert.equal(conta(result, marcador), 1);
  assert.ok(result.indexOf(marcador) < result.indexOf('</body>'));
  assert.equal(adicionarCreditoDesenvolvedor(result), result);
});

test('páginas independentes e erros HTML também recebem identificação', () => {
  const semBody = adicionarCreditoDesenvolvedor('<html><title>Configuração</title></html>');
  const erro = adicionarCreditoDesenvolvedor('<h1>403</h1><p>Sem permissão</p>');
  assert.equal(conta(semBody, marcador), 1);
  assert.equal(conta(erro, marcador), 1);
  assert.ok(semBody.indexOf(marcador) < semBody.indexOf('</html>'));
});

test('camada HTTP inclui rodapé nas páginas e preserva JSON e Content-Length', async () => {
  const app = createApp();
  app.get('/site', (req, res) => res.html('<!doctype html><html><body><h1>Loja</h1></body></html>'));
  app.get('/admin/login', (req, res) => res.html('<!doctype html><html><body><h1>Login</h1></body></html>'));
  app.get('/erro', (req, res) => res.html('<h1>Erro</h1>', 403));
  app.get('/api/estado', (req, res) => res.json({ ok: true }));
  for (const path of ['/site', '/admin/login', '/erro']) {
    const resposta = await dispatchFetch(app, new Request('https://site.exemplo' + path));
    const html = await resposta.text();
    assert.equal(conta(html, marcador), 1, path);
    assert.ok(html.includes(NOME_DESENVOLVEDOR), path);
    assert.equal(Number(resposta.headers.get('content-length')), Buffer.byteLength(html), path);
  }
  const api = await dispatchFetch(app, new Request('https://site.exemplo/api/estado'));
  assert.deepEqual(await api.json(), { ok: true });
  assert.equal(api.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('conteúdo vazio e valores não HTML não são alterados pelo helper', () => {
  assert.equal(adicionarCreditoDesenvolvedor(''), '');
  assert.equal(adicionarCreditoDesenvolvedor(null), null);
});
