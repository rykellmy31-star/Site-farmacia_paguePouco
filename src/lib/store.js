/**
 * store.js — Camada de persistência da Farmácia Pague Pouco.
 *
 * Características (tudo com módulos nativos do Node.js, zero dependências):
 *  - Um arquivo JSON por coleção (snapshot) em data/db/<colecao>.json
 *  - Write-Ahead Log (WAL) em data/db/wal.log: toda mutação é gravada antes de
 *    ser aplicada, e o WAL é truncado somente após o snapshot ser gravado com
 *    sucesso. Em caso de queda, o WAL é replicado na inicialização.
 *  - Escrita atômica: grava em .tmp + rename (nunca corrompe o arquivo atual)
 *  - fsync ao fechar o snapshot, garantindo durabilidade em disco
 *  - Escritas enfileiradas (nunca concorrentes) e coalescidas (debounce)
 *  - Índices em memória para leitura O(1) por id
 *
 * Migração para PostgreSQL: ver database/schema.postgres.sql. Todo acesso ao
 * banco passa por este módulo (ou por src/repositories/*), ponto único de troca.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function uid(prefix = '') {
  const t = Date.now().toString(36);
  let r = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) r += ALPHABET[bytes[i] % 36];
  return `${prefix}${t}${r}`;
}

export function nowISO() {
  return new Date().toISOString();
}

const OP = { SET: 's', DEL: 'd' };

export class Collection {
  constructor(store, name) {
    this.store = store;
    this.name = name;
    this.docs = new Map();
    this.dirty = false;
  }

  _load(snapshot) {
    this.docs.clear();
    for (const doc of snapshot) {
      if (doc && doc.id != null) this.docs.set(String(doc.id), doc);
    }
  }

  _applySet(doc) {
    this.docs.set(String(doc.id), doc);
    this.dirty = true;
  }

  _applyDel(id) {
    this.docs.delete(String(id));
    this.dirty = true;
  }

  all() {
    return Array.from(this.docs.values());
  }

  count(pred) {
    return pred ? this.all().filter(pred).length : this.docs.size;
  }

  find(pred = () => true) {
    return this.all().filter(pred);
  }

  findOne(pred) {
    for (const doc of this.docs.values()) if (pred(doc)) return doc;
    return null;
  }

  get(id) {
    if (id == null) return null;
    return this.docs.get(String(id)) || null;
  }

  insert(doc) {
    const d = { ...doc };
    if (!d.id) d.id = uid();
    if (!d.createdAt) d.createdAt = nowISO();
    d.updatedAt = nowISO();
    this.store._commit(this.name, OP.SET, d.id, d);
    this._applySet(d);
    return d;
  }

  update(id, patch) {
    const current = this.docs.get(String(id));
    if (!current) return null;
    const next = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: nowISO() };
    this.store._commit(this.name, OP.SET, current.id, next);
    this._applySet(next);
    return next;
  }

  /** Atualiza vários documentos de uma vez (uma única passagem de gravação). */
  updateMany(pred, patchFn) {
    let n = 0;
    for (const doc of Array.from(this.docs.values())) {
      if (!pred(doc)) continue;
      const patch = patchFn(doc) || {};
      const next = { ...doc, ...patch, id: doc.id, createdAt: doc.createdAt, updatedAt: nowISO() };
      this.store._commit(this.name, OP.SET, doc.id, next);
      this._applySet(next);
      n++;
    }
    return n;
  }

  remove(id) {
    const current = this.docs.get(String(id));
    if (!current) return false;
    this.store._commit(this.name, OP.DEL, current.id, null);
    this._applyDel(current.id);
    return true;
  }

  removeMany(pred) {
    let n = 0;
    for (const doc of Array.from(this.docs.values())) {
      if (pred(doc) && this.remove(doc.id)) n++;
    }
    return n;
  }

  clear() {
    for (const id of Array.from(this.docs.keys())) this.remove(id);
  }

  /** Consulta com ordenação e paginação. */
  query({ where, sort, order = 'asc', limit, offset = 0 } = {}) {
    let rows = this.all();
    if (where) rows = rows.filter(where);
    if (sort) {
      const dir = order === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const va = a[sort];
        const vb = b[sort];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'pt-BR') * dir;
      });
    }
    const total = rows.length;
    if (offset) rows = rows.slice(offset);
    if (limit != null) rows = rows.slice(0, limit);
    return { rows, total };
  }
}

export class Store {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir || process.env.DATA_DIR || './data');
    this.dbDir = path.join(this.dataDir, 'db');
    this.walPath = path.join(this.dbDir, 'wal.log');
    this.collections = new Map();
    this._writeQueue = Promise.resolve();
    this._flushTimer = null;
    this._flushPending = false;
    this._walFd = null;
    this._closing = false;
    this.stats = { writes: 0, replays: 0 };
  }

  async open() {
    await fsp.mkdir(this.dbDir, { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, 'uploads'), { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, 'logs'), { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, 'mail'), { recursive: true });
    await fsp.mkdir(path.join(this.dataDir, 'backups'), { recursive: true });
    this._walFd = fs.openSync(this.walPath, 'a');
    return this;
  }

  collection(name) {
    let col = this.collections.get(name);
    if (col) return col;
    col = new Collection(this, name);
    this.collections.set(name, col);
    // Carregamento síncrono na primeira vez (dados pequenos; evita race em boot)
    if (fs.existsSync(this._snapPath(name))) {
      try {
        const raw = fs.readFileSync(this._snapPath(name), 'utf8');
        col._load(JSON.parse(raw));
      } catch (err) {
        const backup = `${this._snapPath(name)}.corrompido-${Date.now()}`;
        fs.writeFileSync(backup, fs.readFileSync(this._snapPath(name)));
        console.error(`[store] snapshot de "${name}" ilegível. Backup em ${backup}. Recriando vazio.`, err.message);
        col._load([]);
      }
    }
    return col;
  }

  _snapPath(name) {
    return path.join(this.dbDir, `${name}.json`);
  }

  _commit(collection, op, id, doc) {
    const line = JSON.stringify({ c: collection, o: op, i: String(id), d: doc ?? null, t: Date.now() }) + '\n';
    // 1) WAL primeiro (durabilidade)
    if (this._walFd != null) {
      try {
        fs.writeSync(this._walFd, line);
      } catch (err) {
        console.error('[store] falha ao gravar WAL:', err.message);
      }
    }
    this._flushPending = true;
    this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this._closing) {
      this.flushSync();
      return;
    }
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush().catch((err) => console.error('[store] flush falhou:', err));
    }, 40);
  }

  async flush() {
    this._writeQueue = this._writeQueue.then(() => this._flushNow()).catch((err) => {
      console.error('[store] flush falhou:', err);
    });
    return this._writeQueue;
  }

  async _flushNow() {
    if (!this._flushPending) return;
    const dirty = Array.from(this.collections.values()).filter((c) => c.dirty);
    if (!dirty.length) return;
    for (const col of dirty) {
      await this._writeSnapshot(col);
      col.dirty = false;
    }
    // Snapshots gravados e fsyncados => WAL pode ser truncado
    try {
      fs.fsyncSync(this._walFd);
      fs.ftruncateSync(this._walFd, 0);
      fs.fsyncSync(this._walFd);
    } catch (err) {
      console.error('[store] falha ao truncar WAL:', err.message);
    }
    this._flushPending = false;
    this.stats.writes++;
  }

  async _writeSnapshot(col) {
    const target = this._snapPath(col.name);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    const data = JSON.stringify(col.all(), null, 0);
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, target);
  }

  /** Replica o WAL (chamado antes de qualquer leitura, na inicialização). */
  async replayWal() {
    if (!fs.existsSync(this.walPath)) return 0;
    const raw = await fsp.readFile(this.walPath, 'utf8');
    if (!raw.trim()) return 0;
    let applied = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // linha truncada por queda: descarta apenas ela
      }
      const col = this.collection(rec.c);
      if (rec.o === OP.SET) col._applySet(rec.d);
      else col._applyDel(rec.i);
      applied++;
    }
    this.stats.replays = applied;
    if (applied) {
      console.log(`[store] WAL replicado: ${applied} operação(ões) recuperada(s).`);
      await this.flush();
    }
    return applied;
  }

  flushSync() {
    if (!this._flushPending) return;
    const dirty = Array.from(this.collections.values()).filter((c) => c.dirty);
    for (const col of dirty) {
      const target = this._snapPath(col.name);
      const tmp = `${target}.tmp-sync-${process.pid}`;
      try {
        const fd = fs.openSync(tmp, 'w');
        fs.writeSync(fd, JSON.stringify(col.all()));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fs.renameSync(tmp, target);
        col.dirty = false;
      } catch (err) {
        console.error(`[store] flushSync de "${col.name}" falhou:`, err.message);
      }
    }
    try {
      fs.ftruncateSync(this._walFd, 0);
    } catch { /* ignore */ }
    this._flushPending = false;
  }

  async close() {
    this._closing = true;
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this.flushSync();
    if (this._walFd != null) {
      try {
        fs.closeSync(this._walFd);
      } catch { /* ignore */ }
      this._walFd = null;
    }
  }

  /** Cópia de segurança consistente (snapshot + fsync) para data/backups/<stamp> */
  async backup(destDir) {
    await this.flush();
    await fsp.mkdir(destDir, { recursive: true });
    // Copiar todos os snapshots, mesmo de coleções que não foram acessadas
    // desde o início do processo; o código antigo omitía essas tabelas.
    const colecoesTransitorias = new Set(['sessions.json', 'passwordTokens.json', 'mailOutbox.json', 'paymentSecrets.json']);
    for (const entry of await fsp.readdir(this.dbDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') ||
          colecoesTransitorias.has(entry.name)) continue;
      await fsp.copyFile(path.join(this.dbDir, entry.name), path.join(destDir, entry.name));
    }
    // Os uploads não ficam nos documentos JSON. Preservar originais e
    // metadados lado a lado para uma restauração offline posterior.
    const uploads = path.join(this.dataDir, 'uploads');
    if (fs.existsSync(uploads)) {
      await fsp.cp(uploads, path.join(destDir, 'uploads'), { recursive: true, force: false });
    }
    return destDir;
  }
}

let _store = null;
export async function getStore(dataDir) {
  if (_store) return _store;
  _store = new Store(dataDir);
  await _store.open();
  await _store.replayWal();
  return _store;
}
