/** views/partials.js — Componentes reutilizados pelas páginas. */
import { escapeHtml as e } from '../lib/security.js';
import { formatBRL } from '../lib/format.js';
import { precoVigenteCentavos, temPromocao, descontoPercentual, imagemPrincipal, productUrl, podeVender, estoqueDisponivel } from '../lib/catalog.js';
import { ICONES, money } from './layout.js';
import { STATUS_FINANCEIRO, STATUS_OPERACIONAL } from '../lib/orders.js';
import { melhorParcelamentoSemJuros } from '../lib/payments/index.js';

export function cartaoProduto(produto, { mostrarParcela = true, db = null } = {}) {
  const venda = podeVender(produto);
  const preco = precoVigenteCentavos(produto);
  const original = Number(produto.precoCentavos || 0);
  const promo = temPromocao(produto);
  const disponivel = estoqueDisponivel(produto);
  const img = imagemPrincipal(produto);
  const parcelamentoSemJuros = mostrarParcela ? melhorParcelamentoSemJuros(db, preco) : null;
  const bloqueio = venda.bloqueioSanitario ? venda.motivo : null;

  return `
  <article class="produto ${venda.ok ? '' : 'bloqueado'}">
    ${promo ? `<span class="etiqueta-desconto">-${descontoPercentual(produto)}%</span>` : ''}
    <a class="foto" href="${e(productUrl(produto))}" aria-label="${e(produto.nome)}">
      <img src="${e(img)}" alt="${e(produto.nome)}" loading="lazy" width="300" height="300">
    </a>
    ${produto.marca ? `<span class="marca">${e(produto.marca)}</span>` : ''}
    <h3 class="nome"><a href="${e(productUrl(produto))}">${e(produto.nome)}</a></h3>
    ${promo ? `<span class="preco-antigo">${money(original)}</span>` : ''}
    <span class="preco">${money(preco)}</span>
    ${parcelamentoSemJuros ? `<span class="parcela">ou até ${parcelamentoSemJuros.numero}x sem juros</span>` : ''}
    <div class="acoes">
      ${bloqueio
        ? `<p class="aviso-sanitario mb-0">${e(bloqueio)}</p>`
        : disponivel > 0
          ? `<button type="button" class="botao bloquinho botao-adicionar-cesta" data-adicionar-carrinho="${e(produto.id)}"><span class="icone-cesta" aria-hidden="true">${ICONES.carrinho}</span><span>Adicionar à cesta</span></button>`
          : `<p class="sem-estoque mb-0">Produto esgotado</p>`}
    </div>
  </article>`;
}

export function vitrina(produtos, { rolagem = false, vazia = 'Nenhum produto encontrado.', db = null } = {}) {
  const itens = Array.isArray(produtos) ? produtos.filter(Boolean) : [];
  if (!itens.length) return `<div class="estado-vazio">${e(vazia)}</div>`;
  return `<div class="vitrine ${rolagem ? 'rolagem' : ''}">${itens.map((p) => cartaoProduto(p, { db })).join('')}</div>`;
}

export function secaoVitrina({ id, titulo, link, produtos, rolagem = true, db = null }) {
  const itens = Array.isArray(produtos) ? produtos.filter(Boolean) : [];
  if (!itens.length) return '';
  return `
  <section class="secao" id="${e(id)}">
    <div class="cabecalho-secao">
      <h2>${e(titulo)}</h2>
      ${link ? `<a class="ver-todos" href="${e(link)}">Ver todos ${ICONES.seta}</a>` : ''}
    </div>
    ${vitrina(itens, { rolagem, db })}
  </section>`;
}

export function migalhas(itens) {
  return `<nav class="migalhas" aria-label="Trilha de navegação">
    ${itens.map((it, i) => (it.url && i < itens.length - 1
      ? `<a href="${e(it.url)}">${e(it.texto)}</a> › `
      : `<span aria-current="page">${e(it.texto)}</span>`)).join('')}
  </nav>`;
}

export function paginacao({ pagina, total, porPagina, baseUrl, query = {} }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return '';
  const qs = (p) => {
    const u = new URLSearchParams(query);
    u.set('pagina', String(p));
    return `${baseUrl}?${u.toString()}`;
  };
  const itens = [];
  const inicio = Math.max(1, pagina - 2);
  const fim = Math.min(paginas, inicio + 4);
  if (pagina > 1) itens.push(`<a href="${e(qs(pagina - 1))}" rel="prev">Anterior</a>`);
  for (let p = inicio; p <= fim; p++) {
    itens.push(p === pagina ? `<span class="atual">${p}</span>` : `<a href="${e(qs(p))}">${p}</a>`);
  }
  if (pagina < paginas) itens.push(`<a href="${e(qs(pagina + 1))}" rel="next">Próxima</a>`);
  return `<nav class="paginacao" aria-label="Paginação">${itens.join('')}</nav>`;
}

export function alertaHtml(mensagem, tipo = 'info') {
  if (!mensagem) return '';
  return `<div class="alerta ${e(tipo)}" role="alert">${mensagem}</div>`;
}

export function listaErros(erros) {
  const itens = Object.entries(erros || {}).map(([campo, msg]) => `<li>${e(msg)}</li>`).join('');
  return itens ? `<div class="alerta erro"><strong>Revise os dados informados:</strong><ul>${itens}</ul></div>` : '';
}

export function etiquetaStatus(status, tipo = 'financeiro') {
  const mapa = {
    pendente: 'laranja', aprovado: 'verde', recusado: 'vermelha', estornado: 'azul', expirado: 'cinza',
    aguardando_pagamento: 'laranja', em_separacao: 'azul', preparando_envio: 'azul',
    enviado: 'azul', saiu_para_entrega: 'azul', entregue: 'verde', cancelado: 'vermelha',
    devolucao_em_analise: 'laranja', estorno_em_analise: 'laranja',
  };
  const id = String(status || '');
  // rótulos oficiais em português (cadastro único em lib/orders.js)
  const nome = (tipo === 'operacional' ? STATUS_OPERACIONAL[id]?.nome : STATUS_FINANCEIRO[id]?.nome)
    || STATUS_OPERACIONAL[id]?.nome
    || STATUS_FINANCEIRO[id]?.nome
    || (id === 'estorno_em_analise' ? 'Estorno em análise' : id.replace(/_/g, ' '));
  return `<span class="etiqueta ${mapa[id] || 'cinza'}">${e(nome)}</span>`;
}

export function enderecoHtml(end) {
  if (!end) return '—';
  return `${e(end.logradouro || '')}, ${e(end.numero || 's/n')}${end.complemento ? ` — ${e(end.complemento)}` : ''}<br>
    ${e(end.bairro || '')} — ${e(end.cidade || '')}/${e(end.uf || '')}<br>CEP ${e(end.cep || '')}`;
}

export function campoForm({ nome, rotulo, tipo = 'text', valor = '', obrigatorio = false, dica = '', opcoes = null, atributos = '', erro = '' }) {
  const id = `campo_${nome}`;
  const req = obrigatorio ? ' required aria-required="true"' : '';
  let controle;
  if (opcoes) {
    controle = `<select id="${id}" name="${e(nome)}"${req} ${atributos}>
      ${opcoes.map((o) => {
        const v = typeof o === 'object' ? o.valor : o;
        const t = typeof o === 'object' ? o.texto : o;
        return `<option value="${e(String(v))}" ${String(v) === String(valor) ? 'selected' : ''}>${e(t)}</option>`;
      }).join('')}
    </select>`;
  } else if (tipo === 'textarea') {
    controle = `<textarea id="${id}" name="${e(nome)}"${req} ${atributos}>${e(valor)}</textarea>`;
  } else {
    controle = `<input type="${e(tipo)}" id="${id}" name="${e(nome)}" value="${e(valor)}"${req} ${atributos}>`;
  }
  return `<div class="campo ${erro ? 'com-erro' : ''}">
    <label for="${id}">${e(rotulo)}${obrigatorio ? ' *' : ''}</label>
    ${controle}
    ${dica ? `<span class="dica">${e(dica)}</span>` : ''}
    ${erro ? `<span class="erro-campo">${e(erro)}</span>` : ''}
  </div>`;
}

export function precoHtml(produto, { grande = false } = {}) {
  const preco = precoVigenteCentavos(produto);
  const promo = temPromocao(produto);
  return `<div class="${grande ? 'bloco-preco' : ''}">
    ${promo ? `<span class="preco-antigo">${money(produto.precoCentavos)}</span>` : ''}
    <span class="preco" style="${grande ? 'font-size:1.85rem;font-weight:800' : ''}">${money(preco)}</span>
    ${promo ? ` <span class="etiqueta laranja">-${descontoPercentual(produto)}%</span>` : ''}
  </div>`;
}

export { money, ICONES };
