import test from 'node:test';
import assert from 'node:assert/strict';
import { executarAlarmeFinanceiro } from '../src/lib/payments/alarm-runner.js';

test('conciliação normal executa Pix e estornos e persiste antes de reagendar', async () => {
  const calls = [];
  await executarAlarmeFinanceiro({
    pix: async () => { calls.push('pix'); return { erros: 0 }; },
    estornos: async () => { calls.push('estornos'); return { erros: 0 }; },
    persistir: async () => { calls.push('persistir'); },
    reagendar: async () => { calls.push('reagendar'); },
  });
  assert.deepEqual(calls, ['pix', 'estornos', 'persistir', 'reagendar']);
});

test('falha no Pix não impede estorno nem reagendamento de recuperação', async () => {
  const calls = [];
  const warnings = [];
  await assert.rejects(executarAlarmeFinanceiro({
    pix: async () => { calls.push('pix'); throw new Error('Falha temporária Pix'); },
    estornos: async () => { calls.push('estornos'); return { erros: 0 }; },
    persistir: async () => { calls.push('persistir'); },
    reagendar: async () => { calls.push('reagendar'); },
    registrar: (...parts) => warnings.push(parts),
  }), { name: 'AggregateError' });
  assert.deepEqual(calls, ['pix', 'estornos', 'persistir', 'reagendar']);
  assert.match(JSON.stringify(warnings), /Falha temporária Pix/);
});

test('falhas simultâneas não perdem tentativa de agendar novamente', async () => {
  const calls = [];
  let error;
  try {
    await executarAlarmeFinanceiro({
      pix: async () => { calls.push('pix'); },
      estornos: async () => { calls.push('estornos'); throw new Error('Estorno indisponível'); },
      persistir: async () => { calls.push('persistir'); throw new Error('SQLite indisponível'); },
      reagendar: async () => { calls.push('reagendar'); },
    });
  } catch (e) { error = e; }
  assert.equal(error?.name, 'AggregateError');
  assert.equal(error.errors.length, 2);
  assert.deepEqual(calls, ['pix', 'estornos', 'persistir', 'reagendar']);
});

test('erro no reagendamento é propagado para não fingir que alarme funcionou', async () => {
  await assert.rejects(executarAlarmeFinanceiro({
    pix: async () => ({}),
    estornos: async () => ({}),
    persistir: async () => {},
    reagendar: async () => { throw new Error('Alarm storage offline'); },
  }), /Falhas na conciliação financeira/);
});
