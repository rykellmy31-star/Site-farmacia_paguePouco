/**
 * Valida backup offline sem tocar em Cloudflare ou loja publicada.
 * Confere snapshots, coleções não carregadas e os bytes originais da mídia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/lib/store.js';

test('backup Node inclui todas as coleções e mídias, sem alterar os dados originais', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'pague-pouco-backup-'));
  t.after(async () => rm(folder, { recursive: true, force: true }));
  const db = new Store(folder);
  await db.open();
  t.after(async () => db.close());
  db.collection('orders').insert({ id: 'pedido-teste', totalCentavos: 3990 });
  const originalMedia = Buffer.from('Midia binaria do teste\0\0\x01', 'utf8');
  const mediaDir = path.join(folder, 'uploads', '2026', '10');
  await mkdir(mediaDir, { recursive: true });
  await writeFile(path.join(mediaDir, 'imagem.png'), originalMedia);
  await writeFile(path.join(mediaDir, 'imagem.png.json'), '{"original":"imagem.png"}');
  // Uma coleção existente ainda não aberta neste processo não pode sumir.
  await writeFile(path.join(folder, 'db', 'unloaded.json'), JSON.stringify([{ id: 'nao-acessada' }]));
  // Dados transitórios NÃO podem vazar em uma cópia operacional.
  await writeFile(path.join(folder, 'db', 'sessions.json'), JSON.stringify([{ id: 'sid', token: 'SESSAO-SECRETA' }]));
  await writeFile(path.join(folder, 'db', 'passwordTokens.json'), JSON.stringify([{ id: 'r1', token: 'TOKEN-SENHA' }]));
  await writeFile(path.join(folder, 'db', 'mailOutbox.json'), JSON.stringify([{
    id: 'm1', html: 'https://exemplo.test/conta/redefinir/TOKEN-SENHA',
  }]));
  await writeFile(path.join(folder, 'db', 'paymentSecrets.json'), JSON.stringify([{ id: 'mercadopago', cifra: 'SEGREDO_CRIPTOGRAFADO' }]));
  const backup = path.join(folder, 'backups', 'teste');
  await db.backup(backup);
  const orders = JSON.parse(await readFile(path.join(backup, 'orders.json'), 'utf8'));
  assert.equal(orders[0].id, 'pedido-teste');
  const unloaded = JSON.parse(await readFile(path.join(backup, 'unloaded.json'), 'utf8'));
  assert.equal(unloaded[0].id, 'nao-acessada');
  for (const transitorio of ['sessions.json', 'passwordTokens.json', 'mailOutbox.json', 'paymentSecrets.json']) {
    await assert.rejects(readFile(path.join(backup, transitorio), 'utf8'), { code: 'ENOENT' },
      'backup não deve exportar ' + transitorio);
    assert.ok((await readFile(path.join(folder, 'db', transitorio), 'utf8')).length > 0,
      'backup deve manter original intacto: ' + transitorio);
  }
  assert.deepEqual(await readFile(path.join(backup, 'uploads', '2026', '10', 'imagem.png')), originalMedia);
  assert.equal(await readFile(path.join(backup, 'uploads', '2026', '10', 'imagem.png.json'), 'utf8'),
    '{"original":"imagem.png"}');
  assert.deepEqual(await readFile(path.join(mediaDir, 'imagem.png')), originalMedia,
    'backup não deve modificar imagem de origem');
});
