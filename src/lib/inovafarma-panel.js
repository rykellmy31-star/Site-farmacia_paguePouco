/**
 * Painel de preparação InovaFarma: configurações inertes e cofre isolado.
 * Nenhum método deste módulo realiza fetch nem ativa INOVA_STOCK_ENABLED.
 * Endpoint cadastrado é APENAS informativo até homologação do fornecedor.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowISO } from './store.js';
import { statusAutomaticoInova } from './inovafarma-automation.js';

const CONFIG_ID = 'integracao';
const SECRET_ID = 'inovafarma';
const ROTULO = 'farmacia-pague-pouco:inova-secrets:v1';
const INTERVALOS = new Set([5, 15, 30, 60]);
const EVENTOS_VALIDOS = new Set(['configuracao_salva', 'credencial_substituida', 'credencial_removida']);

const chaveValida = (key) => typeof key === 'string' && key.length >= 32 &&
  !/^(TROQUE_|CHANGE_|INSIRA_|EXEMPLO)/i.test(key);
const derivar = key => crypto.hkdfSync('sha256', Buffer.from(key),
  Buffer.from('pp-inova-secrets-v1'), Buffer.from(ROTULO), 32);

/** Não permite IP, hosts privados, portas arbitrárias ou credenciais embutidas. */
export function validarEnderecoConector(entrada) {
  const valor = String(entrada || '').trim();
  if (!valor) return { ok: true, url: '' };
  if (valor.length > 250 || /[\s\\]/.test(valor)) return { ok: false, erro: 'Endereço inválido.' };
  let url;
  try { url = new URL(valor); } catch { return { ok: false, erro: 'Informe uma URL HTTPS válida.' }; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      url.search || (url.port && url.port !== '443') ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      /\.(?:local|localhost|internal|invalid|test|example)$/i.test(host) ||
      /^(?:localhost|metadata|169\.254\.169\.254)$/i.test(host) ||
      /(?:^|\.)\d+(?:\.\d+){3}$/.test(host)) {
    return { ok: false, erro: 'Somente endereço HTTPS público por hostname, sem IP, consulta ou porta alternativa.' };
  }
  return { ok: true, url: url.href.replace(/\/$/, '') };
}

export function salvarConfiguracaoInova(db, dados) {
  const endereco = validarEnderecoConector(dados?.urlConector);
  if (!endereco.ok) return endereco;
  const estabelecimento = String(dados?.estabelecimento || '').trim();
  const intervaloMinutos = Number(dados?.intervaloMinutos ?? 15);
  if (estabelecimento.length > 80 || /[<>\x00-\x1f]/.test(estabelecimento))
    return { ok: false, erro: 'Identificador do estabelecimento inválido.' };
  if (!INTERVALOS.has(intervaloMinutos))
    return { ok: false, erro: 'Intervalo deve ser 5, 15, 30 ou 60 minutos.' };
  const cols = db.collection('inovaPanelConfig');
  const atual = cols.get(CONFIG_ID);
  const registro = {
    urlConector: endereco.url,
    estabelecimento,
    intervaloMinutos,
    metodoAutenticacao: 'aguardando_documentacao',
    homologado: false, // Não é possível habilitar pelo painel sem contrato oficial.
    atualizadoEm: nowISO(),
  };
  if (atual) cols.update(CONFIG_ID, registro);
  else cols.insert({ id: CONFIG_ID, ...registro });
  registrarEventoInova(db, 'configuracao_salva');
  return { ok: true };
}

export function armazenarCredencialInova(db, valor) {
  const key = config.inova?.credentialsKey;
  if (!chaveValida(key)) return { ok: false, erro: 'Configure antes o Secret INOVA_CREDENTIALS_KEY na Cloudflare (mínimo de 32 caracteres).' };
  const token = String(valor ?? '').trim();
  if (token.length < 20 || token.length > 2048 || /\s/.test(token))
    return { ok: false, erro: 'Credencial deve ter 20 a 2048 caracteres, sem espaços.' };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivar(key), iv);
  cipher.setAAD(Buffer.from(ROTULO));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const documento = {
    versao: 1, iv: iv.toString('base64'), cifra: encrypted.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), atualizadoEm: nowISO(),
  };
  const cols = db.collection('inovaSecrets');
  if (cols.get(SECRET_ID)) cols.update(SECRET_ID, documento);
  else cols.insert({ id: SECRET_ID, ...documento });
  registrarEventoInova(db, 'credencial_substituida');
  return { ok: true };
}

export function apagarCredencialInova(db) {
  db.collection('inovaSecrets').remove(SECRET_ID);
  registrarEventoInova(db, 'credencial_removida');
  return { ok: true };
}

/** Retorna somente booleanos, nunca tenta revelar valor. */
export function estadoCredencialInova(db) {
  const documento = db.collection('inovaSecrets').get(SECRET_ID);
  const key = config.inova?.credentialsKey;
  let legivel = false;
  if (documento && chaveValida(key)) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivar(key), Buffer.from(documento.iv, 'base64'));
      decipher.setAAD(Buffer.from(ROTULO));
      decipher.setAuthTag(Buffer.from(documento.tag, 'base64'));
      const conteudo = Buffer.concat([decipher.update(Buffer.from(documento.cifra, 'base64')), decipher.final()]);
      legivel = conteudo.length >= 20;
    } catch { legivel = false; }
  }
  return { chaveDisponivel: chaveValida(key), cadastrada: !!documento, legivel };
}

function registrarEventoInova(db, tipo) {
  if (!EVENTOS_VALIDOS.has(tipo)) return;
  db.collection('inovaPanelEvents').insert({ tipo, criadoEm: nowISO() });
}

export function diagnosticoInova(db) {
  const configuracao = db.collection('inovaPanelConfig').get(CONFIG_ID) || null;
  const automatico = statusAutomaticoInova(db);
  const segredo = estadoCredencialInova(db);
  const sync = db.collection('inovaSyncMeta').get('estoque') || null;
  const eventos = db.collection('inovaStockSync').all().slice(-10).reverse();
  const docs = db.collection('orders').all();
  const fila = docs.filter(p => p.inovaEnvioPendente === true && !p.inovaConfirmadoEm &&
    p.statusFinanceiro === 'aprovado' && p.statusOperacional !== 'cancelado');
  const confirmadas = docs.filter(p => !!p.inovaConfirmadoEm);
  const erros = db.collection('inovaPanelEvents').all().slice(-25).reverse();
  const produtos = db.collection('products').all().filter(p => p.ativo !== false);
  const semEAN = produtos.filter(p => !/^\d{8,14}$/.test(String(p.ean || ''))).length;
  const divergentes = produtos.filter(p => Number.isSafeInteger(p.estoque?.inovaQuantidade) &&
    Number(p.estoque.quantidade) !== p.estoque.inovaQuantidade).length;
  const dataSync = Date.parse(sync?.recebidoEm || '');
  const idadeMaxima = Math.max(1, config.inova?.maxAgeMinutes || 15) * 60_000;
  const estoqueDesatualizado = !Number.isFinite(dataSync) ||
    Date.now() - dataSync > idadeMaxima;
  const faltaEANnaFila = fila.filter(p => (p.itens || []).some(it => !/^\d{8,14}$/.test(
    String(it.ean || db.collection('products').get(it.produtoId)?.ean || '')))).length;
  return {
    status: config.inova?.enabled ?
      (!automatico.ultimaConexaoValidada ? 'aguardando_primeira_comunicacao' :
        automatico.status === 'atencao' ? 'integracao_com_pendencias' : 'conectada_por_conector') :
      configuracao?.urlConector && segredo.legivel ? 'configurada_nao_conectada' : 'desativada',
    configuracao, segredo, automatico,
    // Somente webhook autenticado e aceito marca comunicação real bem-sucedida.
    ultimaConexaoValidada: automatico.ultimaConexaoValidada,
    estoque: {
      ultimaSincronizacao: sync?.recebidoEm || null,
      quantidadeUltimoLote: eventos[0]?.total ?? 0,
      divergencias: divergentes, semCorrespondenciaEAN: semEAN,
      desatualizado: estoqueDesatualizado,
    },
    vendas: { pendentes: fila.length, confirmadas: confirmadas.length,
      conferir: automatico.vendasParaConferir,
      pendentesDetalhes: fila.slice(0, 25).map(p => ({
        id: p.id, codigo: String(p.codigo || ''), criadoEm: p.criadoEm,
        statusFinanceiro: p.statusFinanceiro, totalCentavos: p.totalCentavos,
        vendedorCodigo: p.vendedor?.codigoInova || null,
      })),
    },
    eventos, auditoria: erros, vendedores: {
      ativos: db.collection('sellers').all().filter(v => v.ativo === true).length,
      vinculados: docs.filter(p => !!p.vendedor?.id).length,
    },
  };
}
