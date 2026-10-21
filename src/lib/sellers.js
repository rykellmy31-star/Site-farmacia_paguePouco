/** Cadastro isolado de vendedores da loja. Nunca contata o ERP. */
import { nowISO } from './store.js';

const CODIGO = /^[A-Za-z0-9._-]{1,40}$/;

export function vendedoresAtivos(db) {
  return db.collection('sellers').all()
    .filter(v => v.ativo === true)
    .sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function validarDadosVendedor(db, dados, idAtual = null) {
  const nome = String(dados?.nome ?? '').trim().replace(/\s+/g, ' ');
  const codigoInova = String(dados?.codigoInova ?? '');
  if (nome.length < 2 || nome.length > 120 || /[<>\x00-\x1f]/.test(nome)) {
    return { ok: false, erro: 'Informe um nome válido de 2 a 120 caracteres.' };
  }
  if (!CODIGO.test(codigoInova)) {
    return { ok: false, erro: 'Código InovaFarma obrigatório: 1 a 40 letras, números, pontos, hífens ou sublinhados, sem espaços.' };
  }
  if (db.collection('sellers').findOne(v =>
    v.id !== idAtual && String(v.codigoInova).toLowerCase() === codigoInova.toLowerCase())) {
    return { ok: false, erro: 'Já existe um vendedor com esse código InovaFarma.' };
  }
  return { ok: true, dados: { nome, codigoInova } };
}

export function cadastrarVendedor(db, dados) {
  const validado = validarDadosVendedor(db, dados);
  if (!validado.ok) return validado;
  const vendedor = db.collection('sellers').insert({
    ...validado.dados, ativo: dados.ativo !== false,
    criadoEm: nowISO(), atualizadoEm: nowISO(),
  });
  return { ok: true, vendedor };
}

export function editarVendedor(db, id, dados) {
  const anterior = db.collection('sellers').get(id);
  if (!anterior) return { ok: false, erro: 'Vendedor não encontrado.' };
  const validado = validarDadosVendedor(db, dados, id);
  if (!validado.ok) return validado;
  const vendedor = db.collection('sellers').update(id, {
    ...validado.dados, ativo: dados.ativo !== false, atualizadoEm: nowISO(),
  });
  return { ok: true, vendedor };
}

/** O navegador envia apenas o ID interno; jamais aceita código/nome do pedido. */
export function selecionarVendedorPedido(db, idRecebido) {
  const ativos = vendedoresAtivos(db);
  if (ativos.length === 0) {
    if (idRecebido) return { ok: false, erro: 'Vendedor não disponível. Atualize o checkout.' };
    return { ok: true, vendedor: null };
  }
  const id = String(idRecebido || '');
  const vendedor = ativos.find(v => v.id === id);
  if (!vendedor) return { ok: false, erro: 'Selecione um vendedor ativo para continuar.' };
  return { ok: true, vendedor: {
    id: vendedor.id, nome: vendedor.nome, codigoInova: vendedor.codigoInova,
  } };
}

export function metricasVendedores(db) {
  const pedidos = db.collection('orders').all();
  const porId = new Map();
  for (const pedido of pedidos) {
    // Somente pagamentos efetivamente aprovados e ainda válidos;
    // estornos solicitados, efetivados e cancelamentos não geram receita.
    if (pedido.statusFinanceiro !== 'aprovado' ||
        pedido.statusOperacional === 'cancelado' || !pedido.vendedor?.id) continue;
    const m = porId.get(pedido.vendedor.id) || { pedidos: 0, totalCentavos: 0 };
    m.pedidos++;
    m.totalCentavos += Number(pedido.totalCentavos || 0);
    porId.set(pedido.vendedor.id, m);
  }
  return porId;
}
