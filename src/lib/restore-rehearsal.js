/**
 * Ensaio de restauração isolado, executado SOMENTE em Node.js.
 *
 * Nunca grava no banco Cloudflare, não expõe endpoint de restauração e apaga
 * a cópia temporária após verificar documentos e arquivos originais.
 * Os arquivos são lidos de mediaDir/<caminho> (espelhando o manifesto).
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Store } from './store.js';

const SKIP = new Set(['sessions', 'passwordTokens', 'mailOutbox']);
const LIMITE_ARQUIVOS = 100_000;
const LIMITE_DOCUMENTOS = 500_000;
const LIMITE_BYTES_ARQUIVO = 128 * 1024 * 1024;
const nomeColecaoValido = (s) =>
  typeof s === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(s) &&
  !['constructor', 'prototype', '__proto__', '__meta'].includes(s);
const caminhoValido = (s) =>
  typeof s === 'string' && s.length <= 500 && !s.includes('\\') &&
  s.split('/').length >= 2 && s.split('/').every(p =>
    !!p && p !== '.' && p !== '..' && /^[a-zA-Z0-9_.-]+$/.test(p));

function exigir(condicao, mensagem) {
  if (!condicao) throw new Error('Backup inválido: ' + mensagem);
}

function colecoesValidas(snapshot) {
  exigir(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    snapshot.format === 'pague-pouco-sqlite-export-v1', 'formato dos documentos desconhecido');
  exigir(snapshot.collections && typeof snapshot.collections === 'object' &&
    !Array.isArray(snapshot.collections), 'coleções ausentes');
  let total = 0;
  const result = [];
  for (const [nome, documentos] of Object.entries(snapshot.collections)) {
    exigir(nomeColecaoValido(nome), 'nome de coleção inseguro');
    exigir(Array.isArray(documentos), 'coleção ' + nome + ' não é lista');
    total += documentos.length;
    exigir(total <= LIMITE_DOCUMENTOS, 'documentos em excesso');
    const ids = new Set();
    for (const doc of documentos) {
      exigir(doc && typeof doc === 'object' && !Array.isArray(doc) &&
        (typeof doc.id === 'string' || typeof doc.id === 'number') &&
        String(doc.id).length > 0 && String(doc.id).length <= 256, 'documento sem ID válido');
      exigir(!ids.has(String(doc.id)), 'IDs duplicados na coleção ' + nome);
      ids.add(String(doc.id));
    }
    if (!SKIP.has(nome)) result.push([nome, documentos]);
  }
  return { result, documents: total, skipped: SKIP.size &&
    [...SKIP].reduce((count, name) => count + (snapshot.collections[name]?.length || 0), 0) };
}

function arquivosValidos(manifest) {
  exigir(manifest && typeof manifest === 'object' &&
    manifest.format === 'pague-pouco-midia-manifest-v1' &&
    Array.isArray(manifest.files), 'manifesto de mídia inválido');
  exigir(manifest.files.length <= LIMITE_ARQUIVOS, 'arquivos em excesso');
  const paths = new Set();
  let size = 0;
  for (const file of manifest.files) {
    exigir(file && caminhoValido(file.caminho), 'caminho de mídia inseguro');
    exigir(typeof file.chave === 'string' &&
      Buffer.from(file.caminho, 'utf8').toString('base64url') === file.chave,
    'chave de download não corresponde ao caminho');
    exigir(Number.isSafeInteger(file.tamanho) && file.tamanho >= 0 &&
      file.tamanho <= LIMITE_BYTES_ARQUIVO, 'tamanho de mídia inválido');
    exigir(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256),
      'SHA-256 inválido');
    exigir(!paths.has(file.caminho), 'mídia duplicada');
    paths.add(file.caminho);
    size += file.tamanho;
  }
  exigir(manifest.total === manifest.files.length && manifest.bytes === size,
    'totais do manifesto inconsistentes');
  return size;
}

/**
 * Executa importação experimental e verifica, após reiniciar o Store, que
 * todos os documentos e os hashes das mídias permaneceram idênticos.
 * Não publica nada e destrói o ambiente de ensaio (inclusive em falhas).
 */
export async function ensaiarRestauracaoCloudflare({ snapshot, manifest, mediaDir }) {
  const { result, documents, skipped } = colecoesValidas(snapshot);
  const bytes = arquivosValidos(manifest);
  if (manifest.files.length) exigir(typeof mediaDir === 'string' && !!mediaDir,
    'pasta de arquivos originais não informada');

  const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-restore-rehearsal-'));
  let store = null;
  try {
    const sourceRoot = mediaDir ? await fs.realpath(mediaDir) : null;
    const sourcePrefix = sourceRoot ? sourceRoot + path.sep : '';
    store = new Store(isolatedDir);
    await store.open();
    for (const [name, documentos] of result) {
      const collection = store.collection(name);
      for (const doc of documentos) {
        // Preserva bytes JSON sem alterar createdAt, updatedAt ou outros
        // campos de domínio, ao contrário de Collection.insert().
        store._commit(name, 's', doc.id, doc);
        collection._applySet(doc);
      }
    }
    for (const media of manifest.files) {
      const original = path.join(sourceRoot, ...media.caminho.split('/'));
      const real = await fs.realpath(original);
      exigir(real.startsWith(sourcePrefix), 'arquivo fora da pasta fornecida');
      const stat = await fs.lstat(real);
      exigir(stat.isFile() && stat.size === media.tamanho, 'arquivo ausente ou incompleto: ' + media.caminho);
      const data = await fs.readFile(real);
      exigir(crypto.createHash('sha256').update(data).digest('hex') === media.sha256,
        'arquivo alterado: ' + media.caminho);
      const target = path.join(isolatedDir, 'uploads', ...media.caminho.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data, { flag: 'wx' });
    }
    await store.flush();
    await store.close();
    store = null;

    // O ensaio só é aprovado se a gravação sobreviver a uma reabertura.
    const restored = new Store(isolatedDir);
    store = restored;
    await restored.open();
    await restored.replayWal();
    for (const [name, docs] of result) {
      exigir(JSON.stringify(restored.collection(name).all()) === JSON.stringify(docs),
        'documentos divergentes após reabrir: ' + name);
    }
    for (const media of manifest.files) {
      const data = await fs.readFile(path.join(isolatedDir, 'uploads', ...media.caminho.split('/')));
      exigir(crypto.createHash('sha256').update(data).digest('hex') === media.sha256,
        'mídia divergente após reabrir: ' + media.caminho);
    }
    return {
      ok: true,
      colecoes: result.length,
      documentosRestaurados: documents - skipped,
      sessoesDescartadas: skipped,
      arquivos: manifest.files.length,
      bytes,
      isolado: true,
      producaoAlterada: false,
    };
  } finally {
    if (store) await store.close();
    await fs.rm(isolatedDir, { recursive: true, force: true });
  }
}
