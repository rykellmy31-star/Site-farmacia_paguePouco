/**
 * Pré-cadastro seguro a partir do catálogo autorizado da InovaFarma.
 * Endpoint do nosso CONECTOR (não é endpoint oficial da Precisão Sistemas).
 * Receber um lote não cria/ativa produtos e não muda preços ou estoques.
 */
import { nowISO } from './store.js';
import { slugUnicoProduto } from './catalog.js';
import { cleanText } from './security.js';

const EAN = /^\d{8,14}$/;
const MAX_LOTE = 250;
const MAX_CONSULTA = 50;

const chaveEAN = (ean) => 'inova-ean:' + ean;
const inteiroSeguro = (n) => Number.isSafeInteger(n) && n >= 0;

export function receberCatalogoInova(db, dados) {
  const loteId = String(dados?.loteId || '').trim();
  const geradoEm = String(dados?.geradoEm || '');
  const geradoMs = Date.parse(geradoEm);
  const itens = dados?.itens;
  const agora = Date.now();
  if (!/^[a-z0-9._:-]{8,100}$/i.test(loteId) ||
    !Number.isFinite(geradoMs) || geradoMs > agora + 60000 ||
    !Array.isArray(itens) || itens.length === 0 || itens.length > MAX_LOTE) {
    return { ok: false, status: 400, erro: 'Lote, data ou quantidade de produtos inválidos.' };
  }
  const eventos = db.collection('inovaCatalogBatches');
  if (eventos.get(loteId)) return { ok: true, duplicado: true, recebidos: 0 };
  const meta = db.collection('inovaCatalogMeta').get('catalogo');
  if (meta && geradoMs < Date.parse(meta.geradoEm))
    return { ok: false, status: 409, erro: 'Lote de catálogo anterior ao último recebido.' };

  const eans = new Set();
  const normalizados = [];
  // Validar o lote INTEIRO antes de persistir qualquer mudança.
  for (const it of itens) {
    const ean = String(it?.ean ?? '').trim();
    const nome = String(it?.nome ?? '').trim();
    const quantidade = it?.quantidade;
    const precoCentavos = it?.precoCentavos;
    if (!EAN.test(ean) || eans.has(ean) ||
        nome.length < 2 || nome.length > 200 || /[<>\x00-\x1f]/.test(nome) ||
        !inteiroSeguro(quantidade) ||
        (precoCentavos != null && (!inteiroSeguro(precoCentavos) || precoCentavos > 100000000))) {
      return { ok: false, status: 400, erro: 'Dados de catálogo inválidos ou EAN repetido.' };
    }
    eans.add(ean);
    const codigo = String(it?.codigoInterno ?? '').trim();
    const marca = String(it?.marca ?? '').trim();
    if (codigo.length > 40 || marca.length > 80 || /[<>\x00-\x1f]/.test(codigo + marca))
      return { ok: false, status: 400, erro: 'Código ou marca inválidos.' };
    normalizados.push({
      ean, nome, codigoInterno: codigo, marca,
      quantidade, precoCentavos: precoCentavos ?? null,
    });
  }

  // EAN é a identidade do rascunho. Nunca reabrir uma rejeição ou
  // reaprovação existente silenciosamente.
  const candidatos = db.collection('inovaCatalogCandidates');
  let novos = 0, atualizados = 0, ignorados = 0;
  const recebidosEm = nowISO();
  for (const entrada of normalizados) {
    const id = chaveEAN(entrada.ean);
    const atual = candidatos.get(id);
    if (!atual) {
      candidatos.insert({
        id, ...entrada, situacao: 'aguardando_revisao',
        ultimaFonteEm: geradoEm, recebidoEm: recebidosEm,
      });
      novos++;
    } else if (atual.situacao === 'aguardando_revisao') {
      candidatos.update(id, { ...entrada, ultimaFonteEm: geradoEm,
        recebidoEm: recebidosEm });
      atualizados++;
    } else {
      ignorados++;
    }
  }
  eventos.insert({ id:loteId, geradoEm, recebidosEm, total: itens.length,
    novos, atualizados, ignorados });
  const proximo = { geradoEm, recebidoEm: recebidosEm, ultimoLoteId:loteId,
    totalRecebidos: (meta?.totalRecebidos || 0) + itens.length };
  if (meta) db.collection('inovaCatalogMeta').update('catalogo', proximo);
  else db.collection('inovaCatalogMeta').insert({ id:'catalogo', ...proximo });
  return { ok: true, duplicado: false, recebidos: itens.length, novos, atualizados, ignorados };
}

export function listarCandidatosInova(db, { busca = '', situacao = '', saldo = 'disponivel', pagina = 1 } = {}) {
  const q = String(busca || '').toLowerCase().slice(0,100).trim();
  const statuses = new Set(['aguardando_revisao','importado','vinculado','ignorado']);
  const filtro = statuses.has(situacao) ? situacao : '';
  const produtos = db.collection('products').all();
  const porEAN = new Map();
  for(const p of produtos) {
    const e = String(p.ean || '');
    if (!porEAN.has(e)) porEAN.set(e, []);
    porEAN.get(e).push(p);
  }
  const todos = db.collection('inovaCatalogCandidates').all().map(c => {
    const encontrados = porEAN.get(c.ean) || [];
    return { ...c, vinculoAtual: encontrados.length === 1 ? encontrados[0].id : null,
      conflitoEAN: encontrados.length > 1 };
  }).filter(c => (saldo !== 'disponivel' || c.quantidade > 0) &&
    (!filtro || c.situacao === filtro) &&
    (!q || c.nome.toLowerCase().includes(q) || c.ean.includes(q) ||
      String(c.codigoInterno||'').toLowerCase().includes(q)))
    .sort((a,b) => String(b.recebidoEm).localeCompare(String(a.recebidoEm)) ||
      a.ean.localeCompare(b.ean));
  const page = Math.max(1, Math.min(100000, Number.parseInt(pagina,10) || 1));
  return { total: todos.length, pagina: page, porPagina:MAX_CONSULTA,
    candidatos: todos.slice((page-1)*MAX_CONSULTA, page*MAX_CONSULTA),
    estatisticas: {
      aguardando: db.collection('inovaCatalogCandidates').count(c=>c.situacao==='aguardando_revisao'),
      importados: db.collection('inovaCatalogCandidates').count(c=>c.situacao==='importado'),
    },
  };
}

export function revisarCandidatoInova(db, ean, acao) {
  if (!EAN.test(String(ean))) return { ok:false, erro:'EAN inválido.' };
  if (!['importar','ignorar'].includes(acao)) return { ok:false, erro:'Ação não permitida.' };
  const col = db.collection('inovaCatalogCandidates');
  const candidato = col.get(chaveEAN(ean));
  if (!candidato) return { ok:false, erro:'Produto não encontrado na importação.' };
  if (candidato.situacao !== 'aguardando_revisao')
    return { ok:false, erro:'Produto já revisado. Nenhuma nova ação foi executada.' };
  const correspondentes = db.collection('products').find(p=>String(p.ean||'')===ean);
  if (correspondentes.length > 1)
    return { ok:false, erro:'EAN duplicado na loja. Resolva o conflito manualmente.' };
  if (acao === 'ignorar') {
    col.update(candidato.id, {situacao:'ignorado', revisadoEm:nowISO()});
    return {ok:true,resultado:'ignorado'};
  }
  if (correspondentes.length === 1) {
    // Não substituir cadastro, preço, ativo ou estoque existente.
    col.update(candidato.id, {situacao:'vinculado', produtoId:correspondentes[0].id,
      revisadoEm:nowISO()});
    return {ok:true,resultado:'vinculado',produtoId:correspondentes[0].id};
  }
  const agora = nowISO();
  const produto = db.collection('products').insert({
    nome: cleanText(candidato.nome,200),slug:slugUnicoProduto(db,candidato.nome),
    codigoInterno:candidato.codigoInterno || '',sku:'',ean:candidato.ean,
    marca: candidato.marca || '',fabricante:'',categoriaId:null,subcategoriaId:null,
    descricao:'',caracteristicas:{},imagens:[],videos:[],
    precoCentavos: candidato.precoCentavos ?? 0,precoPromocionalCentavos:0,
    peso:0,dimensoes:{largura:0,altura:0,comprimento:0},
    ativo:false,destaque:false,
    // Bloqueia a venda até revisão sanitária humana, inclusive para medicamento.
    sanitario:{ classificacao:'nao_aplicavel',requerReceita:true,
      registroMS:'',aprovadoFarmaceutico:false,controlado:false },
    estoque:{quantidade:0,reservado:0,minimo:5},vendas:0,relacionados:[],
    inovaCatalogo:{ean:candidato.ean,importadoEm:agora,revisaoSanitariaPendente:true},
    criadoEm:agora,atualizadoEm:agora,
  });
  col.update(candidato.id,{situacao:'importado',produtoId:produto.id,revisadoEm:agora});
  return {ok:true,resultado:'importado',produtoId:produto.id};
}
