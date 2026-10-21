/**
 * Persistência SQLite do Durable Object. Usa a mesma API Collection do Node.
 * Mutações são gravadas antes de alterar o índice em memória; não há debounce.
 * O Worker serializa requisições completas para proteger estoque e contadores.
 */
import crypto from 'node:crypto';
import { Collection } from '../lib/store.js';

const CHUNK_BYTES = 256 * 1024;

export class CloudStore {
  constructor(storage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.dataDir = '/data';
    this.collections = new Map();
    this.stats = { writes: 0, replays: 0 };
    this.sql.exec(`CREATE TABLE IF NOT EXISTS documents (
      collection_name TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL,
      PRIMARY KEY (collection_name, id)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL,
      etag TEXT NOT NULL, modified TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS file_chunks (
      path TEXT NOT NULL, part INTEGER NOT NULL, body BLOB NOT NULL,
      PRIMARY KEY (path, part)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
    )`);
  }

  collection(name) {
    if (!this.collections.has(name)) {
      const col = new Collection(this, name);
      const rows = this.sql.exec('SELECT doc FROM documents WHERE collection_name = ? ORDER BY rowid', name);
      col._load(Array.from(rows, row => JSON.parse(row.doc)));
      this.collections.set(name, col);
    }
    return this.collections.get(name);
  }

  _commit(name, op, id, doc) {
    if (op === 's') {
      this.sql.exec(`INSERT INTO documents (collection_name, id, doc) VALUES (?, ?, ?)
        ON CONFLICT(collection_name, id) DO UPDATE SET doc = excluded.doc`,
        name, String(id), JSON.stringify(doc));
    } else if (op === 'd') {
      this.sql.exec('DELETE FROM documents WHERE collection_name = ? AND id = ?', name, String(id));
    } else throw new Error('Operação de banco inválida.');
    this.stats.writes++;
  }

  async flush() { await this.storage.sync(); }
  flushSync() { /* SQL síncrono, protegido pelo output gate do Durable Object. */ }
  async close() { await this.flush(); }

  /** Exportação privada do banco; o endpoint exige permissão sistema.*. */
  exportData() {
    const collections = Object.create(null);
    for (const row of this.sql.exec('SELECT collection_name, doc FROM documents ORDER BY collection_name, rowid')) {
      if (row.collection_name === '__meta') continue;
      (collections[row.collection_name] ||= []).push(JSON.parse(row.doc));
    }
    return { format: 'pague-pouco-sqlite-export-v1', createdAt: new Date().toISOString(), collections };
  }

  /**
   * Manifesto completo de mídia guardada no SQLite. O backup de documentos
   * existente não contém os bytes do arquivo: cada item precisa ser baixado
   * em sua própria URL administrativa para não concentrar todos os arquivos
   * na memória de um Worker.
   */
  exportMediaManifest() {
    const files = Array.from(this.sql.exec(
      'SELECT path, mime, size, etag, modified FROM files ORDER BY path'
    ), row => ({
      caminho: row.path,
      tipo: row.mime,
      tamanho: Number(row.size),
      sha256: String(row.etag || '').replace(/^"|"$/g, ''),
      modificadoEm: row.modified,
      chave: Buffer.from(row.path, 'utf8').toString('base64url'),
    }));
    return {
      format: 'pague-pouco-midia-manifest-v1',
      createdAt: new Date().toISOString(),
      total: files.length,
      bytes: files.reduce((n, file) => n + file.tamanho, 0),
      files,
    };
  }

  takeRateLimit(key, max, windowMs) {
    const now = Date.now();
    // Limpeza na própria requisição: nenhum timer ou dependência de memória volátil.
    this.sql.exec('DELETE FROM rate_limits WHERE reset_at < ?', now - 60000);
    this.sql.exec(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END`,
      key, now + windowMs, now, now);
    const row = this.sql.exec('SELECT count, reset_at FROM rate_limits WHERE key = ?', key).one();
    return { allowed: row.count <= max, resetAt: row.reset_at };
  }

  putFile(key, data, mime) {
    if (!key || key.startsWith('/') || key.split('/').some(p => p === '..' || p === '.')) {
      throw new Error('Caminho de arquivo inválido.');
    }
    const etag = '"' + crypto.createHash('sha256').update(data).digest('hex') + '"';
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM file_chunks WHERE path = ?', key);
      this.sql.exec(`INSERT INTO files (path, mime, size, etag, modified) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET mime=excluded.mime, size=excluded.size,
          etag=excluded.etag, modified=excluded.modified`,
        key, mime, data.length, etag, new Date().toISOString());
      // Fragmentos abaixo do limite de 2 MiB por linha do SQLite da Cloudflare.
      for (let i = 0; i < data.length; i += CHUNK_BYTES) {
        this.sql.exec('INSERT INTO file_chunks (path, part, body) VALUES (?, ?, ?)',
          key, i / CHUNK_BYTES, data.subarray(i, i + CHUNK_BYTES));
      }
    });
  }

  deleteFile(key) {
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM file_chunks WHERE path = ?', key);
      this.sql.exec('DELETE FROM files WHERE path = ?', key);
    });
  }

  fileResponse(key, request) {
    const file = Array.from(this.sql.exec('SELECT * FROM files WHERE path = ?', key))[0];
    if (!file) return null;
    const headers = new Headers({
      'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'public, max-age=3600', 'ETag': file.etag,
      'Accept-Ranges': 'bytes', 'Last-Modified': new Date(file.modified).toUTCString(),
    });
    if (request.headers.get('if-none-match') === file.etag) return new Response(null, { status: 304, headers });
    let first = 0, last = file.size - 1, status = 200;
    const range = request.headers.get('range');
    if (range && (!request.headers.get('if-range') || request.headers.get('if-range') === file.etag)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + file.size } });
      if (m[1]) {
        first = Number(m[1]); last = m[2] ? Math.min(Number(m[2]), last) : last;
      } else first = Math.max(0, file.size - Number(m[2]));
      if (first > last || first >= file.size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + file.size } });
      status = 206;
      headers.set('Content-Range', 'bytes ' + first + '-' + last + '/' + file.size);
    }
    headers.set('Content-Length', String(Math.max(0, last - first + 1)));
    if (request.method === 'HEAD') return new Response(null, { status, headers });
    const parts = Array.from(this.sql.exec(
      'SELECT body FROM file_chunks WHERE path = ? AND part >= ? AND part <= ? ORDER BY part',
      key, Math.floor(first / CHUNK_BYTES), Math.floor(last / CHUNK_BYTES)), row => Buffer.from(row.body));
    const bytes = Buffer.concat(parts);
    const offset = first % CHUNK_BYTES;
    return new Response(bytes.subarray(offset, offset + last - first + 1), { status, headers });
  }
}
