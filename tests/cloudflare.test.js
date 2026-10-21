/**
 * Verificações locais: não chama deploy, não usa produção e não cria recursos remotos.
 * Node 22+; npm install; npm run test:cloudflare.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CloudStore } from '../src/cloudflare/store.js';
import { RequestQueue } from '../src/cloudflare/request-queue.js';
import { dispatchFetch, readWebBody } from '../src/cloudflare/http-adapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('fila protege uma reserva durante await e continua após falha', async () => {
  const queue = new RequestQueue();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let available = 1;
  const events = [];
  const first = queue.run(async () => {
    assert.equal(available, 1);
    events.push('first:start');
    await gate;
    available--;
    events.push('first:end');
  });
  const second = queue.run(async () => {
    events.push('second');
    assert.equal(available, 0);
    throw new Error('expected failure');
  });
  const failure = assert.rejects(second, /expected failure/);
  const third = queue.run(() => events.push('third'));
  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  release();
  await Promise.all([first, failure, third]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second', 'third']);
});

test('limite do corpo é aplicado mesmo sem Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
    },
    cancel() { cancelled = true; },
  });
  const request = new Request('https://tests.example/upload', { method: 'POST', body, duplex: 'half' });
  await assert.rejects(readWebBody(request, 5), error => error.status === 413);
  assert.equal(cancelled, true);
});

test('ponte HTTP preserva múltiplos cookies e elimina corpo em HEAD', async () => {
  const app = { async handle(req, res) {
    res.writeHead(200, { 'Set-Cookie': ['a=1; Secure', 'b=2; HttpOnly'], 'Content-Type': 'text/html' });
    res.end(Buffer.from('page'));
  } };
  const get = await dispatchFetch(app, new Request('https://tests.example/'));
  assert.equal(await get.text(), 'page');
  assert.equal(get.headers.getSetCookie().length, 2);
  assert.equal(get.headers.get('cache-control'), 'no-store');
  const head = await dispatchFetch(app, new Request('https://tests.example/', { method: 'HEAD' }));
  assert.equal(await head.text(), '');
});


test('mídia respeita intervalos, cache e HEAD com tamanho original', async () => {
  const bytes = Buffer.from('abcdefgh');
  const db = Object.create(CloudStore.prototype);
  db.sql = { exec(query) {
    return query.includes('SELECT * FROM files')
      ? [{ mime: 'video/mp4', size: bytes.length, etag: '"test-etag"', modified: '2026-10-20T00:00:00Z' }]
      : [{ body: bytes }];
  } };
  const request = (headers = {}, method = 'GET') => new Request('https://tests.example/uploads/test.mp4', { headers, method });
  const partial = db.fileResponse('test.mp4', request({ Range: 'bytes=2-4' }));
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-4/8');
  assert.equal(await partial.text(), 'cde');
  assert.equal(await db.fileResponse('test.mp4', request({ Range: 'bytes=-3' })).text(), 'fgh');
  assert.equal(db.fileResponse('test.mp4', request({ Range: 'bytes=8-9' })).status, 416);
  assert.equal(db.fileResponse('test.mp4', request({ 'If-None-Match': '"test-etag"' })).status, 304);
  const head = db.fileResponse('test.mp4', request({}, 'HEAD'));
  assert.equal(head.headers.get('content-length'), '8');
  assert.equal(await head.text(), '');
});

test('Workers local: site, login, uploads e dados sobrevivem à reinicialização', { timeout: 180000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pague-pouco-worker-'));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const password = 'SomenteTeste-Cloudflare-2026';
  let child;
  let logs = '';
  const cookies = new Map();
  const saveCookies = response => {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0], index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const headers = () => ({ Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') });
  async function call(url, opts = {}) {
    const response = await fetch(origin + url, { redirect: 'manual', ...opts,
      headers: { ...headers(), ...opts.headers } });
    saveCookies(response);
    return response;
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const processToStop = child;
    const exited = once(processToStop, 'exit');
    processToStop.kill('SIGTERM');
    const timer = setTimeout(() => processToStop.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
    child = null;
  }
  async function start() {
    logs = '';
    child = spawn(process.execPath, [
      path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local',
      '--ip', '127.0.0.1', '--port', String(port), '--persist-to', directory,
      '--var', 'ADMIN_EMAIL:admin@tests.example', '--var', 'ADMIN_PASSWORD:' + password,
    ], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { logs = (logs + data).slice(-12000); });
    child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error('Wrangler encerrou: ' + logs);
      try {
        const response = await fetch(origin + '/__health', { signal: AbortSignal.timeout(1500) });
        if (response.ok) return;
      } catch { /* Inicializando o workerd local. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Worker local não inicializou: ' + logs);
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  execFileSync(process.execPath, ['scripts/prepare-cloudflare.js'], { cwd: root, stdio: 'pipe' });
  const seed = JSON.parse(await readFile(path.join(root, '.cloudflare/seed.json'), 'utf8'));
  assert.equal('admins' in seed, false);
  assert.equal('customers' in seed, false);

  await start();
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/styles.css')).status, 200);
  assert.equal((await call('/data/db/admins.json')).status, 404);
  const login = await call('/admin/login');
  assert.equal(login.status, 200);
  const csrf = decodeURIComponent(cookies.get('pp_csrf'));
  assert.ok(csrf);
  const badCsrf = await call('/admin/login', { method: 'POST', body: new URLSearchParams({ email: 'admin@tests.example', senha: password }) });
  assert.equal(badCsrf.status, 403);
  const signed = await call('/admin/login', { method: 'POST', body: new URLSearchParams({
    email: 'admin@tests.example', senha: password, _csrf: csrf,
  }) });
  assert.equal(signed.status, 303);
  assert.equal(signed.headers.get('location'), '/admin');
  assert.ok(cookies.get('pp_admin_sess'));
  const dashboard = await call('/admin');
  assert.equal(dashboard.status, 200);
  const dashboardHtml = await dashboard.text();
  const adminCsrf = /window\.PP_ADMIN=({[^<]+?});<\/script>/.exec(dashboardHtml);
  assert.ok(adminCsrf, 'O painel precisa publicar o token CSRF para ações AJAX.');
  const adminToken = JSON.parse(adminCsrf[1]).csrf;
  assert.ok(adminToken, 'O token CSRF do administrador não pode ficar vazio.');
  assert.notEqual(adminToken, csrf, 'O token administrativo não pode ser o do visitante.');
  const adminFormHtml = await (await call('/admin/configuracoes')).text();
  assert.match(adminFormHtml, new RegExp('name="_csrf" value="' + adminToken + '"'));

  // Reproduz o erro observado pelo usuário: formulário administrativo real,
  // com token de visitante, não pode salvar; com token da sessão, deve salvar.
  const rejectedSave = await call('/admin/api/config/seo', {
    method: 'POST', body: new URLSearchParams({ _csrf: csrf, tituloPadrao: 'CSRF inválido' }),
  });
  assert.equal(rejectedSave.status, 403);
  const saved = await call('/admin/api/config/seo', {
    method: 'POST', body: new URLSearchParams({ _csrf: adminToken, tituloPadrao: 'Teste de edição persistente' }),
  });
  assert.equal(saved.status, 303);
  assert.match(saved.headers.get('location'), /\/admin\/configuracoes/);
  const loginAgain = await call('/admin/login');
  assert.equal(loginAgain.status, 303, 'Sessão administrativa ativa redireciona ao painel.');
  assert.equal(loginAgain.headers.get('location'), '/admin');

  const form = new FormData();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>';
  form.append('_csrf', adminToken);
  form.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'teste.svg');
  const uploaded = await call('/admin/api/upload', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  const uploadResult = await uploaded.json();
  const backup = await call('/admin/api/sistema/backup', { method: 'POST', body: new URLSearchParams({ _csrf: adminToken }) });
  assert.equal(backup.status, 200);
  const snapshot = await backup.json();
  assert.equal(snapshot.collections.admins.length, 1);
  assert.equal(snapshot.collections.settings.find(x => x.id === 'seo')?.tituloPadrao, 'Teste de edição persistente');
  assert.equal('__meta' in snapshot.collections, false);
  const media = snapshot.collections.midia.find(item => item.nome === 'teste.svg');
  assert.ok(media, JSON.stringify(uploadResult));
  assert.equal(await (await call(media.url)).text(), svg);

  // Backup seguro: o JSON preserva cadastros e o manifesto relaciona os
  // arquivos originais, cada um com hash SHA-256 e download autenticado.
  const unauthedBackup = await call('/admin/api/sistema/backup/midias.json', {
    headers: { Cookie: '' },
  });
  assert.equal(unauthedBackup.status, 401, 'backup de mídia não pode ser público');
  const manifestResponse = await call('/admin/api/sistema/backup/midias.json');
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-disposition') || '', /attachment/);
  assert.equal(manifestResponse.headers.get('cache-control'), 'no-store');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.format, 'pague-pouco-midia-manifest-v1');
  const entry = manifest.files.find(item => item.caminho === media.caminho);
  assert.ok(entry, 'mídia precisa constar no manifesto');
  assert.equal(entry.tamanho, Buffer.byteLength(svg));
  assert.equal(entry.sha256, crypto.createHash('sha256').update(svg).digest('hex'));
  const unauthedFile = await call('/admin/api/sistema/backup/arquivo/' + entry.chave, {
    headers: { Cookie: '' },
  });
  assert.equal(unauthedFile.status, 401, 'bytes originais não podem ser públicos via backup');
  const download = await call('/admin/api/sistema/backup/arquivo/' + entry.chave);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /attachment/);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.equal(await download.text(), svg, 'backup deve conter bytes idênticos ao upload');
  assert.equal((await call('/admin/api/sistema/backup/arquivo/YWJjLi4vLi4vc2VncmVkbw')).status, 404,
    'chave que não aponta para arquivo salvo é recusada');

  // Fluxo real do editor de produtos: a rota GET exibe o formulário,
  // mas o action POST deve apontar para /admin/api/produtos(/:id).
  const newProductPage = await call('/admin/produtos/novo');
  assert.equal(newProductPage.status, 200);
  const newProductHtml = await newProductPage.text();
  assert.match(newProductHtml, /id="formProduto" method="post" action="\/admin\/api\/produtos"/);
  assert.match(newProductHtml, /js\/admin\.js\?v=admin-formularios-v3/);
  const adminScript = await (await call('/js/admin.js?v=admin-formularios-v3')).text();
  assert.match(adminScript, /form\.id !== 'formProduto'/);
  assert.match(adminScript, /body: new FormData\(form\)/);
  const style = await (await call('/styles.css?v=admin-produtos-salvar-v2')).text();
  assert.match(style, /body \.notificacao[\s\S]*?background: #ffffff !important/);
  assert.match(style, /body \.notificacao,[\s\S]*?color: #171717 !important/);

  // O navegador envia FormData (inclusive CSRF), não uma rota POST inexistente.
  const novo = new FormData();
  for (const [key, value] of Object.entries({
    _csrf: adminToken, nome: 'Produto de teste com imagem', preco: '19.90',
    quantidade: '4', estoqueMinimo: '1', classificacao: 'nao_aplicavel', ativo: '1',
  })) novo.append(key, value);
  const created = await call('/admin/api/produtos', { method: 'POST', body: novo });
  assert.equal(created.status, 200);
  const productCreated = await created.json();
  assert.equal(productCreated.ok, true);
  assert.ok(productCreated.id);
  assert.equal(productCreated.url, '/admin/produtos/' + productCreated.id);
  const editPage = await call(productCreated.url);
  assert.equal(editPage.status, 200);
  assert.match(await editPage.text(), new RegExp('action="/admin/api/produtos/' + productCreated.id + '"'));
  const edit = new FormData();
  for (const [key, value] of Object.entries({
    _csrf: adminToken, nome: 'Produto editado com imagem',
    preco: '17.50', quantidade: '4', estoqueMinimo: '1',
    classificacao: 'nao_aplicavel', ativo: '1',
  })) edit.append(key, value);
  edit.append('imagens[]', media.url);
  edit.append('imagemLegenda[]', 'Imagem do teste');
  const edited = await call('/admin/api/produtos/' + productCreated.id, { method: 'POST', body: edit });
  assert.equal(edited.status, 200, 'Editar produto não deve retornar 404.');
  assert.equal((await edited.json()).id, productCreated.id);
  const successPage = await call(productCreated.url + '?salvo=1');
  assert.match(await successPage.text(), /Produto salvo com sucesso/);

  const afterEdit = await call('/admin/api/sistema/backup', {
    method: 'POST', body: new URLSearchParams({ _csrf: adminToken }),
  });
  assert.equal(afterEdit.status, 200);
  const updatedProduct = (await afterEdit.json()).collections.products.find(p => p.id === productCreated.id);
  assert.equal(updatedProduct.nome, 'Produto editado com imagem');
  assert.equal(updatedProduct.precoCentavos, 1750);
  assert.equal(updatedProduct.imagens?.[0]?.url, media.url);

  // Reproduz as operações que abriram JSON cru no navegador do lojista.
  const stockPage = await call('/admin/estoque');
  assert.equal(stockPage.status, 200);
  assert.match(await stockPage.text(), /action="\/admin\/api\/estoque\/movimentar"/);
  const stockChange = await call('/admin/api/estoque/movimentar', {
    method: 'POST', body: new URLSearchParams({
      _csrf: adminToken, produtoId: productCreated.id, tipo: 'entrada',
      quantidade: '3', observacao: 'Reposição teste de formulário',
    }),
  });
  assert.equal(stockChange.status, 200);
  const stockResult = await stockChange.json();
  assert.equal(stockResult.ok, true);
  assert.equal(stockResult.saldo, 7, 'saldo precisa refletir a movimentação aplicada somente uma vez');

  const promotionsPage = await call('/admin/promocoes');
  assert.equal(promotionsPage.status, 200);
  assert.match(await promotionsPage.text(), /action="\/admin\/api\/cupons"/);
  const couponForm = new URLSearchParams({
    _csrf: adminToken, codigo: 'REGRESSAOFORM2026', tipo: 'percentual',
    valor: '10', ativo: '1', usoMaximo: '2', valorMinimo: '0',
  });
  const coupon = await call('/admin/api/cupons', { method: 'POST', body: couponForm });
  assert.equal(coupon.status, 200);
  assert.equal((await coupon.json()).ok, true);
  const duplicate = await call('/admin/api/cupons', { method: 'POST', body: couponForm });
  assert.equal(duplicate.status, 400, 'cupom duplicado precisa falhar, sem criar outro registro');
  assert.match((await duplicate.json()).erro, /Já existe um cupom/);
  assert.match(await (await call('/admin/promocoes?salvo=1')).text(),
    /Operação concluída com sucesso/);

  await stop();
  await start();
  assert.equal((await call('/admin')).status, 200, 'sessão persiste após reinicialização');
  assert.equal(await (await call(media.url)).text(), svg, 'upload persiste após reinicialização');
  const afterRestartDownload = await call('/admin/api/sistema/backup/arquivo/' + entry.chave);
  assert.equal(afterRestartDownload.status, 200);
  assert.equal(await afterRestartDownload.text(), svg, 'backup de mídia sobrevive à reinicialização');
  const range = await call(media.url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '<svg');
  const check = await call('/admin/api/sistema/backup', { method: 'POST', body: new URLSearchParams({ _csrf: adminToken }) });
  assert.equal(check.status, 200, 'A sessão administrativa e o token persistem após reiniciar.');
  const recovered = await check.json();
  assert.equal(recovered.collections.admins.length, 1, 'bootstrap não duplica usuários');
  assert.equal(recovered.collections.settings.find(x => x.id === 'seo')?.tituloPadrao, 'Teste de edição persistente', 'Edição de texto persiste após reiniciar o Worker.');
  assert.equal(recovered.collections.midia.filter(item => item.id === media.id).length, 1);
  const persistedProduct = recovered.collections.products.find(p => p.id === productCreated.id);
  assert.equal(persistedProduct.nome, 'Produto editado com imagem', 'Edição de produto persiste após reiniciar.');
  assert.equal(persistedProduct.precoCentavos, 1750);
  assert.equal(persistedProduct.imagens?.[0]?.url, media.url, 'Imagem associada continua persistente.');
  assert.equal(persistedProduct.estoque?.quantidade, 7, 'Movimentação de estoque persiste no SQLite.');
  assert.equal(recovered.collections.coupons.filter(c => c.codigo === 'REGRESSAOFORM2026').length, 1,
    'Cupom deve ser criado apenas uma vez e persistir após reinicialização.');
});
