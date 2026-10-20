/**
 * uploads.js — Armazenamento persistente e seguro de imagens e vídeos.
 *
 *  - Arquivos gravados em disco: data/uploads/aaaa/mm/<id>.<ext>  (persistem reinicializações)
 *  - Nome aleatório gerado pelo servidor (nunca usa o nome enviado pelo cliente)
 *  - Validação por "magic bytes" (não confia apenas no Content-Type)
 *  - Limites de tamanho configuráveis e extensão permitida por tipo
 *  - Registro no banco (coleção "midia") com dimensões, tamanho e autor
 *  - Otimização opcional de imagem: usa o pacote "sharp" SOMENTE se o responsável
 *    técnico o instalar manualmente (IMAGE_OPTIMIZE=true). Sem ele, o sistema
 *    continua funcionando e apenas serve a imagem original já validada.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', kind: 'image', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', mime: 'image/gif', kind: 'image', test: (b) => b.slice(0, 3).toString('latin1') === 'GIF' },
  { ext: 'webp', mime: 'image/webp', kind: 'image', test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'svg', mime: 'image/svg+xml', kind: 'image', test: (b) => b.slice(0, 400).toString('latin1').includes('<svg') },
  { ext: 'mp4', mime: 'video/mp4', kind: 'video', test: (b) => b.slice(4, 8).toString('latin1') === 'ftyp' },
  { ext: 'webm', mime: 'video/webm', kind: 'video', test: (b) => b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { ext: 'pdf', mime: 'application/pdf', kind: 'doc', test: (b) => b.slice(0, 4).toString('latin1') === '%PDF' },
];

export function detectFileType(buffer) {
  for (const sig of SIGNATURES) {
    try {
      if (sig.test(buffer)) return sig;
    } catch { /* buffer pequeno */ }
  }
  return null;
}

/** Lê dimensões de JPEG/PNG sem dependências (para exibição e SEO). */
export function imageSize(buffer, ext) {
  try {
    if (ext === 'png' && buffer.length > 24) {
      return { largura: buffer.readUInt32BE(16), altura: buffer.readUInt32BE(20) };
    }
    if (ext === 'jpg') {
      let i = 2;
      while (i < buffer.length - 9) {
        if (buffer[i] !== 0xff) { i++; continue; }
        const marker = buffer[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { altura: buffer.readUInt16BE(i + 5), largura: buffer.readUInt16BE(i + 7) };
        }
        i += 2 + buffer.readUInt16BE(i + 2);
      }
    }
    if (ext === 'webp' && buffer.slice(12, 16).toString('latin1') === 'VP8 ') {
      return { largura: buffer.readUInt16LE(26) & 0x3fff, altura: buffer.readUInt16LE(28) & 0x3fff };
    }
  } catch { /* ignora */ }
  return { largura: null, altura: null };
}

export class UploadError extends Error {
  constructor(message, code = 'UPLOAD_ERROR') {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

/**
 * Salva um arquivo enviado.
 * @returns {object} registro da mídia persistido no banco
 */
export async function saveUpload(db, file, opts = {}) {
  const kind = opts.kind || 'image';
  if (!file || !Buffer.isBuffer(file.data) || file.data.length === 0) {
    throw new UploadError('Nenhum arquivo recebido.');
  }
  const detected = detectFileType(file.data);
  if (!detected) {
    throw new UploadError('Tipo de arquivo não permitido. Envie imagens (JPG, PNG, WEBP, SVG) ou vídeos (MP4, WEBM).');
  }
  if (detected.kind !== kind) {
    throw new UploadError(`Arquivo enviado é do tipo "${detected.kind}", mas era esperado "${kind}".`);
  }
  const maxBytes = kind === 'video' ? config.uploads.maxVideoBytes : config.uploads.maxImageBytes;
  if (file.data.length > maxBytes) {
    throw new UploadError(`Arquivo muito grande. Limite de ${(maxBytes / 1024 / 1024).toFixed(0)} MB para ${kind}.`);
  }

  let buffer = file.data;
  let ext = detected.ext;
  const dims = detected.kind === 'image' ? imageSize(buffer, ext) : { largura: null, altura: null };

  // Otimização opcional (requer "sharp" instalado manualmente; falha silenciosa)
  if (kind === 'image' && config.uploads.imageOptimize) {
    try {
      const sharp = (await import('sharp')).default;
      buffer = await sharp(file.data).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      ext = 'webp';
    } catch {
      // sharp ausente: mantém o original (comportamento padrão, sem erro)
    }
  }

  const id = crypto.randomBytes(9).toString('base64url');
  const now = new Date();
  const relDir = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  const absDir = path.join(config.uploadsDir, relDir);
  await fsp.mkdir(absDir, { recursive: true });
  const filename = `${id}.${ext}`;
  const absPath = path.join(absDir, filename);
  await fsp.writeFile(absPath, buffer, { flag: 'wx', mode: 0o644 });
  await fsp.writeFile(`${absPath}.json`, JSON.stringify({
    original: String(file.filename || '').slice(0, 200),
    contentType: detected.mime,
    enviadoEm: now.toISOString(),
  }));

  const record = db.collection('midia').insert({
    id,
    nome: opts.nome || String(file.filename || `arquivo.${ext}`).slice(0, 120),
    tipo: detected.kind,
    mime: ext === 'webp' ? 'image/webp' : detected.mime,
    ext,
    caminho: path.posix.join(relDir, filename),
    url: `/uploads/${path.posix.join(relDir, filename)}`,
    tamanho: buffer.length,
    largura: dims.largura,
    altura: dims.altura,
    criadoEm: now.toISOString(),
    autorId: opts.userId || null,
    autorTipo: opts.userType || 'admin',
    legenda: opts.legenda || '',
  });
  return record;
}

export function findUpload(db, id) {
  return db.collection('midia').get(id) || null;
}

export async function deleteUpload(db, id, { force = false } = {}) {
  const rec = db.collection('midia').get(id);
  if (!rec) return { ok: false, erro: 'Arquivo não encontrado.' };
  const usos = countUsages(db, rec.url);
  if (usos > 0 && !force) {
    return { ok: false, erro: `Este arquivo está sendo usado em ${usos} local(is). Remova o vínculo antes ou force a exclusão.`, usos };
  }
  const abs = path.join(config.uploadsDir, rec.caminho);
  try {
    await fsp.unlink(abs);
  } catch { /* arquivo já removido */ }
  try {
    await fsp.unlink(`${abs}.json`);
  } catch { /* opcional */ }
  db.collection('midia').remove(id);
  return { ok: true };
}

export function countUsages(db, url) {
  if (!url) return 0;
  let n = 0;
  for (const p of db.collection('products').all()) {
    const imgs = (p.imagens || []).map((i) => (typeof i === 'string' ? i : i.url));
    if (imgs.includes(url)) n++;
    if ((p.videos || []).some((v) => (typeof v === 'string' ? v : v.url) === url)) n++;
    if (p.bulaUrl === url) n++;
  }
  for (const c of db.collection('categories').all()) if (c.imagem === url) n++;
  for (const b of db.collection('banners').all()) if (b.imagem === url || b.imagemMobile === url) n++;
  const s = db.collection('settings').get('site');
  if (s) {
    const json = JSON.stringify(s);
    if (json.includes(url)) n++;
  }
  return n;
}

export function uploadStats(db) {
  const all = db.collection('midia').all();
  const imagens = all.filter((m) => m.tipo === 'image');
  const videos = all.filter((m) => m.tipo === 'video');
  const bytes = all.reduce((a, m) => a + (m.tamanho || 0), 0);
  return { total: all.length, imagens: imagens.length, videos: videos.length, bytes };
}

export function ensureUploadDirs() {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}
