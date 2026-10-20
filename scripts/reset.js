/**
 * reset.js — Apaga TODOS os dados de desenvolvimento (banco e uploads).
 * Uso: node scripts/reset.js --confirmar
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

if (!process.argv.includes('--confirmar')) {
  console.log('Este comando apaga o banco de dados e os arquivos enviados.');
  console.log('Execute novamente com --confirmar para prosseguir.');
  process.exit(0);
}

for (const alvo of [path.join(config.dataDir, 'db'), config.uploadsDir, path.join(config.dataDir, 'mail')]) {
  fs.rmSync(alvo, { recursive: true, force: true });
  console.log('Removido:', alvo);
}
console.log('✔ Dados removidos. Rode "npm run seed" para recriar os dados de exemplo.');
