/**
 * app.js — Rotas e middlewares compartilhados entre Node.js e Cloudflare.
 *
 * Recebe o banco persistente do runtime e registra middlewares de
 * segurança (sessão, CSRF, rate limit) e monta todas as rotas do site, da API,
 * da conta do cliente, do checkout, dos webhooks e do painel administrativo.
 */
import { config } from './config.js';
import { uid } from './lib/store.js';
import { vincularCarrinhoAoCliente } from './lib/cart.js';
import { createApp } from './lib/http.js';
import { readSession, csrfOk, escapeHtml, randomToken, csrfField } from './lib/security.js';
import { ensureSettings } from './lib/settings.js';
import { logSystem } from './lib/audit.js';
import { rateLimitMiddleware } from './lib/security.js';
import { registrarRotasPublicas, paginaNaoEncontrada } from './routes/public.js';
import { registrarRotasApi } from './routes/api.js';
import { registrarRotasConta } from './routes/account.js';
import { registrarRotasCheckout } from './routes/checkout.js';
import { registrarRotasWebhook } from './routes/webhooks.js';
import { registrarRotasInovafarma } from './routes/inovafarma.js';
import { registrarRotasRoboInova } from './routes/inovafarma-robo.js';
import { registrarRotasAdmin } from './routes/admin.js';

export function createApplication(db) {
ensureSettings(db);
if (!db.collection('counters').get('pedido')) {
  db.collection('counters').insert({ id: 'pedido', ano: new Date().getFullYear(), sequencia: 1 });
}

const app = createApp();

/* ------------------------------------------------------------------ */
/* Middlewares de segurança                                            */
/* ------------------------------------------------------------------ */
const ASSET_RE = /^\/(styles\.css|js\/|img\/|uploads\/|favicon|manifest|robots\.txt|sitemap\.xml)/;

app.use(async (req, res) => {
  req.startedAt = Date.now();

  // sessões
  const sid = req.cookies[config.sessionCookie];
  req.session = sid ? readSession(db, sid) : null;
  req.user = null;
  if (req.session && req.session.type === 'customer') {
    const c = db.collection('customers').get(req.session.userId);
    req.user = c && c.ativo !== false ? c : null;
    if (!req.user) req.session = null;
  }
  const aid = req.cookies['pp_admin_sess'];
  req.adminSession = aid ? readSession(db, aid) : null;
  req.adminUser = null;
  if (req.adminSession && req.adminSession.type === 'admin') {
    const a = db.collection('admins').get(req.adminSession.userId);
    req.adminUser = a && a.ativo ? a : null;
    if (!req.adminUser) req.adminSession = null;
  }

  // token CSRF para visitantes sem sessão (cookie de dupla submissão)
  if (!ASSET_RE.test(req.path) && !req.cookies.pp_csrf) {
    const token = randomToken(24);
    res.cookie('pp_csrf', token, { maxAge: 60 * 60 * 24 * 365, path: '/', httpOnly: false, sameSite: 'Lax' });
    req.cookies.pp_csrf = token;
  }

  // carrinho (cookie próprio, criado apenas em navegação de página)
  if (!ASSET_RE.test(req.path) && !req.cookies[config.cartCookie] && (req.method === 'GET' || req.path.startsWith('/api/carrinho'))) {
    const cart = db.collection('carts').insert({
      id: `c_${uid()}`, clienteId: req.user?.id || null, itens: [], cupom: null, frete: null,
      criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
    });
    res.cookie(config.cartCookie, cart.id, { maxAge: 60 * 60 * 24 * 180, path: '/', httpOnly: false });
    req.cookies[config.cartCookie] = cart.id;
  }

  // Se o cliente chega autenticado com cookie de cesta pertencente
  // a OUTRA conta (por exemplo em computador compartilhado), substitua
  // o cookie antes de qualquer página carregar dados da cesta anterior.
  if (!ASSET_RE.test(req.path) && req.user?.id && req.cookies[config.cartCookie]) {
    const anterior = req.cookies[config.cartCookie];
    const seguro = vincularCarrinhoAoCliente(db, anterior, req.user.id);
    if (seguro && seguro !== anterior) {
      res.cookie(config.cartCookie, seguro, {
        maxAge: 60 * 60 * 24 * 180, path: '/', httpOnly: false,
      });
      req.cookies[config.cartCookie] = seguro;
    }
  }

  // headers de segurança
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (!config.isDev) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

// Uma senha provisória não permite utilizar endpoints administrativos,
// nem consultar pedidos, exports ou ações de gerenciamento. A restrição
// vale no servidor para HTML, JSON e downloads, não apenas para menus.
app.use(async (req, res) => {
  if (!req.path.startsWith('/admin') || req.adminUser?.deveTrocarSenha !== true) return;
  if (['/admin/login', '/admin/sair', '/admin/alterar-senha'].includes(req.path)) return;
  res.set('Cache-Control', 'no-store');
  if (req.path.startsWith('/admin/api/')) {
    return void res.json({
      ok: false, erro: 'Defina sua senha pessoal antes de utilizar o painel.',
      alterarSenha: '/admin/alterar-senha',
    }, 403);
  }
  return void res.redirect('/admin/alterar-senha');
});

// Injeta automaticamente o campo oculto de CSRF em TODO formulário POST
// renderizado pelo servidor (evita esquecimento e garante a proteção na prática)
app.use(async (req, res) => {
  const original = res.html.bind(res);
  res.html = (corpo, code) => {
    if (typeof corpo === 'string' && corpo.includes('<form')) {
      corpo = corpo.replace(/<form\b([^>]*)>/gi, (m, attrs) => {
        if (!/method\s*=\s*["']?post/i.test(attrs)) return m;
        // não duplica quando o formulário já traz o campo (ex.: telas do painel)
        const fim = corpo.indexOf('</form>', corpo.indexOf(m));
        const trecho = corpo.slice(corpo.indexOf(m), fim < 0 ? corpo.length : fim);
        return /name=["']_csrf["']/.test(trecho) ? m : m + csrfField(req);
      });
    }
    return original(corpo, code);
  };
});

// CSRF: exige token em toda mutação (exceto webhooks, que usam assinatura)
app.use(async (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.path.startsWith('/webhooks/')) return;
  if (!csrfOk(req)) {
    logSystem(db, 'security', `CSRF rejeitado em ${req.method} ${req.path}`, { ip: req.ip });
    const json = req.path.startsWith('/api/') || req.headers['x-requested-with'] === 'fetch' || req.path.startsWith('/admin/api/');
    const mensagem = 'Sua sessão expirou ou a requisição não pôde ser validada. Recarregue a página e tente novamente.';
    if (json) res.json({ ok: false, erro: mensagem }, 403);
    else res.html(`<h1>403 — Requisição não validada</h1><p>${escapeHtml(mensagem)}</p><a href="/">Voltar ao início</a>`, 403);
  }
});

// Rate limiting por escopo
const limiteLogin = rateLimitMiddleware('login', config.rateLimit.loginMax);
const limiteCheckout = rateLimitMiddleware('checkout', config.rateLimit.checkoutMax);
app.use(async (req, res) => {
  const p = req.path;
  // Limite tentativas de ENVIO, não visualizações GET do formulário.
  // A regra anterior bloqueava clientes apenas por navegar entre login,
  // cadastro e checkout, mesmo sem tentar autenticar ou finalizar.
  if (req.method === 'POST' &&
    (p === '/conta/login' || p === '/conta/cadastro' ||
      p === '/conta/esqueci-senha' || p === '/admin/login')) {
    return limiteLogin(req, res);
  }
  if (req.method === 'POST' && (p.startsWith('/checkout') || p === '/api/frete')) {
    return limiteCheckout(req, res);
  }
});

/* ------------------------------------------------------------------ */
/* Imagens dinâmicas                                                   */
/* ------------------------------------------------------------------ */
app.get('/img/produto.svg', (req, res) => {
  const nome = String(req.query.get('nome') || 'Produto').slice(0, 60);
  const marca = String(req.query.get('marca') || 'Pague Pouco').slice(0, 30);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="${escapeHtml(nome)}">
  <rect width="400" height="400" fill="#eef4f1"/>
  <circle cx="200" cy="170" r="86" fill="#ffffff"/>
  <text x="200" y="196" font-family="system-ui, sans-serif" font-size="80" font-weight="700" text-anchor="middle" fill="#0a6b48">${escapeHtml((marca || 'P').charAt(0).toUpperCase())}</text>
  <text x="200" y="312" font-family="system-ui, sans-serif" font-size="18" font-weight="600" text-anchor="middle" fill="#1b2b26">${escapeHtml(marca)}</text>
  <text x="200" y="340" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle" fill="#5b6b64">Imagem ilustrativa</text>
</svg>`;
  res.set('Cache-Control', 'public, max-age=86400');
  res.text(svg, 200, 'image/svg+xml');
});

/* ------------------------------------------------------------------ */
/* Rotas                                                               */
/* ------------------------------------------------------------------ */
registrarRotasPublicas(app, db);
registrarRotasApi(app, db);
registrarRotasConta(app, db);
registrarRotasCheckout(app, db);
registrarRotasAdmin(app, db);
registrarRotasWebhook(app, db);
registrarRotasInovafarma(app, db);
registrarRotasRoboInova(app, db);

/* Arquivos estáticos (css, js, imagens e uploads) — ficam por último para
   que as rotas da aplicação tenham prioridade; o que não for arquivo nem
   rota cai na página 404. */
app.static('/uploads', config.uploadsDir, { maxAge: 604800 });
app.static('', config.publicDir, { maxAge: 600, notFound: paginaNaoEncontrada(db) });

/* ------------------------------------------------------------------ */
/* Tratamento de erros                                                 */
/* ------------------------------------------------------------------ */
app.onError = async (err, req, res) => {
  const status = err.status || 500;
  if (status >= 500) logSystem(db, 'error', `${req.method} ${req.path} → ${err.message}`, { stack: String(err.stack || '').slice(0, 800), ip: req.ip });
  else logSystem(db, 'warn', `${req.method} ${req.path} → ${err.message}`);

  const json = req.path.startsWith('/api/') || req.path.startsWith('/admin/api/') || req.headers['x-requested-with'] === 'fetch';
  const msg = status >= 500 ? 'Ocorreu um erro inesperado. Nossa equipe técnica já foi notificada.' : err.message;
  if (res._ended) return;
  if (json) return void res.json({ ok: false, erro: msg }, status);
  res.html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/styles.css"><title>Erro ${status}</title></head>
    <body style="display:flex;align-items:center;justify-content:center;min-height:100vh">
    <div class="pagina-conteudo texto-centro" style="max-width:520px">
      <h1>${status}</h1><p>${escapeHtml(msg)}</p>
      <p><a class="botao" href="/">Voltar à página inicial</a></p>
    </div></body></html>`, status);
};


return app;
}
