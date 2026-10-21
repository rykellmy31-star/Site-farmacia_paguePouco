/**
 * Validação de promoções na entrada administrativa.
 * Nunca armazena configurações financeiras NaN, Infinity, negativas ou
 * descontos percentuais acima de 100%.
 */
import { toCents } from './format.js';

const TIPOS = new Set(['percentual', 'fixo', 'frete_gratis']);

function dataValida(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const data = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === value;
}

function moedaNaoNegativa(value) {
  if (value == null || value === '') return 0;
  const texto = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(texto)) return null;
  const n = toCents(texto);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function validarNovoCupom(payload) {
  const codigo = String(payload?.codigo || '').trim().toUpperCase();
  const tipo = String(payload?.tipo || 'percentual');
  const valor = Number(String(payload?.valor ?? '').replace(',', '.'));
  if (!/^[A-Z0-9_-]{3,40}$/.test(codigo)) {
    return { ok: false, erro: 'Código do cupom: use de 3 a 40 letras, números, _ ou -.' };
  }
  if (!TIPOS.has(tipo)) return { ok: false, erro: 'Tipo de desconto inválido.' };
  if (tipo !== 'frete_gratis' &&
      (!Number.isFinite(valor) || valor <= 0 || (tipo === 'percentual' && valor > 100))) {
    return { ok: false, erro: 'Desconto inválido: informe valor positivo e percentual de até 100%.' };
  }
  if (tipo === 'fixo' && !Number.isSafeInteger(Math.round(valor * 100))) {
    return { ok: false, erro: 'Valor fixo fora do limite aceito.' };
  }
  const minimo = moedaNaoNegativa(payload?.valorMinimo);
  if (minimo == null) return { ok: false, erro: 'Valor mínimo inválido.' };

  let usoMaximo = null;
  if (payload?.usoMaximo != null && String(payload.usoMaximo).trim() !== '') {
    usoMaximo = Number(payload.usoMaximo);
    if (!Number.isSafeInteger(usoMaximo) || usoMaximo <= 0) {
      return { ok: false, erro: 'Limite de usos precisa ser um inteiro positivo.' };
    }
  }
  const validoDe = payload?.validoDe || null;
  const validoAte = payload?.validoAte || null;
  if (!dataValida(validoDe) || !dataValida(validoAte) ||
      (validoDe && validoAte && validoDe > validoAte)) {
    return { ok: false, erro: 'Intervalo de validade do cupom inválido.' };
  }
  return {
    ok: true,
    dados: {
      codigo, tipo, valor: tipo === 'frete_gratis' ? 0 : valor,
      valorMinimo: minimo, usoMaximo, validoDe, validoAte,
    },
  };
}
