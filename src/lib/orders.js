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
import { installmentOptions } from './payments/index.js';

export const STATUS_FINANCEIRO = {
  pendente: { id: 'pendente', nome: 'Aguardando pagamento', cor: '#b26a00', bg: '#fff4d6' },
  aprovado: { id: 'aprovado', nome: 'Pagamento aprovado', cor: '#0b7a3d', bg: '#dcf5e6' },
  recusado: { id: 'recusado', nome: 'Pagamento recusado', cor: '#a32020', bg: '#fde3e3' },
  estornado: { id: 'estornado', nome: 'Estornado', cor: '#5a3ea0', bg: '#ece6fb' },
  estorno_solicitado: { id: 'estorno_solicitado', nome: 'Estorno solicitado', cor: '#a35a00', bg: '#fff4d6' },
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
  const loja = db.collection('settings').get('loja') || {};
  if (loja.lojaAberta === false) return { ok: false, erro: 'A loja está fechada para novos pedidos.' };
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
  const baseCentavos = Math.max(0, subtotalCentavos - descontoCentavos + freteCentavos);
  if (baseCentavos < Number(loja.valorMinimoPedido || 0)) {
    return { ok: false, erro: 'O pedido não atingiu o valor mínimo da loja.' };
  }
  const pagamentos = db.collection('settings').get('pagamentos') || db.collection('settings').get('payments') || {};
  let descontoPixCentavos = 0;
  let acrescimoJurosCentavos = 0;
  let parcelasValidadas = 1;
  if (metodoPagamento === 'pix') {
    const percentual = Math.max(0, Math.min(100, Number(pagamentos.descontoPixPercentual) || 0));
    descontoPixCentavos = Math.round(baseCentavos * percentual / 100);
  } else if (metodoPagamento === 'credit_card') {
    if (!Number.isInteger(Number(parcelas)) || Number(parcelas) < 1) return { ok: false, erro: 'Parcelas inválidas.' };
    const plano = installmentOptions(db, baseCentavos).find((opt) => opt.numero === Number(parcelas));
    if (!plano) return { ok: false, erro: 'Parcelamento não permitido.' };
    parcelasValidadas = plano.numero;
    acrescimoJurosCentavos = plano.total - baseCentavos;
  } else if (metodoPagamento !== 'debit_card') {
    return { ok: false, erro: 'Meio de pagamento inválido.' };
  }
  const totalCentavos = baseCentavos - descontoPixCentavos + acrescimoJurosCentavos;

  // 4) Proteção contra pedido duplicado (mesmo cliente/carrinho nos últimos 60s)
  const agora = Date.now();
  const duplicado = db.collection('orders').findOne((o) =>
    o.clienteId === (cliente?.id || null) &&
    o.carrinhoId === cart.id &&
    Math.abs(agora - new Date(o.criadoEm).getTime()) < 60_000);
  if (duplicado) {
    logSystem(db, 'warn', `Pedido duplicado evitado (carrinho ${cart.id}).`);
    return { ok: false, erro: 'Este pedido já foi registrado. Acompanhe em "Meus pedidos".', codigo: 'DUPLICADO', pedido: duplicado };
  }

  const codigo = proximoCodigo(db);
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
    descontoCentavos: descontoCentavos + descontoPixCentavos,
    descontoPixCentavos,
    acrescimoJurosCentavos,
    cupom: cupomAplicado,
    // Controla devolução da utilização caso o pagamento seja recusado
    // ou expire, sem alterar contabilização de pedidos antigos.
    cupomUsoReservado: !!cupomAplicado,
    cupomUsoLiberadoEm: null,
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
    parcelas: parcelasValidadas,
    statusFinanceiro: 'pendente',
    statusOperacional: 'aguardando_pagamento',
    endereco: { ...endereco },
    rastreio: { codigo: '', transportadora: '', url: '', enviadoEm: null },
    pagamentoId: null,
    // Se o Worker reiniciar antes de associar o pagamento ao pedido, o
    // reconciliador identifica esta etapa sem presumir recusa ou aprovação.
    pendenciaPagamento: 'criacao_em_andamento',
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


/**
 * Cada reserva é contabilizada pela sua movimentação vinculada ao pedido.
 * O estoque de outro pedido nunca pode ser consumido durante a liberação.
 */
function reservaAtiva(db, pedidoId, produtoId) {
  const movimentos = db.collection('stockMovements').find((m) =>
    m.pedidoId === pedidoId && m.produtoId === produtoId);
  const soma = (tipo) => movimentos.filter((m) => m.tipo === tipo)
    .reduce((v, m) => v + Number(m.quantidade || 0), 0);
  return Math.max(0, soma('reserva') - soma('liberacao') - soma('saida'));
}

function liberarReserva(db, pedido) {
  const itens = [];
  for (const item of pedido.itens || []) {
    const qtd = reservaAtiva(db, pedido.id, item.produtoId);
    if (!qtd) continue;
    const p = db.collection('products').get(item.produtoId);
    if (!p || Number(p.estoque?.reservado || 0) < qtd) {
      return { ok: false, erro: 'Reserva inconsistente; requer conferência manual.' };
    }
    itens.push({ produtoId: item.produtoId, quantidade: qtd });
  }
  for (const item of itens) registrarMovimentoEstoque(db, {
    ...item, tipo: 'liberacao', origem: 'pedido_cancelado_ou_expirado', pedidoId: pedido.id,
    observacao: `Liberação de reserva — pedido ${pedido.codigo}`,
  });
  return { ok: true };
}

/**
 * Pré-validação sem mutações: impede aprovar cobranças simuladas quando
 * o pedido perdeu produtos, saldo ou reservas. Agrupa linhas repetidas
 * do mesmo produto para não aprovar uma compra sem estoque suficiente.
 */
export function validarReservaParaAprovacao(db, pedidoId) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (pedido.statusFinanceiro !== 'pendente' || pedido.statusOperacional === 'cancelado') {
    return { ok: false, erro: 'Este pedido não está apto a receber aprovação.' };
  }
  if (!(pedido.itens || []).length) return { ok: false, erro: 'Pedido sem itens válidos.' };
  const quantidades = new Map();
  for (const item of pedido.itens) {
    const qtd = Number(item.quantidade);
    if (!item.produtoId || !Number.isSafeInteger(qtd) || qtd <= 0) {
      return { ok: false, erro: 'Quantidade inválida em item do pedido.' };
    }
    quantidades.set(item.produtoId, (quantidades.get(item.produtoId) || 0) + qtd);
  }
  for (const [produtoId, quantidade] of quantidades) {
    const produto = db.collection('products').get(produtoId);
    if (!produto || reservaAtiva(db, pedido.id, produtoId) < quantidade ||
        Number(produto.estoque?.reservado || 0) < quantidade ||
        Number(produto.estoque?.quantidade || 0) < quantidade) {
      return { ok: false, erro: 'Reserva deste pedido insuficiente; conciliação necessária.' };
    }
  }
  return { ok: true, pedido };
}

export function atualizarStatusFinanceiro(db, pedidoId, status, { obs = '', por = 'sistema', pagamentoId = null } = {}) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (!STATUS_FINANCEIRO[status]) return { ok: false, erro: 'Status financeiro inválido.' };
  const anterior = pedido.statusFinanceiro;
  if (anterior === status) return { ok: true, pedido, semAlteracao: true };
  const transicoes = {
    pendente: ['aprovado', 'recusado', 'expirado'],
    aprovado: ['estorno_solicitado', 'estornado'],
    estorno_solicitado: ['estornado'],
    recusado: [], expirado: [], estornado: [],
  };
  if (!transicoes[anterior]?.includes(status)) {
    return { ok: false, erro: `Transição financeira não permitida: ${anterior} → ${status}.` };
  }
  if (status === 'aprovado' && pedido.statusOperacional === 'cancelado') {
    return { ok: false, erro: 'Pedido cancelado não pode ser reativado; exige conciliação.' };
  }
  if (status === 'estornado') {
    const pagamento = db.collection('payments').get(pedido.pagamentoId);
    if (!pagamento || pagamento.status !== 'refunded') {
      return { ok: false, erro: 'O provedor ainda não confirmou o estorno.' };
    }
  }

  const patch = { statusFinanceiro: status, atualizadoEm: nowISO(), pagamentoId: pagamentoId || pedido.pagamentoId };
  if (status === 'aprovado') {
    const reserva = validarReservaParaAprovacao(db, pedidoId);
    if (!reserva.ok) return reserva;
    for (const item of pedido.itens || []) {
      registrarMovimentoEstoque(db, {
        produtoId: item.produtoId, tipo: 'saida', quantidade: item.quantidade,
        origem: 'pedido_aprovado', pedidoId: pedido.id,
        observacao: `Saída referente ao pedido ${pedido.codigo}`,
      });
      const p = db.collection('products').get(item.produtoId);
      if (p) db.collection('products').update(p.id, { vendas: Number(p.vendas || 0) + item.quantidade });
    }
    patch.statusOperacional = 'em_separacao';
  }
  if (status === 'recusado' || status === 'expirado') {
    const liberacao = liberarReserva(db, pedido);
    if (!liberacao.ok) return liberacao;

    // A tentativa de pagamento não consumiu definitivamente a promoção:
    // devolva o uso reservado para que o cliente possa tentar novamente.
    // O indicador de liberação impede desconto duplicado, e pedidos antigos
    // sem esse indicador continuam intactos (sem recontagem retroativa).
    if (pedido.cupomUsoReservado === true && !pedido.cupomUsoLiberadoEm && pedido.cupom?.cupomId) {
      const cupom = db.collection('coupons').get(pedido.cupom.cupomId);
      if (cupom) db.collection('coupons').update(cupom.id, {
        usos: Math.max(0, Number(cupom.usos || 0) - 1),
      });
      patch.cupomUsoLiberadoEm = nowISO();
    }
  }

  const atualizado = db.collection('orders').update(pedidoId, patch);
  adicionarHistorico(db, atualizado, { tipo: 'financeiro', status, obs, por });
  return { ok: true, pedido: db.collection('orders').get(pedidoId) };
}

export function atualizarStatusOperacional(db, pedidoId, status, { obs = '', por = 'sistema', rastreio = null } = {}) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  if (!STATUS_OPERACIONAL[status]) return { ok: false, erro: 'Status operacional inválido.' };
  if (status === 'cancelado') return { ok: false, erro: 'Use o fluxo de cancelamento validado.' };
  if (pedido.statusOperacional === 'cancelado') return { ok: false, erro: 'Pedido cancelado não pode ser reativado.' };
  if (status === pedido.statusOperacional && !rastreio) return { ok: true, pedido, semAlteracao: true };
  if (status !== pedido.statusOperacional &&
      STATUS_OPERACIONAL[status].ordem <= (STATUS_OPERACIONAL[pedido.statusOperacional]?.ordem || 0)) {
    return { ok: false, erro: 'Não é permitido retroceder etapas da entrega.' };
  }
  if (pedido.statusFinanceiro !== 'aprovado' && (status !== pedido.statusOperacional || rastreio)) {
    return { ok: false, erro: 'Pedido não pago não pode avançar operacionalmente.' };
  }
  const patch = { statusOperacional: status, atualizadoEm: nowISO() };
  if (rastreio) patch.rastreio = { ...(pedido.rastreio || {}), ...rastreio };
  if (status === 'enviado' && !pedido.enviadoEm) patch.enviadoEm = nowISO();
  if (status === 'entregue' && !pedido.entregueEm) patch.entregueEm = nowISO();
  db.collection('orders').update(pedidoId, patch);
  adicionarHistorico(db, db.collection('orders').get(pedidoId), { tipo: 'operacional', status, obs, por });
  return { ok: true, pedido: db.collection('orders').get(pedidoId) };
}

/**
 * Deve ser chamado ANTES de qualquer chamada externa de estorno. Caso a
 * encomenda já tenha sido expedida, o botão Cancelar não pode reembolsar
 * dinheiro e somente depois descobrir que a operação era proibida.
 * Devoluções pós-expedição exigem fluxo específico com conferência humana.
 */
export function validarCancelamentoOperacional(pedido) {
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado.' };
  // Em criação interrompida/timeout a cobrança real pode existir e ainda
  // não estar vinculada. Não libere reserva nem cupom antes da conciliação.
  if (pedido.statusFinanceiro === 'pendente' &&
      ['criacao_em_andamento', 'conciliacao_necessaria'].includes(pedido.pendenciaPagamento)) {
    return { ok: false, erro: 'Pagamento aguardando conferência. Não cancele antes de verificar a cobrança.' };
  }
  if (['entregue', 'cancelado', 'enviado', 'saiu_para_entrega'].includes(pedido.statusOperacional)) {
    return { ok: false, erro: 'Pedido expedido, entregue ou cancelado exige outro fluxo.' };
  }
  return { ok: true };
}

export function cancelarPedido(db, pedidoId, { motivo = '', por = 'sistema' } = {}) {
  const pedido = db.collection('orders').get(pedidoId);
  const admissivel = validarCancelamentoOperacional(pedido);
  if (!admissivel.ok) return admissivel;
  if (['aprovado', 'estorno_solicitado'].includes(pedido.statusFinanceiro)) {
    return { ok: false, erro: 'Pagamento aprovado: confirme o estorno no provedor antes do cancelamento.' };
  }
  if (pedido.statusFinanceiro === 'pendente') {
    const r = atualizarStatusFinanceiro(db, pedido.id, 'recusado', { obs: 'Cancelamento antes da aprovação.', por });
    if (!r.ok) return r;
  }
  db.collection('orders').update(pedidoId, { statusOperacional: 'cancelado', atualizadoEm: nowISO() });
  adicionarHistorico(db, db.collection('orders').get(pedidoId), { tipo: 'operacional', status: 'cancelado', obs: motivo, por });
  // O cancelamento não representa uma devolução física de mercadoria.
  return { ok: true, pedido: db.collection('orders').get(pedidoId) };
}

/**
 * Apenas o código interno que recebeu uma RECUSA DEFINITIVA do provedor
 * pode finalizar a criação interrompida. Não libera estoque se uma cobrança
 * tiver sido registrada antes de uma queda ou timeout.
 *
 * Não usar para respostas HTTP 408/429/5xx nem falhas de rede.
 */
export function cancelarCriacaoComRecusaDefinitiva(db, pedidoId) {
  const pedido = db.collection('orders').get(pedidoId);
  if (!pedido || pedido.statusFinanceiro !== 'pendente' ||
      pedido.pendenciaPagamento !== 'criacao_em_andamento' || pedido.pagamentoId ||
      db.collection('payments').find(p => p.pedidoId === pedidoId).length) {
    return { ok: false, erro: 'Cobrança não comprovadamente recusada; conferência necessária.' };
  }
  // O bloqueio protetivo só é suspenso quando o provedor confirmou que
  // NÃO foi criado pagamento e não há pagamento local do pedido.
  db.collection('orders').update(pedidoId, { pendenciaPagamento: null });
  const cancelado = cancelarPedido(db, pedidoId, {
    motivo: 'Cobrança recusada ou integração não configurada; reserva liberada.',
    por: 'sistema',
  });
  if (!cancelado.ok) {
    // Reserva inconsistente: mantenha o pedido bloqueado para auditoria.
    db.collection('orders').update(pedidoId, {
      pendenciaPagamento: 'conciliacao_necessaria',
    });
  }
  return cancelado;
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

export function vendasPorDia(db, dias = 30, fim = new Date()) {
  const out = [];
  const hoje = new Date(fim);
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

export function produtosMaisVendidos(db, limite = 10, { de = null, ate = null } = {}) {
  const mapa = new Map();
  for (const o of db.collection('orders').all()) {
    if (o.statusFinanceiro !== 'aprovado') continue;
    const dia = String(o.criadoEm || '').slice(0, 10);
    if ((de && dia < de) || (ate && dia > ate)) continue;
    for (const it of o.itens || []) {
      const atual = mapa.get(it.produtoId) || { produtoId: it.produtoId, nome: it.nome, quantidade: 0, receitaCentavos: 0 };
      atual.quantidade += it.quantidade;
      atual.receitaCentavos += it.subtotalCentavos;
      mapa.set(it.produtoId, atual);
    }
  }
  return Array.from(mapa.values()).sort((a, b) => b.quantidade - a.quantidade).slice(0, limite);
}
