/**
 * Cofre das credenciais privadas do Mercado Pago.
 * A chave de criptografia vive SOMENTE no secret MP_CREDENTIALS_KEY do runtime,
 * nunca no Durable Object nem em backups. A conta exige um superadministrador.
 */
import crypto from 'node:crypto';
import { config } from '../../config.js';

const COLECAO = 'paymentSecrets';
const ID = 'mercadopago';
const ROTULO = 'farmacia-pague-pouco:mercadopago:v1';

function chaveValida(chave) {
  return typeof chave === 'string' && chave.length >= 32 &&
    !/^(TROQUE_|CHANGE_|INSIRA_|EXEMPLO)/i.test(chave);
}
function derivar(chave) {
  return crypto.hkdfSync('sha256', Buffer.from(chave, 'utf8'),
    Buffer.from('pp-payment-secrets-v1'), Buffer.from(ROTULO), 32);
}

function abrir(documento, chave) {
  if (!documento || !chaveValida(chave) || documento.versao !== 1) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivar(chave),
      Buffer.from(documento.iv, 'base64'));
    decipher.setAAD(Buffer.from(ROTULO));
    decipher.setAuthTag(Buffer.from(documento.tag, 'base64'));
    const clear = Buffer.concat([decipher.update(Buffer.from(documento.cifra, 'base64')), decipher.final()]);
    const dados = JSON.parse(clear.toString('utf8'));
    if (typeof dados.accessToken !== 'string' || !dados.accessToken) return null;
    return dados;
  } catch {
    // Chave trocada ou documento adulterado: jamais expor conteúdo ou cair em modo inseguro.
    return null;
  }
}

export function credenciaisMercadoPago(db) {
  const salvo = db.collection(COLECAO).get(ID);
  if (!salvo) return { ...config.payments.mp, origem: 'ambiente', legivel: true };
  const dados = abrir(salvo, config.payments.credentialsKey);
  if (!dados) return {
    accessToken: '', publicKey: '', webhookSecret: '', pixKey: '',
    sandbox: true, origem: 'painel', legivel: false,
  };
  return {
    accessToken: dados.accessToken, publicKey: dados.publicKey || '',
    webhookSecret: dados.webhookSecret || '', pixKey: '',
    sandbox: dados.ambiente === 'testes', origem: 'painel', legivel: true,
  };
}

export function estadoCredenciaisMercadoPago(db) {
  const salvo = !!db.collection(COLECAO).get(ID);
  const cfg = credenciaisMercadoPago(db);
  return {
    cofrePreparado: chaveValida(config.payments.credentialsKey),
    origem: salvo ? 'painel' : (cfg.accessToken ? 'ambiente' : 'nenhuma'),
    legivel: cfg.legivel,
    tokenConfigurado: !!cfg.accessToken,
    webhookConfigurado: !!cfg.webhookSecret,
    publicKeyConfigurada: !!cfg.publicKey,
    ambiente: cfg.sandbox ? 'testes' : 'producao',
  };
}

export function salvarCredenciaisMercadoPago(db, dados) {
  const chave = config.payments.credentialsKey;
  if (!chaveValida(chave)) {
    return { ok: false, erro: 'Configure primeiro o secret MP_CREDENTIALS_KEY na Cloudflare (mínimo de 32 caracteres).' };
  }
  const accessToken = String(dados.accessToken || '').trim();
  const publicKey = String(dados.publicKey || '').trim();
  const webhookSecret = String(dados.webhookSecret || '').trim();
  const ambiente = String(dados.ambiente || 'testes');
  if (!['testes', 'producao'].includes(ambiente)) return { ok: false, erro: 'Ambiente de pagamento inválido.' };
  if (accessToken.length < 20 || accessToken.length > 2048 || /\s/.test(accessToken)) {
    return { ok: false, erro: 'Access Token inválido. Confira o token copiado do Mercado Pago.' };
  }
  if (publicKey.length > 512 || /\s/.test(publicKey) ||
      webhookSecret.length > 512 || /\s/.test(webhookSecret)) {
    return { ok: false, erro: 'Public Key ou assinatura de webhook inválida.' };
  }
  // O Mercado Pago pode emitir Access Tokens de TESTE e PRODUÇÃO com prefixo
  // APP_USR-. Prefixo não informa o ambiente: não rejeitar token de teste válido.
  // A escolha do ambiente é responsabilidade do titular, e o painel exige uma
  // confirmação separada antes de habilitar cobranças reais.
  if (ambiente === 'producao' && accessToken.startsWith('TEST-')) {
    return { ok: false, erro: 'Token de testes informado para ambiente de produção.' };
  }
  if (ambiente === 'producao' && webhookSecret.length < 12) {
    return { ok: false, erro: 'Configure também o segredo de assinatura dos webhooks para produção.' };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivar(chave), iv);
  cipher.setAAD(Buffer.from(ROTULO));
  const cifra = Buffer.concat([cipher.update(JSON.stringify({ accessToken, publicKey, webhookSecret, ambiente }), 'utf8'), cipher.final()]);
  const documento = {
    versao: 1, iv: iv.toString('base64'), cifra: cifra.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
  const colecao = db.collection(COLECAO);
  if (colecao.get(ID)) colecao.update(ID, documento);
  else colecao.insert({ id: ID, ...documento });
  return { ok: true };
}

export function removerCredenciaisMercadoPago(db) {
  return db.collection(COLECAO).remove(ID);
}
