import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from '../src/lib/store.js';
import { validarNovoCupom } from '../src/lib/coupon-validation.js';
import { validarCupom } from '../src/lib/cart.js';

function dbCupom(dados) {
  const collections = new Map();
  const db = { collection(name) {
    if (!collections.has(name)) collections.set(name, new Collection({ _commit() {} }, name));
    return collections.get(name);
  } };
  db.collection('coupons').insert({
    id: 'cupom', codigo: 'AUDITORIA', tipo: 'percentual', valor: 10,
    ativo: true, usos: 0, usoMaximo: 5,
    ...dados,
  });
  return db;
}

test('admin aceita cupom percentual válido e limite inteiro', () => {
  const r = validarNovoCupom({ codigo: ' auditoria-1 ', tipo: 'percentual',
    valor: '12.5', valorMinimo: '19.90', usoMaximo: '3' });
  assert.equal(r.ok, true);
  assert.equal(r.dados.codigo, 'AUDITORIA-1');
  assert.equal(r.dados.valor, 12.5);
  assert.equal(r.dados.valorMinimo, 1990);
  assert.equal(r.dados.usoMaximo, 3);
});

test('admin rejeita valores percentuais acima de 100%, negativos, NaN e Infinity', () => {
  for (const valor of ['101', '-10', 'Infinity', 'NaN', '0', '']) {
    assert.equal(validarNovoCupom({ codigo: 'AUDITORIA', tipo: 'percentual', valor }).ok, false,
      'valor rejeitado: ' + valor);
  }
});

test('admin rejeita tipos inexistentes e limite fracionado/zero', () => {
  assert.equal(validarNovoCupom({ codigo: 'AUDITORIA', tipo: 'desconhecido', valor: '10' }).ok, false);
  for (const usoMaximo of ['0', '-1', '1.5', 'Infinity', 'NaN']) {
    assert.equal(validarNovoCupom({ codigo: 'AUDITORIA', tipo: 'frete_gratis', usoMaximo }).ok, false,
      'limite rejeitado: ' + usoMaximo);
  }
  assert.equal(validarNovoCupom({ codigo: 'AUDITORIA', tipo: 'frete_gratis' }).ok, true);
});

test('admin não armazena mínimo inválido ou valores fixos fora do limite', () => {
  for (const valorMinimo of ['-1', 'Infinity', 'abc', '10.123']) {
    assert.equal(validarNovoCupom({
      codigo: 'AUDITORIA', tipo: 'fixo', valor: '10', valorMinimo,
    }).ok, false);
  }
  assert.equal(validarNovoCupom({ codigo: 'AUDITORIA', tipo: 'fixo', valor: 'Infinity' }).ok, false);
});

test('admin rejeita datas fora da ordem e datas impossíveis', () => {
  const valid = { codigo: 'AUDITORIA', tipo: 'fixo', valor: '10' };
  assert.equal(validarNovoCupom({ ...valid, validoDe: '2026-10-22', validoAte: '2026-10-21' }).ok, false);
  assert.equal(validarNovoCupom({ ...valid, validoDe: '2026-02-31' }).ok, false);
  assert.equal(validarNovoCupom({ ...valid, validoAte: '2026-13-01' }).ok, false);
  assert.equal(validarNovoCupom({ ...valid, validoDe: '2026-10-21', validoAte: '2026-10-21' }).ok, true);
});

test('cupom fica válido até o final do dia indicado, inclusive', () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const db = dbCupom({ validoDe: hoje, validoAte: hoje });
  const r = validarCupom(db, 'AUDITORIA', { subtotalCentavos: 1000, itens: [] });
  assert.equal(r.ok, true);
  assert.equal(r.desconto, 100);
});

test('cupom legado com percentual impossível não concede frete ou desconto', () => {
  const db = dbCupom({ valor: 150 });
  assert.equal(validarCupom(db, 'AUDITORIA', { subtotalCentavos: 1000 }).ok, false);
  db.collection('coupons').update('cupom', { valor: Number.POSITIVE_INFINITY });
  assert.equal(validarCupom(db, 'AUDITORIA', { subtotalCentavos: 1000 }).ok, false);
  db.collection('coupons').update('cupom', { tipo: 'desconhecido', valor: 10 });
  assert.equal(validarCupom(db, 'AUDITORIA', { subtotalCentavos: 1000 }).ok, false);
});
