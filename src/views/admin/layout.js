/** views/admin/layout.js — Estrutura do painel administrativo. */
import { escapeHtml as e } from '../../lib/security.js';
import { can, ROLES } from '../../lib/permissions.js';
import { money } from '../layout.js';

const MENU = [
  { id: 'dashboard', rotulo: 'Painel', href: '/admin', perm: 'dashboard.ver', icone: '📊' },
  { separador: 'Catálogo' },
  { id: 'produtos', rotulo: 'Produtos', href: '/admin/produtos', perm: 'produtos.ver', icone: '💊' },
  { id: 'categorias', rotulo: 'Categorias', href: '/admin/categorias', perm: 'categorias.ver', icone: '🗂️' },
  { id: 'estoque', rotulo: 'Estoque', href: '/admin/estoque', perm: 'estoque.ver', icone: '📦' },
  { id: 'midia', rotulo: 'Fotos e vídeos', href: '/admin/midia', perm: 'midia.ver', icone: '🖼️' },
  { separador: 'Vendas' },
  { id: 'pedidos', rotulo: 'Pedidos', href: '/admin/pedidos', perm: 'pedidos.ver', icone: '🧾' },
  { id: 'clientes', rotulo: 'Clientes', href: '/admin/clientes', perm: 'clientes.ver', icone: '👥' },
  { id: 'promocoes', rotulo: 'Cupons e promoções', href: '/admin/promocoes', perm: 'promocoes.ver', icone: '🏷️' },
  { id: 'pagamentos', rotulo: 'Pagamentos', href: '/admin/pagamentos', perm: 'pagamentos.ver', icone: '💳' },
  { id: 'relatorios', rotulo: 'Relatórios', href: '/admin/relatorios', perm: 'relatorios.ver', icone: '📈' },
  { separador: 'Site' },
  { id: 'aparencia', rotulo: 'Editor visual do site', href: '/admin/aparencia', perm: 'configuracoes.ver', icone: '🎨' },
  { id: 'banners', rotulo: 'Banners', href: '/admin/banners', perm: 'banners.ver', icone: '🖋️' },
  { id: 'paginas', rotulo: 'Páginas', href: '/admin/paginas', perm: 'paginas.ver', icone: '📄' },
  { id: 'whatsapp', rotulo: 'WhatsApp de atendimento', href: '/admin/whatsapp', perm: 'whatsapp.ver', icone: '💬' },
  { separador: 'Configurações' },
  { id: 'fretes', rotulo: 'Configuração de fretes', href: '/admin/fretes', perm: 'fretes.ver', icone: '🚚' },
  { id: 'configuracoes', rotulo: 'Configurações gerais', href: '/admin/configuracoes', perm: 'configuracoes.ver', icone: '⚙️' },
  { id: 'usuarios', rotulo: 'Usuários e permissões', href: '/admin/usuarios', perm: 'usuarios.ver', icone: '🔐' },
  { id: 'auditoria', rotulo: 'Auditoria', href: '/admin/auditoria', perm: 'auditoria.ver', icone: '🕵️' },
  { id: 'sistema', rotulo: 'Sistema e backups', href: '/admin/sistema', perm: 'sistema.ver', icone: '🛠️' },
];

export function paginaAdmin(ctx, { titulo, conteudo, ativo = '', headExtra = '', corpoExtra = '' }) {
  const usuario = ctx.adminUser;
  const empresa = ctx.settings.empresa || {};
  const menuHtml = MENU.map((item) => {
    if (item.separador) return `<li class="separador-menu">${e(item.separador)}</li>`;
    if (!can(usuario, item.perm)) return '';
    return `<li><a href="${e(item.href)}" class="${ativo === item.id ? 'ativo' : ''}">
      <span aria-hidden="true">${item.icone}</span> ${e(item.rotulo)}</a></li>`;
  }).join('').replace(/<li class="separador-menu">(.*?)<\/li>(<li><\/li>)*/g, (m, p1) => {
    const depois = m.split('</li>').slice(1).join('</li>');
    return depois.replace(/<li><\/li>/g, '') ? m : '';
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titulo)} — Painel | ${e(empresa.nomeFantasia || 'Pague Pouco')}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#8b0000">
<link rel="stylesheet" href="/styles.css?v=responsivo-mobile-desktop-20261021">
<link rel="icon" type="image/svg+xml" href="/img/favicon.svg?v=20261021-vermelho">
<style>
:root{--marca-texto:${e(ctx.settings.tema?.corTexto || '#8b0000')};--primaria:${e(ctx.settings.tema?.corPrimaria || '#8b0000')};--primaria-escura:${e(ctx.settings.tema?.corPrimariaEscura || '#6b0000')};--secundaria:${e(ctx.settings.tema?.corSecundaria || '#8b0000')};}
.admin-menu .separador-menu{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--texto-suave);padding:12px 12px 4px;font-weight:700}
.admin-menu ul{list-style:none;margin:0;padding:8px}
@media(min-width:768px){.admin-menu ul{padding:12px 10px}}
</style>
${headExtra}
</head>
<body class="admin">
<header class="admin-topo">
  <div class="container linha centro">
    <span class="marca-admin">
      ${ctx.settings.tema?.logoUrl ? `<img src="${e(ctx.settings.tema.logoUrl)}" alt="">` : ''}
      Painel — ${e(empresa.nomeFantasia || 'Farmácia Pague Pouco')}
    </span>
    <span class="espaco"></span>
    <span class="texto-pequeno esconde-mobile">${e(usuario.nome)} · ${e(ROLES[usuario.role]?.nome || usuario.role)}</span>
    <a href="/" target="_blank" rel="noopener">Ver site ↗</a>
    <a href="/admin/sair">Sair</a>
  </div>
</header>
<div class="admin-corpo">
  <nav class="admin-menu" aria-label="Menu do painel">
    <ul>${menuHtml}</ul>
  </nav>
  <main class="admin-conteudo">
    ${ctx.avisoLayout ? `<div class="alerta ${e(ctx.avisoLayout.tipo || 'info')}">${ctx.avisoLayout.texto}</div>` : ''}
    ${ctx.req?.query?.has('salvo') ? '<div class="alerta sucesso mb-2" role="status">Operação concluída com sucesso. As alterações foram salvas.</div>' : ''}
    ${conteudo}
  </main>
</div>
<div class="notificacao" id="notificacaoAdmin" role="status"></div>
<script>window.PP_ADMIN=${JSON.stringify({ csrf: ctx.csrf, role: usuario.role })};</script>
<script src="/js/admin.js?v=estornos-pendentes-v4" defer></script>
${corpoExtra}
</body>
</html>`;
}

/* ---------------------- componentes do painel ---------------------- */
export function painel({ titulo, corpo, acoes = '', semPadding = false }) {
  return `<section class="painel">
    ${titulo ? `<header><h3>${e(titulo)}</h3><span style="flex:1"></span>${acoes}</header>` : ''}
    <div class="corpo ${semPadding ? 'sem-padding' : ''}">${corpo}</div>
  </section>`;
}

export function tabelaAdmin({ colunas, linhas, vazio = 'Nenhum registro encontrado.' }) {
  if (!linhas.length) return `<div class="estado-vazio">${e(vazio)}</div>`;
  return `<div class="tabela-rolagem"><table class="tabela-admin">
    <thead><tr>${colunas.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.join('')}</tbody>
  </table></div>`;
}

export function cartaoMetrica(rotulo, valor, extra = '') {
  return `<div class="cartao-metrica">
    <div class="rotulo-metrica">${e(rotulo)}</div>
    <div class="valor-metrica">${e(String(valor))}</div>
    ${extra ? `<div class="extra">${extra}</div>` : ''}
  </div>`;
}

export function campoAdmin({ nome, rotulo, tipo = 'text', valor = '', dica = '', obrigatorio = false, opcoes = null, atributos = '', min = null, max = null, step = null }) {
  const id = `f_${nome}`;
  const req = obrigatorio ? ' required' : '';
  const extra = [min != null ? `min="${e(min)}"` : '', max != null ? `max="${e(max)}"` : '', step != null ? `step="${e(step)}"` : ''].filter(Boolean).join(' ');
  let controle;
  if (opcoes) {
    controle = `<select id="${id}" name="${e(nome)}"${req} ${atributos}>
      ${opcoes.map((o) => {
        const val = typeof o === 'object' ? o.valor : o;
        const txt = typeof o === 'object' ? o.texto : o;
        return `<option value="${e(String(val))}" ${String(val) === String(valor ?? '') ? 'selected' : ''}>${e(txt)}</option>`;
      }).join('')}</select>`;
  } else if (tipo === 'textarea') {
    controle = `<textarea id="${id}" name="${e(nome)}"${req} ${atributos}>${e(valor ?? '')}</textarea>`;
  } else if (tipo === 'checkbox') {
    return `<label class="check"><input type="checkbox" id="${id}" name="${e(nome)}" value="1" ${valor ? 'checked' : ''} ${atributos}> <span>${e(rotulo)}</span></label>`;
  } else {
    controle = `<input type="${e(tipo)}" id="${id}" name="${e(nome)}" value="${e(valor ?? '')}"${req} ${extra} ${atributos}>`;
  }
  return `<div class="campo">
    <label for="${id}">${e(rotulo)}${obrigatorio ? ' *' : ''}</label>
    ${controle}
    ${dica ? `<span class="dica">${e(dica)}</span>` : ''}
  </div>`;
}

export function barraFerramentas(conteudo) {
  return `<div class="barra-ferramentas">${conteudo}</div>`;
}

export function etiquetaStatus(status) {
  const mapa = {
    pendente: 'laranja', aprovado: 'verde', recusado: 'vermelha', estornado: 'azul', expirado: 'cinza',
    aguardando_pagamento: 'laranja', em_separacao: 'azul', preparando_envio: 'azul', enviado: 'azul',
    saiu_para_entrega: 'azul', entregue: 'verde', cancelado: 'vermelha', ativo: 'verde', inativo: 'cinza',
  };
  return `<span class="etiqueta ${mapa[status] || 'cinza'}">${e(String(status || '').replace(/_/g, ' '))}</span>`;
}

export function graficoBarras(dados, { rotulo = 'valor' } = {}) {
  if (!dados.length) return '<div class="estado-vazio">Sem dados no período.</div>';
  const max = Math.max(...dados.map((d) => Number(d.valor) || 0), 1);
  return `<div class="grafico-barras">
    ${dados.map((d) => `<div class="barra" style="height:${Math.max(2, ((Number(d.valor) || 0) / max) * 100)}%"
      data-info="${e(d.rotulo)}: ${e(String(d.texto ?? d.valor))}" title="${e(d.rotulo)}: ${e(String(d.texto ?? d.valor))}"></div>`).join('')}
  </div>`;
}

export function paginacaoAdmin({ pagina, total, porPagina, base, query = {} }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return '';
  const qs = (p) => {
    const u = new URLSearchParams(query);
    u.set('pagina', String(p));
    return `${base}?${u.toString()}`;
  };
  const itens = [];
  const inicio = Math.max(1, pagina - 2);
  const fim = Math.min(paginas, inicio + 4);
  if (pagina > 1) itens.push(`<a href="${e(qs(pagina - 1))}">Anterior</a>`);
  for (let p = inicio; p <= fim; p++) itens.push(p === pagina ? `<span class="atual">${p}</span>` : `<a href="${e(qs(p))}">${p}</a>`);
  if (pagina < paginas) itens.push(`<a href="${e(qs(pagina + 1))}">Próxima</a>`);
  return `<nav class="paginacao">${itens.join('')}</nav>`;
}

export { money };
