import { config } from '../config.js';
/**
 * views/layout.js — Layout público: cabeçalho, navegação, rodapé, WhatsApp,
 * barra de cookies e temas vindos das configurações do painel.
 */
import { escapeHtml, sanitizeHtml } from '../lib/security.js';
import { formatBRL, FUSO_LOJA } from '../lib/format.js';
import { montarArvore } from '../lib/catalog.js';
import { normalizarFundoHome } from '../lib/fundo-home.js';
import { estiloSeloDesconto } from '../lib/efeito-selo-desconto.js';
import { textoInstitucionalDinamico, dadosEmpresaVisiveis, campoCadastrado } from '../lib/dados-institucionais.js';
import { escapeHtml as e } from '../lib/security.js';

export { escapeHtml, sanitizeHtml };
export const money = (cents) => formatBRL((Number(cents) || 0) / 100);

export const ICONES = {
  busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  usuario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  carrinho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l2.4 12.4A2 2 0 0 0 9.4 17H19a2 2 0 0 0 2-1.6L22 8H6"/><circle cx="10" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.51.07-.78.37-.27.3-1.02 1-.99 2.43.03 1.43 1.05 2.81 1.2 3 .15.2 2.05 3.28 5.05 4.47 2.99 1.19 2.99.79 3.53.74.54-.05 1.75-.71 2-1.4.25-.69.25-1.28.17-1.4-.07-.13-.27-.2-.57-.35z"/><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.03h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.11.82.83-3.03-.2-.31a8.19 8.19 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.2-8.25 8.2z"/></svg>',
  caminhao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h13v13H1z"/><path d="M14 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/></svg>',
  cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  estrela: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6.6 7 .6-5.3 4.6 1.6 6.8L12 17l-5.3 3.6L8.3 14 3 9.2l7-.6z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  casa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
  etiqueta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/></svg>',
};

/**
 * Monta o link do WhatsApp com mensagem codificada e número ofuscado no HTML.
 * Canal EXCLUSIVO PARA DÚVIDAS (nunca é usado para finalizar compras).
 */
export function linkWhatsApp(whatsapp, extra = '') {
  const numero = String(whatsapp?.numero || '').replace(/\D/g, '');
  const mensagem = encodeURIComponent(`${whatsapp?.mensagem || 'Olá! Gostaria de tirar uma dúvida.'}${extra}`);
  return numero ? `https://wa.me/${numero}?text=${mensagem}` : '';
}

export function horarioAtendimentoAgora(whatsapp, agora = new Date()) {
  if (!whatsapp?.respeitarHorario) return { aberto: true, texto: '' };
  // O Worker usa UTC; consultar horário e dia útil no fuso real da loja.
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_LOJA, weekday: 'long', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const valor = tipo => partes.find(p => p.type === tipo)?.value || '';
  const dias = { Sunday:'domingo', Monday:'segunda', Tuesday:'terca',
    Wednesday:'quarta', Thursday:'quinta', Friday:'sexta', Saturday:'sabado' };
  const hoje = dias[valor('weekday')];
  const cfg = (whatsapp.horarios || []).find((h) => h.dia === hoje);
  if (!cfg || !cfg.ativo) return { aberto: false, texto: whatsapp.mensagemIndisponivel || '' };
  const minutos = Number(valor('hour')) * 60 + Number(valor('minute'));
  const [hi, mi] = String(cfg.inicio || '00:00').split(':').map(Number);
  const [hf, mf] = String(cfg.fim || '00:00').split(':').map(Number);
  const dentro = minutos >= hi * 60 + mi && minutos <= hf * 60 + mf;
  return { aberto: dentro, texto: dentro ? '' : (whatsapp.mensagemIndisponivel || '') };
}

function widgetWhatsApp(whatsapp, pathname) {
  if (!whatsapp?.ativo) return '';
  const paginas = whatsapp.paginas || ['todas'];
  if (!paginas.includes('todas') && !paginas.some((p) => pathname.startsWith(p))) return '';
  const numero = String(whatsapp.numero || '').replace(/\D/g, '');
  if (!numero) return '';
  const { aberto, texto } = horarioAtendimentoAgora(whatsapp);
  const link = linkWhatsApp(whatsapp);
  const pos = whatsapp.posicao === 'esquerda' ? 'esquerda' : '';
  // Somente cores hexadecimais: valores do painel nunca são CSS arbitrário.
  const corFundo = /^#[0-9a-f]{6}$/i.test(whatsapp.botaoCorFundo || '')
    ? whatsapp.botaoCorFundo : '#25d366';
  const corTexto = /^#[0-9a-f]{6}$/i.test(whatsapp.botaoCorTexto || '')
    ? whatsapp.botaoCorTexto : '#ffffff';
  const pulsacao = whatsapp.pulsacaoSuave !== false ? ' whatsapp-pulso-suave' : '';
  return `
  <div class="whatsapp-flutuante ${pos}" id="whatsappFlutuante">
    <div class="whatsapp-aviso" id="whatsappAviso">
      <strong>${e(whatsapp.textoBotao || 'Dúvidas?')}</strong>
      <p class="mb-0 mt-1">${e(aberto ? (whatsapp.mensagem || '') : texto)}</p>
      <p class="mb-0 mt-1 texto-pequeno"><strong>Atenção:</strong> ${e(whatsapp.avisoCheckout || 'Este canal é exclusivo para dúvidas.')}</p>
    </div>
    <a class="botao-whatsapp${pulsacao}" href="${e(link)}" target="_blank" rel="noopener noreferrer"
       style="--whatsapp-botao-fundo:${e(corFundo)};--whatsapp-botao-texto:${e(corTexto)}"
       aria-label="Tirar dúvidas pelo WhatsApp" data-whatsapp-link>
      ${ICONES.whatsapp}
      <span class="texto">${e(whatsapp.textoBotao || 'Dúvidas?')}</span>
    </a>
  </div>`;
}

function barraCookies(cookies) {
  if (!cookies?.ativo) return '';
  return `
  <div class="barra-cookies" id="barraCookies">
    <div class="container">
      <div class="cresce">
        <strong>${e(cookies.titulo || 'Usamos cookies')}</strong><br>
        ${e(cookies.texto || '')} O registro de visitas e tentativas de compra ocorre apenas com sua aceitação.
        Se entrar na sua conta, esses totais poderão ser associados ao seu cadastro.
        <a href="${e(cookies.linkPolitica || '/pagina/politica-de-cookies')}">Saiba mais</a>.
      </div>
      <button class="botao pequeno" data-cookies="aceitar">${e(cookies.textoBotaoAceitar || 'Aceitar')}</button>
      <button class="botao pequeno secundario" data-cookies="recusar">${e(cookies.textoBotaoRecusar || 'Recusar')}</button>
    </div>
  </div>`;
}

function menuDepartamentos(arvore, whatsapp) {
  const principais = arvore.slice(0, 9);
  const resto = arvore.slice(9);
  return `
  <nav class="menu-departamentos" aria-label="Departamentos">
    <div class="container">
      <button type="button" id="botaoTodosDeptos" aria-expanded="false" aria-controls="submenuDeptos" class="todos">
        ${ICONES.menu} Departamentos
      </button>
      ${principais.map((c) => `<a href="/categoria/${e(c.slug)}">${e(c.nome)}</a>`).join('')}
      ${resto.length ? `<a href="/departamentos" class="esconde-mobile">Ver todos</a>` : ''}
    </div>
  </nav>
  <div class="submenu-departamentos" id="submenuDeptos">
    <div class="container">
      ${arvore.map((c) => `
        <div>
          <a href="/categoria/${e(c.slug)}" class="negrito">${e(c.nome)}</a>
          ${(c.filhas || []).map((f) => `<a href="/categoria/${e(f.slug)}">${e(f.nome)}</a>`).join('')}
        </div>`).join('')}
    </div>
  </div>`;
}

// A migração visual aplica verde/branco só às antigas cores padrão.
// Depois de uma edição no painel, as cores escolhidas pelo lojista prevalecem.
export function coresBarraTopo(tema = {}) {
  const legado = tema.barraTopoEstiloVersao !== 'abaixo-menu-verde-20261107';
  const valido = cor => /^#[0-9a-f]{6}$/i.test(String(cor || ''));
  const fundo = tema.barraTopoCorFundo;
  const texto = tema.barraTopoCorTexto;
  return {
    fundo: valido(fundo) && !(legado && fundo.toLowerCase() === '#fff0f0') ? fundo : '#16803c',
    texto: valido(texto) && !(legado && texto.toLowerCase() === '#8b0000') ? texto : '#ffffff',
  };
}

function barraAvisos(tema) {
  if (tema.barraTopoAtiva !== true || !String(tema.barraTopoTexto || '').trim()) return '';
  const cores = coresBarraTopo(tema);
  return `<div class="barra-topo${tema.barraTopoPulsante !== false ? ' barra-topo-pulsante' : ''}" style="--barra-topo-fundo:${e(cores.fundo)};--barra-topo-texto:${e(cores.texto)}"><span class="barra-topo-conteudo">${sanitizeHtml(tema.barraTopoTexto)}</span></div>`;
}

function cabecalho(ctx) {
  const { settings, cartCount = 0, usuario, arvore } = ctx;
  const empresa = settings.empresa || {};
  const tema = settings.tema || {};
  const whatsapp = settings.whatsapp || {};
  const logo = tema.logoUrl
    ? `<img src="${e(tema.logoUrl)}" alt="${e(empresa.nomeFantasia || 'Farmácia Pague Pouco')}" style="height:${Number(tema.logoAltura) || 44}px">`
    : `<span class="logo-marca"><strong>PAGUE POUCO</strong><span>FARMÁCIA</span></span>`;
  return `
  <header class="cabecalho">
    <div class="container">
      <div class="linha centro">
        <button class="acao-topo esconde-mobile" type="button" id="botaoMenuMobile" aria-label="Abrir departamentos" style="display:none"></button>
        <a href="/" class="logo" aria-label="Página inicial da ${e(empresa.nomeFantasia || 'Farmácia Pague Pouco')}">${logo}</a>
        <div class="busca">
          <form action="/busca" method="get" role="search" autocomplete="off">
            <label class="sr-only" for="campoBusca">Buscar produtos</label>
            <input type="text" id="campoBusca" name="q" placeholder="Buscar medicamento, marca, sintoma..." value="${e(ctx.termoBusca || '')}" aria-autocomplete="list" aria-controls="listaSugestoes">
            <button type="submit" aria-label="Buscar">${ICONES.busca}</button>
          </form>
          <div class="sugestoes" id="listaSugestoes" role="listbox" aria-label="Sugestões de produtos"></div>
        </div>
        <div class="acoes-topo">
          <div class="cep-topo" title="Calcule o frete para sua região">
            <form action="/cep" method="get" id="formCepTopo" style="display:flex;gap:6px;align-items:center">
              ${ICONES.caminhao}
              <label class="sr-only" for="cepTopo">Seu CEP</label>
              <input type="text" id="cepTopo" name="cep" inputmode="numeric" placeholder="Seu CEP" value="${e(ctx.cepSessao || '')}" maxlength="9">
            </form>
          </div>
          <a class="acao-topo" href="${usuario ? '/conta' : '/conta/login'}" aria-label="${usuario ? 'Minha conta' : 'Entrar ou cadastrar'}">
            ${ICONES.usuario}
            <span>${usuario ? 'Minha conta' : 'Entrar'}</span>
          </a>
          <button class="acao-topo acao-carrinho" type="button" id="abrirCarrinho" aria-label="Abrir carrinho">
            ${ICONES.carrinho}
            <span class="contador" id="contadorCarrinho">${cartCount}</span>
            <span class="esconde-mobile">Cesta</span>
          </button>
        </div>
      </div>
    </div>
    ${menuDepartamentos(arvore, whatsapp)}
    ${barraAvisos(tema)}
  </header>`;
}

function rodape(ctx) {
  const { settings, db } = ctx;
  const empresa = settings.empresa || {};
  const dados = dadosEmpresaVisiveis(empresa);
  const rodapeCfg = settings.rodape || {};
  const whatsapp = settings.whatsapp || {};
  const link = linkWhatsApp(whatsapp);
  const paginas = db.collection('pages').all().filter((p) => p.publicada);
  return `
  <footer class="rodape">
    <div class="container">
      <div class="rodape-grade">
        <div class="rodape-loja">
          <h4>${e(empresa.nomeFantasia || 'Farmácia Pague Pouco')}</h4>
          <p>${e(textoInstitucionalDinamico(rodapeCfg.textoInstitucional || '', empresa))}</p>
          <p class="mb-0">
            ${campoCadastrado(empresa.endereco?.logradouro) ? `${e(dados.enderecoLinha1)}<br>${e(dados.enderecoLinha2)}<br>` : ''}
            ${campoCadastrado(empresa.telefone) ? `Telefone: ${e(dados.telefone)}<br>` : ''}
            ${campoCadastrado(empresa.email) ? `E-mail: ${e(dados.email)}` : ''}
          </p>
          <div class="selos">
            ${(rodapeCfg.formasPagamento || []).map((f) => `<span class="selo">${e(f)}</span>`).join('')}
          </div>
        </div>
        ${(rodapeCfg.colunas || []).map((col) => `
          <div class="rodape-coluna">
            <h4>${e(col.titulo)}</h4>
            <ul>${(col.links || []).map((l) => `<li><a href="${e(l.url)}">${e(l.texto)}</a></li>`).join('')}</ul>
          </div>`).join('')}
        <div class="rodape-atendimento">
          <h4>Atendimento</h4>
          <p>${e(empresa.horarioAtendimento || '')}</p>
          ${whatsapp.ativo && link ? `<p class="rodape-whatsapp-linha"><a class="rodape-whatsapp-link" href="${e(link)}" target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp"><span class="rodape-whatsapp-icone" aria-hidden="true">${ICONES.whatsapp}</span><span>Falar no WhatsApp</span></a></p>` : ''}
          ${campoCadastrado(empresa.farmaceuticoResponsavel) ? `<p class="mb-0 texto-pequeno">Farmacêutico responsável: ${e(dados.farmaceuticoResponsavel)}${campoCadastrado(empresa.crf) ? ` — ${e(dados.crfCompleto)}` : ''}</p>` : ''}
        </div>
      </div>
      <div class="rodape-inferior">
        <div class="container" style="padding:0">
          <p class="mb-0">${e(empresa.nomeFantasia || 'Farmácia Pague Pouco')}${campoCadastrado(empresa.cnpj) ? ` — CNPJ ${e(dados.cnpj)}` : ''}. Todos os direitos reservados.</p>
          <p class="mb-0 mt-1">Os preços e condições são válidos apenas para compras realizadas neste site. Venda de medicamentos conforme a legislação sanitária vigente (RDC 44/2009 e normas posteriores). Imagens meramente ilustrativas.</p>
        </div>
      </div>
    </div>
  </footer>`;
}

function menuMobile() {
  return `
  <nav class="menu-mobile" aria-label="Navegação rápida">
    <a href="/">${ICONES.casa}<span>Início</span></a>
    <a href="/departamentos">${ICONES.menu}<span>Departamentos</span></a>
    <a href="/ofertas">${ICONES.etiqueta}<span>Ofertas</span></a>
    <a href="#" id="abrirCarrinhoMobile" data-abrir-carrinho>${ICONES.carrinho}<span>Cesta</span></a>
    <a href="/conta">${ICONES.usuario}<span>Conta</span></a>
  </nav>`;
}

function gavetaCarrinho() {
  return `
  <div class="fundo-escuro" id="fundoEscuro"></div>
  <aside class="gaveta" id="gavetaCarrinho" aria-label="Carrinho de compras" aria-hidden="true">
    <header>
      <h2>Sua cesta</h2>
      <button type="button" id="fecharCarrinho" class="botao pequeno secundario" aria-label="Fechar carrinho">Fechar</button>
    </header>
    <div class="corpo" id="corpoCarrinho"><p class="texto-centro texto-suave">Carregando...</p></div>
    <footer id="rodapeCarrinho"></footer>
  </aside>`;
}

/**
 * Renderiza uma página pública completa.
 * @param {object} ctx {req, db, settings, usuario, cartCount, termoBusca, cepSessao, arvore}
 */
export function paginaPublica(ctx, { titulo, descricao, conteudo, headExtra = '', corpoClasse = '', canonical = '', ogImage = '', semIndex = false } = {}) {
  const { settings, req, db } = ctx;
  const empresa = settings.empresa || {};
  const tema = settings.tema || {};
  const seo = settings.seo || {};
  const fundoHome = normalizarFundoHome(tema.fundoHome);
  const classeFundoHome = corpoClasse === 'pagina-inicial' && fundoHome.modo !== 'padrao'
    ? (fundoHome.modo === 'imagem' ? ' fundo-personalizado fundo-imagem' : ' fundo-personalizado fundo-cor') : '';
  const arvore = ctx.arvore || montarArvore(db);
  const tituloFinal = titulo ? `${titulo} | ${empresa.nomeFantasia || 'Farmácia Pague Pouco'}` : (seo.tituloPadrao || empresa.nomeFantasia);
  const descFinal = descricao || seo.descricaoPadrao || '';
  const url = canonical || `${config.publicBaseUrl || ''}${req?.pathname || ''}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(tituloFinal)}</title>
<meta name="description" content="${e(descFinal)}">
<meta name="keywords" content="${e(seo.palavrasChave || '')}">
<link rel="canonical" href="${e(url)}">
${semIndex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow">'}
<meta property="og:type" content="website">
<meta property="og:title" content="${e(tituloFinal)}">
<meta property="og:description" content="${e(descFinal)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(ogImage || seo.ogImage || '')}">
<meta name="theme-color" content="#8b0000">
<link rel="icon" type="image/svg+xml" href="${e(tema.faviconUrl || '/img/favicon.svg?v=20261021-vermelho')}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/styles.css?v=inteligencia-vendas-20261109-gaveta-20261109">
<style>
:root{
  --primaria:${e(tema.corPrimaria || '#8b0000')};
  --primaria-escura:${e(tema.corPrimariaEscura || '#6b0000')};
  --secundaria:${e(tema.corSecundaria || '#8b0000')};
  --texto:${e(tema.corTexto || '#8b0000')};
  --marca-texto:${e(tema.corTexto || '#8b0000')};
  --fundo:${e(tema.corFundo || '#fffafa')};
  ${estiloSeloDesconto(tema.seloDescontoPulsoIntensidade)}
}
${classeFundoHome ? `body.pagina-inicial.fundo-personalizado{--fundo-home-cor:${fundoHome.cor};}` : ''}
${fundoHome.modo === 'imagem' && classeFundoHome ? `body.pagina-inicial.fundo-imagem::before{background-image:url("${e(fundoHome.imagemUrl)}");background-position:${fundoHome.posicaoCss};}` : ''}
</style>
${seo.googleAnalyticsId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${e(seo.googleAnalyticsId)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${e(seo.googleAnalyticsId)}');</script>` : ''}
${headExtra}
</head>
<body class="com-menu-mobile ${corpoClasse}${classeFundoHome}">
<div class="notificacao" id="notificacao" role="status" aria-live="polite"></div>
${cabecalho({ ...ctx, arvore })}
<main id="conteudo">${conteudo}</main>
${rodape({ ...ctx, arvore })}
${menuMobile()}
${gavetaCarrinho()}
${widgetWhatsApp(settings.whatsapp, req?.pathname || '/')}
${barraCookies(settings.cookies)}
<script>window.PP_CONFIG=${JSON.stringify({
    cartCount: ctx.cartCount || 0,
    csrf: ctx.csrf || '',
    cep: ctx.cepSessao || '',
    logado: !!ctx.usuario,
  })};</script>
<script src="/js/app.js?v=carrossel-pausa-6s-10s-20261104-inteligencia-vendas-20261109-gaveta" defer></script>
<script src="/js/visitas-site.js?v=20261108" defer></script>
<script src="/js/password-toggle.js?v=20261107" defer></script>
</body>
</html>`;
}
