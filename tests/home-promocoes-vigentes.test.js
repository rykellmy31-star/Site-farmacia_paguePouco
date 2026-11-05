import test from 'node:test';
import assert from 'node:assert/strict';
import { vitrineProdutos, ordenarOfertasVigentes, searchProducts } from '../src/lib/catalog.js';
import { homePage } from '../src/views/public.js';

const DATA_QUARTA = new Date('2026-11-04T15:00:00.000Z');
const DATA_QUINTA = new Date('2026-11-05T15:00:00.000Z');
const DATA_SEXTA = new Date('2026-11-06T15:00:00.000Z');

function produto(id, { diaSemana = null, destaque = false, semPromocao = false,
  estoque = 4, vendas = 0, criadoEm = '2026-11-01T10:00:00Z',
  inicio = '2020-01-01', fim = '2099-12-31' } = {}) {
  return {
    id, slug: id, nome: id, ativo: true, destaque,
    estoque: { quantidade: estoque, reservado: 0, quarentena: 0 },
    precoCentavos: 2000, precoPromocionalCentavos: 0, vendas, criadoEm,
    imagens: [], sanitario: { classificacao: 'nao_aplicavel' },
    inovaPromocoes: semPromocao ? [] : [{
      inicio, fim, diaSemana,
      precoVendaCentavos: 2000, precoPromocionalCentavos: 1500,
    }],
  };
}
function banco(produtos) {
  return { collection: (nome) => ({
    all: () => nome === 'products' ? produtos : [],
    get: () => null,
  }) };
}
function contexto(db, secoes = ['ofertas', 'destaques']) {
  return {
    db, arvore: [], csrf: 'TOKEN_TESTE',
    req: { pathname: '/', query: new URLSearchParams() },
    settings: {
      empresa: { nomeFantasia: 'Farmácia Pague Pouco' },
      tema: {}, seo: {}, whatsapp: {}, cookies: {},
      home: { secoes: secoes.map((tipo, ordem) => ({
        tipo, ordem, ativo: true,
        titulo: tipo === 'destaques' ? 'Produtos em destaque' : 'Ofertas do dia',
        limite: 12,
      })) },
    },
  };
}

test('ofertas seguem quarta do bebê, quinta do esmalte, sexta e mês vigente', () => {
  const vigencia = { inicio: '2026-11-01', fim: '2026-11-30' };
  const db = banco([
    produto('black-friday', vigencia),
    produto('lenco-quarta', { ...vigencia, diaSemana: 'quarta' }),
    produto('esmalte-quinta', { ...vigencia, diaSemana: 'quinta' }),
    produto('beleza-sexta', { ...vigencia, diaSemana: 'sexta' }),
    produto('sem-desconto', { semPromocao: true }),
    produto('sem-estoque', { ...vigencia, estoque: 0 }),
  ]);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUARTA)
    .map((p) => p.id), ['lenco-quarta', 'black-friday']);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUINTA)
    .map((p) => p.id), ['esmalte-quinta', 'black-friday']);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_SEXTA)
    .map((p) => p.id), ['beleza-sexta', 'black-friday']);
  assert.equal(vitrineProdutos(db, 'ofertas', Infinity,
    new Date('2026-12-01T15:00:00Z')).length, 0);
});

test('a home mostra todas as ofertas válidas, mesmo acima do antigo limite de 12', () => {
  const itens = Array.from({ length: 15 }, (_, i) => produto('oferta-' + i));
  const db = banco(itens);
  assert.equal(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUARTA).length, 15);
  const html = homePage(contexto(db, ['ofertas']));
  assert.match(html, /<section class="secao" id="ofertas">/);
  assert.equal((html.match(/class="produto /g) || []).length, 15);
  assert.equal((html.match(/data-adicionar-carrinho="oferta-0"/g) || []).length, 1);
});

test('sem promoção ou destaques, omite seções e respectivos títulos da home', () => {
  const db = banco([produto('normal', { semPromocao: true })]);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', 12, DATA_QUARTA), []);
  assert.deepEqual(vitrineProdutos(db, 'destaques', 8, DATA_QUARTA), []);
  const html = homePage(contexto(db));
  assert.doesNotMatch(html, /<section class="secao" id="ofertas">/);
  assert.doesNotMatch(html, /<section class="secao" id="destaques">/);
  assert.doesNotMatch(html, /<h2>Ofertas do dia<\/h2>/);
  assert.doesNotMatch(html, /<h2>Produtos em destaque<\/h2>/);
});

test('destaque marcado aparece, sem repetir o item já mostrado nas ofertas', () => {
  const db = banco([
    produto('em-oferta-e-destaque', { destaque: true }),
    produto('destaque-manual', { semPromocao: true, destaque: true }),
    produto('comum', { semPromocao: true }),
  ]);
  const html = homePage(contexto(db));
  assert.match(html, /<section class="secao" id="ofertas">/);
  assert.match(html, /<section class="secao" id="destaques">/);
  assert.equal((html.match(/data-adicionar-carrinho="em-oferta-e-destaque"/g) || []).length, 1);
  assert.equal((html.match(/data-adicionar-carrinho="destaque-manual"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-adicionar-carrinho="comum"/);
  const apenasOferta = homePage(contexto(banco([
    produto('so-promo', { destaque: true }),
  ])));
  assert.doesNotMatch(apenasOferta, /<section class="secao" id="destaques">/);
});

test('mais vendidos e novidades mantêm a ordenação existente', () => {
  const db = banco([
    produto('antigo', { semPromocao: true, vendas: 11, criadoEm: '2026-10-01T00:00:00Z' }),
    produto('novo', { semPromocao: true, vendas: 1, criadoEm: '2026-11-04T00:00:00Z' }),
    produto('medio', { semPromocao: true, vendas: 5, criadoEm: '2026-10-15T00:00:00Z' }),
  ]);
  assert.deepEqual(vitrineProdutos(db, 'mais_vendidos', 3).map((p) => p.id),
    ['antigo', 'medio', 'novo']);
  assert.deepEqual(vitrineProdutos(db, 'novidades', 3).map((p) => p.id),
    ['novo', 'medio', 'antigo']);
});

test('oferta específica de quinta vem antes da promoção mensal mesmo com menor desconto', () => {
  const vigencia = { inicio: '2026-11-01', fim: '2026-11-30' };
  const mensal = { ...produto('black-farma', vigencia),
    inovaPromocoes: [{ inicio: vigencia.inicio, fim: vigencia.fim, diaSemana: null,
      precoVendaCentavos: 2000, precoPromocionalCentavos: 1000 }] }; // 50%
  const quinta = produto('esmalte', { ...vigencia, diaSemana: 'quinta' }); // 25%
  const outraQuinta = produto('acetona', { ...vigencia, diaSemana: 'quinta' });
  const sexta = produto('beleza-sexta', { ...vigencia, diaSemana: 'sexta' });
  const db = banco([mensal, quinta, sexta, outraQuinta]);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUINTA).map(p => p.id),
    ['acetona', 'esmalte', 'black-farma']);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_SEXTA).map(p => p.id),
    ['beleza-sexta', 'black-farma']);
  assert.deepEqual(searchProducts(db, {
    promocao: true, ordenar: 'ofertas_do_dia', porPagina: 24, referencia: DATA_QUINTA,
  }).rows.map(p => p.id), ['acetona', 'esmalte', 'black-farma']);
});

test('marcação manual do dia prioriza produto com desconto vigente, mas não cria promoção', () => {
  const mensal = produto('oferta-mensal');
  const marcado = { ...produto('esmalte-marcado'), diasPromocaoOrganizacao: ['quinta'] };
  const naoPromo = { ...produto('sem-desconto', { semPromocao: true }),
    diasPromocaoOrganizacao: ['quinta'] };
  const db = banco([mensal, naoPromo, marcado]);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUINTA).map(p => p.id),
    ['esmalte-marcado', 'oferta-mensal']);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_SEXTA).map(p => p.id),
    ['esmalte-marcado', 'oferta-mensal']); // Sem marcação de sexta: ambos são mensais.
  assert.equal(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUINTA)
    .some(p => p.id === 'sem-desconto'), false);
});

test('prioridade exige campanha semanal vigente e preserva filtros de estoque', () => {
  const promoVencida = produto('promo-vencida', {
    inicio: '2026-10-01', fim: '2026-10-31', diaSemana: 'quinta',
  });
  const mensal = produto('black');
  const zerado = produto('esmalte-sem-estoque', { diaSemana: 'quinta', estoque: 0 });
  const db = banco([promoVencida, mensal, zerado]);
  assert.deepEqual(vitrineProdutos(db, 'ofertas', Infinity, DATA_QUINTA).map(p => p.id), ['black']);
  assert.deepEqual(ordenarOfertasVigentes([mensal], DATA_QUINTA).map(p => p.id), ['black']);
});

test('página inicial mantém a ordem semanal e nenhum produto é duplicado na vitrine', async () => {
  // Este teste é independente do dia corrente: escolhe a terça/sexta calculada
  // pelo mesmo fuso da loja e verifica as referências reais da home.
  const { diaLocalFarmacia, diaSemanaLocalFarmacia } =
    await import('../src/lib/inovafarma-promocoes-precos.js');
  const hoje = diaLocalFarmacia(), dia = diaSemanaLocalFarmacia(hoje);
  const mensal = produto('mensal-home');
  const semanal = produto('semanal-home', { diaSemana: dia });
  const html = homePage(contexto(banco([mensal, semanal]), ['ofertas']));
  const primeiro = html.indexOf('data-adicionar-carrinho="semanal-home"');
  const segundo = html.indexOf('data-adicionar-carrinho="mensal-home"');
  assert.ok(primeiro >= 0 && segundo > primeiro);
  assert.equal((html.match(/data-adicionar-carrinho="semanal-home"/g) || []).length, 1);
});
