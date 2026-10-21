/**
 * Recuperação de desastre em ambiente descartável. Os dados do usuário
 * nunca são aplicados à loja publicada durante estes testes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensaiarRestauracaoCloudflare } from '../src/lib/restore-rehearsal.js';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bytes = Buffer.from('PNG\x00-original\x01-bits', 'utf8');
const caminho = '2026/10/imagem-teste.png';
const chave = Buffer.from(caminho).toString('base64url');
const hash = crypto.createHash('sha256').update(bytes).digest('hex');

const snapshot = () => ({
  format: 'pague-pouco-sqlite-export-v1',
  createdAt: '2026-10-21T03:00:00Z',
  collections: {
    admins: [{ id: 'admin', nome: 'Admin', senhaHash: 'hash-seguro', updatedAt: 'original' }],
    products: [{ id: 'produto', nome: 'Produto original', imagens: [{ url: '/uploads/' + caminho }] }],
    orders: [{ id: 'pedido', codigo: 'PP-TESTE', statusFinanceiro: 'aprovado' }],
    sessions: [{ id: 'sessao-antiga', userId: 'admin', type: 'admin' }],
    passwordTokens: [{ id: 'token-antigo', clienteId: 'c1' }],
    mailOutbox: [{ id: 'mensagem-antiga', html: 'https://example.test/redefinir/TOKEN-SECRETO' }],
  },
});
const manifest = () => ({
  format: 'pague-pouco-midia-manifest-v1',
  total: 1, bytes: bytes.length,
  files: [{ caminho, chave, sha256: hash, tamanho: bytes.length, tipo: 'image/png' }],
});

async function midiaTeste(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-backup-original-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '2026', '10'), { recursive: true });
  const original = path.join(root, ...caminho.split('/'));
  await fs.writeFile(original, bytes);
  return { root, original };
}

test('backup reabre documentos + mídias idênticos em armazenamento isolado', async t => {
  const { root, original } = await midiaTeste(t);
  const result = await ensaiarRestauracaoCloudflare({
    snapshot: snapshot(), manifest: manifest(), mediaDir: root,
  });
  assert.deepEqual(result, {
    ok: true, colecoes: 3, documentosRestaurados: 3, transitoriosDescartados: 3,
    arquivos: 1, bytes: bytes.length, isolado: true, producaoAlterada: false,
  });
  assert.deepEqual(await fs.readFile(original), bytes, 'arquivos de origem nunca mudam');
});

test('hash divergente, bytes faltantes e manifesto adulterado não são aceitos', async t => {
  const { root, original } = await midiaTeste(t);
  // Uma mídia do mesmo tamanho, mas alterada, deve falhar por HASH
  // (não apenas pelo tamanho). A mídia faltante falha separadamente.
  await fs.writeFile(original, Buffer.alloc(bytes.length, 0x21));
  await assert.rejects(
    ensaiarRestauracaoCloudflare({ snapshot: snapshot(), manifest: manifest(), mediaDir: root }),
    /arquivo alterado/,
  );
  await fs.rm(original);
  await assert.rejects(
    ensaiarRestauracaoCloudflare({ snapshot: snapshot(), manifest: manifest(), mediaDir: root }),
    /ENOENT|arquivo ausente/,
  );
  const outside = manifest();
  outside.files[0].caminho = '../privado/arquivo.png';
  outside.files[0].chave = Buffer.from(outside.files[0].caminho).toString('base64url');
  await assert.rejects(
    ensaiarRestauracaoCloudflare({ snapshot: snapshot(), manifest: outside, mediaDir: root }),
    /caminho de mídia inseguro/,
  );
});

test('coleções proibidas e IDs duplicados bloqueiam importação de backup corrompido', async () => {
  const backup = snapshot();
  backup.collections.__meta = [{ id: 'session-secret', value: 'NAO_RESTAURAR' }];
  await assert.rejects(
    ensaiarRestauracaoCloudflare({ snapshot: backup, manifest: { ...manifest(), files: [], total: 0, bytes: 0 } }),
    /nome de coleção inseguro/,
  );
  delete backup.collections.__meta;
  backup.collections.orders.push({ id: 'pedido', codigo: 'DUPLICADO' });
  await assert.rejects(
    ensaiarRestauracaoCloudflare({ snapshot: backup, manifest: { ...manifest(), files: [], total: 0, bytes: 0 } }),
    /IDs duplicados/,
  );
});

test('sem mídia ainda permite ensaiar somente o banco sem diretório externo', async () => {
  const manifestVazio = { format: 'pague-pouco-midia-manifest-v1', total: 0, bytes: 0, files: [] };
  const result = await ensaiarRestauracaoCloudflare({ snapshot: snapshot(), manifest: manifestVazio });
  assert.equal(result.ok, true);
  assert.equal(result.arquivos, 0);
  assert.equal(result.transitoriosDescartados, 3);
});

test('alarme da Cloudflare reprograma usando função existente Pix+estornos', async () => {
  const worker = await fs.readFile(path.join(base, 'src/cloudflare/worker.js'), 'utf8');
  assert.match(worker, /async programarAlarmeFinanceiro\(\)/);
  assert.doesNotMatch(worker, /programarAlarmePix/, 'não deve sobrar chamada ao nome antigo');
  assert.match(worker, /await this\.programarAlarmeFinanceiro\(\)/,
    'requisições devem armar a próxima verificação quando houver pendências');
  assert.match(worker, /reagendar: \(\) => this\.programarAlarmeFinanceiro\(\)/,
    'alarme deve delegar o reagendamento à rotina testada sob falhas');
  assert.match(worker, /executarAlarmeFinanceiro\(/);
  assert.match(worker, /temPixPendente\(this\.db\).*temEstornoPendente\(this\.db\)/);
});
