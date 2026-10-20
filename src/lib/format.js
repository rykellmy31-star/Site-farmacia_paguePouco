/** format.js — Formatação brasileira (moeda, datas, números, documentos). */

export function formatBRL(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Interpreta um valor digitado em reais, aceitando os dois formatos usados no
 * Brasil: "1.234,56" (ponto de milhar, vírgula decimal) e "31.90" (ponto
 * decimal, comum em campos de formulário e importações).
 */
export function parseBRL(value) {
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  const bruto = String(value ?? '').trim();
  if (!bruto) return 0;
  const negativo = /^-/.test(bruto);
  let s = bruto.replace(/[^\d.,-]/g, '');
  if (s.includes(',')) {
    // formato brasileiro: ponto é milhar, vírgula é decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    // formato com ponto decimal (ex.: 31.90)
    s = s;
  } else {
    // apenas separador de milhar (ex.: 1.234)
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100 * (negativo ? -1 : 1);
}

/** Centavos: todo cálculo monetário do sistema é feito em inteiros (centavos). */
export function toCents(value) {
  const n = typeof value === 'number' ? value : parseBRL(value);
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return Math.round(Number(cents ?? 0)) / 100;
}

export function formatDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', ...opts });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatNumber(value, decimals = 0) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCep(cep) {
  const d = String(cep ?? '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(cep ?? '');
}

export function formatDoc(doc) {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return String(doc ?? '');
}

export function formatPhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(phone ?? '');
}

export function plural(total, singular, pluralForm) {
  return `${total} ${total === 1 ? singular : pluralForm || `${singular}s`}`;
}

export function percentOff(price, promo) {
  const p = Number(price ?? 0);
  const pr = Number(promo ?? 0);
  if (!p || !pr || pr >= p) return 0;
  return Math.round(((p - pr) / p) * 100);
}
