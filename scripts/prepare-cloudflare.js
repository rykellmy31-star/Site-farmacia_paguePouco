/**
 * Build local: gera somente assets públicos e catálogo inicial.
 * Não publica data/db, .env, backups, ZIP, contas ou credenciais.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cloudflare');
const assets = path.join(output, 'assets');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(assets, { recursive: true });
await fs.cp(path.join(root, 'public'), assets, { recursive: true });

for (const folder of ['seed', 'banners']) {
  const from = path.join(root, 'data', 'uploads', folder);
  try {
    // Os arquivos de demonstração são SVGs. Metadados privados nunca são copiados.
    const to = path.join(assets, 'uploads', folder);
    await fs.mkdir(to, { recursive: true });
    for (const file of await fs.readdir(from)) {
      if (/^[a-zA-Z0-9_-]+\.svg$/.test(file)) await fs.copyFile(path.join(from, file), path.join(to, file));
    }
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

const initial = {};
for (const name of ['settings', 'categories', 'products', 'pages', 'banners', 'showcases', 'coupons']) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(root, 'data', 'db', name + '.json'), 'utf8'));
    if (!Array.isArray(data)) throw new Error('Coleção inválida: ' + name);
    initial[name] = data;
  } catch (err) { if (err.code !== 'ENOENT') throw err; initial[name] = []; }
}
await fs.writeFile(path.join(output, 'seed.json'), JSON.stringify(initial));
console.log('Build Cloudflare preparado: assets públicos e catálogo, sem contas de demonstração.');
