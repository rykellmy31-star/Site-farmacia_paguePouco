/**
 * security.js — Autenticação, sessões, CSRF, rate limit, validação e sanitização.
 * Tudo com módulos nativos: scrypt (hash de senha), HMAC (cookies), timingSafeEqual.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

/* ------------------------------------------------------------------ */
/* Escaping / sanitização                                              */
/* ------------------------------------------------------------------ */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5',
  'blockquote', 'a', 'img', 'hr', 'span', 'div', 'section', 'article', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'small', 'code', 'pre', 'figure', 'figcaption', 'sup', 'sub',
]);
const ALLOWED_ATTR = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading']),
  '*': new Set(['class', 'id', 'colspan', 'rowspan', 'dir']),
};
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;

/** Sanitizador de HTML com lista branca (usado no conteúdo editável do CMS). */
export function sanitizeHtml(input) {
  if (!input) return '';
  let html = String(input);
  // remove blocos perigosos inteiros
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|svg|math)\b[^>]*>/gi, '');
  // comentários condicionais / eventos inline
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // processa tag por tag
  html = html.replace(/<\/?([a-zA-Z0-9-]+)((?:\s+[^>]*?)?)\/?>/g, (full, tagRaw, attrsRaw) => {
    const tag = tagRaw.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    const closing = full.startsWith('</');
    if (closing) return `</${tag}>`;
    const allowed = new Set([...(ALLOWED_ATTR['*'] || []), ...(ALLOWED_ATTR[tag] || [])]);
    const attrs = [];
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(attrsRaw || ''))) {
      const name = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? m[5] ?? '';
      if (!allowed.has(name)) continue;
      if (name.startsWith('on')) continue;
      if ((name === 'href' || name === 'src') && !SAFE_URL.test(value.trim())) continue;
      if (value.toLowerCase().includes('javascript:')) continue;
      attrs.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
    }
    if (tag === 'a') {
      if (!attrs.some((a) => a.startsWith('rel='))) attrs.push('rel="noopener noreferrer"');
      if (!attrs.some((a) => a.startsWith('target='))) attrs.push('target="_blank"');
    }
    const selfClosing = ['br', 'hr', 'img'].includes(tag);
    return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClosing ? ' /' : ''}>`;
  });
  return html;
}

/* ------------------------------------------------------------------ */
/* Senhas                                                              */
/* ------------------------------------------------------------------ */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
    const [, N, r, p, saltB64, keyB64] = stored.split('$');
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const key = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/* ------------------------------------------------------------------ */
/* Sessões                                                             */
/* ------------------------------------------------------------------ */
export const SESSION_TYPES = { CUSTOMER: 'customer', ADMIN: 'admin' };

export function createSession(db, type, userId, meta = {}) {
  const sessions = db.collection('sessions');
  const id = randomToken(36);
  const ttlHours = type === SESSION_TYPES.ADMIN ? config.adminSessionTTLHours : config.sessionTTLHours;
  sessions.insert({
    id,
    type,
    userId: String(userId),
    csrf: randomToken(24),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000).toISOString(),
    ip: meta.ip || '',
    userAgent: (meta.userAgent || '').slice(0, 255),
    cartId: meta.cartId || null,
  });
  return id;
}

export function readSession(db, id) {
  if (!id) return null;
  const s = db.collection('sessions').get(id);
  if (!s) return null;
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    db.collection('sessions').remove(id);
    return null;
  }
  return s;
}

export function destroySession(db, id) {
  if (id) db.collection('sessions').remove(id);
}

export function rotateSessionCsrf(db, id) {
  const s = db.collection('sessions').get(id);
  if (!s) return null;
  return db.collection('sessions').update(id, { csrf: randomToken(24) });
}

/* ------------------------------------------------------------------ */
/* CSRF                                                                */
/* ------------------------------------------------------------------ */
export function csrfToken(req) {
  return (req.session && req.session.csrf) || req.cookies?.pp_csrf || '';
}

export function csrfField(req) {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken(req))}">`;
}

/**
 * Validação CSRF (dupla submissão, tempo constante):
 *  - com sessão ativa: compara com o token guardado NA SESSÃO (mais forte);
 *  - visitante sem sessão: compara com o token do cookie "pp_csrf" emitido pelo
 *    servidor (padrão de mercado, combinado com cookie SameSite=Lax).
 * Em nenhum caso uma requisição de mutação é aceita sem token válido.
 */
export function csrfOk(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const candidate = String(req.csrfFromBody || req.headers['x-csrf-token'] || '');
  if (!candidate) return false;
  const esperados = [req.session?.csrf, req.cookies?.pp_csrf].filter(Boolean);
  for (const esperado of esperados) {
    const a = Buffer.from(String(esperado));
    const b = Buffer.from(candidate);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Rate limiting (em memória, por IP + escopo)                         */
/* ------------------------------------------------------------------ */
const buckets = new Map();

export function rateLimit(scope, max, windowMs = config.rateLimit.windowMs) {
  return (req, res) => {
    const key = `${scope}:${req.ip}`;
    if (req.ctx?.db?.takeRateLimit) {
      const limit = req.ctx.db.takeRateLimit(key, max, windowMs);
      req.rateLimitResetAt = limit.resetAt;
      return limit.allowed;
    }
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    b.count++;
    if (b.count > max) return false;
    return true;
  };
}

export function rateLimitMiddleware(scope, max, windowMs) {
  const check = rateLimit(scope, max, windowMs);
  return (req, res) => {
    if (check(req, res)) return;
    const retry = Math.ceil(((req.rateLimitResetAt || buckets.get(`${scope}:${req.ip}`)?.resetAt || Date.now() + 1000) - Date.now()) / 1000);
    res.set('Retry-After', String(Math.max(retry, 1)));
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/') || req.headers['x-requested-with'] === 'fetch') {
      res.json({ ok: false, error: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' }, 429);
    } else {
      res.html('<h1>429 — Muitas requisições</h1><p>Aguarde alguns instantes e recarregue a página.</p>', 429);
    }
  };
}

export function resetRateLimits() {
  buckets.clear();
}

// limpeza periódica (evita crescimento infinito)
const _cleaner = config.isCloudflare ? null : setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt + 60_000) buckets.delete(k);
}, 60_000);
_cleaner?.unref?.();

/* ------------------------------------------------------------------ */
/* Validadores                                                         */
/* ------------------------------------------------------------------ */
export const validators = {
  required: (v) => v != null && String(v).trim() !== '',
  minLen: (v, n) => String(v ?? '').trim().length >= n,
  maxLen: (v, n) => String(v ?? '').length <= n,
  email: (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v ?? '').trim()),
  cep: (v) => /^\d{8}$/.test(String(v ?? '').replace(/\D/g, '')),
  phone: (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length >= 10 && d.length <= 11;
  },
  cpf: (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
    let check = (sum * 10) % 11 % 10;
    if (check !== Number(d[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
    check = (sum * 10) % 11 % 10;
    return check === Number(d[10]);
  },
  cnpj: (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const calc = (len) => {
      let pos = len - 7;
      let sum = 0;
      for (let i = 0; i < len; i++) {
        sum += Number(d[i]) * pos--;
        if (pos < 2) pos = 9;
      }
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  },
  number: (v) => v !== '' && v != null && Number.isFinite(Number(String(v).replace(',', '.'))),
  int: (v) => Number.isInteger(Number(v)),
  positive: (v) => Number(v) >= 0,
  oneOf: (v, list) => list.includes(v),
  uf: (v) => /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(String(v ?? '').toUpperCase()),
  slug: (v) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(v ?? '')),
  url: (v) => /^(https?:\/\/|\/)/i.test(String(v ?? '').trim()) || v === '',
};

/** Roda um esquema { campo: [ [fn, mensagem, ...args], ... ] } e devolve erros. */
export function validate(data, schema) {
  const errors = {};
  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules) {
      const [fn, message, ...args] = rule;
      const ok = typeof fn === 'function' ? fn(data[field], ...args, data) : fn;
      if (!ok) {
        errors[field] = message;
        break;
      }
    }
  }
  return errors;
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

/* ------------------------------------------------------------------ */
/* Normalização de strings                                             */
/* ------------------------------------------------------------------ */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export function onlyDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** Remove caracteres de controle e limita tamanho (defesa contra abusos de texto). */
export function cleanText(v, max = 5000) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
