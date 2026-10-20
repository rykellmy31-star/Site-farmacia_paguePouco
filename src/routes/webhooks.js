/**
 * routes/webhooks.js — Notificações de pagamento.
 *
 * Regra de segurança: NENHUM pedido é marcado como pago apenas com base no corpo
 * da requisição. O Mercado Pago é consultado (fonte autoritativa) e/ou a
 * assinatura é validada. Eventos repetidos são ignorados (idempotência).
 */
import { atualizarStatusFinanceiro, adicionarHistorico } from '../lib/orders.js';
import { handleWebhook } from '../lib/payments/index.js';
import { logSystem } from '../lib/audit.js';
import { escapeHtml } from '../lib/security.js';

function jaProcessado(db, chave) {
  if (!chave) return false;
  return !!db.collection('webhookEvents').findOne((w) => w.chave === chave);
}

function registrarEvento(db, chave, provider, corpo, resultado) {
  return db.collection('webhookEvents').insert({
    chave: chave || `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    provider,
    corpo: typeof corpo === 'string' ? corpo.slice(0, 2000) : (corpo ? JSON.stringify(corpo).slice(0, 2000) : ''),
    resultado: resultado || {},
    criadoEm: new Date().toISOString(),
  });
}

export function registrarRotasWebhook(app, db) {
  /* ------------------------- MERCADO PAGO -------------------------- */
  app.post('/webhooks/mercadopago', async (req, res) => {
    const corpo = req.body || {};
    let resultado;
    try {
      resultado = await handleWebhook(db, {
        provider: 'mercadopago',
        headers: req.headers,
        body: corpo,
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(corpo),
      });
    } catch (err) {
      logSystem(db, 'error', `Webhook Mercado Pago: ${err.message}`);
      return void res.json({ ok: false, erro: 'Erro ao processar notificação.' }, 500);
    }
    if (!resultado.ok) {
      logSystem(db, 'warn', `Webhook MP rejeitado: ${resultado.erro}`);
      return void res.json({ ok: false, erro: resultado.erro }, 400);
    }

    const chave = `mp:${resultado.idempotencyKey || resultado.pagamentoId}:${resultado.status}`;
    if (jaProcessado(db, chave)) {
      return void res.json({ ok: true, duplicado: true });
    }
    await aplicarResultado(db, resultado, 'mercadopago');
    registrarEvento(db, chave, 'mercadopago', corpo, resultado);
    res.json({ ok: true });
  });

  /* --------------------- PROVEDOR INTERNO (TESTES) ----------------- */
  app.post('/webhooks/internal', async (req, res) => {
    const corpo = req.body || {};
    let resultado;
    try {
      resultado = await handleWebhook(db, {
        provider: 'internal',
        headers: req.headers,
        body: corpo,
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(corpo),
      });
    } catch (err) {
      return void res.json({ ok: false, erro: err.message }, 500);
    }
    if (!resultado.ok) return void res.json({ ok: false, erro: resultado.erro }, 400);

    const chave = `int:${resultado.idempotencyKey || corpo?.idempotencyKey || resultado.pagamentoId}:${resultado.status}`;
    if (jaProcessado(db, chave)) return void res.json({ ok: true, duplicado: true });
    await aplicarResultado(db, resultado, 'internal');
    registrarEvento(db, chave, 'internal', corpo, resultado);
    res.json({ ok: true });
  });

  /* ---------------------- CONSULTA DE STATUS ----------------------- */
  app.get('/webhooks/status', (req, res) => {
    const eventos = db.collection('webhookEvents')
      .all()
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .slice(0, 50);
    res.html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
      <link rel="stylesheet" href="/styles.css"><title>Eventos de webhook</title></head>
      <body><div class="container mt-3">
      <h1>Últimos eventos de webhook</h1>
      <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Data</th><th>Provedor</th><th>Chave</th><th>Resultado</th></tr></thead>
      <tbody>${eventos.map((ev) => `<tr><td>${escapeHtml(ev.criadoEm)}</td><td>${escapeHtml(ev.provider)}</td>
        <td>${escapeHtml(ev.chave)}</td><td>${escapeHtml(JSON.stringify(ev.resultado).slice(0, 120))}</td></tr>`).join('')}</tbody>
      </table></div></div></body></html>`);
  });
}

async function aplicarResultado(db, resultado, provider) {
  const { pedidoId, status } = resultado;
  if (!pedidoId) return;
  const mapa = { approved: 'aprovado', rejected: 'recusado', cancelled: 'recusado', refunded: 'estornado', expired: 'expirado' };
  const novo = mapa[status];
  if (!novo) return;
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return;
  await atualizarStatusFinanceiro(db, pedidoId, novo, { obs: `Confirmação automática via webhook (${provider}).`, por: 'webhook' });
  logSystem(db, 'info', `Pedido ${pedido.codigo}: status financeiro → ${novo} (webhook ${provider}).`);
}
