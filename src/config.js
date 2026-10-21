/**
 * config.js — Configuração central.
 * Regra: SEGREDOS e infraestrutura vêm de variáveis de ambiente (.env).
 *        DADOS DE NEGÓCIO (fretes, WhatsApp, banners, textos, aparência,
 *        meios de pagamento habilitados) vêm do banco e são editados no painel.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// WebSocketPair identifica o runtime Workers sem executar I/O no escopo global.
export const IS_CLOUDFLARE = typeof WebSocketPair !== 'undefined';
export const ROOT = IS_CLOUDFLARE ? '/' : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env simples (sem dependências)
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
if (!IS_CLOUDFLARE) loadEnv(path.join(ROOT, '.env'));

const bool = (v, def = false) => {
  if (v == null || v === '') return def;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(String(v).toLowerCase());
};
const int = (v, def) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
};

function resolveSecret() {
  if (IS_CLOUDFLARE) return ''; // Preenchido com segredo persistente do Durable Object.
  const env = process.env.SESSION_SECRET;
  if (env && env !== 'TROQUE_ESTE_VALOR_POR_UMA_CHAVE_ALEATORIA_LONGA') return env;
  const secretPath = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'), '.session-secret');
  try {
    if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
    const generated = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    console.warn('[config] SESSION_SECRET não definido: gerado automaticamente em', secretPath);
    return generated;
  } catch {
    return 'insecure-dev-secret-change-me';
  }
}

export const config = {
  isCloudflare: IS_CLOUDFLARE,
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  isDev: bool(process.env.DEV_MODE, true),
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  publicDir: path.join(ROOT, 'public'),
  uploadsDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'), 'uploads'),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`).replace(/\/$/, ''),
  sessionSecret: resolveSecret(),
  sessionCookie: 'pp_sess',
  csrfCookie: 'pp_csrf',
  cartCookie: 'pp_cart',
  sessionTTLHours: int(process.env.SESSION_TTL_HOURS, 24 * 30),
  adminSessionTTLHours: int(process.env.ADMIN_SESSION_TTL_HOURS, 12),
  trustProxy: bool(process.env.TRUST_PROXY, true),
  payments: {
    credentialsKey: process.env.MP_CREDENTIALS_KEY || '',
    provider: (process.env.PAYMENT_PROVIDER || 'internal').toLowerCase(),
    mp: {
      accessToken: process.env.MP_ACCESS_TOKEN || '',
      publicKey: process.env.MP_PUBLIC_KEY || '',
      webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
      sandbox: bool(process.env.MP_SANDBOX, true),
      pixKey: process.env.MP_PIX_KEY || '',
    },
  },
  cep: {
    viacep: bool(process.env.VIACEP_ENABLED, false),
    timeoutMs: int(process.env.VIACEP_TIMEOUT_MS, 3500),
  },
  uploads: {
    maxImageBytes: int(process.env.MAX_IMAGE_BYTES, 8 * 1024 * 1024),
    maxVideoBytes: int(process.env.MAX_VIDEO_BYTES, 64 * 1024 * 1024),
    imageOptimize: bool(process.env.IMAGE_OPTIMIZE, false),
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'no-reply@paguepouco.com.br',
    enabled: bool(process.env.SMTP_HOST, false),
  },
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    loginMax: int(process.env.RATE_LIMIT_LOGIN, 8),
    apiMax: int(process.env.RATE_LIMIT_API, 240),
    checkoutMax: int(process.env.RATE_LIMIT_CHECKOUT, 20),
  },
};

export const isProduction = () => config.env === 'production';

/** Configuração por binding, sem .env ou escritas no filesystem do Worker. */
export function configureCloudflare(env, origin, persistentSecret) {
  config.isCloudflare = true;
  config.env = 'production';
  config.isDev = false;
  config.root = '/';
  config.dataDir = '/data';
  config.publicDir = '/public';
  config.uploadsDir = '/data/uploads';
  config.publicBaseUrl = String(env.PUBLIC_BASE_URL || origin).replace(/\/$/, '');
  config.sessionSecret = env.SESSION_SECRET || persistentSecret;
  config.trustProxy = true;
  config.payments.provider = String(env.PAYMENT_PROVIDER || 'internal').toLowerCase();
  config.payments.credentialsKey = env.MP_CREDENTIALS_KEY || '';
  config.payments.mp = {
    accessToken: env.MP_ACCESS_TOKEN || '', publicKey: env.MP_PUBLIC_KEY || '',
    webhookSecret: env.MP_WEBHOOK_SECRET || '', pixKey: env.MP_PIX_KEY || '',
    sandbox: bool(env.MP_SANDBOX, true),
  };
  config.cep.viacep = bool(env.VIACEP_ENABLED, false);
  // Limite de memória do runtime: uploads de vídeo até 16 MiB por arquivo.
  config.uploads.maxImageBytes = Math.min(int(env.MAX_IMAGE_BYTES, 8 * 1024 * 1024), 8 * 1024 * 1024);
  config.uploads.maxVideoBytes = Math.min(int(env.MAX_VIDEO_BYTES, 16 * 1024 * 1024), 16 * 1024 * 1024);
  config.uploads.imageOptimize = false;
  config.mail.enabled = false; // No Worker, e-mails ficam na fila privada persistente.
  config.mail.from = env.MAIL_FROM || 'no-reply@paguepouco.com.br';
}
