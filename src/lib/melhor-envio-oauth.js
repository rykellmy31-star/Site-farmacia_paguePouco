/**
 * Melhor Envio — autorização OAuth2 com estado de sessão, token criptografado
 * e renovação sob demanda. Somente escopo shipping-calculate.
 *
 * Client ID, Secret e chave AES vivem SOMENTE em secrets do Worker.
 * Os tokens cifrados persistem no banco, e NUNCA são expostos ao navegador.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

export const MELHOR_ENVIO_CALLBACK = 'https://site.farmaciapaguepouco.app/admin/melhor-envio/callback';
const COLLECTION = 'shippingSecrets';
const DOC_ID = 'melhor-envio-oauth';
const AAD = 'farmacia-pague-pouco:melhor-envio-oauth:v1';

const validKey = key => typeof key === 'string' && key.length >= 32 &&
  !/^(TROQUE_|CHANGE_|INSIRA_|EXEMPLO)/i.test(key);
const baseUrl = () => config.melhorEnvio?.sandbox
  ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br';
const deriveKey = key => crypto.hkdfSync('sha256', Buffer.from(key, 'utf8'),
  Buffer.from('pp-melhor-envio-oauth-v1'), Buffer.from(AAD), 32);

function seal(payload) {
  const key = config.melhorEnvio?.credentialsKey;
  if (!validKey(key)) throw new Error('Configure MELHOR_ENVIO_CREDENTIALS_KEY (32+ caracteres) na Cloudflare.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key), iv);
  cipher.setAAD(Buffer.from(AAD));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { versao: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    cifra: ciphertext.toString('base64') };
}

function unseal(doc) {
  if (!doc || doc.versao !== 1 || !validKey(config.melhorEnvio?.credentialsKey)) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm',
      deriveKey(config.melhorEnvio.credentialsKey), Buffer.from(doc.iv, 'base64'));
    decipher.setAAD(Buffer.from(AAD));
    decipher.setAuthTag(Buffer.from(doc.tag, 'base64'));
    const raw = Buffer.concat([decipher.update(Buffer.from(doc.cifra, 'base64')), decipher.final()]);
    const value = JSON.parse(raw.toString('utf8'));
    if (typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' ||
        !value.accessToken || !value.refreshToken) return null;
    return value;
  } catch {
    return null; // Chave errada ou documento adulterado: falhar fechado.
  }
}

export function estadoOAuthMelhorEnvio(db) {
  const doc = db.collection(COLLECTION).get(DOC_ID);
  const tokens = unseal(doc);
  return {
    conectado: !!tokens,
    credenciaisAplicativo: !!(config.melhorEnvio?.clientId && config.melhorEnvio?.clientSecret),
    cofrePreparado: validKey(config.melhorEnvio?.credentialsKey),
    contatoConfigurado: !!config.melhorEnvio?.contato,
    expiraEm: tokens ? new Date(tokens.expiresAt).toISOString() : null,
    ilegivel: !!doc && !tokens,
  };
}

export function iniciarOAuthMelhorEnvio(db, session) {
  const cfg = config.melhorEnvio || {};
  if (!session || !cfg.clientId || !cfg.clientSecret || !cfg.contato || !validKey(cfg.credentialsKey))
    return {ok: false, erro:'Configure MELHOR_ENVIO_CLIENT_ID, MELHOR_ENVIO_CLIENT_SECRET, MELHOR_ENVIO_CREDENTIALS_KEY e MELHOR_ENVIO_CONTATO_EMAIL nos segredos da Cloudflare.'};
  const state = crypto.randomBytes(32).toString('hex');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000;
  db.collection('sessions').update(session.id, {melhorEnvioOauth: {stateHash, expiresAt}});
  const url = new URL(baseUrl() + '/oauth/authorize');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', MELHOR_ENVIO_CALLBACK);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'shipping-calculate');
  url.searchParams.set('state', state);
  return {ok:true,url:url.toString()};
}

export function consumirEstadoOAuthMelhorEnvio(db, session, state) {
  if (!session || typeof state !== 'string' || state.length < 40 || state.length > 128) return false;
  const latest = db.collection('sessions').get(session.id);
  const flow = latest?.melhorEnvioOauth;
  // Invalida ANTES da chamada externa. Não aceitar reuso do mesmo callback.
  if (flow) db.collection('sessions').update(session.id, {melhorEnvioOauth: null});
  if (!flow || !Number.isFinite(flow.expiresAt) || flow.expiresAt < Date.now()) return false;
  const expected = Buffer.from(flow.stateHash || '', 'hex');
  const received = crypto.createHash('sha256').update(state).digest();
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function requestToken(payload, {fetcher=globalThis.fetch, timeoutMs=8000}={}) {
  const cfg = config.melhorEnvio || {};
  if (!cfg.clientId || !cfg.clientSecret || !validKey(cfg.credentialsKey)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(baseUrl() + '/oauth/token', {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json',
        'User-Agent':'Farmacia Pague Pouco (' + cfg.contato + ')'},
      body:JSON.stringify({ ...payload, client_id:cfg.clientId, client_secret:cfg.clientSecret }),
      signal:controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' ||
        data.access_token.length < 20 || data.refresh_token.length < 20) return null;
    const now = Date.now();
    const life = Number(data.expires_in);
    return {
      accessToken:data.access_token,
      refreshToken:data.refresh_token,
      expiresAt:now + (Number.isFinite(life) && life > 0 ? life : 30 * 86400) * 1000,
      refreshExpiresAt: now + 45 * 86400 * 1000,
      sandbox: !!cfg.sandbox,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function storeTokens(db, payload) {
  const sealed = seal(payload);
  const collection = db.collection(COLLECTION);
  if (collection.get(DOC_ID)) collection.update(DOC_ID, sealed);
  else collection.insert({id:DOC_ID, ...sealed});
}

export async function autorizarOAuthMelhorEnvio(db, code, opts={}) {
  if (typeof code !== 'string' || !code || code.length > 2048)
    return {ok:false,erro:'Código de autorização inválido.'};
  const tokens = await requestToken({grant_type:'authorization_code',code,
    redirect_uri:MELHOR_ENVIO_CALLBACK}, opts);
  if (!tokens) return {ok:false,erro:'Não foi possível concluir a autorização. Confira Client ID, Secret e URL de retorno.'};
  storeTokens(db, tokens);
  return {ok:true};
}

const refreshing = new Map();
export async function tokenOAuthMelhorEnvio(db, opts={}) {
  if (!db) return '';
  const old = unseal(db.collection(COLLECTION).get(DOC_ID));
  if (!old || old.sandbox !== !!config.melhorEnvio?.sandbox) return '';
  if (old.expiresAt - Date.now() > 60 * 60 * 1000) return old.accessToken;
  if (!old.refreshToken || old.refreshExpiresAt < Date.now()) return '';
  if (refreshing.has(db)) return refreshing.get(db);
  const task = (async () => {
    const result = await requestToken({grant_type:'refresh_token',
      refresh_token:old.refreshToken}, opts);
    if (!result) return '';
    storeTokens(db, result);
    return result.accessToken;
  })();
  refreshing.set(db, task);
  try { return await task; } finally { refreshing.delete(db); }
}

export function desconectarOAuthMelhorEnvio(db) {
  return db.collection(COLLECTION).remove(DOC_ID);
}
