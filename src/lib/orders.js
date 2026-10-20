/**
 * orders.js — Ciclo de vida do pedido: criação, reserva/baixa de estoque,
 * status financeiro x status operacional, histórico e movimentações.
 *
 * REGRA DE ESTOQUE (requisito 3 e 5):
 *  - Pedido criado            → estoque é RESERVADO (reservado += qtd)
 *  - Pagamento APROVADO       → reserva é convertida em SAÍDA definitiva
 *  - Pedido CANCELADO/EXPIRADO→ reserva é LIBERADA (devolvida ao disponível)
 * Toda movimentação é registrada na coleção "stockMovements" (histórico).
 */
import crypto from 'node:crypto';
import { nowISO } from './store.js';
import { podeVender, precoVigenteCentavos, estoqueDisponivel } from './catalog.js';
import { resolverFreteEscolhido } from './freight.js';
import { calcularTotais, validarCupom, clearCart } from './cart.js';
import { logSystem } from './audit.js';

export const STATUS_FINANCEIRO = {
  pendente: { id: 'pendente', nome: 'Aguardando pagamento', cor: '#b26a00', bg: '#fff4d6' },
  aprovado: { id: 'aprovado', nome: 'Pagamento aprovado', cor: '#0b7a3d', bg: '#dcf5e6' },
  recusado: { id: 'recusado', nome: 'Pagamento recusado', cor: '#a32020', bg: '#fde3e3' },
  estornado: { id: 'estornado', nome: 'Estornado', cor: '#5a3ea0', bg: '#ece6fb' },
  expirado: { id: 'expirado', nome: 'Expirado', cor: '#6b6b6b', bg: '#eeeeee' },
};

export const STATUS_OPERACIONAL = {
  aguardando_pagamento: { id: 'aguardando_pagamento', nome: 'Aguardando pagamento', ordem: 1 },
  em_separacao: { id: 'em_separacao', nome: 'Em separação', ordem: 2 },
  preparando_envio: { id: 'preparando_envio', nome: 'Preparando envio', ordem: 3 },
  enviado: { id: 'enviado', nome: 'Enviado', ordem: 4 },
  saiu_para_entrega: { id: 'saiu_para_entrega', nome: 'Saiu para entrega', ordem: 5 },
  entregue: { id: 'entregue', nome: 'Entregue', ordem: 6 },
  cancelado: { id: 'cancelado', nome: 'Cancelado', ordem: 7 },
};

export function proximoCodigo(db) {
  const ano = new Date().getFullYear();
  const counters = db.collection('counters');
  let c = counters.get('pedido');
  if (!c || c.ano !== ano) {
    c = counters.get('pedido')
      ? counters.update('pedido', { ano, sequencia: 1 })
      : counters.insert({ id: 'pedido', ano, sequencia: 1 });
  }
  const seq = Number(c.sequencia);
  counters.update('pedido', { sequencia: seq + 1 });
  return `PP${ano}${String(seq).padStart(6, '0')}`;
}

export function registrarMovimentoEstoque(db, { produtoId, tipo, quantidade, origem, pedidoId = null, lote = null, validade = null, usuarioId = null, observacao = '' }) {
  const produto = db.collection('products').get(produtoId);
  if (!produto) return null;
  const estoque = { ...(produto.estoque || {}) };
  const antes = Number(estoque.quantidade || 0);
  const reservadoAntes = Number(estoque.reservado || 0);
  const q = Math.abs(Number(quantidade) || 0);

  switch (tipo) {
    case 'entrada':
      estoque.quantidade = antes + q;
      break;
    case 'saida':
      estoque.quantidade = Math.max(0, antes - q);
      estoque.reservado = Math.max(0, reservadoAntes - q);
      break;
    case 'reserva':
      estoque.reservado = reservadoAntes + q;
      break;
    case 'liberacao':
      estoque.reservado = Math.max(0, reservadoAntes - q);
      break;
    case 'ajuste':
      estoque.quantidade = q;
      break;
    default:
      break;
  }
  db.collection('products').update(produtoId, { estoque: { ...estoque }, atualizadoEm: nowISO() });
  return db.collection('stockMovements').insert({
    produtoId,
    produtoNome: produto.nome,
    tipo,
    quantidade: q,
    saldoAntes: antes,
    saldoDepois: Number(estoque.quantidade || 0),
    reservadoAntes,
    reservadoDepois: Number(estoque.reservado || 0),
    origem,
    pedidoId,
    lote,
    validade,
    usuarioId,
    observacao,
    criadoEm: nowISO(),
  });
}

/**
 * Cria o pedido a partir do carrinho, REVALIDANDO tudo no servidor.
 * @returns {{ok:boolean, erro?:string, pedido?:object, avisos?:string[]}}
 */
export async function criarPedido(db, { cart, cliente, endereco, freteOpcaoId, metodoPagamento, parcelas = 1, freteConfig, cupomCodigo = null, req = null }) {
  const avisos = [];
  if (!cart || !(cart.itens || []).length) return { ok: false, erro: 'Carrinho vazio.' };
  if (!endereco?.cep) return { ok: false, erro: 'Informe o CEP de entrega.' };

  // 1) Revalida cada item contra o cadastro atual
  const itens = [];
  for (const item of cart.itens) {
    const p = db.collection('products').get(item.produtoId);
    if (!p) return { ok: false, erro: `O produto "${item.nome}" não está mais disponível.` };
    const venda = podeVender(p);
    if (!venda.ok) return { ok: false, erro: `${p.nome}: ${venda.motivo}`, codigo: venda.codigo };
    const disponivel = estoqueDisponivel(p);
    if (disponivel < item.quantidade) {
      return { ok: false, erro: `${p.nome}: estoque insuficiente (disponível: ${disponivel}).` };
    }
    const preco = precoVigenteCentavos(p); // preço vem do banco, nunca do navegador
    itens.push({
      produtoId: p.id,
      sku: p.sku || '',
      ean: p.ean || '',
      nome: p.nome,
      slug: p.slug,
      imagem: p.imagens?.[0]?.url || '',
      categoriaId: p.categoriaId || null,
      quantidade: item.quantidade,
      precoUnitarioCentavos: preco,
      precoOriginalCentavos: Number(p.precoCentavos || preco),
      subtotalCentavos: preco * item.quantidade,
      peso: Number(p.peso) || 0,
      largura: Number(p.dimensoes?.largura) || 0,
      altura: Number(p.dimensoes?.altura) || 0,
      comprimento: Number(p.dimensoes?.comprimento) || 0,
      sanitario: {
        classificacao: p.sanitario?.classificacao || 'nao_aplicavel',
        registroMS: p.sanitario?.registroMS || '',
        apresentacao: p.sanitario?.apresentacao || '',
        principioAtivo: p.sanitario?.principioAtivo || '',
      },
    });
  }

  // 2) Subtotal e cupom (recalculados)
  const subtotalCentavos = itens.reduce((a, i) => a + i.subtotalCentavos, 0);
  let descontoCentavos = 0;
  let cupomAplicado = null;
  let freteGratisCupom = false;
  if (cupomCodigo) {
    const res = validarCupom(db, cupomCodigo, { subtotalCentavos, clienteId: cliente?.id || null, itens });
    if (!res.ok) return { ok: false, erro: res.erro, codigo: 'CUPOM_INVALIDO' };
    descontoCentavos = res.desconto;
    freteGratisCupom = !!res.freteGratis;
    cupomAplicado = { codigo: res.cupom.codigo, cupomId: res.cupom.id, desconto: res.desconto, freteGratis: res.freteGratis };
  }

  // 3) Frete recalculado no servidor
  const frete = resolverFreteEscolhido({
    config: freteConfig,
    cep: endereco.cep,
    uf: endereco.uf,
    cidade: endereco.cidade,
    items: itens,
    subtotalCents: subtotalCentavos,
    opcaoId: freteOpcaoId,
    cupomFreteGratis: freteGratisCupom,
  });
  if (!frete.ok) return { ok: false, erro: frete.erro, codigo: 'FRETE_INDISPONIVEL' };

  const freteCentavos = frete.valor;
  const totalCentavos = Math.max(0, subtotalCentavos - descontoCentavos + freteCentavos);

  // 4) Proteção contra pedido duplicado (mesmo cliente/carrinho nos últimos 60s)
  const codigo = proximoCodigo(db);
  const agora = Date.now();
  const duplicado = db.collection('orders').findOne((o) =>
    o.clienteId === (cliente?.id || null) &&
    o.carrinhoId === cart.id &&
    Math.abs(agora - new Date(o.criadoEm).getTime()) < 60_000);
  if (duplicado) {
    logSystem(db, 'warn', `Pedido duplicado evitado (carrinho ${cart.id}).`);
    return { ok: false, erro: 'Este pedido já foi registrado. Acompanhe em "Meus pedidos".', codigo: 'DUPLICADO', pedido: duplicado };
  }

  // 5) Reserva de estoque
  for (const item of itens) {
    registrarMovimentoEstoque(db, {
      produtoId: item.produtoId,
      tipo: 'reserva',
      quantidade: item.quantidade,
      origem: 'pedido',
      pedidoId: null,
      observacao: `Reserva para pedido ${codigo}`,
    });
  }

  const pedido = db.collection('orders').insert({
    codigo,
    carrinhoId: cart.id,
    clienteId: cliente?.id || null,
    cliente: {
      nome: cliente?.nome || endereco.nome || '',
      email: cliente?.email || endereco.email || '',
      telefone: cliente?.telefone || endereco.telefone || '',
      cpf: cliente?.cpf || '',
    },
    itens,
    subtotalCentavos,
    descontoCentavos,
    cupom: cupomAplicado,
    freteCentavos,
    freteOpcao: {
      id: frete.opcao.id,
      label: frete.opcao.label,
      prazoMin: frete.opcao.prazoMin,
      prazoMax: frete.opcao.prazoMax,
      prazo: frete.opcao.prazo,
      detalhe: frete.opcao.detalhe || '',
    },
    totalCentavos,
    metodoPagamento, // pix | credit_card | debit_card
    parcelas: metodoPagamento === 'credit_card' ? Math.max(1, Number(parcelas) || 1) : 1,
    statusFinanceiro: 'pendente',
    statusOperacional: 'aguardando_pagamento',
    endereco: { ...endereco },
    rastreio: { codigo: '', transportadora: '', url: '', enviadoEm: null },
    pagamentoId: null,
    observacoes: '',
    historico: [{
      tipo: 'operacional', status: 'aguardando_pagamento', em: nowISO(),
      por: cliente?.nome || 'cliente', obs: 'Pedido registrado.',
    }],
    criadoEm: nowISO(),
    atualizadoEm: nowISO(),
    ip: req?.ip || '',
  });

  // Vincula as movimentações ao pedido
  db.collection('stockMovements').updateMany(
    (m) => m.pedidoId === null && m.observacao === `Reserva para pedido ${codigo}`,
    (m) => ({ pedidoId: pedido.id })
  );

  if (cupomAplicado) {
    const cupom = db.collection('coupons').get(cupomAplicado.cupomId);
    if (cupom) db.collection('coupons').update(cupom.id, { usos: Number(cupom.usos || 0) + 1 });
  }

  clearCart(db, cart);
  return { ok: true, pedido, avisos };
}

/* ------------------------------------------------------------------ */
/* Transições de status                                                */
/* ------------------------------------------------------------------ */
export function adicionarHistorico(db, pedido, { tipo, status, obs = '', por = 'sistema' }) {
  const historico = [...(pedido.historico || []), { tipo, status, obs, por, em: nowISO() }];
  return db.collection('orders').update(pedido.id, { historico, atualizadoEm: nowISO() });
}

export function atualizarStatusFinanceiro(db, pedidoId, status, { obs = '', por = 'sistema', pagamentoId = null } = {}) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  const anterior = pedido.statusFinanceiro;
  if (anterior === status) return { ok: true, pedido, semAlteracao: true };

  const patch = { statusFinanceiro: status, atualizadoEm: nowISO(), pagamentoId: pagamentoId || pedido.pagamentoId };

  if (status === 'aprovado' && anterior !== 'aprovado') {
    // Converte reserva em saída definitiva e conta como venda
    for (const item of pedido.itens) {
      registrarMovimentoEstoque(db, {
        produtoId: item.produtoId,
        tipo: 'saida',
        quantidade: item.quantidade,
        origem: 'pedido_aprovado',
        pedidoId: pedido.id,
        observacao: `Saída referente ao pedido ${pedido.codigo}`,
      });
      const p = db.collection('products').get(item.produtoId);
      if (p) db.collection('products').update(p.id, { vendas: Number(p.vendas || 0) + item.quantidade });
    }
    patch.statusOperacional = 'em_separacao';
  }
  if (['recusado', 'cancelado'].includes(status)) {
    liberarReserva(db, pedido);
  }
  if (status === 'expirado') {
    liberarReserva(db, pedido);
  }

  const atualizado = db.collection('orders').update(pedidoId, patch);
  adicionarHistorico(db, atualizado, { tipo: 'financeiro', status, obs, por });
  return { ok: true, pedido: db.collection('orders').get(pedidoId) };
}

export function atualizarStatusOperacional(db, pedidoId, status, { obs = '', por = 'sistema', rastreio = null } = {}) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (!STATUS_OPERACIONAL[status]) return { ok: false, erro: 'Status operacional inválido.' };
  const patch = { statusOperacional: status, atualizadoEm: nowISO() };
  if (rastreio) patch.rastreio = { ...(pedido.rastreio || {}), ...rastreio };
  if (status === 'enviado' && !pedido.enviadoEm) patch.enviadoEm = nowISO();
  if (status === 'entregue' && !pedido.entregueEm) patch.entregueEm = nowISO();
  if (status === 'cancelado') {
    patch.statusFinanceiro = pedido.statusFinanceiro === 'aprovado' ? 'estornado' : 'recusado';
    liberarReserva(db, pedido);
    if (pedido.statusFinanceiro === 'aprovado') {
      // devolve ao estoque (já houve baixa)
      for (const item of pedido.itens) {
        registrarMovimentoEstoque(db, {
          produtoId: item.produtoId,
          tipo: 'entrada',
          quantidade: item.quantidade,
          origem: 'cancelamento_pos_aprovacao',
          pedidoId: pedido.id,
          observacao: `Devolução ao estoque — pedido ${pedido.codigo} cancelado após aprovação`,
        });
      }
    }
  }
  db.collection('orders').update(pedidoId, patch);
  adicionarHistorico(db, db.collection('orders').get(pedidoId), { tipo: 'operacional', status, obs, por });
  return { ok: true, pedido: db.collection('orders').get(pedidoId) };
}

function liberarReserva(db, pedido) {
  const jaLiberou = (db.collection('stockMovements').all()).some((m) => m.pedidoId === pedido.id && m.tipo === 'liberacao');
  if (jaLiberou) return;
  for (const item of pedido.itens) {
    registrarMovimentoEstoque(db, {
      produtoId: item.produtoId,
      tipo: 'liberacao',
      quantidade: item.quantidade,
      origem: 'pedido_cancelado_ou_expirado',
      pedidoId: pedido.id,
      observacao: `Liberação de reserva — pedido ${pedido.codigo}`,
    });
  }
}

export function cancelarPedido(db, pedidoId, { motivo = '', por = 'sistema' } = {}) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (['entregue', 'cancelado'].includes(pedido.statusOperacional)) {
    return { ok: false, erro: `Pedido ${pedido.statusOperacional} não pode ser cancelado.` };
  }
  return atualizarStatusOperacional(db, pedidoId, 'cancelado', { obs: motivo, por });
}

export function pedidosDoCliente(db, clienteId) {
  return db.collection('orders')
    .find((o) => o.clienteId === clienteId)
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

export function metricas(db, { de = null, ate = null } = {}) {
  let pedidos = db.collection('orders').all();
  if (de) pedidos = pedidos.filter((o) => o.criadoEm >= de);
  if (ate) pedidos = pedidos.filter((o) => o.criadoEm <= ate);
  const pagos = pedidos.filter((o) => o.statusFinanceiro === 'aprovado');
  const receita = pagos.reduce((a, o) => a + Number(o.totalCentavos || 0), 0);
  const ticket = pagos.length ? Math.round(receita / pagos.length) : 0;
  const produtos = db.collection('products').all();
  const estoqueBaixo = produtos.filter((p) => {
    const e = p.estoque || {};
    return Number(e.quantidade || 0) <= Number(e.minimo || 0);
  });
  return {
    pedidosTotal: pedidos.length,
    pedidosPagos: pagos.length,
    pedidosPendentes: pedidos.filter((o) => o.statusFinanceiro === 'pendente').length,
    pedidosEnviados: pedidos.filter((o) => ['enviado', 'saiu_para_entrega'].includes(o.statusOperacional)).length,
    pedidosEntregues: pedidos.filter((o) => o.statusOperacional === 'entregue').length,
    pedidosCancelados: pedidos.filter((o) => o.statusOperacional === 'cancelado').length,
    receitaCentavos: receita,
    ticketMedioCentavos: ticket,
    produtosTotal: produtos.length,
    produtosAtivos: produtos.filter((p) => p.ativo).length,
    estoqueBaixo: estoqueBaixo.length,
    clientesTotal: db.collection('customers').count(),
  };
}

export function vendasPorDia(db, dias = 30) {
  const out = [];
  const hoje = new Date();
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const pedidos = db.collection('orders').all().filter((o) => String(o.criadoEm).slice(0, 10) === key);
    const pagos = pedidos.filter((o) => o.statusFinanceiro === 'aprovado');
    out.push({
      data: key,
      pedidos: pedidos.length,
      pagos: pagos.length,
      receitaCentavos: pagos.reduce((a, o) => a + Number(o.totalCentavos || 0), 0),
    });
  }
  return out;
}

export function produtosMaisVendidos(db, limite = 10) {
  const mapa = new Map();
  for (const o of db.collection('orders').all()) {
    if (o.statusFinanceiro !== 'aprovado') continue;
    for (const it of o.itens || []) {
      const atual = mapa.get(it.produtoId) || { produtoId: it.produtoId, nome: it.nome, quantidade: 0, receitaCentavos: 0 };
      atual.quantidade += it.quantidade;
      atual.receitaCentavos += it.subtotalCentavos;
      mapa.set(it.produtoId, atual);
    }
  }
  return Array.from(mapa.values()).sort((a, b) => b.quantidade - a.quantidade).slice(0, limite);
}
