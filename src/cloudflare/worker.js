/**
 * Entrada Cloudflare Workers. Um único Durable Object coordena esta loja.
 * Não alterar o nome "loja-principal-v1": ele identifica o banco persistente.
 */
import { DurableObject } from 'cloudflare:workers';
import { configureCloudflare } from '../config.js';
import { createApplication } from '../app.js';
import { hashPassword, randomToken } from '../lib/security.js';
import { CloudStore } from './store.js';
import { RequestQueue } from './request-queue.js';
import { adicionarCreditoDesenvolvedor } from '../lib/developer-credit.js';
import { executarAlarmeFinanceiro } from '../lib/payments/alarm-runner.js';
import {
  reconciliarPix, temPixPendente, reconciliarEstornos, temEstornoPendente,
  temCheckoutInterrompido, reconciliarCheckoutsInterrompidos,
} from '../lib/payments/reconciliation.js';
import initialData from '../../.cloudflare/seed.json';

export class LojaDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.bindings = env;
    this.queue = new RequestQueue();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.db = new CloudStore(ctx.storage);
      const meta = this.db.collection('__meta');
      if (!meta.get('session-secret')) {
        meta.insert({ id: 'session-secret', value: randomToken(48) });
      }
      this.secret = meta.get('session-secret').value;
      if (!meta.get('catalog-seeded-v1')) {
        ctx.storage.transactionSync(() => {
          // Somente catálogo: nunca importa admins, clientes, sessões ou pedidos do ZIP.
          for (const [name, documents] of Object.entries(initialData)) {
            if (!['settings', 'categories', 'products', 'pages', 'banners', 'showcases', 'coupons'].includes(name)) continue;
            const col = this.db.collection(name);
            if (!col.count()) for (const doc of documents) col.insert(doc);
          }
          meta.insert({ id: 'catalog-seeded-v1', value: true });
        });
      }
      await this.db.flush();
    });
  }

  fetch(request) {
    return this.queue.run(async () => {
      await this.ready;
      const url = new URL(request.url);
      configureCloudflare(this.bindings, url.origin, this.secret);
      const admins = this.db.collection('admins');
      const email = String(this.bindings.ADMIN_EMAIL || '').trim().toLowerCase();
      const password = String(this.bindings.ADMIN_PASSWORD || '');
      if (!admins.count() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length >= 12) {
        admins.insert({
          id: 'bootstrap-super-admin', nome: 'Super Administrador', email,
          senhaHash: hashPassword(password), role: 'super_admin', ativo: true,
          criadoEm: new Date().toISOString(), ultimoAcesso: null, deveTrocarSenha: false,
        });
      }
      if (!this.app) this.app = createApplication(this.db);
      if (url.pathname === '/__health') {
        return Response.json({ ok: true, runtime: 'cloudflare-workers', storage: 'durable-object-sqlite' },
          { headers: { 'Cache-Control': 'no-store' } });
      }
      if ((url.pathname === '/admin' || url.pathname.startsWith('/admin/')) && !admins.count()) {
        return new Response(adicionarCreditoDesenvolvedor('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Configurar administrador</title>' +
          '<link rel="stylesheet" href="/styles.css"><body>' +
          '<h1>Configure o primeiro administrador</h1><p>No painel da Cloudflare, em Configurações → Variáveis e segredos, ' +
          'adicione ADMIN_EMAIL e o segredo ADMIN_PASSWORD, com pelo menos 12 caracteres. Salve e implante a nova versão.</p>' +
          '<p>Depois, volte a /admin. Nenhuma senha de demonstração é aceita neste ambiente.</p></body></html>'),
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' } });
      }
      const response = await this.app.fetch(request, {
        db: this.db, env: this.bindings,
        ip: request.headers.get('x-pague-pouco-ip') || 'unknown',
      });
      await this.db.flush(); // Não confirma sucesso antes da persistência.
      await this.programarAlarmeFinanceiro();
      return response;
    }).catch(err => {
      console.error('[worker] falha ao atender requisição:', err.message);
      return new Response('Não foi possível processar a solicitação. Tente novamente.',
        { status: 500, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
    });
  }
  // Durable Object Alarms: Pix e estornos não dependem de visitas do cliente.
  async programarAlarmeFinanceiro() {
    if (!temPixPendente(this.db) && !temEstornoPendente(this.db) &&
        !temCheckoutInterrompido(this.db)) return;
    const atual = await this.ctx.storage.getAlarm();
    if (atual == null) await this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
  }

  async alarm() {
    return this.queue.run(async () => {
      await this.ready;
      // Alarmes não possuem Request/Origin. Usar o domínio oficial enquanto
      // PUBLIC_BASE_URL ainda não foi configurada na Cloudflare.
      configureCloudflare(this.bindings, this.bindings.PUBLIC_BASE_URL || 'https://site.farmaciapaguepouco.app', this.secret);
      if (!this.app) this.app = createApplication(this.db);
      await executarAlarmeFinanceiro({
        pedidos: () => reconciliarCheckoutsInterrompidos(this.db),
        pix: () => reconciliarPix(this.db),
        estornos: () => reconciliarEstornos(this.db),
        persistir: () => this.db.flush(),
        reagendar: () => this.programarAlarmeFinanceiro(),
        registrar: (fluxo, problema) =>
          console.warn('[alarme financeiro]', fluxo, problema),
      });
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Somente arquivos públicos selecionados são publicados pelo build.
    if (['GET', 'HEAD'].includes(request.method) &&
      (/^\/(styles\.css|js\/|img\/)/.test(url.pathname) || /^\/uploads\/(seed|banners)\//.test(url.pathname))) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    const headers = new Headers(request.headers);
    // Sobrescreve cabeçalhos fornecidos pelo cliente; o painel não confia em X-Forwarded-For.
    headers.set('x-pague-pouco-ip', request.headers.get('cf-connecting-ip') || 'unknown');
    const forwarded = new Request(request, { headers });
    const id = env.LOJA.idFromName('loja-principal-v1');
    return env.LOJA.get(id).fetch(forwarded);
  },
};
