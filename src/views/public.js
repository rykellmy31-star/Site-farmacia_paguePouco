/** views/public.js — Páginas do site: home, departamentos, categoria, produto, busca e conteúdo. */
import { escapeHtml as e, sanitizeHtml } from '../lib/security.js';
import {
  montarArvore, categoriaPorSlug, searchProducts, vitrineProdutos,
  produtosRelacionados, imagemPrincipal, precoVigenteCentavos, temPromocao,
  descontoPercentual, podeVender, estoqueDisponivel, avisoMedicamento, categoryUrl,
} from '../lib/catalog.js';
import { paginaPublica, money, ICONES } from './layout.js';
import {
  vitrina, secaoVitrina, migalhas, paginacao, cartaoProduto, enderecoHtml,
} from './partials.js';
import { formatDate } from '../lib/format.js';
import { STATUS_OPERACIONAL, STATUS_FINANCEIRO } from '../lib/orders.js';

/* ------------------------------------------------------------------ */
/* HOME                                                                */
/* ------------------------------------------------------------------ */
// Atualiza as imagens padrão no navegador após a troca de cores.
function bannerImageUrl(value) {
  return typeof value === 'string' && new RegExp('^/uploads/banners/banner-principal-[123][.]svg$').test(value)
    ? value + '?v=vermelho-20261020'
    : value;
}

export function carrosselBanners(banners, id = 'carrosselPrincipal') {
  if (!banners.length) return '';
  return `
  <div class="carrossel${banners.length > 1 ? ' com-controles' : ''}" id="${e(id)}" data-carrossel>
    <div class="trilha" data-trilha>
      ${banners.map((b, i) => `
        <div class="slide">
          ${b.link ? `<a href="${e(b.link)}">` : '<span>'}
            <picture>
              ${b.imagemMobile ? `<source media="(max-width: 640px)" srcset="${e(bannerImageUrl(b.imagemMobile))}">` : ''}
              <img src="${e(bannerImageUrl(b.imagem))}" alt="${e(b.titulo || 'Banner promocional')}" ${i === 0 ? '' : 'loading="lazy"'} width="1200" height="420">
            </picture>
            ${b.imagem === '/img/fundo-banner-vermelho.svg' && (b.titulo || b.descricao) ? `
            <div class="banner-texto-sobreposto">
              ${b.titulo ? `<h2>${e(b.titulo)}</h2>` : ''}
              ${b.descricao ? `<p>${e(b.descricao)}</p>` : ''}
              <span class="banner-cta">Ver ofertas <span aria-hidden="true">→</span></span>
            </div>` : ''}
          ${b.link ? '</a>' : '</span>'}
        </div>`).join('')}
    </div>
    ${banners.length > 1 ? `
      <button class="seta esquerda" type="button" data-carrossel-anterior aria-label="Banner anterior">‹</button>
      <button class="seta direita" type="button" data-carrossel-proximo aria-label="Próximo banner">›</button>
      <div class="pontos" data-pontos>
        ${banners.map((b, i) => `<button class="ponto ${i === 0 ? 'ativo' : ''}" type="button" data-carrossel-ir="${i}" aria-label="Ir ao banner ${i + 1}"></button>`).join('')}
      </div>` : ''}
  </div>`;
}

function secaoDepartamentos(arvore) {
  return `
  <section class="secao" id="departamentos">
    <div class="cabecalho-secao">
      <h2>Departamentos</h2>
      <a class="ver-todos" href="/departamentos">Ver todos ${ICONES.seta}</a>
    </div>
    <div class="grade-departamentos">
      ${arvore.map((c) => `
        <a class="departamento" href="${e(categoryUrl(c))}">
          <div class="icone" aria-hidden="true">${e(c.icone || '💊')}</div>
          <span>${e(c.nome)}</span>
        </a>`).join('')}
    </div>
  </section>`;
}

function secaoEntregas(settings) {
  const home = settings.home || {};
  return `
  <section class="secao" id="entregas">
    <div class="painel" style="background:linear-gradient(135deg,var(--primaria-clara),#fff)">
      <div class="linha coluna" style="gap:6px">
        <h2 class="mb-0">${e(home.entregaTitulo || 'Entregas para todo o Brasil')}</h2>
        <p class="mb-0">${e(home.entregaTexto || '')}</p>
        <div class="beneficios-entrega" aria-label="Benefícios de entrega e compra">
          <span class="beneficio-entrega">${ICONES.caminhao} Frete fixo por estado</span>
          <span class="beneficio-entrega">${ICONES.cadeado} Compra segura</span>
          <a class="beneficio-entrega beneficio-link" href="/pagina/entregas-e-fretes">Como calculamos o frete</a>
        </div>
      </div>
    </div>
  </section>`;
}

function secaoInstitucional(settings) {
  const home = settings.home || {};
  return `
  <section class="secao" id="institucional">
    <div class="pagina-conteudo">
      <h2>${e(home.institucionalTitulo || 'Quem somos')}</h2>
      <p class="mb-0">${e(home.institucionalTexto || '')}</p>
      <p class="mb-0 mt-2">
        <a class="botao secundario pequeno" href="/pagina/quem-somos">Conheça a farmácia</a>
        <a class="botao secundario pequeno" href="/pagina/atendimento-farmaceutico">Atendimento farmacêutico</a>
        <a class="botao secundario pequeno" href="/pagina/informacoes-sanitarias">Informações sanitárias</a>
      </p>
    </div>
  </section>`;
}

function vitrinesPersonalizadas(db, ctx) {
  const vitrines = db.collection('showcases').all()
    .filter((v) => v.ativa !== false)
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
  if (!vitrines.length) return '';
  return vitrines.map((v) => {
    let produtos = [];
    if (v.tipo === 'categoria' && v.categoriaId) {
      const res = searchProducts(db, { categoriaSlug: v.categoriaSlug, porPagina: Number(v.limite) || 12 });
      produtos = res.rows;
    } else if (v.tipo === 'marca' && v.marca) {
      const res = searchProducts(db, { marca: v.marca, porPagina: Number(v.limite) || 12 });
      produtos = res.rows;
    } else if (v.tipo === 'dinamica') {
      produtos = vitrineProdutos(db, v.origem || 'destaques', Number(v.limite) || 12);
    } else {
      produtos = (v.produtosIds || []).map((id) => db.collection('products').get(id)).filter(Boolean);
    }
    return secaoVitrina({
      id: `vitrine-${v.id}`,
      titulo: v.titulo,
      link: v.link || '',
      produtos,
      rolagem: v.rolagem !== false,
    });
  }).join('');
}

export function homePage(ctx) {
  const { db, settings } = ctx;
  const arvore = ctx.arvore || montarArvore(db);
  const home = settings.home || {};
  const secoesAtivas = (home.secoes || []).filter((s) => s.ativo).sort((a, b) => a.ordem - b.ordem);
  const banners = db.collection('banners').all()
    .filter((b) => b.ativo !== false && (b.posicao || 'principal') === 'principal')
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
  const bannersSec = db.collection('banners').all()
    .filter((b) => b.ativo !== false && b.posicao === 'secundario')
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));

  const blocos = secoesAtivas.map((s) => {
    switch (s.tipo) {
      case 'banners':
        return `<section class="secao" id="banners" style="margin-top:14px">${carrosselBanners(banners)}
          ${bannersSec.length ? `<div class="vitrine vitrine-banners mt-2" style="--colunas-banner:${Math.min(bannersSec.length, 3)}">
            ${bannersSec.map((b) => `<a href="${e(b.link || '#')}"><img src="${e(bannerImageUrl(b.imagem))}" alt="${e(b.titulo || '')}" loading="lazy" style="border-radius:12px"></a>`).join('')}
          </div>` : ''}
        </section>`;
      case 'categorias': return secaoDepartamentos(arvore);
      case 'ofertas': return secaoVitrina({ id: 'ofertas', titulo: s.titulo || 'Ofertas do dia', link: '/ofertas', produtos: vitrineProdutos(db, 'ofertas', s.limite || 12) });
      case 'destaques': return secaoVitrina({ id: 'destaques', titulo: s.titulo || 'Destaques', produtos: vitrineProdutos(db, 'destaques', s.limite || 8) });
      case 'mais_vendidos': return secaoVitrina({ id: 'mais-vendidos', titulo: s.titulo || 'Mais vendidos', produtos: vitrineProdutos(db, 'mais_vendidos', s.limite || 8) });
      case 'novidades': return secaoVitrina({ id: 'novidades', titulo: s.titulo || 'Novidades', produtos: vitrineProdutos(db, 'novidades', s.limite || 8) });
      case 'vitrines': return vitrinesPersonalizadas(db, ctx);
      case 'entregas': return secaoEntregas(settings);
      case 'institucional': return secaoInstitucional(settings);
      default: return '';
    }
  }).join('');

  return paginaPublica(ctx, {
    titulo: '',
    conteudo: `<div class="container">${blocos}</div>`,
  });
}

/* ------------------------------------------------------------------ */
/* DEPARTAMENTOS                                                       */
/* ------------------------------------------------------------------ */
export function departamentosPage(ctx) {
  const arvore = ctx.arvore || montarArvore(ctx.db);
  return paginaPublica(ctx, {
    titulo: 'Departamentos',
    descricao: 'Todos os departamentos da Farmácia Pague Pouco.',
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Departamentos' }])}
      <h1>Departamentos</h1>
      <div class="vitrine" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
        ${arvore.map((c) => `
          <a class="departamento" href="${e(categoryUrl(c))}">
            <div class="icone">${e(c.icone || '💊')}</div>
            <span>${e(c.nome)}</span>
            ${(c.filhas || []).length ? `<span class="texto-pequeno texto-suave">${c.filhas.length} subcategoria(s)</span>` : ''}
          </a>`).join('')}
      </div>
      ${arvore.map((c) => (c.filhas || []).length ? `
        <section class="secao">
          <h2>${e(c.nome)}</h2>
          <div class="vitrine">
            ${c.filhas.map((f) => cartaoProdutoContainer(ctx, f)).join('')}
          </div>
        </section>` : '').join('')}
    </div>`,
  });
}

function cartaoProdutoContainer(ctx, cat) {
  return `<a class="departamento" href="${e(categoryUrl(cat))}">
    <div class="icone">${e(cat.icone || '•')}</div>
    <span>${e(cat.nome)}</span>
  </a>`;
}

/* ------------------------------------------------------------------ */
/* CATEGORIA / BUSCA                                                   */
/* ------------------------------------------------------------------ */
export function categoriaPage(ctx, { categoria, produtos, total, pagina, porPagina, ordenar, filtros }) {
  const arvore = ctx.arvore || montarArvore(ctx.db);
  const filhas = (arvore.find((c) => c.id === categoria.id) || {}).filhas || categoria.filhas || [];
  return paginaPublica(ctx, {
    titulo: categoria.nome,
    descricao: categoria.descricao || `${categoria.nome} na Farmácia Pague Pouco.`,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Departamentos', url: '/departamentos' }, { texto: categoria.nome }])}
      <h1>${e(categoria.nome)}</h1>
      ${categoria.descricao ? `<p class="texto-suave">${sanitizeHtml(categoria.descricao)}</p>` : ''}
      ${filhas.length ? `<div class="filtros">
        <h3>Subcategorias</h3>
        <div class="linha" style="flex-wrap:wrap;gap:6px">
          ${filhas.map((f) => `<a class="botao pequeno secundario" href="${e(categoryUrl(f))}">${e(f.nome)}</a>`).join('')}
        </div>
      </div>` : ''}
      ${barraOrdenacao(ordenar, total, filtros)}
      ${vitrina(produtos, { vazia: 'Nenhum produto nesta categoria no momento.' })}
      ${paginacao({ pagina, total, porPagina, baseUrl: `/categoria/${categoria.slug}`, query: { ordenar } })}
    </div>`,
  });
}

export function buscaPage(ctx, { termo, produtos, total, pagina, porPagina, ordenar, filtros, marcas }) {
  return paginaPublica(ctx, {
    titulo: termo ? `Busca: ${termo}` : 'Buscar produtos',
    descricao: `Resultados da busca por ${termo} na Farmácia Pague Pouco.`,
    semIndex: true,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: `Busca: ${termo}` }])}
      <h1>${termo ? `Resultados para "${e(termo)}"` : 'Buscar produtos'}</h1>
      <p class="texto-suave">${total} ${total === 1 ? 'produto encontrado' : 'produtos encontrados'}</p>
      ${marcas.length ? `<div class="filtros"><h3>Marcas encontradas</h3>
        <div class="linha" style="flex-wrap:wrap;gap:6px">
          ${marcas.slice(0, 20).map((m) => `<a class="botao pequeno secundario" href="/marca/${e(encodeURIComponent(m.nome))}">${e(m.nome)} (${m.total})</a>`).join('')}
        </div></div>` : ''}
      ${barraOrdenacao(ordenar, total, filtros)}
      ${vitrina(produtos, { vazia: 'Nenhum produto encontrado. Tente outra palavra-chave ou verifique a ortografia.' })}
      ${paginacao({ pagina, total, porPagina, baseUrl: '/busca', query: { q: termo, ordenar } })}
    </div>`,
  });
}

function barraOrdenacao(ordenar, total, filtros = {}) {
  const opcoes = [
    ['relevancia', 'Mais relevantes'], ['menor_preco', 'Menor preço'], ['maior_preco', 'Maior preço'],
    ['maior_desconto', 'Maior desconto'], ['mais_vendidos', 'Mais vendidos'], ['novidades', 'Novidades'], ['nome', 'A-Z'],
  ];
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v) qs.set(k, v);
  return total > 0 ? `
  <form class="filtros" method="get" id="formOrdenacao">
    ${Object.entries(filtros).filter(([, v]) => v).map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('')}
    <div class="linha centro entre" style="flex-wrap:wrap;gap:10px">
      <div class="linha centro ordenacao-campo" style="gap:8px">
        <label class="rotulo mb-0" for="ordenar">Ordenar por</label>
        <select id="ordenar" name="ordenar" class="entrada" style="width:auto;min-width:170px" onchange="this.form.submit()">
          ${opcoes.map(([v, t]) => `<option value="${v}" ${ordenar === v ? 'selected' : ''}>${e(t)}</option>`).join('')}
        </select>
      </div>
      <noscript><button class="botao pequeno secundario" type="submit">Aplicar</button></noscript>
    </div>
  </form>` : '';
}

/* ------------------------------------------------------------------ */
/* PRODUTO                                                             */
/* ------------------------------------------------------------------ */
export function produtoPage(ctx, { produto, categoria, relacionados, configLoja }) {
  const venda = podeVender(produto);
  const imagens = produto.imagens || [];
  const videos = produto.videos || [];
  const preco = precoVigenteCentavos(produto);
  const disponivel = estoqueDisponivel(produto);
  const aviso = avisoMedicamento(produto, configLoja);
  const s = produto.sanitario || {};

  const galeria = `
  <div class="galeria">
    <div class="principal">
      <img id="imagemPrincipal" src="${e(imagens[0]?.url || '/img/produto-sem-foto.svg')}" alt="${e(produto.nome)}" width="500" height="500">
    </div>
    <div class="miniaturas">
      ${imagens.map((img, i) => `
        <button type="button" class="${i === 0 ? 'ativo' : ''}" data-miniatura="${e(img.url)}" aria-label="Ver imagem ${i + 1} de ${e(produto.nome)}">
          <img src="${e(img.url)}" alt="" loading="lazy">
        </button>`).join('')}
      ${videos.map((v, i) => `
        <button type="button" data-video="${e(v.url)}" aria-label="Ver vídeo ${i + 1}">
          <video src="${e(v.url)}" muted preload="metadata"></video>
        </button>`).join('')}
    </div>
  </div>`;

  const caracteristicas = Object.entries(produto.caracteristicas || {});
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: produto.nome,
    sku: produto.sku,
    brand: { '@type': 'Brand', name: produto.marca || '' },
    description: (produto.descricao || '').replace(/<[^>]+>/g, ' ').slice(0, 500),
    image: imagens.map((i) => i.url),
    offers: {
      '@type': 'Offer',
      price: (preco / 100).toFixed(2),
      priceCurrency: 'BRL',
      availability: disponivel > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  });

  return paginaPublica(ctx, {
    titulo: produto.nome,
    descricao: (produto.descricao || produto.nome).replace(/<[^>]+>/g, ' ').slice(0, 160),
    ogImage: imagens[0]?.url || '',
    headExtra: `<script type="application/ld+json">${jsonLd}</script>`,
    conteudo: `<div class="container">
      ${migalhas([
        { texto: 'Início', url: '/' },
        { texto: 'Departamentos', url: '/departamentos' },
        ...(categoria ? [{ texto: categoria.nome, url: categoryUrl(categoria) }] : []),
        { texto: produto.nome },
      ])}
      <div class="produto-detalhe">
        ${galeria}
        <div class="produto-info">
          ${produto.marca ? `<span class="marca">${e(produto.marca)}</span>` : ''}
          <h1>${e(produto.nome)}</h1>
          ${s.apresentacao ? `<p class="texto-suave mb-1">${e(s.apresentacao)}${s.concentracao ? ` — ${e(s.concentracao)}` : ''}</p>` : ''}
          <div class="bloco-preco">
            ${temPromocao(produto) ? `<span class="preco-antigo">${money(produto.precoCentavos)}</span>` : ''}
            <span class="preco">${money(preco)}</span>
            ${temPromocao(produto) ? `<span class="etiqueta laranja">-${descontoPercentual(produto)}%</span>` : ''}
            <p class="texto-pequeno texto-suave mb-0 mt-1">Em até 6x sem juros nos cartões. Consulte as condições no checkout.</p>
          </div>

          ${venda.ok && disponivel > 0 ? `
          <div class="linha centro compra-produto">
            <div class="quantidade">
              <button type="button" data-qtd="-1" aria-label="Diminuir quantidade">−</button>
              <input type="number" id="quantidadeProduto" value="1" min="1" max="${Math.min(99, disponivel)}" aria-label="Quantidade">
              <button type="button" data-qtd="1" aria-label="Aumentar quantidade">+</button>
            </div>
            <button type="button" class="botao destaque botao-adicionar-cesta" data-adicionar-carrinho="${e(produto.id)}" data-quantidade-input="quantidadeProduto">
              <span class="icone-cesta" aria-hidden="true">${ICONES.carrinho}</span>
              <span>Adicionar à cesta</span>
            </button>
          </div>
          <p class="texto-pequeno texto-suave mt-1">${disponivel} unidade(s) disponível(eis).</p>` : `
          <div class="alerta aviso">
            <strong>Indisponível para compra online.</strong><br>${e(venda.motivo || 'Produto esgotado.')}
          </div>`}

          ${aviso ? `
          <div class="aviso-sanitario-bloco">
            <strong>Informações do medicamento</strong>
            ${aviso.registro ? `<div>${e(aviso.registro)}</div>` : ''}
            ${aviso.principioAtivo ? `<div>${e(aviso.principioAtivo)}</div>` : ''}
            ${aviso.fabricante ? `<div>Fabricante: ${e(aviso.fabricante)}</div>` : ''}
            ${aviso.bulaUrl ? `<div class="mt-1"><a class="botao pequeno secundario" href="${e(aviso.bulaUrl)}" target="_blank" rel="noopener">Baixar bula (PDF)</a></div>` : ''}
            <div class="mt-1"><strong>${e(aviso.fraseObrigatoria)}</strong></div>
            ${aviso.automedicacao ? `<div class="mt-1">${e(aviso.automedicacao)}</div>` : ''}
          </div>` : ''}

          <div class="aba-conteudo">
            <div class="abas" role="tablist">
              <button class="ativo" data-aba="descricao" role="tab" aria-selected="true">Descrição</button>
              <button data-aba="caracteristicas" role="tab" aria-selected="false">Características</button>
              ${videos.length ? `<button data-aba="videos" role="tab" aria-selected="false">Vídeos</button>` : ''}
              ${aviso ? `<button data-aba="sanitario" role="tab" aria-selected="false">Informações sanitárias</button>` : ''}
            </div>
            <div class="painel-aba ativo" id="aba-descricao" role="tabpanel">${sanitizeHtml(produto.descricao || '<p>Descrição em breve.</p>')}</div>
            <div class="painel-aba" id="aba-caracteristicas" role="tabpanel">
              <ul class="caracteristicas">
                <li><span>Código interno</span><strong>${e(produto.codigoInterno || '—')}</strong></li>
                <li><span>SKU</span><strong>${e(produto.sku || '—')}</strong></li>
                ${produto.ean ? `<li><span>EAN</span><strong>${e(produto.ean)}</strong></strong></li>` : ''}
                ${produto.marca ? `<li><span>Marca</span><strong>${e(produto.marca)}</strong></li>` : ''}
                ${produto.fabricante ? `<li><span>Fabricante</span><strong>${e(produto.fabricante)}</strong></li>` : ''}
                ${s.classificacao && s.classificacao !== 'nao_aplicavel' ? `<li><span>Classificação</span><strong>${e(s.classificacao.replace(/_/g, ' '))}</strong></li>` : ''}
                ${s.registroMS ? `<li><span>Registro MS</span><strong>${e(s.registroMS)}</strong></li>` : ''}
                ${caracteristicas.map(([k, v]) => `<li><span>${e(k)}</span><strong>${e(String(v))}</strong></li>`).join('')}
              </ul>
            </div>
            ${videos.length ? `<div class="painel-aba" id="aba-videos" role="tabpanel">
              ${videos.map((v) => `<video src="${e(v.url)}" controls preload="metadata" style="width:100%;max-width:520px;border-radius:8px"></video>
                ${v.titulo ? `<p class="texto-pequeno texto-suave">${e(v.titulo)}</p>` : ''}`).join('')}
            </div>` : ''}
            ${aviso ? `<div class="painel-aba" id="aba-sanitario" role="tabpanel">
              <p><strong>Uso racional de medicamentos:</strong> este produto é destinado ao alívio de sintomas conforme a bula.
              Não utilize doses superiores às recomendadas.</p>
              <ul>
                <li>${e(aviso.fraseObrigatoria)}</li>
                <li>${e(aviso.automedicacao || 'Leia atentamente a bula antes de usar.')}</li>
                <li>Em caso de dúvidas, converse com o farmacêutico responsável pelo site.</li>
              </ul>
              <p class="mb-0 texto-pequeno">As informações desta página têm caráter informativo e não substituem a bula oficial
              nem a orientação de profissional de saúde. A bula oficial é fornecida pelo fabricante${aviso.bulaUrl ? ' e está disponível no link acima' : ''}.</p>
            </div>` : ''}
          </div>
        </div>
      </div>
      ${relacionados.length ? `
      <section class="secao">
        <div class="cabecalho-secao"><h2>Quem viu este produto também comprou</h2></div>
        ${vitrina(relacionados, { rolagem: true })}
      </section>` : ''}
    </div>`,
  });
}

/* ------------------------------------------------------------------ */
/* PÁGINAS DE CONTEÚDO                                                 */
/* ------------------------------------------------------------------ */
export function paginaConteudo(ctx, { pagina }) {
  return paginaPublica(ctx, {
    titulo: pagina.titulo,
    descricao: pagina.resumo || pagina.titulo,
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: pagina.titulo }])}
      <div class="pagina-conteudo">
        <h1>${e(pagina.titulo)}</h1>
        ${sanitizeHtml(pagina.conteudo || '')}
        ${pagina.atualizadoEm ? `<p class="texto-pequeno texto-suave mb-0 mt-3">Atualizado em ${formatDate(pagina.atualizadoEm)}.</p>` : ''}
      </div>
    </div>`,
  });
}

export function paginaCep(ctx, { cepInfo, fretes, produtosExemplo }) {
  return paginaPublica(ctx, {
    titulo: 'Consulta de CEP e frete',
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Consulta de CEP' }])}
      <h1>Consulte o frete para o seu CEP</h1>
      <form class="filtros" method="get" action="/cep">
        <div class="campo-linha">
          <div class="campo">
            <label for="cep">CEP</label>
            <input class="entrada" type="text" id="cep" name="cep" value="${e(cepInfo?.cep || '')}" placeholder="00000-000" inputmode="numeric" required>
          </div>
          <div class="campo" style="flex:0 0 auto;justify-content:flex-end;display:flex;align-items:flex-end">
            <button class="botao" type="submit">Consultar</button>
          </div>
        </div>
      </form>
      ${cepInfo ? `
        <div class="painel">
          <div class="corpo">
            ${cepInfo.erro
              ? `<div class="alerta erro">${e(cepInfo.erro)}</div>`
              : `<p><strong>CEP:</strong> ${e(String(cepInfo.cep).replace(/(\d{5})(\d{3})/, '$1-$2'))} —
                 <strong>UF:</strong> ${e(cepInfo.uf)} (${e(cepInfo.ufNome || '')})</p>
                 <p class="texto-pequeno texto-suave mb-0">Fonte da identificação do estado: ${e(cepInfo.fonte)}.
                 ${cepInfo.cidade ? `Cidade: ${e(cepInfo.cidade)}.` : ''}</p>`}
          </div>
        </div>` : ''}
      <div class="painel mt-3">
        <header><h3>Valores de frete por estado (fixos, definidos pela farmácia)</h3></header>
        <div class="corpo sem-padding">
          <div class="tabela-rolagem">
            <table class="tabela">
              <thead><tr><th>Estado</th><th>Frete</th><th>Prazo estimado</th><th>Situação</th></tr></thead>
              <tbody>
                ${fretes.map((f) => `<tr>
                  <td>${e(f.uf)} — ${e(f.nome)}</td>
                  <td>${f.disponivel ? money(f.valor) : '—'}</td>
                  <td>${f.disponivel ? e(f.prazo) : 'Sem entrega configurada'}</td>
                  <td>${f.disponivel ? '<span class="etiqueta verde">Ativo</span>' : '<span class="etiqueta cinza">Inativo</span>'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p class="texto-pequeno texto-suave">Os valores são definidos pela Farmácia Pague Pouco no painel administrativo e
      não correspondem necessariamente ao custo real de postagem. Consulte também a página
      <a href="/pagina/entregas-e-fretes">Entregas e Fretes</a>.</p>
    </div>`,
  });
}

export function paginaErro(ctx, { codigo = 404, mensagem = 'Página não encontrada.' }) {
  return paginaPublica(ctx, {
    titulo: `${codigo} — ${mensagem}`,
    semIndex: true,
    conteudo: `<div class="container">
      <div class="pagina-conteudo texto-centro">
        <h1>${codigo}</h1>
        <p>${e(mensagem)}</p>
        <p><a class="botao" href="/">Voltar à página inicial</a></p>
      </div>
    </div>`,
  });
}

export function paginaOfertas(ctx, { produtos, total, pagina, porPagina }) {
  return paginaPublica(ctx, {
    titulo: 'Ofertas e promoções',
    descricao: 'Ofertas do dia e promoções da Farmácia Pague Pouco.',
    conteudo: `<div class="container">
      ${migalhas([{ texto: 'Início', url: '/' }, { texto: 'Ofertas' }])}
      <h1>Ofertas e promoções</h1>
      <p class="texto-suave">${total} produto(s) em promoção.</p>
      ${vitrina(produtos, { vazia: 'Nenhuma oferta ativa no momento.' })}
      ${paginacao({ pagina, total, porPagina, baseUrl: '/ofertas' })}
    </div>`,
  });
}

export { STATUS_FINANCEIRO, STATUS_OPERACIONAL };
