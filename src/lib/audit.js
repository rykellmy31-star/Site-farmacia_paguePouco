/**
 * audit.js — Trilha de auditoria (LGPD/segurança): registra TODA ação relevante
 * de administrador e eventos de sistema. Consultável no painel.
 */
import { nowISO } from './store.js';

export function logAdmin(db, admin, action, entity, entityId, details = {}, req = null) {
  return db.collection('auditLogs').insert({
    atorId: admin?.id || null,
    atorNome: admin?.nome || 'sistema',
    atorRole: admin?.role || 'sistema',
    acao: action,
    entidade: entity,
    entidadeId: entityId != null ? String(entityId) : null,
    detalhes: typeof details === 'string' ? { texto: details } : details,
    ip: req?.ip || '',
    userAgent: (req?.headers?.['user-agent'] || '').slice(0, 200),
    criadoEm: nowISO(),
  });
}

export function logSystem(db, level, message, meta = {}) {
  const entry = db.collection('systemLogs').insert({
    nivel: level, // info | warn | error | security
    mensagem: String(message).slice(0, 2000),
    meta,
    criadoEm: nowISO(),
  });
  if (level === 'error' || level === 'security') {
    console.error(`[${level}]`, message, meta && Object.keys(meta).length ? meta : '');
  }
  return entry;
}

export function logCustomer(db, customerId, action, entity, entityId, details = {}, req = null) {
  return db.collection('auditLogs').insert({
    atorId: customerId || null,
    atorNome: 'cliente',
    atorRole: 'customer',
    acao: action,
    entidade: entity,
    entidadeId: entityId != null ? String(entityId) : null,
    detalhes: details,
    ip: req?.ip || '',
    userAgent: (req?.headers?.['user-agent'] || '').slice(0, 200),
    criadoEm: nowISO(),
  });
}

export function queryLogs(db, { tipo = 'admin', limite = 200, busca = '', acao = '', de = '', ate = '' } = {}) {
  let rows = db.collection('auditLogs').all();
  if (tipo === 'admin') rows = rows.filter((r) => r.atorRole !== 'customer');
  if (tipo === 'cliente') rows = rows.filter((r) => r.atorRole === 'customer');
  if (acao) rows = rows.filter((r) => r.acao === acao);
  if (busca) {
    const b = String(busca).toLowerCase();
    rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(b));
  }
  if (de) rows = rows.filter((r) => r.criadoEm >= de);
  if (ate) rows = rows.filter((r) => r.criadoEm <= ate);
  return rows.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, limite);
}
