/**
 * Restituição segura de cópias exportadas do Worker, somente no computador
 * do operador. NUNCA se conecta à Cloudflare nem faz restore em produção.
 *
 * Exemplo:
 * node scripts/validate-cloudflare-backup.mjs --snapshot backup.json
 *   --manifest midias-manifest.json --media-dir ./midias-extraidas
 */
import fs from 'node:fs/promises';
import { ensaiarRestauracaoCloudflare } from '../src/lib/restore-rehearsal.js';

export function parametros(argv) {
  const valores = new Map(), validos=new Set(['--snapshot','--manifest','--media-dir']);
  for(let i=0;i<argv.length;i+=2) {
    const chave=argv[i], valor=argv[i+1];
    if(!validos.has(chave) || !valor || valor.startsWith('--') || valores.has(chave))
      throw new Error('Uso: --snapshot arquivo.json --manifest midias.json [--media-dir pasta]');
    valores.set(chave,valor);
  }
  if (!valores.get('--snapshot') || !valores.get('--manifest'))
    throw new Error('Informe o snapshot e o manifesto de mídias.');
  return {snapshotFile:valores.get('--snapshot'),
    manifestFile:valores.get('--manifest'),mediaDir:valores.get('--media-dir')};
}

export async function validarArquivosBackup({snapshotFile,manifestFile,mediaDir}) {
  const MAX_JSON = 64 * 1024 * 1024;
  const [st1,st2] = await Promise.all([fs.stat(snapshotFile),fs.stat(manifestFile)]);
  if(!st1.isFile()||!st2.isFile()||st1.size>MAX_JSON||st2.size>MAX_JSON)
    throw new Error('Arquivos JSON ausentes ou excedem o limite seguro de tamanho.');
  const [doc,midias] = await Promise.all([
    fs.readFile(snapshotFile,'utf8'),fs.readFile(manifestFile,'utf8'),
  ]);
  return ensaiarRestauracaoCloudflare({
    snapshot: JSON.parse(doc),manifest: JSON.parse(midias),mediaDir,
  });
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const resultado=await validarArquivosBackup(parametros(process.argv.slice(2)));
    // Não imprimir nomes, IDs, registros, emails, hash ou caminhos sensíveis.
    console.log('RESTAURACAO_ISOLADA='+JSON.stringify(resultado));
  } catch(e) {
    console.error('RESTAURACAO_ISOLADA='+JSON.stringify({
      ok:false,erro:'Backup inválido, incompleto ou mídia divergente. Não usar em produção.',
    }));
    process.exitCode=1;
  }
}
