/**
 * Ensaia a recuperação de um backup Cloudflare sem alterar nenhum sistema.
 *
 * node scripts/testar-restauracao.js dados.json midias-manifest.json [pasta-de-midias]
 *
 * A pasta de mídias deve conter os originais no caminho informado no
 * manifesto, por exemplo 2026/10/identificador.webp.
 */
import fs from 'node:fs/promises';
import { ensaiarRestauracaoCloudflare } from '../src/lib/restore-rehearsal.js';

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) {
  console.error('Uso: node scripts/testar-restauracao.js DADOS.json MANIFESTO.json [PASTA-DE-MIDIAS]');
  process.exitCode = 2;
} else {
  try {
    const [dados, manifesto, mediaDir] = args;
    const snapshot = JSON.parse(await fs.readFile(dados, 'utf8'));
    const manifest = JSON.parse(await fs.readFile(manifesto, 'utf8'));
    const resultado = await ensaiarRestauracaoCloudflare({ snapshot, manifest, mediaDir });
    console.log('Ensaio de restauração isolado: APROVADO');
    console.log(JSON.stringify(resultado, null, 2));
    console.log('Nenhuma loja ou banco de produção foi alterado.');
  } catch (erro) {
    console.error('Ensaio de restauração: REPROVADO (' + erro.message + ')');
    process.exitCode = 1;
  }
}
