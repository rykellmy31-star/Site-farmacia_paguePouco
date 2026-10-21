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
import { can } from '../lib/permissions.js';

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
        dataId: req.query.get('data.id') || req.query.get('id') || corpo?.data?.id,
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
    const aplicado = await aplicarResultado(db, resultado, 'mercadopago');
    if (!aplicado.ok) {
      logSystem(db, 'warn', `Conciliação pendente para webhook MP: ${aplicado.erro}`);
      return void res.json({ ok: false, erro: aplicado.erro }, 409);
    }
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
    const aplicado = await aplicarResultado(db, resultado, 'internal');
    if (!aplicado.ok) return void res.json({ ok: false, erro: aplicado.erro }, 409);
    registrarEvento(db, chave, 'internal', corpo, resultado);
    res.json({ ok: true });
  });

  /* ---------------------- CONSULTA DE STATUS ----------------------- */
  app.get('/webhooks/status', (req, res) => {
    if (!can(req.adminUser, 'auditoria.ver')) return void res.json({ ok: false, erro: 'Acesso restrito.' }, 403);
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
  const { pedidoId, status, pagamentoId } = resultado;
  if (!pedidoId || !pagamentoId) return { ok: false, erro: 'Pedido ou cobrança não identificados.' };
  const mapa = { approved: 'aprovado', rejected: 'recusado', cancelled: 'recusado', refunded: 'estornado', expired: 'expirado' };
  const novo = mapa[status];
  if (!novo) return { ok: true, ignorado: true };
  const pedido = db.collection('orders').get(pedidoId);
  const pagamento = db.collection('payments').get(pagamentoId);
  if (!pedido || !pagamento || pedido.pagamentoId !== pagamento.id ||
      pagamento.pedidoId !== pedido.id || pagamento.provedor !== provider ||
      Number(pagamento.valorCentavos) !== Number(pedido.totalCentavos)) {
    return { ok: false, erro: 'Vínculo entre cobrança e pedido inconsistente.' };
  }
  // O provedor interno emite eventos assinados, mas mantém a cobrança pendente
  // até o processamento; o MP já atualiza sua cobrança via consulta autenticada.
  if (provider === 'internal' && status === 'refunded' && pedido.statusFinanceiro === 'aprovado') {
    db.collection('payments').update(pagamento.id, { status: 'refunded', atualizadoEm: new Date().toISOString() });
  }
  const alteracao = atualizarStatusFinanceiro(db, pedidoId, novo,
    { obs: `Confirmação via webhook (${provider}).`, por: 'webhook' });
  if (!alteracao.ok) return alteracao;
  if (provider === 'internal') {
    db.collection('payments').update(pagamento.id, {
      status, atualizadoEm: new Date().toISOString(),
      eventos: [...(pagamento.eventos || []), { status, em: new Date().toISOString(), origem: 'webhook' }],
    });
  }
  logSystem(db, 'info', `Pedido ${pedido.codigo}: status financeiro → ${novo} (webhook ${provider}).`);
  return { ok: true };
}
