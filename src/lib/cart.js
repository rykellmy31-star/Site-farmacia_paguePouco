/**
 * cart.js — Carrinho de compras SERVER-SIDE (nada de preço confiando no navegador).
 * O carrinho é gravado no banco e identificado por cookie; ao fazer login, é
 * vinculado ao cliente. Preços são sempre recalculados a partir do cadastro.
 */
import crypto from 'node:crypto';
import { nowISO } from './store.js';
import { podeVender, precoVigenteCentavos, estoqueDisponivel } from './catalog.js';
import { config } from '../config.js';

export function novoCarrinhoId() {
  return `c_${crypto.randomBytes(12).toString('base64url')}`;
}

export function getCart(db, req) {
  const carts = db.collection('carts');
  let id = req.cookies?.[config.cartCookie] || req.session?.cartId || null;
  let cart = id ? carts.get(id) : null;
  if (!cart) {
    cart = carts.insert({ id: novoCarrinhoId(), clienteId: req.user?.id || null, itens: [], cupom: null, frete: null, criadoEm: nowISO(), atualizadoEm: nowISO() });
    req.setCartCookie = cart.id;
  }
  if (req.user?.id && cart.clienteId !== req.user.id) {
    cart = carts.update(cart.id, { clienteId: req.user.id });
  }
  return cart;
}

export function attachCartCookie(res, cartId) {
  res.cookie(config.cartCookie, cartId, { maxAge: 60 * 60 * 24 * 180, path: '/', httpOnly: false });
}

/** Recalcula os itens a partir do cadastro atual (preço, disponibilidade, bloqueios). */
export function normalizeCart(db, cart) {
  const itens = [];
  const avisos = [];
  for (const item of cart.itens || []) {
    const p = db.collection('products').get(item.produtoId);
    if (!p) {
      avisos.push({ item, tipo: 'removido', mensagem: 'Produto não está mais disponível e foi removido do carrinho.' });
      continue;
    }
    const venda = podeVender(p);
    if (!venda.ok) {
      avisos.push({ item, tipo: 'bloqueado', mensagem: `${p.nome}: ${venda.motivo} Item removido do carrinho.`, produto: p });
      continue;
    }
    const disponivel = estoqueDisponivel(p);
    const quantidade = Math.max(1, Math.min(Number(item.quantidade) || 1, disponivel, 99));
    if (quantidade < Number(item.quantidade || 1)) {
      avisos.push({ item, tipo: 'estoque', mensagem: `${p.nome}: estoque disponível reduzido para ${quantidade}.`, produto: p });
    }
    const preco = precoVigenteCentavos(p);
    if (preco !== item.precoUnitarioCentavos) {
      avisos.push({ item, tipo: 'preco', mensagem: `${p.nome}: o preço foi atualizado desde a adição ao carrinho.`, produto: p });
    }
    itens.push({
      produtoId: p.id,
      sku: p.sku || '',
      nome: p.nome,
      slug: p.slug,
      imagem: (p.imagens?.[0]?.url) || (typeof p.imagens?.[0] === 'string' ? p.imagens[0] : '') || '',
      categoriaId: p.categoriaId || null,
      quantidade,
      precoUnitarioCentavos: preco,
      precoOriginalCentavos: Number(p.precoCentavos || preco),
      peso: Number(p.peso) || 0,
      largura: Number(p.dimensoes?.largura) || 0,
      altura: Number(p.dimensoes?.altura) || 0,
      comprimento: Number(p.dimensoes?.comprimento) || 0,
      estoqueDisponivel: disponivel,
    });
  }
  const atualizado = db.collection('carts').update(cart.id, { itens, atualizadoEm: nowISO() });
  return { cart: atualizado || cart, avisos };
}

export function addItem(db, cart, produtoId, quantidade = 1) {
  const p = db.collection('products').get(produtoId);
  if (!p) return { ok: false, erro: 'Produto não encontrado.' };
  const venda = podeVender(p);
  if (!venda.ok) return { ok: false, erro: venda.motivo, codigo: venda.codigo };
  const disponivel = estoqueDisponivel(p);
  const atual = (cart.itens || []).find((i) => i.produtoId === p.id);
  const qtdFinal = Math.min(99, (Number(atual?.quantidade) || 0) + Math.max(1, Number(quantidade) || 1));
  if (qtdFinal > disponivel) {
    return { ok: false, erro: `Quantidade indisponível. Restam ${disponivel} unidade(s) em estoque.`, codigo: 'SEM_ESTOQUE' };
  }
  const itens = atual
    ? (cart.itens || []).map((i) => (i.produtoId === p.id ? { ...i, quantidade: qtdFinal } : i))
    : [...(cart.itens || []), { produtoId: p.id, quantidade: qtdFinal, precoUnitarioCentavos: precoVigenteCentavos(p) }];
  db.collection('carts').update(cart.id, { itens, atualizadoEm: nowISO() });
  return { ok: true, quantidade: qtdFinal };
}

export function setItemQuantity(db, cart, produtoId, quantidade) {
  const qtd = Math.max(0, Math.min(99, Number(quantidade) || 0));
  if (qtd === 0) return removeItem(db, cart, produtoId);
  const p = db.collection('products').get(produtoId);
  if (!p) return { ok: false, erro: 'Produto não encontrado.' };
  const venda = podeVender(p);
  if (!venda.ok) return { ok: false, erro: venda.motivo, codigo: venda.codigo };
  if (qtd > estoqueDisponivel(p)) {
    return { ok: false, erro: `Quantidade indisponível. Restam ${estoqueDisponivel(p)} unidade(s).`, codigo: 'SEM_ESTOQUE' };
  }
  const itens = (cart.itens || []).map((i) => (i.produtoId === produtoId ? { ...i, quantidade: qtd, precoUnitarioCentavos: precoVigenteCentavos(p) } : i));
  db.collection('carts').update(cart.id, { itens, atualizadoEm: nowISO() });
  return { ok: true, quantidade: qtd };
}

export function removeItem(db, cart, produtoId) {
  const itens = (cart.itens || []).filter((i) => i.produtoId !== produtoId);
  db.collection('carts').update(cart.id, { itens, atualizadoEm: nowISO() });
  return { ok: true };
}

export function clearCart(db, cart) {
  return db.collection('carts').update(cart.id, { itens: [], cupom: null, frete: null, atualizadoEm: nowISO() });
}

/* ------------------------------------------------------------------ */
/* Cupons                                                              */
/* ------------------------------------------------------------------ */
export function validarCupom(db, codigo, { subtotalCentavos, clienteId = null, itens = [] } = {}) {
  const cupom = db.collection('coupons').findOne((c) => String(c.codigo || '').toUpperCase() === String(codigo || '').toUpperCase());
  if (!cupom) return { ok: false, erro: 'Cupom não encontrado.' };
  if (!cupom.ativo) return { ok: false, erro: 'Cupom inativo.' };
  const agora = Date.now();
  if (cupom.validoDe && new Date(cupom.validoDe).getTime() > agora) return { ok: false, erro: 'Cupom ainda não está válido.' };
  if (cupom.validoAte && new Date(cupom.validoAte).getTime() < agora) return { ok: false, erro: 'Cupom expirado.' };
  if (cupom.usoMaximo != null && Number(cupom.usos || 0) >= Number(cupom.usoMaximo)) return { ok: false, erro: 'Cupom esgotado.' };
  if (cupom.valorMinimo && subtotalCentavos < Number(cupom.valorMinimo)) {
    return { ok: false, erro: `Cupom válido para compras a partir de R$ ${(cupom.valorMinimo / 100).toFixed(2).replace('.', ',')}.` };
  }
  if (cupom.primeiroPedido && clienteId) {
    const pedidos = db.collection('orders').count((o) => o.clienteId === clienteId && o.statusFinanceiro === 'aprovado');
    if (pedidos > 0) return { ok: false, erro: 'Cupom exclusivo para o primeiro pedido.' };
  }

  let desconto = 0;
  let freteGratis = false;
  const catsPermitidas = (cupom.categoriasPermitidas || []).map(String);
  const itensElegiveis = catsPermitidas.length
    ? itens.filter((i) => catsPermitidas.includes(String(i.categoriaId)))
    : itens;
  const base = itensElegiveis.reduce((acc, i) => acc + i.precoUnitarioCentavos * i.quantidade, 0) || subtotalCentavos;

  if (cupom.tipo === 'percentual') {
    desconto = Math.round((base * Number(cupom.valor || 0)) / 100);
  } else if (cupom.tipo === 'fixo') {
    desconto = Math.min(base, Math.round(Number(cupom.valor || 0) * 100));
  } else if (cupom.tipo === 'frete_gratis') {
    freteGratis = true;
  }
  desconto = Math.max(0, Math.min(desconto, base));
  return { ok: true, cupom, desconto, freteGratis };
}

export function aplicarCupom(db, cart, codigo, ctx) {
  const res = validarCupom(db, codigo, ctx);
  if (!res.ok) return res;
  db.collection('carts').update(cart.id, {
    cupom: { codigo: res.cupom.codigo, desconto: res.desconto, freteGratis: res.freteGratis, cupomId: res.cupom.id },
    atualizadoEm: nowISO(),
  });
  return res;
}

export function removerCupom(db, cart) {
  db.collection('carts').update(cart.id, { cupom: null, atualizadoEm: nowISO() });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Totais                                                              */
/* ------------------------------------------------------------------ */
export function calcularTotais(db, cart, { freteValor = 0, freteGratisPorCupom = false } = {}) {
  const itens = cart.itens || [];
  const subtotalCentavos = itens.reduce((acc, i) => acc + i.precoUnitarioCentavos * i.quantidade, 0);
  let descontoCupom = Number(cart.cupom?.desconto || 0);
  if (descontoCupom > subtotalCentavos) descontoCupom = subtotalCentavos;
  const freteGratis = !!(cart.cupom?.freteGratis || freteGratisPorCupom);
  const freteCentavos = freteGratis ? 0 : Math.max(0, Number(freteValor || 0));
  const totalCentavos = Math.max(0, subtotalCentavos - descontoCupom + freteCentavos);
  return {
    quantidadeItens: itens.reduce((a, i) => a + i.quantidade, 0),
    quantidadeTipos: itens.length,
    subtotalCentavos,
    descontoCupom,
    freteCentavos,
    freteGratis,
    totalCentavos,
    pesoTotalKg: itens.reduce((a, i) => a + (Number(i.peso) || 0) * i.quantidade, 0),
  };
}
