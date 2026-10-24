/** routes/api.js — API do carrinho, CEP, frete e sugestões (usada pelo front-end). */
import { criarContexto } from './context.js';
import {
  getCart, attachCartCookie, addItem, setItemQuantity, removeItem, clearCart,
  calcularTotais, aplicarCupom, removerCupom, normalizeCart,
} from '../lib/cart.js';
import { lookupCep, ufFromCep, isValidCep } from '../lib/cep.js';
import { calcularFrete } from '../lib/freight.js';
import { searchProducts } from '../lib/catalog.js';
import { htmlGavetaCarrinho, htmlRodapeCarrinho, htmlItensCarrinho, htmlResumoCarrinho } from '../views/cart.js';
import { rateLimitMiddleware } from '../lib/security.js';
import { logSystem } from '../lib/audit.js';

function responderCarrinho(req, res, db, { avisos = [] } = {}) {
  const cart = getCart(db, req);
  const normalizado = normalizeCart(db, cart);
  const totais = calcularTotais(db, normalizado.cart, { freteValor: normalizado.cart.frete?.valor || 0 });
  if (req.setCartCookie || normalizado.cart.id !== req.cookies?.pp_cart) attachCartCookie(res, normalizado.cart.id);
  return {
    ok: true,
    carrinhoId: normalizado.cart.id,
    quantidade: totais.quantidadeItens,
    total: totais.totalCentavos,
    subtotal: totais.subtotalCentavos,
    desconto: totais.descontoCupom,
    frete: totais.freteCentavos,
    itens: normalizado.cart.itens,
    avisos: [...avisos, ...normalizado.avisos.map((a) => a.mensagem)],
    html: {
      corpo: htmlGavetaCarrinho(normalizado.cart, totais),
      rodape: htmlRodapeCarrinho(normalizado.cart, totais, db),
      resumo: htmlResumoCarrinho(normalizado.cart, totais, { db, exibirParcelamento: true }),
      resumoSemFrete: htmlResumoCarrinho(normalizado.cart, totais, { mostrarFrete: false, db, exibirParcelamento: true }),
      itens: htmlItensCarrinho(normalizado.cart),
    },
  };
}

export function registrarRotasApi(app, db) {
  const limiteApi = rateLimitMiddleware('api', 240);

  /* ------------------------- CARRINHO (GET) --------------------------- */
  app.get('/api/carrinho', (req, res) => {
    if (res._ended) return;
    res.json(responderCarrinho(req, res, db));
  });

  /* ---------------------- ADICIONAR AO CARRINHO ----------------------- */
  app.post('/api/carrinho/adicionar', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const cart = getCart(db, req);
    const produtoId = String(req.body.produtoId || '');
    const quantidade = req.body.quantidade ?? 1;
    const r = addItem(db, cart, produtoId, quantidade);
    if (!r.ok) return void res.json({ ok: false, erro: r.erro, codigo: r.codigo }, 400);
    const resposta = responderCarrinho(req, res, db);
    resposta.mensagem = 'Produto adicionado à cesta.';
    res.json(resposta);
  });

  app.post('/api/carrinho/atualizar', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const cart = getCart(db, req);
    const r = setItemQuantity(db, cart, String(req.body.produtoId || ''), req.body.quantidade);
    if (!r.ok) return void res.json({ ok: false, erro: r.erro, codigo: r.codigo }, 400);
    res.json(responderCarrinho(req, res, db));
  });

  app.post('/api/carrinho/remover', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const cart = getCart(db, req);
    removeItem(db, cart, String(req.body.produtoId || ''));
    res.json(responderCarrinho(req, res, db));
  });

  app.post('/api/carrinho/limpar', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const cart = getCart(db, req);
    clearCart(db, cart);
    res.json(responderCarrinho(req, res, db));
  });

  app.post('/api/carrinho/cupom', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const cart = getCart(db, req);
    const codigo = String(req.body.codigo || '').trim();
    if (!codigo) return void res.json({ ok: false, erro: 'Informe o código do cupom.' }, 400);
    const totais = calcularTotais(db, cart, {});
    const r = aplicarCupom(db, cart, codigo, {
      subtotalCentavos: totais.subtotalCentavos,
      clienteId: req.user?.id || null,
      itens: cart.itens || [],
    });
    if (!r.ok) return void res.json({ ok: false, erro: r.erro }, 400);
    const resposta = responderCarrinho(req, res, db);
    resposta.mensagem = `Cupom ${codigo} aplicado.`;
    res.json(resposta);
  });

  app.post('/api/carrinho/cupom/remover', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const cart = getCart(db, req);
    removerCupom(db, cart);
    res.json(responderCarrinho(req, res, db));
  });

  /* ----------------------------- CEP ---------------------------------- */
  app.get('/api/cep/:cep', async (req, res) => {
    const info = await lookupCep(req.params.cep);
    res.json(info);
  });

  /* ----------------------------- FRETE -------------------------------- */
  app.post('/api/frete', { maxBodyBytes: 64 * 1024 }, (req, res) => {
    const ctx = criarContexto(req, db);
    const cep = String(req.body.cep || '').replace(/\D/g, '');
    const cidade = String(req.body.cidade || '');
    const uf = String(req.body.uf || '');
    if (!isValidCep(cep)) return void res.json({ ok: false, erro: 'Informe um CEP válido com 8 dígitos.' }, 400);
    const cart = getCart(db, req);
    const calc = calcularFrete({
      config: ctx.settings.frete,
      cep, uf, cidade,
      items: cart.itens || [],
      subtotalCents: (cart.itens || []).reduce((a, i) => a + i.precoUnitarioCentavos * i.quantidade, 0),
      cupomFreteGratis: !!cart.cupom?.freteGratis,
    });
    res.json({ ok: true, ...calc });
  });

  /* ------------------------ SUGESTÕES DE BUSCA ------------------------ */
  app.get('/api/busca', (req, res) => {
    const q = (req.query.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return void res.json({ sugestoes: [] });
    const r = searchProducts(db, { q, porPagina: 8 });
    res.json({
      sugestoes: r.rows.map((p) => ({
        id: p.id, nome: p.nome, url: `/produto/${p.slug}`,
        imagem: p.imagens?.[0]?.url || '', marca: p.marca || '',
      })),
    });
  });

  /* --------------------- PREFERÊNCIA DE COOKIES ----------------------- */
  app.post('/api/cookies', { maxBodyBytes: 8 * 1024 }, (req, res) => {
    const aceitar = String(req.body.acao || '') === 'aceitar';
    res.cookie('pp_cookies', aceitar ? 'aceito' : 'recusado', { maxAge: 60 * 60 * 24 * 365, httpOnly: false });
    res.json({ ok: true, aceito: aceitar });
  });

  /* ---------------------- PREFERÊNCIA DE CEP -------------------------- */
  app.post('/api/cep-sessao', { maxBodyBytes: 8 * 1024 }, (req, res) => {
    const cep = String(req.body.cep || '').replace(/\D/g, '');
    if (!isValidCep(cep) || !ufFromCep(cep)) {
      return void res.json({ ok: false, erro: 'Informe um CEP válido.' }, 400);
    }
    res.cookie('pp_cep', cep, { maxAge: 60 * 60 * 24 * 180, httpOnly: false });
    if (req.session) db.collection('sessions').update(req.session.id, { cep });
    res.json({ ok: true, uf: ufFromCep(cep) });
  });

  app.get('/api/saude', (req, res) => {
    res.json({
      ok: true,
      loja: (db.collection('settings').get('empresa') || {}).nomeFantasia || 'Farmácia Pague Pouco',
      produtos: db.collection('products').count(),
      pedidos: db.collection('orders').count(),
      hora: new Date().toISOString(),
    });
  });
}
