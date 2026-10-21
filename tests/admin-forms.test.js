/**
 * Exercita o JavaScript do painel em um navegador simulado, sem dependências
 * externas nem acessar serviços ou dados reais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const adminScript = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');

function browser({ path = '/admin/estoque', responder } = {}) {
  const events = new Map();
  const calls = [];
  const timers = [];
  const destinations = [];
  const classes = new Set();
  const toast = {
    textContent: '',
    style: { removeProperty() {} },
    classList: {
      add(v) { classes.add(v); },
      remove(v) { classes.delete(v); },
      toggle(v, yes) { yes ? classes.add(v) : classes.delete(v); },
    },
  };
  const document = {
    querySelector(selector) { return selector === '#notificacaoAdmin' ? toast : null; },
    querySelectorAll() { return []; },
    addEventListener(name, listener) { events.set(name, listener); },
  };
  const origin = 'https://loja.test';
  const location = {
    origin, href: origin + path, pathname: path,
    assign(value) { destinations.push(value); },
  };
  class FormDataFake {
    constructor(form) { this.form = form; }
    append() {}
  }
  const fetch = (path, options) => {
    calls.push({ path, options });
    return responder(path, options);
  };
  runInNewContext(adminScript, {
    document, window: { PP_ADMIN: { csrf: 'token-do-admin' }, location },
    location, fetch, FormData: FormDataFake, URL,
    clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; },
    console,
  }, { timeout: 2000 });
  const form = (action, method = 'post') => {
    const button = { textContent: 'Salvar', disabled: false };
    return {
      id: '', dataset: {}, button,
      getAttribute(name) { return { action, method }[name] || null; },
      querySelector() { return button; },
      contains() { return false; },
    };
  };
  const submit = f => {
    const event = { target: f, submitter: f.button, prevented: false,
      preventDefault() { this.prevented = true; } };
    events.get('submit')(event);
    return event;
  };
  return { form, submit, toast, calls, timers, destinations, classes };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const json = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status, redirected: false,
  headers: { get(name) { return name.toLowerCase() === 'content-type' ? 'application/json' : null; } },
  async json() { return data; },
});

test('estoque: formulário salva via AJAX, impede clique duplicado e volta ao painel com aviso', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const ui = browser({ responder: () => response });
  const form = ui.form('/admin/api/estoque/movimentar');
  assert.equal(ui.submit(form).prevented, true);
  assert.equal(ui.submit(form).prevented, true);
  assert.equal(ui.calls.length, 1, 'não deve registrar duas movimentações para dois cliques');
  assert.equal(ui.calls[0].options.headers['X-CSRF-Token'], 'token-do-admin');
  assert.equal(ui.calls[0].options.body.form, form, 'envia os campos originais e CSRF via FormData');
  assert.equal(form.button.disabled, true);
  release(json({ ok: true, saldo: 110 }));
  await flush();
  assert.match(ui.toast.textContent, /Saldo atual: 110/);
  assert.equal(ui.destinations.length, 0);
  ui.timers.at(-1)();
  assert.equal(ui.destinations[0], '/admin/estoque?salvo=1');
});

test('cupom: erro de validação aparece no painel e mantém os dados para correção', async () => {
  const ui = browser({ path: '/admin/promocoes',
    responder: async () => json({ ok: false, erro: 'Já existe um cupom com este código.' }, 400),
  });
  const form = ui.form('/admin/api/cupons');
  assert.equal(ui.submit(form).prevented, true);
  await flush();
  assert.match(ui.toast.textContent, /Já existe um cupom/);
  assert.ok(ui.classes.has('erro'));
  assert.equal(form.button.disabled, false);
  assert.equal(form.button.textContent, 'Salvar');
  assert.equal(ui.destinations.length, 0);
});

test('formulários com redirecionamento seguem apenas rotas internas e preservam a navegação', async () => {
  const ui = browser({ path: '/admin/fretes', responder: async () => ({
    ok: true, redirected: true, url: 'https://loja.test/admin/fretes?salvo=1',
  }) });
  const form = ui.form('/admin/api/fretes');
  ui.submit(form);
  await flush();
  assert.deepEqual(ui.destinations, ['/admin/fretes?salvo=1']);

  const externo = browser({ responder: async () => ({
    ok: true, redirected: true, url: 'https://outro.example/admin/fretes',
  }) });
  externo.submit(externo.form('/admin/api/fretes'));
  await flush();
  assert.equal(externo.destinations.length, 0);
  assert.ok(externo.classes.has('erro'), 'não segue endereço externo');
});

test('cupom criado usa confirmação e recarrega a listagem, sem mostrar JSON ao cliente', async () => {
  const ui = browser({ path: '/admin/promocoes', responder: async () => json({ ok: true }) });
  ui.submit(ui.form('/admin/api/cupons'));
  await flush();
  assert.match(ui.toast.textContent, /Cupom criado/);
  ui.timers.at(-1)();
  assert.equal(ui.destinations[0], '/admin/promocoes?salvo=1');
});

test('download de backup e formulários GET não são interceptados', () => {
  const ui = browser({ responder: () => { throw new Error('fetch não deveria acontecer'); } });
  assert.equal(ui.submit(ui.form('/admin/api/sistema/backup')).prevented, false);
  assert.equal(ui.submit(ui.form('/admin/produtos', 'get')).prevented, false);
  assert.equal(ui.calls.length, 0);
});
