/**
 * Ponte de estoque INOVAFARMA — contrato do conector autorizado.
 *
 * Não tenta acessar banco/serviços privados da INOVAFARMA. Um conector
 * homologado consulta o ERP e transmite saldos absolutos com EAN, e confirma
 * pedidos somente depois de registrá-los no ERP.
 * Ativação é opt-in. Sem snapshot recente, a venda online falha fechada.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowISO } from './store.js';

const MAX_LOTE = 500;
const MAX_VENDAS = 100;
const EAN = /^\d{8,14}$/;

export function inovaAtiva() {
  return config.inova?.enabled === true;
}

export function autenticacaoInovaValida(authorization) {
  const expected = String(config.inova?.token || '');
  const recebido = /^Bearer ([^\s]+)$/i.exec(String(authorization || '').trim())?.[1] || '';
  if (!inovaAtiva() || expected.length < 32 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Só a Inova define o saldo-base. Reservas locais e vendas ainda não refletidas
 * no ERP são subtraídas temporariamente para impedir sobrevenda. */
export function estoqueInovaDisponivel(produto, agora = Date.now()) {
  const e = produto?.estoque || {};
  const ultimo = Date.parse(e.inovaRecebidoEm || '');
  const prazo = Math.max(1, Number(config.inova?.maxAgeMinutes || 15)) * 60_000;
  if (!Number.isFinite(ultimo) || ultimo > agora + 60_000 || agora - ultimo > prazo ||
      !Number.isSafeInteger(e.inovaQuantidade) || e.inovaQuantidade < 0) return 0;
  return Math.max(0, e.inovaQuantidade -
    Math.max(0, Number(e.reservado || 0)) -
    Math.max(0, Number(e.inovaPendente || 0)));
}

/** A fila nasce apenas de pedidos aprovados quando a integração está ligada.
 * Não importa vendas históricas nem entrega dados de clientes ao conector. */
export function vendasPendentesInova(db, limite = MAX_VENDAS) {
  return db.collection('orders').all()
    .filter(p => p.inovaEnvioPendente === true && !p.inovaConfirmadoEm &&
      p.statusFinanceiro === 'aprovado' && p.statusOperacional !== 'cancelado')
    .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)))
    .slice(0, Math.max(1, Math.min(MAX_VENDAS, Number(limite) || MAX_VENDAS)))
    .map(p => ({
      pedidoId: p.id,
      codigo: p.codigo,
      // Contrato INTERNO de preparação, não representa payload oficial do ERP.
      chaveIdempotencia: 'venda-online:' + p.codigo,
      criadoEm: p.criadoEm,
      vendedor: p.vendedor ? { codigoInova: String(p.vendedor.codigoInova), nome: p.vendedor.nome } : null,
      valores: {
        subtotalProdutosCentavos: p.subtotalCentavos,
        descontoTotalCentavos: p.descontoCentavos,
        freteCentavos: p.freteCentavos,
        totalPagoCentavos: p.totalCentavos,
        metodoPagamento: p.metodoPagamento,
      },
      aprovadoEm: (p.historico || []).findLast(x => x.tipo === 'financeiro' && x.status === 'aprovado')?.em || p.atualizadoEm,
      itens: (p.itens || []).map(item => {
        const produto = db.collection('products').get(item.produtoId);
        return {
          produtoId: item.produtoId,
          ean: item.ean || produto?.ean || null,
          quantidade: Number(item.quantidade),
          precoUnitarioCentavos: Number(item.precoUnitarioCentavos || 0),
          subtotalCentavos: Number(item.subtotalCentavos || 0),
        };
      }),
    }));
}

export function confirmarVendasInova(db, dados) {
  const vendas = dados?.vendas;
  if (!Array.isArray(vendas) || vendas.length < 1 || vendas.length > MAX_VENDAS) {
    return { ok: false, status: 400, erro: 'Informe de 1 a 100 vendas.' };
  }
  const ids = new Set();
  const referencias = new Set();
  const atualizar = [];
  for (const v of vendas) {
    const id = String(v?.pedidoId || '');
    const referencia = String(v?.referenciaInova || '').trim();
    if (!id || ids.has(id) || !referencia || referencia.length > 100 || referencias.has(referencia)) {
      return { ok: false, status: 400, erro: 'Pedido ou referência inválida/repetida.' };
    }
    ids.add(id);
    referencias.add(referencia);
    // Uma mesma referência externa nunca pode provar duas vendas diferentes.
    if (db.collection('orders').all().some(p => p.id !== id && p.inovaReferencia === referencia)) {
      return { ok: false, status: 409, erro: 'Referência Inova já associada a outro pedido.' };
    }
    const pedido = db.collection('orders').get(id);
    if (!pedido || pedido.inovaEnvioPendente !== true ||
        (!pedido.inovaConfirmadoEm && (pedido.statusFinanceiro !== 'aprovado' || pedido.statusOperacional === 'cancelado'))) {
      return { ok: false, status: 409, erro: 'Pedido fora da fila INOVAFARMA.' };
    }
    if (pedido.inovaConfirmadoEm && pedido.inovaReferencia !== referencia) {
      return { ok: false, status: 409, erro: 'Pedido já confirmado com outra referência.' };
    }
    if (!pedido.inovaConfirmadoEm) atualizar.push({ id, referencia });
  }
  for (const p of atualizar) db.collection('orders').update(p.id, {
    inovaConfirmadoEm: nowISO(), inovaReferencia: p.referencia,
  });
  return { ok: true, confirmadas: atualizar.length, duplicadas: vendas.length - atualizar.length };
}

/**
 * Recebe estoque absoluto por EAN. 'pedidosRefletidos' contém somente pedidos
 * já confirmados na Inova e efetivamente contabilizados no saldo deste lote.
 * Não interpreta confirmação de envio como baixa de estoque.
 */
export function importarEstoqueInova(db, dados, agora = Date.now()) {
  const loteId = String(dados?.loteId || '').trim();
  const geradoEm = String(dados?.geradoEm || '');
  const linhas = dados?.itens;
  const refletidos = dados?.pedidosRefletidos ?? [];
  const geradoMs = Date.parse(geradoEm);
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(loteId) ||
      !Number.isFinite(geradoMs) || geradoMs > agora + 60_000 ||
      !Array.isArray(linhas) || linhas.length < 1 || linhas.length > MAX_LOTE ||
      !Array.isArray(refletidos) || refletidos.length > MAX_VENDAS) {
    return { ok: false, status: 400, erro: 'Lote, data ou quantidade de itens inválidos.' };
  }
  const eventos = db.collection('inovaStockSync');
  if (eventos.get(loteId)) return { ok: true, duplicado: true, atualizados: 0 };
  const meta = db.collection('inovaSyncMeta').get('estoque');
  if (meta && geradoMs <= Date.parse(meta.geradoEm)) {
    return { ok: false, status: 409, erro: 'Lote mais antigo que o último estoque recebido.' };
  }

  const locais = new Map();
  for (const produto of db.collection('products').all()) {
    const ean = String(produto.ean || '').trim();
    if (!ean) continue;
    if (!locais.has(ean)) locais.set(ean, []);
    locais.get(ean).push(produto);
  }
  const lotes = [];
  const eans = new Set();
  for (const item of linhas) {
    const ean = String(item?.ean || '').trim();
    const qtd = item?.quantidade;
    if (!EAN.test(ean) || eans.has(ean) || !Number.isSafeInteger(qtd) || qtd < 0) {
      return { ok: false, status: 400, erro: 'EAN duplicado/inválido ou saldo não inteiro/negativo.' };
    }
    eans.add(ean);
    if (locais.get(ean)?.length !== 1) {
      return { ok: false, status: 409, erro: 'EAN não cadastrado de forma única no site: ' + ean };
    }
    lotes.push({ produto: locais.get(ean)[0], quantidade: qtd });
  }

  const ids = new Set();
  const pedidosRefletidos = [];
  for (const idBruto of refletidos) {
    const id = String(idBruto);
    if (!id || ids.has(id)) return { ok: false, status: 400, erro: 'Pedido refletido repetido/inválido.' };
    ids.add(id);
    const p = db.collection('orders').get(id);
    if (!p || !p.inovaConfirmadoEm || p.inovaEnvioPendente !== true ||
        !p.inovaReferencia || p.inovaRefletidoEm ||
        !(p.itens || []).every(i => eans.has(String(db.collection('products').get(i.produtoId)?.ean || '')))) {
      return { ok: false, status: 409, erro: 'Pedido não confirmado ou não coberto integralmente pelo lote.' };
    }
    pedidosRefletidos.push(p);
  }

  const recebidoEm = new Date(agora).toISOString();
  for (const p of pedidosRefletidos) db.collection('orders').update(p.id, { inovaRefletidoEm: recebidoEm });

  // Recalcula a dívida pelos pedidos, em vez de decrementar contadores no
  // replay. Isso mantém a operação idempotente após interrupções do Worker.
  const pendencias = new Map();
  for (const p of db.collection('orders').all()) {
    if (p.inovaEnvioPendente !== true || p.inovaRefletidoEm) continue;
    for (const item of p.itens || []) {
      pendencias.set(item.produtoId, (pendencias.get(item.produtoId) || 0) + Number(item.quantidade || 0));
    }
  }
  for (const { produto, quantidade } of lotes) {
    const e = produto.estoque || {};
    db.collection('products').update(produto.id, {
      estoque: { ...e, quantidade, inovaQuantidade: quantidade,
        inovaRecebidoEm: recebidoEm, inovaFonteEm: new Date(geradoMs).toISOString(),
        inovaPendente: pendencias.get(produto.id) || 0 },
      atualizadoEm: recebidoEm,
    });
  }
  eventos.insert({ id: loteId, geradoEm: new Date(geradoMs).toISOString(),
    recebidoEm, total: lotes.length, pedidosRefletidos: pedidosRefletidos.map(p => p.id) });
  const m = { geradoEm: new Date(geradoMs).toISOString(), recebidoEm, loteId };
  if (meta) db.collection('inovaSyncMeta').update('estoque', m);
  else db.collection('inovaSyncMeta').insert({ id: 'estoque', ...m });
  return { ok: true, atualizados: lotes.length, pedidosRefletidos: pedidosRefletidos.length };
}
