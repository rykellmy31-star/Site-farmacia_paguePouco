import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIAS_BANNER, validarAgendamentoBanner, dataHojeBanner, bannerDeveAparecer,
  descricaoAgendamentoBanner, ordenarBanners, moverBanner,
} from '../src/lib/banner-agendamento.js';
import { homePage } from '../src/views/public.js';
import { telaBanners } from '../src/views/admin/catalogo.js';

const quarta = new Date('2026-11-04T15:00:00.000Z');
const quinta = new Date('2026-11-05T15:00:00.000Z');
const domingo = new Date('2026-11-08T15:00:00.000Z');
const base = (id, extra = {}) => ({
  id, titulo: id, imagem: '/img/fundo-banner-vermelho.svg', link: '/ofertas',
  posicao: 'principal', ordem: 1, ativo: true, ...extra,
});

function bancoBanners(lista) {
  const mapa = new Map(lista.map(b => [b.id, { ...b }]));
  const col = {
    all: () => [...mapa.values()],
    get: id => mapa.get(id) || null,
    update: (id, patch) => {
      const novo = { ...mapa.get(id), ...patch };
      mapa.set(id, novo);
      return novo;
    },
  };
  return { storage: { transactionSync: fn => fn() },
    collection: () => col, col };
}
function ctxPublico(lista) {
  return {
    db: { collection: name => ({
      all: () => name === 'banners' ? lista : [],
      get: () => null,
    }) },
    arvore: [], req: { pathname: '/', query: new URLSearchParams() },
    settings: { empresa: { nomeFantasia: 'Farmácia Pague Pouco' },
      tema: {}, seo: {}, whatsapp: {}, cookies: {},
      home: { secoes: [{ tipo: 'banners', ordem: 1, ativo: true }] } },
  };
}
function ctxAdmin() {
  return {
    adminUser: { id: 'admin', role: 'super_admin', nome: 'Super Admin' },
    csrf: 'TOKEN_TESTE', req: { pathname: '/admin/banners', query: new URLSearchParams() },
    settings: { empresa: { nomeFantasia: 'Farmácia Pague Pouco' }, tema: {} },
  };
}
test('banners antigos mantêm exibição diária e inativos nunca aparecem', () => {
  assert.equal(bannerDeveAparecer(base('antigo'), quarta), true);
  assert.equal(bannerDeveAparecer(base('antigo'), quinta), true);
  assert.equal(bannerDeveAparecer(base('inativo', { ativo: false }), quarta), false);
  assert.equal(bannerDeveAparecer(base('fora', { diaSemana: 'dia-invalido' }), quarta), false);
  assert.equal(descricaoAgendamentoBanner(base('antigo')), 'Todos os dias');
});

test('quarta do bebê só é exibida nas quartas, quinta do esmalte nas quintas', () => {
  const bebe = base('bebê', { diaSemana: 'quarta' });
  const esmalte = base('esmalte', { diaSemana: 'quinta' });
  assert.equal(bannerDeveAparecer(bebe, quarta), true);
  assert.equal(bannerDeveAparecer(bebe, quinta), false);
  assert.equal(bannerDeveAparecer(esmalte, quarta), false);
  assert.equal(bannerDeveAparecer(esmalte, quinta), true);
  assert.equal(descricaoAgendamentoBanner(bebe), 'Toda quarta-feira');
  assert.equal(descricaoAgendamentoBanner(base('domingo', { diaSemana: 'domingo' })), 'Todo domingo');
  assert.equal(bannerDeveAparecer(base('domingo', { diaSemana: 'domingo' }), domingo), true);
  assert.equal(DIAS_BANNER.length, 8);
});

test('vigência por intervalo é inclusiva e bloqueia dias fora das datas', () => {
  const b = base('novembro', { inicio: '2026-11-04', fim: '2026-11-05' });
  assert.equal(bannerDeveAparecer(b, new Date('2026-11-03T15:00:00Z')), false);
  assert.equal(bannerDeveAparecer(b, quarta), true);
  assert.equal(bannerDeveAparecer(b, quinta), true);
  assert.equal(bannerDeveAparecer(b, new Date('2026-11-06T15:00:00Z')), false);
  assert.equal(descricaoAgendamentoBanner(b), 'Todos os dias · 04/11/2026 até 05/11/2026');
  assert.equal(bannerDeveAparecer(base('inicio', { inicio: '2026-11-05' }), quarta), false);
  assert.equal(bannerDeveAparecer(base('fim', { fim: '2026-11-04' }), quinta), false);
});

test('o dia usa horário de Brasília no instante de trocar a data', () => {
  assert.equal(dataHojeBanner(new Date('2026-11-05T02:59:00Z')), '2026-11-04');
  assert.equal(dataHojeBanner(new Date('2026-11-05T03:00:00Z')), '2026-11-05');
  assert.equal(bannerDeveAparecer(base('bebe', { diaSemana: 'quarta' }),
    new Date('2026-11-05T02:59:00Z')), true);
  assert.equal(bannerDeveAparecer(base('bebe', { diaSemana: 'quarta' }),
    new Date('2026-11-05T03:00:00Z')), false);
});

test('validação rejeita datas falsas, invertidas e dia desconhecido sem modificar dados', () => {
  assert.deepEqual(validarAgendamentoBanner({ diaSemana: 'todos', inicio: '', fim: '' }), {
    ok: true, diaSemana: null, inicio: null, fim: null,
  });
  assert.deepEqual(validarAgendamentoBanner({ diaSemana: 'quarta',
    inicio: '2026-11-01', fim: '2026-11-30' }), {
    ok: true, diaSemana: 'quarta', inicio: '2026-11-01', fim: '2026-11-30',
  });
  assert.equal(validarAgendamentoBanner({ diaSemana: 'segunda-feira' }).ok, false);
  assert.equal(validarAgendamentoBanner({ inicio: '2026-02-30' }).ok, false);
  assert.equal(validarAgendamentoBanner({ inicio: '2026-12-01', fim: '2026-11-01' }).ok, false);
});

test('setas trocam a ordem real sem mudar faixa, conteúdo e ativação', () => {
  const db = bancoBanners([
    base('primeiro', { ordem: 1 }),
    base('segundo', { ordem: 2, diaSemana: 'quarta' }),
    base('terceiro', { ordem: 3, ativo: false }),
    base('faixa', { ordem: 1, posicao: 'secundario' }),
  ]);
  assert.equal(moverBanner(db, 'segundo', 'cima').alterado, true);
  assert.deepEqual(ordenarBanners(db.col.all().filter(b => b.posicao === 'principal'))
    .map(b => b.id), ['segundo', 'primeiro', 'terceiro']);
  assert.equal(db.col.get('segundo').diaSemana, 'quarta');
  assert.equal(db.col.get('terceiro').ativo, false);
  assert.equal(db.col.get('faixa').ordem, 1);
  assert.equal(moverBanner(db, 'segundo', 'cima').alterado, false);
  assert.equal(moverBanner(db, 'primeiro', 'baixo').alterado, true);
  assert.deepEqual(ordenarBanners(db.col.all().filter(b => b.posicao === 'principal'))
    .map(b => b.id), ['segundo', 'terceiro', 'primeiro']);
  assert.equal(moverBanner(db, 'fantasma', 'cima').status, 404);
  assert.equal(moverBanner(db, 'primeiro', 'direita').status, 400);
});

test('home oculta banner agendado fora do dia e mantém banner permanente', () => {
  const todos = base('sempre', { ordem: 1 });
  const hoje = dataHojeBanner();
  const [y, m, d] = hoje.split('-').map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const outroDia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][(dia + 1) % 7];
  const somenteOutroDia = base('banner-amanha', { ordem: 2, diaSemana: outroDia });
  const html = homePage(ctxPublico([todos, somenteOutroDia]));
  assert.match(html, /class="carrossel/);
  assert.match(html, /alt="sempre"/);
  assert.doesNotMatch(html, /alt="banner-amanha"/);
  assert.doesNotMatch(homePage(ctxPublico([somenteOutroDia])),
    /<section class="secao" id="banners"/);
});

test('admin exibe dia e período e botões de posição sem precisar recriar o banner', () => {
  const b = base('QUARTA DO BEBÊ', { diaSemana: 'quarta', ordem: 2,
    inicio: '2026-11-01', fim: '2026-12-31' });
  const html = telaBanners(ctxAdmin(), {
    banners: [base('primeiro'), b], categorias: [], midias: [], editando: b,
  });
  assert.match(html, /name="diaSemana"/);
  assert.match(html, /name="inicio"/);
  assert.match(html, /name="fim"/);
  assert.match(html, /value="quarta" selected/);
  assert.match(html, /01\/11\/2026 até 31\/12\/2026/);
  assert.match(html, /data-mover-banner="primeiro"/);
  assert.match(html, /data-mover-banner="QUARTA DO BEBÊ"/);
  assert.match(html, /aria-label="Subir QUARTA DO BEBÊ"/);
  assert.match(html, /data-direcao-banner="baixo"/);
  assert.match(html, /Programar exibição automática/);
});

test('API de movimentação exige permissão e mantém CSRF do admin', () => {
  const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  assert.match(routes, /\/admin\/api\/banners\/:id\/mover/);
  assert.match(routes, /if \(!guardApi\(req, res, 'banners\.editar'\)\) return;/);
  assert.match(admin, /data-mover-banner/);
  assert.match(admin, /post\(`\/admin\/api\/banners\/\$\{encodeURIComponent\(id\)\}\/mover`/);
});
