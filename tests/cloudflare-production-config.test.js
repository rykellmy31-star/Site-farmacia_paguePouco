import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureCloudflare, config } from '../src/config.js';

const worker = readFileSync(new URL('../src/cloudflare/worker.js', import.meta.url), 'utf8');

test('alarme financeiro sem Request usa domínio real e não hostname inválido', () => {
  assert.match(worker, /configureCloudflare\(this\.bindings, this\.bindings\.PUBLIC_BASE_URL \|\| 'https:\/\/site\.farmaciapaguepouco\.app', this\.secret\)/);
  assert.doesNotMatch(worker, /https:\/\/localhost\.invalid/);
});

test('alarme reprograma conciliação de Pix, estornos e checkout pendente', () => {
  assert.match(worker, /async alarm\(\)/);
  assert.match(worker, /pedidos:\s*observar\('pedidos',\s*\(\)\s*=>\s*reconciliarCheckoutsInterrompidos\(this\.db\)\)/);
  assert.match(worker, /pix:\s*observar\('pix',\s*\(\)\s*=>\s*reconciliarPix\(this\.db\)\)/);
  assert.match(worker, /estornos:\s*observar\('estornos',\s*\(\)\s*=>\s*reconciliarEstornos\(this\.db\)\)/);
  assert.match(worker, /reagendar:\s*\(\)\s*=>\s*this\.programarAlarmeFinanceiro\(\)/);
});

test('PUBLIC_BASE_URL explícita mantém preferência e segredo não é exposto', () => {
  const prev = {
    publicBaseUrl: config.publicBaseUrl,
    sessionSecret: config.sessionSecret,
    isCloudflare: config.isCloudflare,
  };
  try {
    configureCloudflare({
      PUBLIC_BASE_URL: 'https://site.farmaciapaguepouco.app',
      PAYMENT_PROVIDER: 'internal',
    }, 'https://host-interno.invalid', 'segredo-interno-teste');
    assert.equal(config.publicBaseUrl, 'https://site.farmaciapaguepouco.app');
    assert.equal(config.sessionSecret, 'segredo-interno-teste');
  } finally {
    Object.assign(config, prev);
  }
});
