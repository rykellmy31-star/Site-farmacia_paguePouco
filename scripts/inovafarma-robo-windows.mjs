/**
 * Robô LOCAL, somente leitura, para exportações CSV do InovaFarma no Windows.
 * Faz triagem e gera fila privada para revisão humana. Nunca acessa ERP,
 * banco Cloudflare, API remota, pedidos ou pagamentos.
 * Requer Node.js 22 e os módulos existentes deste projeto.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lerItensRelatorioEstoqueSomenteLeitura } from '../src/lib/inovafarma-csv-import.js';
import { lerCatalogoNovoInova } from '../src/lib/inovafarma-catalogo-substituicao.js';
import { analisarPromocoesInovaCsv } from '../src/lib/inovafarma-promocoes-csv.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MIN_ESTAVEL_MS = 10000;
const INTERVALO_MS = 15000;
const MAX_REGISTROS = 3000;

function lerTexto(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
export function classificarExportacaoInova(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_BYTES)
    throw new Error('CSV vazio ou maior que 8 MB.');
  const texto = lerTexto(bytes).replace(/^\uFEFF/, '');
  if (/^\s*RELAT[OÓ]RIO DE PROMO[CÇ][OÕ]ES\s*[;\r\n]/i.test(texto)) {
    const relatorio = analisarPromocoesInovaCsv(texto);
    if (relatorio.erros.length)
      throw new Error('Promoções com preços inválidos; corrija o relatório antes de importar.');
    return { tipo: 'promocoes', total: relatorio.total,
      campanhas: relatorio.campanhas.length, validade: 'Revisar datas e formas de pagamento no painel' };
  }
  try {
    const produtos = lerItensRelatorioEstoqueSomenteLeitura(bytes);
    return { tipo: 'estoque', total: produtos.length,
      semEstoque: produtos.filter(x => x.quantidade === 0).length };
  } catch (erroEstoque) {
    try {
      const catalogo = lerCatalogoNovoInova(bytes);
      return { tipo: 'catalogo_completo', total: catalogo.itens.length,
        aviso: 'Substituição integral requer backup e confirmação manual no painel' };
    } catch {
      throw new Error('CSV não reconhecido: use Posição de Estoque, Relatório de Promoções ou Catálogo padronizado completo.');
    }
  }
}

function estadoNovo() { return { versao: 1, processados: {}, rejeitados: {}, atualizadoEm: null }; }
async function lerEstado(caminho) {
  try {
    const v = JSON.parse(await fs.readFile(caminho, 'utf8'));
    if (v?.versao !== 1 || !v.processados || !v.rejeitados ||
      Array.isArray(v.processados) || Array.isArray(v.rejeitados))
      throw new Error('Estado inválido');
    return v;
  } catch (err) {
    if (err.code === 'ENOENT') return estadoNovo();
    // Falha fechada: nunca sobrescrever estado corrompido (poderia duplicar).
    throw new Error('Estado do robô indisponível. Confira o arquivo estado.json antes de continuar.');
  }
}
async function salvarEstado(arquivo, estado) {
  const cortar = (obj) => Object.fromEntries(Object.entries(obj).slice(-MAX_REGISTROS));
  estado.processados = cortar(estado.processados);
  estado.rejeitados = cortar(estado.rejeitados);
  estado.atualizadoEm = new Date().toISOString();
  const temporario = arquivo + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temporario, JSON.stringify(estado, null, 2), { flag: 'wx', mode: 0o600 });
  try { await fs.rename(temporario, arquivo); }
  catch (e) { await fs.rm(temporario, { force: true }); throw e; }
}
export async function examinarExportacoes({
  origem, saida = null, agora = Date.now(), estabilidadeMs = MIN_ESTAVEL_MS,
} = {}) {
  if (!origem || typeof origem !== 'string') throw new Error('Informe --pasta com as exportações CSV.');
  const dir = path.resolve(origem);
  const destino = path.resolve(saida || path.join(dir, '.robo-inovafarma'));
  if (destino === dir) throw new Error('A fila não pode ser a própria pasta de origem.');
  await fs.mkdir(destino, { recursive: true, mode: 0o700 });
  const stateFile = path.join(destino, 'estado.json');
  const estado = await lerEstado(stateFile);
  const resultado = { prontos: 0, duplicados: 0, rejeitados: 0, aindaExportando: 0, itens: [] };
  const arquivos = (await fs.readdir(dir, { withFileTypes: true }))
    .filter(x => x.isFile() && !x.name.startsWith('.') && !x.name.startsWith('~') &&
      x.name.toLowerCase().endsWith('.csv'))
    .map(x => x.name).sort();
  for (const nome of arquivos) {
    const arq = path.join(dir, nome);
    const antes = await fs.lstat(arq).catch(() => null);
    if (!antes?.isFile() || antes.isSymbolicLink()) continue;
    if (antes.mtimeMs > agora || agora - antes.mtimeMs < estabilidadeMs) {
      resultado.aindaExportando++;continue;
    }
    if (antes.size < 2 || antes.size > MAX_BYTES) {
      resultado.rejeitados++;
      resultado.itens.push({ arquivo: nome, situacao: 'rejeitado', motivo: 'Limite de 8 MB ou arquivo vazio' });
      continue;
    }
    const bytes = await fs.readFile(arq).catch(() => null);
    const depois = await fs.lstat(arq).catch(() => null);
    if (!bytes || !depois?.isFile() || antes.size !== depois.size ||
      antes.mtimeMs !== depois.mtimeMs || bytes.length !== antes.size) {
      resultado.aindaExportando++;continue;
    }
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (estado.processados[hash]) { resultado.duplicados++;continue; }
    if (estado.rejeitados[hash]) { resultado.rejeitados++;continue; }
    try {
      const info = classificarExportacaoInova(bytes);
      const arquivoFila = info.tipo + '-' + hash.slice(0, 32) + '.csv';
      const copia = path.join(destino, arquivoFila);
      await fs.writeFile(copia, bytes, { flag: 'wx', mode: 0o600 }).catch(err => {
        if (err.code !== 'EEXIST') throw err;
      });
      // Protege contra arquivo de fila adulterado no disco entre execuções.
      const gravado = await fs.readFile(copia);
      if (crypto.createHash('sha256').update(gravado).digest('hex') !== hash)
        throw new Error('Cópia na fila não corresponde ao relatório original.');
      const meta = { ...info, hash, arquivoFila, detectadoEm: new Date(agora).toISOString() };
      estado.processados[hash] = meta;
      await salvarEstado(stateFile, estado);
      resultado.prontos++;
      resultado.itens.push({ ...meta, situacao: 'pronto_para_revisao' });
    } catch (err) {
      if (String(err.message).includes('Cópia na fila não corresponde')) throw err;
      estado.rejeitados[hash] = { detectadoEm: new Date(agora).toISOString(),
        motivo: String(err.message).slice(0, 200) };
      await salvarEstado(stateFile, estado);
      resultado.rejeitados++;
      resultado.itens.push({ arquivo: nome, situacao: 'rejeitado', motivo: String(err.message).slice(0, 200) });
    }
  }
  return { ...resultado, fila: destino };
}

function argumentos(argv) {
  const opts = { assistir: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--assistir') opts.assistir = true;
    else if (a === '--uma-vez') opts.assistir = false;
    else if (a === '--pasta' && argv[i+1]) opts.origem = argv[++i];
    else if (a === '--saida' && argv[i+1]) opts.saida = argv[++i];
    else if (a === '--ajuda' || a === '-h') opts.ajuda = true;
    else throw new Error('Argumento inválido: ' + a);
  }
  return opts;
}
function mostrarAjuda() {
  console.log('Robô InovaFarma (somente preparação, sem importar automaticamente)');
  console.log('Uso: node scripts/inovafarma-robo-windows.mjs --pasta "C:\\ExportacoesInova" --assistir');
  console.log('Ou:  node scripts/inovafarma-robo-windows.mjs --pasta "C:\\ExportacoesInova" --uma-vez');
}
async function main() {
  const options = argumentos(process.argv.slice(2));
  if (options.ajuda) { mostrarAjuda();return; }
  if (!options.origem) { mostrarAjuda();process.exitCode = 2;return; }
  let trabalhando = false;
  async function executar() {
    if (trabalhando) return;
    trabalhando = true;
    try {
      const r = await examinarExportacoes(options);
      console.log(new Date().toISOString(), 'Novos:', r.prontos, 'Duplicados:', r.duplicados,
        'Rejeitados:', r.rejeitados, 'Ainda exportando:', r.aindaExportando);
      for (const item of r.itens) console.log(item.situacao, item.tipo || '', item.total || '',
        item.motivo || '', item.arquivoFila || '');
      if (r.prontos) console.log('Revisar arquivos em:', r.fila);
    } catch (e) { console.error('Robô parado com segurança:', e.message);
      if (!options.assistir) process.exitCode = 1;
    } finally { trabalhando = false; }
  }
  await executar();
  if (options.assistir) {
    console.log('Monitoramento local ativo; nenhum arquivo será enviado ao site automaticamente.');
    setInterval(executar, INTERVALO_MS);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(e => { console.error(e.message);process.exitCode=1; });
