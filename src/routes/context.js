/** routes/context.js — Monta o contexto comum a todas as páginas (usuário, carrinho, configurações). */
import { getAllSettings } from '../lib/settings.js';
import { montarArvore } from '../lib/catalog.js';
import { getCart } from '../lib/cart.js';
import { csrfToken } from '../lib/security.js';
import { calcularTotais } from '../lib/cart.js';

export function criarContexto(req, db) {
  const cart = getCart(db, req);
  const settings = getAllSettings(db);
  const usuario = req.user || null;
  const cartCount = (cart.itens || []).reduce((a, i) => a + i.quantidade, 0);
  return {
    req,
    db,
    settings,
    usuario,
    cart,
    cartCount,
    csrf: csrfToken(req),
    cepSessao: req.session?.cep || req.cookies?.pp_cep || '',
    arvore: montarArvore(db),
    termoBusca: req.query.get('q') || '',
    totaisCarrinho: calcularTotais(db, cart, { freteValor: cart.frete?.valor || 0 }),
  };
}
