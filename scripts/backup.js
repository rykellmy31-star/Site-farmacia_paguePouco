/** backup.js — Gera uma cópia consistente dos dados em data/backups/<data-hora>. */
import path from 'node:path';
import fs from 'node:fs';
import { getStore } from '../src/lib/store.js';
import { config } from '../src/config.js';

const db = await getStore(config.dataDir);
const destino = path.join(db.dataDir, 'backups', `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await db.backup(destino);
// copia também os uploads (fotos e vídeos)
const uploadsDestino = path.join(destino, 'uploads');
fs.mkdirSync(uploadsDestino, { recursive: true });
fs.cpSync(config.uploadsDir, uploadsDestino, { recursive: true, force: true });
console.log('✔ Backup gerado em:', destino);
await db.close();
