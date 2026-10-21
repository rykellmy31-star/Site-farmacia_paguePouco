import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { createPayment as criarPixMP } from '../src/lib/payments/mercadopago.js';
import { diagnosticarFalhaPix } from '../src/lib/payments/diagnostics.js';

class DB {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection({ _commit() {} }, name));
    return this.cols.get(name);
  }
}
const cfg = { payments: { mp: { accessToken: 'TEST-nao-e-token-real', sandbox: true } } };
const parametros = (db, cpf = '12345678909') => ({
  db, config: cfg,
  order: { id: 'pedido-isolado', codigo: 'PP-TESTE', totalCentavos: 190 },
  method: 'pix', payer: { cpf, nome: 'Pessoa Teste', email: 'example@example.com' },
  returnUrls: { notificationUrl: 'https://example.test/webhooks/mercadopago' },
});

test('HTTP 401 e 403 apontam credencial/conta e não exibem erro bruto com tokens', () => {
  const malicioso = { message: 'Authorization: Bearer SENHA-PRIVADA', error: 'outro_erro',
    cause: [{ code: 'SEGREDO-PRIVADO-EXTRA', description: 'CPF 12345678909' }] };
  for (const status of [401, 403]) {
    const d = diagnosticarFalhaPix(status, malicioso);
    assert.equal(d.httpStatus, status);
    assert.equal(d.codigo, 'nao_informado');
    assert.doesNotMatch(JSON.stringify(d), /SENHA-PRIVADA|SEGREDO-PRIVADO|12345678909/);
    assert.match(d.motivo, status === 401 ? /Access Token/ : /Pix/);
  }
});

test('HTTP 400 com CPF, e-mail e valor inválidos oferece diagnóstico tipificado', () => {
  assert.match(diagnosticarFalhaPix(400, { cause: [{ code: 2067 }] }).motivo, /CPF/);
  assert.match(diagnosticarFalhaPix(400, { cause: [{ code: 4037 }] }).motivo, /valor/);
  assert.match(diagnosticarFalhaPix(400, { cause: [{ code: 2198 }] }).motivo, /e-mail/);
  assert.equal(diagnosticarFalhaPix(400, { cause: [{ code: 'cpf:12345678909' }] }).codigo, 'nao_informado');
});

test('Pix não deve enviar solicitação à API sem documento de pagador', async () => {
  const db = new DB(); const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('nao deve chamar API'); };
    for (const cpf of ['', '123', '123.123']) {
      const resultado = await criarPixMP(parametros(db, cpf));
      assert.equal(resultado.ok, false);
      assert.match(resultado.erro, /CPF/);
      assert.equal(db.collection('payments').count(), 0);
    }
  } finally { globalThis.fetch = original; }
});

test('Pix com CPF manda identificação apenas ao Mercado Pago', async () => {
  const db = new DB(); const original = globalThis.fetch;
  try {
    let corpo;
    globalThis.fetch = async (_url, opts) => {
      corpo = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        id: 123456, status: 'pending',
        point_of_interaction: { transaction_data: { qr_code: '000201PIX-EXEMPLO' } },
      }), { status: 201 });
    };
    const resultado = await criarPixMP(parametros(db, '123.456.789-09'));
    assert.equal(resultado.ok, true);
    assert.equal(corpo.payer.identification.type, 'CPF');
    assert.equal(corpo.payer.identification.number, '12345678909');
    assert.equal(corpo.transaction_amount, 1.9);
    assert.equal(resultado.pixSemCodigo, false);
    assert.equal(resultado.pagamento.pixCodigo, '000201PIX-EXEMPLO');
  } finally { globalThis.fetch = original; }
});

test('falhas HTTP 4xx são diagnosticadas sem gravar pagamento nem API raw', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 422]) {
      const db = new DB();
      globalThis.fetch = async () => new Response(JSON.stringify({
        message: 'token_privado_ou_cpf_nao_mostrar',
        cause: [{ code: status === 400 ? 2067 : 'segredo_qualquer' }],
      }), { status });
      const resultado = await criarPixMP(parametros(db));
      assert.equal(resultado.ok, false);
      assert.equal(resultado.indeterminado, false);
      assert.equal(resultado.diagnostico.httpStatus, status);
      assert.doesNotMatch(JSON.stringify(resultado), /token_privado_ou_cpf_nao_mostrar|segredo_qualquer/);
      assert.equal(db.collection('payments').count(), 0);
    }
  } finally { globalThis.fetch = original; }
});

test('HTTP 5xx e resposta 2xx sem ID mantêm resultado indeterminado', async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, payload] of [[503, { error: 'server' }], [200, { status: 'pending' }]]) {
      const db = new DB();
      globalThis.fetch = async () => new Response(JSON.stringify(payload), { status });
      const r = await criarPixMP(parametros(db));
      assert.equal(r.ok, false);
      assert.equal(r.indeterminado, true);
      assert.equal(db.collection('payments').count(), 0);
    }
  } finally { globalThis.fetch = original; }
});

test('cobrança HTTP 201 sem código Pix preserva referência para conciliação', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 123456, status: 'pending' }), { status: 201 });
    const db = new DB();
    const r = await criarPixMP(parametros(db));
    assert.equal(r.ok, true);
    assert.equal(r.pixSemCodigo, true);
    assert.equal(r.pagamento.pixSemCodigo, true);
    assert.equal(db.collection('payments').count(), 1);
  } finally { globalThis.fetch = original; }
});
