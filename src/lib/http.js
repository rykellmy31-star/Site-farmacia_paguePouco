/**
 * http.js — Microsservidor HTTP sem dependências:
 *  - roteador com parâmetros nomeados (:slug, *resto)
 *  - cookies assinados, sessões, helpers de resposta (html/json/redirect)
 *  - body parser: JSON, urlencoded e multipart/form-data (uploads)
 *  - arquivos estáticos com ETag, cache e tipos MIME seguros
 */
import http from 'node:http';
import { dispatchFetch, readWebBody } from '../cloudflare/http-adapter.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */
export function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { /* Ignora cookie malformado. */ }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure || (config.publicBaseUrl || '').startsWith('https')) parts.push('Secure');
  return parts.join('; ');
}

/* ------------------------------------------------------------------ */
/* Request / Response                                                  */
/* ------------------------------------------------------------------ */
class Response {
  constructor(res) {
    this.raw = res;
    this.statusCode = 200;
    this.headers = Object.create(null);
  }
  set(name, value) {
    this.headers[name] = value;
    return this;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  cookie(name, value, opts) {
    const prev = this.headers['Set-Cookie'];
    const line = serializeCookie(name, value, opts);
    this.headers['Set-Cookie'] = prev ? [].concat(prev, line) : line;
    return this;
  }
  clearCookie(name) {
    return this.cookie(name, '', { maxAge: 0, path: '/' });
  }
  redirect(url, code = 303) {
    this.statusCode = code;
    this.headers.Location = url;
    this.end('');
  }
  html(body, code) {
    if (code != null) this.statusCode = code;
    this.headers['Content-Type'] = 'text/html; charset=utf-8';
    this.headers['X-Content-Type-Options'] = 'nosniff';
    this.end(body);
  }
  json(data, code) {
    if (code != null) this.statusCode = code;
    this.headers['Content-Type'] = 'application/json; charset=utf-8';
    this.headers['X-Content-Type-Options'] = 'nosniff';
    this.end(JSON.stringify(data));
  }
  text(body, code, type = 'text/plain; charset=utf-8') {
    if (code != null) this.statusCode = code;
    this.headers['Content-Type'] = type;
    this.end(body);
  }
  end(body = '') {
    if (this._ended) return;
    this._ended = true;
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    if (!Object.keys(this.headers).some(name => name.toLowerCase() === 'content-length')) this.headers['Content-Length'] = buf.length;
    this.raw.writeHead(this.statusCode, this.headers);
    this.raw.end(buf);
  }
}

async function readBody(req, limitBytes) {
  if (req._webRequest) return readWebBody(req._webRequest, Math.min(limitBytes, 20 * 1024 * 1024));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        done = true;
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

/** Parser multipart/form-data (compatível com navegadores e fetch/FormData). */
function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const fields = Object.create(null);
  const files = [];
  let idx = 0;
  const nextSep = (from) => buffer.indexOf(sep, from);

  idx = nextSep(0);
  if (idx < 0) return { fields, files };
  while (idx >= 0) {
    const start = idx + sep.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    // cabeçalhos
    let headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headerRaw = buffer.slice(start + 2, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextIdx = nextSep(bodyStart);
    const bodyEnd = nextIdx < 0 ? buffer.length : nextIdx - 2;
    const content = buffer.slice(bodyStart, bodyEnd);

    const dispMatch = /content-disposition:\s*form-data;(.*)/i.exec(headerRaw.split('\r\n')[0] || '');
    if (dispMatch) {
      const attrs = Object.create(null);
      const re = /([\w-]+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(dispMatch[1]))) attrs[m[1].toLowerCase()] = m[2];
      const ctypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerRaw);
      const name = attrs.name || 'file';
      if (attrs.filename != null && attrs.filename !== '') {
        files.push({
          field: name,
          filename: attrs.filename,
          contentType: (ctypeMatch ? ctypeMatch[1] : 'application/octet-stream').trim(),
          data: content,
          size: content.length,
        });
      } else {
        const prev = fields[name];
        const value = content.toString('utf8');
        fields[name] = prev === undefined ? value : [].concat(prev, value);
      }
    }
    idx = nextIdx;
    if (idx < 0) break;
  }
  return { fields, files };
}

async function attachBody(req, res, opts = {}) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    req.body = Object.create(null);
    req.files = [];
    return;
  }
  const ctype = req.headers['content-type'] || '';
  const limit = opts.maxBodyBytes || (ctype.includes('multipart') ? config.uploads.maxVideoBytes + 5 * 1024 * 1024 : 2 * 1024 * 1024);
  const raw = await readBody(req.raw, limit);
  req.rawBody = raw;
  if (ctype.includes('application/json')) {
    try {
      req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      req.body = {};
      throw Object.assign(new Error('BAD_JSON'), { status: 400 });
    }
    req.files = [];
  } else if (ctype.includes('application/x-www-form-urlencoded')) {
    req.body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    req.files = [];
  } else if (ctype.includes('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    if (!m) throw Object.assign(new Error('BAD_MULTIPART'), { status: 400 });
    const parsed = parseMultipart(raw, m[1] || m[2]);
    req.body = parsed.fields;
    req.files = parsed.files;
  } else {
    req.body = Object.create(null);
    req.files = [];
  }
}

/* ------------------------------------------------------------------ */
/* App / Router                                                        */
/* ------------------------------------------------------------------ */
export function createApp() {
  const routes = [];
  const middlewares = [];

  function compile(pattern) {
    const keys = [];
    let regex = pattern
      .replace(/\/$/, '')
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      });
    if (!regex.endsWith('.*')) regex += '/?';
    return { re: new RegExp(`^${regex}$`), keys };
  }

  function add(method, pattern, handler, meta = {}) {
    // aceita tanto (path, handler, meta) quanto (path, meta, handler)
    if (typeof handler !== 'function' && typeof meta === 'function') {
      const aux = handler; handler = meta; meta = aux || {};
    }
    const { re, keys } = compile(pattern);
    routes.push({ method, pattern, re, keys, handler, meta });
    return app;
  }

  const app = {
    routes,
    fetch(request, context) { return dispatchFetch(app, request, context); },
    use(fn) {
      middlewares.push(fn);
      return app;
    },
    get: (p, h, m) => add('GET', p, h, m),
    post: (p, h, m) => add('POST', p, h, m),
    put: (p, h, m) => add('PUT', p, h, m),
    patch: (p, h, m) => add('PATCH', p, h, m),
    del: (p, h, m) => add('DELETE', p, h, m),
    all: (p, h, m) => {
      add('GET', p, h, m);
      add('POST', p, h, m);
      return app;
    },
    /** Serve arquivos estáticos de um diretório em um prefixo. */
    static(prefix, dir, opts = {}) {
      app.get(`${prefix}/*`, async (req, res) => {
        await serveStatic(req, res, dir, prefix, opts);
      });
      return app;
    },
    async handle(rawReq, rawRes) {
      const url = new URL(rawReq.url, `http://${rawReq.headers.host || 'localhost'}`);
      const req = {
        raw: rawReq,
        method: rawReq.method.toUpperCase(),
        path: url.pathname.replace(/\/+$/, '') || '/',
        pathname: url.pathname,
        query: url.searchParams,
        headers: rawReq.headers,
        cookies: parseCookies(rawReq.headers.cookie),
        ip: clientIp(rawReq),
        params: {},
        ctx: rawReq.context || {},
      };
      const res = new Response(rawRes);

      // Corpo já é lido aqui para que os middlewares (CSRF, auditoria) tenham acesso
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        await attachBody(req, res, {});
        req.csrfFromBody = req.body?._csrf || req.headers['x-csrf-token'] || '';
      } else {
        req.body = Object.create(null);
        req.files = [];
      }

      // Middlewares globais (podem encerrar a resposta)
      for (const mw of middlewares) {
        await mw(req, res);
        if (res._ended) return;
      }

      let matched = null;
      for (const r of routes) {
        if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
        const m = r.re.exec(req.path);
        if (m) {
          matched = r;
          req.params = {};
          r.keys.forEach((k, i) => {
            req.params[k] = decodeURIComponent(m[i + 1] || '');
          });
          break;
        }
      }

      try {
        if (!matched) {
          res.status(404);
          return void (await app.notFound?.(req, res)) || (res._ended ? undefined : res.html('<h1>404</h1>', 404));
        }
        await matched.handler(req, res);
        if (!res._ended) res.end('');
      } catch (err) {
        await app.onError?.(err, req, res);
      }
    },
    listen(port, host) {
      const server = http.createServer((a, b) => app.handle(a, b));
      return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
    },
  };
  return app;
}

export function clientIp(req) {
  if (config.isCloudflare) return req.trustedIp || 'unknown';
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
    const xr = req.headers['x-real-ip'];
    if (xr) return String(xr).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/* ------------------------------------------------------------------ */
/* Arquivos estáticos                                                  */
/* ------------------------------------------------------------------ */
async function serveStatic(req, res, dir, prefix, opts = {}) {
  if (config.isCloudflare) {
    const rel = decodeURIComponent(req.pathname.slice(prefix.length)).replace(/^\/+/, '');
    if (rel.split('/').some(p => p === '..' || p === '.') || rel.includes('\\') || rel.includes('\0')) {
      return void res.text('Caminho inválido.', 400);
    }
    let result = prefix === '/uploads' ? req.ctx.db.fileResponse(rel, req.raw._webRequest) : null;
    if (!result) result = await req.ctx.env.ASSETS.fetch(req.raw._webRequest);
    if (result.status === 404 && opts.notFound) return void opts.notFound(req, res);
    for (const [name, value] of result.headers) {
      if (!['transfer-encoding', 'set-cookie'].includes(name) && (name !== 'content-length' || req.method === 'HEAD')) res.set(name, value);
    }
    res.status(result.status);
    if (result.status === 404) return void res.text('Arquivo não encontrado.', 404);
    return void res.end(Buffer.from(await result.arrayBuffer()));
  }
  const rel = decodeURIComponent(req.pathname.slice(prefix.length)) || '';
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(dir, safe);
  if (!filePath.startsWith(path.resolve(dir))) {
    return void res.status(403).text('Forbidden');
  }
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    stat = await fsp.stat(filePath);
  } catch {
    if (opts.notFound) return void opts.notFound(req, res);
    return void res.status(404).text('Arquivo não encontrado');
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).set('ETag', etag);
    return void res.end('');
  }
  const cacheable = opts.cache !== false && /\.(css|js|png|jpe?g|webp|gif|svg|woff2|mp4|webm|ico)$/i.test(filePath);
  res.set('Content-Type', type);
  res.set('ETag', etag);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', cacheable ? `public, max-age=${opts.maxAge ?? 604800}` : 'no-cache');
  if (opts.download) res.set('Content-Disposition', 'attachment');
  res.set('Content-Length', stat.size);
  res.raw.writeHead(200, res.headers);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { try { res.raw.end(); } catch { /* conexão já fechada */ } });
  stream.pipe(res.raw);
}

export function hashETag(str) {
  return crypto.createHash('sha1').update(str).digest('base64url').slice(0, 16);
}
