import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCep, isValidCep, ufFromCep, lookupCep } from '../src/lib/cep.js';
import { defaultFreightConfig, calcularFrete, resolverFreteEscolhido } from '../src/lib/freight.js';

const cotar = (cep, uf, cidade = 'São Paulo') => calcularFrete({
  config: defaultFreightConfig(), cep, uf, cidade, items: [], subtotalCents: 2500,
});

test('CEP com máscara mantém zero inicial e identifica UF real', async () => {
  assert.equal(normalizeCep('01001-000'), '01001000');
  assert.equal(isValidCep('01001-000'), true);
  assert.equal(ufFromCep('01001-000'), 'SP');
  const resposta = await lookupCep('01001-000');
  assert.equal(resposta.valido, true);
  assert.equal(resposta.uf, 'SP');
});

test('CEP incompleto nunca é preenchido artificialmente com zeros', async () => {
  assert.equal(normalizeCep('1234567'), '1234567');
  assert.equal(isValidCep('1234567'), false);
  assert.equal(ufFromCep('1234567'), null);
  const resposta = await lookupCep('1234567');
  assert.equal(resposta.valido, false);
  assert.equal(resposta.uf, null);
});

test('CEP longo não pode ser truncado para simular CEP válido', async () => {
  assert.equal(normalizeCep('010010000'), '010010000');
  assert.equal(isValidCep('010010000'), false);
  assert.equal(ufFromCep('010010000'), null);
  assert.equal((await lookupCep('010010000')).valido, false);
});

test('cotação inválida não oferece nem retirada nem entrega local', () => {
  for (const cep of ['1234567', '010010000', '00000000']) {
    const r = cotar(cep, 'SP');
    assert.equal(r.disponivel, false, 'CEP ' + cep);
    assert.equal(r.opcoes.length, 0);
    assert.match(r.motivo, /CEP/i);
  }
});

test('UF divergente do CEP não autoriza cobrança de frete incorreta', () => {
  const r = cotar('01001000', 'BA');
  assert.equal(r.disponivel, false);
  assert.equal(r.uf, 'SP');
  assert.equal(r.opcoes.length, 0);
  assert.match(r.motivo, /não corresponde/i);
});

test('cotação correta continua disponível com UF coerente ou não informada', () => {
  for (const uf of ['SP', '', undefined]) {
    const r = cotar('01001-000', uf);
    assert.equal(r.disponivel, true);
    assert.equal(r.uf, 'SP');
    assert.ok(r.opcoes.some(o => o.id === '_padrao'));
  }
});

test('checkout nunca aceita frete com CEP incompleto ou UF forjada', () => {
  for (const [cep, uf] of [['1234567', 'SP'], ['01001000', 'BA']]) {
    const r = resolverFreteEscolhido({
      config: defaultFreightConfig(), cep, uf, cidade: 'São Paulo',
      items: [], subtotalCents: 2500, opcaoId: '_padrao', cupomFreteGratis: false,
    });
    assert.equal(r.ok, false);
  }
});
