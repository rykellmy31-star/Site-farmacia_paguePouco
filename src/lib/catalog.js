/**
 * catalog.js — Regras de catálogo, busca, filtros e classificação sanitária.
 *
 * BLOQUEIOS SANITÁRIOS (RDC 44/2009 e normas correlatas) aplicados NO SERVIDOR:
 *  - Medicamento sujeito a prescrição (requerReceita / classificação "controlado")
 *    NÃO pode ser vendido pela loja virtual.
 *  - Produto sem aprovação do responsável técnico NÃO pode ser vendido.
 *  - Medicamento sem registro MS informado, quando exigível, fica bloqueado.
 * Esses bloqueios valem para vitrine, busca, carrinho e checkout.
 */
import { slugify } from './security.js';
import { inovaAtiva, estoqueInovaDisponivel } from './inovafarma-stock.js';

export const CLASSIFICACOES = {
  nao_aplicavel: { id: 'nao_aplicavel', nome: 'Não se aplica (não é medicamento)', exigeRegistro: false, vendaOnline: true },
  isento_prescricao: { id: 'isento_prescricao', nome: 'Medicamento isento de prescrição (MIP)', exigeRegistro: true, vendaOnline: true },
  controlado: { id: 'controlado', nome: 'Medicamento sujeito a controle especial', exigeRegistro: true, vendaOnline: false },
  generico: { id: 'generico', nome: 'Medicamento genérico (isento de prescrição)', exigeRegistro: true, vendaOnline: true },
  fitoterapico: { id: 'fitoterapico', nome: 'Fitoterápico', exigeRegistro: true, vendaOnline: true },
  suplemento: { id: 'suplemento', nome: 'Suplemento alimentar', exigeRegistro: false, vendaOnline: true },
  cosmético: { id: 'cosmético', nome: 'Cosmético / dermocosmético', exigeRegistro: false, vendaOnline: true },
  correlato: { id: 'correlato', nome: 'Correlato / produto para saúde', exigeRegistro: true, vendaOnline: true },
};

export function sanitarioDefault() {
  return {
    classificacao: 'nao_aplicavel',
    requerReceita: false,
    registroMS: '',
    apresentacao: '',
    concentracao: '',
    principioAtivo: '',
    fabricante: '',
    bulaUrl: '',
    aprovadoFarmaceutico: false,
    aprovadoPor: '',
    aprovadoEm: null,
    restricaoTransporte: false,
    restricaoAdvertencia: '',
    controlado: false,
    tarja: '',
  };
}

/**
 * Um produto pode ser vendido online?
 * @returns {{ok:boolean, motivo:string|null, codigo:string|null, bloqueioSanitario:boolean}}
 */
export function podeVender(produto) {
  if (!produto) return { ok: false, motivo: 'Produto inexistente.', codigo: 'NOT_FOUND', bloqueioSanitario: false };
  if (produto.inovaArquivado?.em) return { ok: false, motivo: 'Produto arquivado.', codigo: 'ARQUIVADO', bloqueioSanitario: false };
  if (!produto.ativo) return { ok: false, motivo: 'Produto inativo.', codigo: 'INATIVO', bloqueioSanitario: false };
  const s = { ...sanitarioDefault(), ...(produto.sanitario || {}) };

  if (s.controlado || s.requerReceita || s.classificacao === 'controlado') {
    return {
      ok: false,
      motivo: 'Medicamento sujeito a prescrição/controle especial: a venda online é bloqueada pelo sistema (RDC 44/2009).',
      codigo: 'CONTROLADO',
      bloqueioSanitario: true,
    };
  }
  if (CLASSIFICACOES[s.classificacao]?.exigeRegistro && !String(s.registroMS || '').trim()) {
    return {
      ok: false,
      motivo: 'Cadastro sanitário incompleto: informe o número de registro na Anvisa (MS).',
      codigo: 'SEM_REGISTRO',
      bloqueioSanitario: true,
    };
  }
  if (!s.aprovadoFarmaceutico && (s.classificacao === 'isento_prescricao' || s.classificacao === 'generico' || s.classificacao === 'fitoterapico' || s.classificacao === 'controlado')) {
    return {
      ok: false,
      motivo: 'Produto pendente de aprovação pelo farmacêutico responsável técnico.',
      codigo: 'AGUARDANDO_FARMACEUTICO',
      bloqueioSanitario: true,
    };
  }
  if (estoqueDisponivel(produto) <= 0) {
    return { ok: false, motivo: 'Produto esgotado.', codigo: 'SEM_ESTOQUE', bloqueioSanitario: false };
  }
  return { ok: true, motivo: null, codigo: null, bloqueioSanitario: false };
}

export function estoqueDisponivel(produto) {
  if (inovaAtiva()) return estoqueInovaDisponivel(produto);
  const e = produto?.estoque || {};
  return Math.max(0, Number(e.quantidade || 0) -
    Math.max(0, Number(e.reservado || 0)) -
    Math.max(0, Number(e.quarentena || 0)));
}

export function precoVigenteCentavos(produto) {
  const promo = Number(produto.precoPromocionalCentavos || 0);
  const normal = Number(produto.precoCentavos || 0);
  return promo > 0 && promo < normal ? promo : normal;
}

export function temPromocao(produto) {
  const promo = Number(produto.precoPromocionalCentavos || 0);
  const normal = Number(produto.precoCentavos || 0);
  return promo > 0 && promo < normal;
}

export function descontoPercentual(produto) {
  if (!temPromocao(produto)) return 0;
  return Math.round(((produto.precoCentavos - produto.precoPromocionalCentavos) / produto.precoCentavos) * 100);
}

export function productUrl(produto) {
  return `/produto/${produto.slug || slugify(produto.nome)}`;
}

export function categoryUrl(cat) {
  return `/categoria/${cat.slug}`;
}

export function imagemPrincipal(produto) {
  const imgs = produto.imagens || [];
  if (!imgs.length) return '/img/produto-sem-foto.svg';
  const principal = imgs.find((i) => (typeof i === 'object' ? i.principal : false));
  const escolhida = principal || imgs[0];
  return typeof escolhida === 'string' ? escolhida : escolhida.url;
}

export function montarArvore(db) {
  const cats = db.collection('categories').all().filter((c) => c.ativa !== false);
  const byId = new Map(cats.map((c) => [c.id, { ...c, filhas: [] }]));
  const raizes = [];
  for (const c of byId.values()) {
    if (c.paiId && byId.has(c.paiId)) byId.get(c.paiId).filhas.push(c);
    else if (!c.paiId) raizes.push(c);
  }
  const ordem = (a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  raizes.sort(ordem);
  for (const r of raizes) r.filhas.sort(ordem);
  return raizes;
}

export function categoriaPorSlug(db, slug) {
  return db.collection('categories').findOne((c) => c.slug === slug) || null;
}

export function categoriaPorId(db, id) {
  return db.collection('categories').get(id) || null;
}

export function descendentesDe(db, categoriaId) {
  const ids = new Set([String(categoriaId)]);
  let mudou = true;
  const todas = db.collection('categories').all();
  while (mudou) {
    mudou = false;
    for (const c of todas) {
      if (c.paiId && ids.has(String(c.paiId)) && !ids.has(String(c.id))) {
        ids.add(String(c.id));
        mudou = true;
      }
    }
  }
  return Array.from(ids);
}

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function searchProducts(db, {
  q = '', categoriaSlug = '', marca = '', ordenar = 'relevancia', pagina = 1,
  porPagina = 24, precoMin = null, precoMax = null, apenasDisponiveis = true,
  apenasVendaveis = true, promocao = false, termos = null,
} = {}) {
  let rows = db.collection('products').all().filter(p => !p.inovaArquivado?.em);

  if (apenasVendaveis) rows = rows.filter((p) => podeVender(p).ok || p.ativo);
  if (apenasDisponiveis) rows = rows.filter((p) => !apenasVendaveis || podeVender(p).ok);

  if (categoriaSlug) {
    const cat = categoriaPorSlug(db, categoriaSlug);
    if (cat) {
      const ids = new Set(descendentesDe(db, cat.id));
      rows = rows.filter((p) => ids.has(String(p.categoriaId)) || ids.has(String(p.subcategoriaId)));
    }
  }
  if (marca) rows = rows.filter((p) => normalize(p.marca) === normalize(marca));
  if (promocao) rows = rows.filter((p) => temPromocao(p));
  const pMin = precoMin != null && precoMin !== '' ? Number(precoMin) * 100 : null;
  const pMax = precoMax != null && precoMax !== '' ? Number(precoMax) * 100 : null;
  if (pMin != null) rows = rows.filter((p) => precoVigenteCentavos(p) >= pMin);
  if (pMax != null) rows = rows.filter((p) => precoVigenteCentavos(p) <= pMax);

  const termo = normalize(q).trim();
  if (termo && !termos) {
    const tokens = termo.split(/\s+/).filter(Boolean);
    rows = rows
      .map((p) => {
        const campos = [p.nome, p.marca, p.fabricante, p.sku, p.ean, p.sanitario?.principioAtivo, p.descricao]
          .map((v) => normalize(v || ''));
        const hay = campos.join(' ');
        let score = 0;
        for (const t of tokens) {
          if (!hay.includes(t)) { score = -1e9; break; }
          if (normalize(p.nome).startsWith(t)) score += 40;
          if (normalize(p.nome).includes(t)) score += 25;
          if (normalize(p.marca || '').includes(t)) score += 12;
          if (normalize(p.sanitario?.principioAtivo || '').includes(t)) score += 15;
          if (normalize(p.sku || '') === t || normalize(p.ean || '') === t) score += 60;
          score += 1;
        }
        return { p, score };
      })
      .filter((r) => r.score > -1e8)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.p);
  }

  const ordenadores = {
    relevancia: null,
    menor_preco: (a, b) => precoVigenteCentavos(a) - precoVigenteCentavos(b),
    maior_preco: (a, b) => precoVigenteCentavos(b) - precoVigenteCentavos(a),
    novidades: (a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')),
    mais_vendidos: (a, b) => Number(b.vendas || 0) - Number(a.vendas || 0),
    nome: (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
    maior_desconto: (a, b) => descontoPercentual(b) - descontoPercentual(a),
  };
  const cmp = ordenadores[ordenar];
  if (cmp) rows = rows.slice().sort(cmp);

  const total = rows.length;
  const inicio = (Math.max(1, Number(pagina) || 1) - 1) * porPagina;
  const paginaAtual = Math.max(1, Number(pagina) || 1);
  const itens = rows.slice(inicio, inicio + porPagina);
  // "produtos" é o nome usado pelas views; "rows" é mantido por compatibilidade
  return { produtos: itens, rows: itens, total, pagina: paginaAtual, porPagina };
}

export function vitrineProdutos(db, tipo, limite = 12) {
  const base = db.collection('products').all().filter((p) => p.ativo && podeVender(p).ok);
  const filtros = {
    ofertas: () => base.filter(temPromocao).sort((a, b) => descontoPercentual(b) - descontoPercentual(a)),
    destaques: () => base.filter((p) => p.destaque),
    mais_vendidos: () => base.slice().sort((a, b) => Number(b.vendas || 0) - Number(a.vendas || 0)),
    novidades: () => base.slice().sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''))),
  };
  const fn = filtros[tipo] || filtros.destaques;
  let rows = fn();
  if (!rows.length) rows = base.slice(0, limite);
  return rows.slice(0, limite);
}

export function marcasDisponiveis(db) {
  const set = new Map();
  for (const p of db.collection('products').all()) {
    if (!p.ativo || !p.marca) continue;
    set.set(p.marca, (set.get(p.marca) || 0) + 1);
  }
  return Array.from(set.entries()).map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total);
}

export function produtosRelacionados(db, produto, limite = 8) {
  if (!produto) return [];
  if ((produto.relacionados || []).length) {
    const manuais = produto.relacionados.map((id) => db.collection('products').get(id)).filter((p) => p && p.ativo && podeVender(p).ok);
    if (manuais.length) return manuais.slice(0, limite);
  }
  return db.collection('products')
    .all()
    .filter((p) => p.id !== produto.id && p.ativo && podeVender(p).ok && (p.categoriaId === produto.categoriaId || p.marca === produto.marca))
    .slice(0, limite);
}

export function slugUnicoProduto(db, nome, idAtual = null) {
  const base = slugify(nome) || 'produto';
  let slug = base;
  let n = 2;
  while (db.collection('products').findOne((p) => p.slug === slug && p.id !== idAtual)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export function slugUnicoCategoria(db, nome, idAtual = null) {
  const base = slugify(nome) || 'categoria';
  let slug = base;
  let n = 2;
  while (db.collection('categories').findOne((c) => c.slug === slug && c.id !== idAtual)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** Texto legal obrigatório na página do medicamento (editável no painel). */
export function avisoMedicamento(produto, settingsLoja) {
  const s = { ...sanitarioDefault(), ...(produto.sanitario || {}) };
  const isMed = ['isento_prescricao', 'generico', 'fitoterapico', 'controlado'].includes(s.classificacao);
  if (!isMed) return null;
  return {
    registro: s.registroMS ? `Registro MS: ${s.registroMS}` : null,
    principioAtivo: s.principioAtivo ? `Princípio ativo: ${s.principioAtivo}` : null,
    apresentacao: s.apresentacao || null,
    concentracao: s.concentracao || null,
    fabricante: s.fabricante || produto.fabricante || null,
    fraseObrigatoria: settingsLoja?.avisoMedicamento || 'MEDICAMENTO ISENTO DE PRESCRIÇÃO. SE PERSISTIREM OS SINTOMAS, O MÉDICO DEVERÁ SER CONSULTADO.',
    automedicacao: settingsLoja?.avisoAutomedicacao || '',
    bulaUrl: s.bulaUrl || null,
    bulaOficial: s.bulaUrl ? true : false,
  };
}
