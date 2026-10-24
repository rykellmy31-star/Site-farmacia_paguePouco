import { config } from '../config.js';
/** routes/public.js — Rotas abertas do site (sem login). */
import { escapeHtml as e } from '../lib/security.js';
import { criarContexto } from './context.js';
import {
  homePage, departamentosPage, categoriaPage, produtoPage, buscaPage,
  paginaConteudo, paginaCep, paginaErro, paginaOfertas,
} from '../views/public.js';
import {
  categoriaPorSlug, searchProducts, produtosRelacionados, vitrineProdutos, montarArvore, marcasDisponiveis,
} from '../lib/catalog.js';
import { UFS, lookupCep } from '../lib/cep.js';
import { calcularFrete } from '../lib/freight.js';
import { deadlineText } from '../lib/freight.js';

const POR_PAGINA = 24;

export function registrarRotasPublicas(app, db) {
  /* ------------------------------- HOME ------------------------------- */
  app.get('/', (req, res) => {
    const ctx = criarContexto(req, db);
    res.html(homePage(ctx));
  });

  /* -------------------------- DEPARTAMENTOS --------------------------- */
  app.get('/departamentos', (req, res) => {
    const ctx = criarContexto(req, db);
    res.html(departamentosPage(ctx));
  });

  /* ----------------------------- CATEGORIA ---------------------------- */
  app.get('/categoria/:slug', (req, res) => {
    const ctx = criarContexto(req, db);
    const cat = categoriaPorSlug(db, req.params.slug);
    if (!cat) return void res.html(paginaErro(ctx, { codigo: 404, mensagem: 'Departamento não encontrado.' }), 404);
    const pagina = Number(req.query.get('pagina')) || 1;
    const ordenar = req.query.get('ordenar') || 'relevancia';
    const resultado = searchProducts(db, {
      categoriaSlug: cat.slug, pagina, porPagina: POR_PAGINA, ordenar,
    });
    res.html(categoriaPage(ctx, { categoria: cat, ...resultado, pagina, porPagina: POR_PAGINA, ordenar, filtros: {} }));
  });

  /* ----------------------------- PRODUTO ------------------------------ */
  app.get('/produto/:slug', (req, res) => {
    const ctx = criarContexto(req, db);
    const produto = db.collection('products').findOne((p) => p.slug === req.params.slug);
    if (!produto || produto.inovaArquivado?.em) return void res.html(paginaErro(ctx, { codigo: 404, mensagem: 'Produto não encontrado.' }), 404);
    const categoria = db.collection('categories').get(produto.categoriaId) || null;
    res.html(produtoPage(ctx, {
      produto,
      categoria,
      relacionados: produtosRelacionados(db, produto, 8),
      configLoja: ctx.settings.loja,
    }));
  });

  /* ------------------------------ BUSCA ------------------------------- */
  app.get('/busca', (req, res) => {
    const ctx = criarContexto(req, db);
    const termo = (req.query.get('q') || '').slice(0, 120);
    const pagina = Number(req.query.get('pagina')) || 1;
    const ordenar = req.query.get('ordenar') || 'relevancia';
    const resultado = searchProducts(db, { q: termo, pagina, porPagina: POR_PAGINA, ordenar });
    res.html(buscaPage(ctx, {
      termo, ...resultado, pagina, porPagina: POR_PAGINA, ordenar,
      filtros: { q: termo }, marcas: termo ? marcasDisponiveis(db) : [],
    }));
  });

  app.get('/marca/:marca', (req, res) => {
    const ctx = criarContexto(req, db);
    const marca = decodeURIComponent(req.params.marca);
    const pagina = Number(req.query.get('pagina')) || 1;
    const resultado = searchProducts(db, { marca, pagina, porPagina: POR_PAGINA });
    res.html(buscaPage(ctx, { termo: marca, ...resultado, pagina, porPagina: POR_PAGINA, ordenar: 'relevancia', filtros: {}, marcas: [] }));
  });

  app.get('/ofertas', (req, res) => {
    const ctx = criarContexto(req, db);
    const pagina = Number(req.query.get('pagina')) || 1;
    const resultado = searchProducts(db, { promocao: true, pagina, porPagina: POR_PAGINA, ordenar: 'maior_desconto' });
    res.html(paginaOfertas(ctx, { ...resultado, pagina, porPagina: POR_PAGINA }));
  });

  /* ------------------------------- CEP -------------------------------- */
  app.get('/cep', async (req, res) => {
    const ctx = criarContexto(req, db);
    const cepParam = req.query.get('cep') || '';
    let cepInfo = null;
    if (cepParam) cepInfo = await lookupCep(cepParam);
    const cfg = ctx.settings.frete;
    const fretes = UFS.map((u) => {
      const st = cfg.states?.[u.uf] || {};
      return {
        uf: u.uf, nome: u.nome, disponivel: !!st.ativo,
        valor: Number(st.valor || 0),
        prazo: deadlineText(st.prazoMin, st.prazoMax),
      };
    });
    const ctxComCep = { ...ctx, cepSessao: cepParam };
    res.html(paginaCep({ ...ctxComCep, req }, { cepInfo, fretes }));
    if (cepInfo?.uf) res.cookie('pp_cep', String(cepInfo.cep), { maxAge: 60 * 60 * 24 * 180 });
  });

  /* ------------------------- PÁGINAS DE CONTEÚDO ---------------------- */
  app.get('/pagina/:slug', (req, res) => {
    const ctx = criarContexto(req, db);
    const pagina = db.collection('pages').findOne((p) => p.slug === req.params.slug && p.publicada);
    if (!pagina) return void res.html(paginaErro(ctx, { codigo: 404, mensagem: 'Página não encontrada.' }), 404);
    res.html(paginaConteudo(ctx, { pagina }));
  });

  /* ------------------------------- SEO -------------------------------- */
  app.get('/robots.txt', (req, res) => {
    const base = config.publicBaseUrl;
    res.text(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /conta
Disallow: /checkout
Disallow: /api
Disallow: /busca

Sitemap: ${base}/sitemap.xml
`, 200, 'text/plain; charset=utf-8');
  });

  app.get('/sitemap.xml', (req, res) => {
    const base = config.publicBaseUrl;
    const hoje = new Date().toISOString().slice(0, 10);
    const urls = [
      `${base}/`, `${base}/departamentos`, `${base}/ofertas`, `${base}/cep`,
    ];
    for (const c of db.collection('categories').all()) {
      if (c.ativa !== false) urls.push(`${base}/categoria/${c.slug}`);
    }
    for (const p of db.collection('products').all()) {
      if (p.ativo) urls.push(`${base}/produto/${p.slug}`);
    }
    for (const p of db.collection('pages').all()) {
      if (p.publicada) urls.push(`${base}/pagina/${p.slug}`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${e(u)}</loc><lastmod>${hoje}</lastmod><changefreq>daily</changefreq><priority>${u.endsWith('/') ? '1.0' : '0.7'}</priority></url>`).join('\n')}
</urlset>`;
    res.text(xml, 200, 'application/xml; charset=utf-8');
  });

  app.get('/manifest.webmanifest', (req, res) => {
    const s = db.collection('settings').get('empresa') || {};
    res.text(JSON.stringify({
      name: s.nomeFantasia || 'Farmácia Pague Pouco',
      short_name: 'Pague Pouco',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#8b0000',
      icons: [{ src: '/img/favicon.svg?v=20261021-vermelho', sizes: 'any', type: 'image/svg+xml' }],
    }), 200, 'application/manifest+json');
  });
}

/** Handler de "página não encontrada" — usado como fallback dos arquivos estáticos. */
export function paginaNaoEncontrada(db) {
  return function naoEncontrada(req, res) {
    const ctx = criarContexto(req, db);
    res.html(paginaErro(ctx, { codigo: 404, mensagem: 'Página não encontrada.' }), 404);
  };
}

export function registrar404(app, db) {
  app.get('*', paginaNaoEncontrada(db));
}
