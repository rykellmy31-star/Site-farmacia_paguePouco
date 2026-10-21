/**
 * Endpoints exclusivos de um conector INOVAFARMA autorizado e homologado.
 * Bearer obrigatório; nenhuma credencial da Inova é recebida/salva aqui.
 */
import { config } from '../config.js';
import { registrarAtividadeConectorInova } from '../lib/inovafarma-automation.js';
import { receberCatalogoInova } from '../lib/inovafarma-catalog-import.js';
import {
  autenticacaoInovaValida, importarEstoqueInova, vendasPendentesInova,
  confirmarVendasInova,
} from '../lib/inovafarma-stock.js';

export function registrarRotasInovafarma(app, db) {
  function autenticar(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!config.inova?.enabled || String(config.inova?.token || '').length < 32) {
      res.json({ ok: false, erro: 'Integração INOVAFARMA desativada/não configurada.' }, 503);
      return false;
    }
    if (!autenticacaoInovaValida(req.headers.authorization)) {
      res.json({ ok: false, erro: 'Não autorizado.' }, 401);
      return false;
    }
    return true;
  }

  // Conector recebe apenas código/EAN e quantidade — nunca dados de clientes.
  app.get('/integracoes/inovafarma/vendas/pendentes', (req, res) => {
    if (!autenticar(req, res)) return;
    res.json({ ok: true, vendas: vendasPendentesInova(db) });
  });

  // Confirmar só após a venda ter sido efetivamente registrada no ERP.
  app.post('/webhooks/inovafarma/vendas/confirmar', (req, res) => {
    if (!autenticar(req, res)) return;
    const r = confirmarVendasInova(db, req.body);
    registrarAtividadeConectorInova(db,
      r.ok ? 'vendas_confirmadas' : 'falha_validacao_vendas',
      { quantidade: r.ok ? r.confirmadas : 0 });
    res.json(r.ok ? r : { ok: false, erro: r.erro, ...(r.status ? { status: r.status } : {}) },
      r.ok ? 200 : r.status);
  });

  // Catálogo bruto em lotes do CONECTOR HOMOLOGADO. Entrada autenticada e
  // desativada por padrão. Não publica produtos nem atualiza o estoque.
  app.post('/webhooks/inovafarma/catalogo', { maxBodyBytes: 256 * 1024 }, (req, res) => {
    if (!autenticar(req, res)) return;
    const r = receberCatalogoInova(db, req.body);
    res.json(r.ok ? r : { ok: false, erro: r.erro }, r.ok ? 200 : r.status);
  });

  // Somente saldos ABSOLUTOS. Operação sem credenciais falha fechada.
  app.post('/webhooks/inovafarma/estoque', (req, res) => {
    if (!autenticar(req, res)) return;
    const r = importarEstoqueInova(db, req.body);
    if (!r.duplicado) {
      registrarAtividadeConectorInova(db,
        r.ok ? 'estoque_recebido' : 'falha_validacao_estoque',
        { quantidade: r.ok ? r.atualizados : 0 });
    }
    res.json(r.ok ? r : { ok: false, erro: r.erro }, r.ok ? 200 : r.status);
  });
}
