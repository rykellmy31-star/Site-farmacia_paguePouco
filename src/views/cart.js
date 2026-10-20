/** views/cart.js — Fragmentos HTML do carrinho (gaveta lateral e resumo). */
import { escapeHtml as e } from '../lib/security.js';
import { money, ICONES } from './layout.js';
import { productUrl, imagemPrincipal } from '../lib/catalog.js';

export function htmlItensCarrinho(cart, { editavel = true } = {}) {
  if (!(cart.itens || []).length) {
    return `<div class="carrinho-vazio">
      <p>Sua cesta está vazia.</p>
      <a class="botao" href="/ofertas">Ver ofertas</a>
    </div>`;
  }
  return cart.itens.map((item) => {
    const p = { id: item.produtoId, slug: item.slug, nome: item.nome, imagens: item.imagem ? [{ url: item.imagem }] : [] };
    return `
    <div class="item-carrinho" data-item="${e(item.produtoId)}">
      <a href="${e(productUrl(p))}"><img src="${e(item.imagem || '/img/produto-sem-foto.svg')}" alt="${e(item.nome)}" loading="lazy"></a>
      <div class="info">
        <a class="nome" href="${e(productUrl(p))}">${e(item.nome)}</a>
        <div class="linha centro entre">
          <strong>${money(item.precoUnitarioCentavos * item.quantidade)}</strong>
          ${editavel ? `<button class="remover" type="button" data-remover="${e(item.produtoId)}">Remover</button>` : ''}
        </div>
        ${editavel ? `
        <div class="controles">
          <div class="quantidade" style="height:36px">
            <button type="button" data-qtd-carrinho="-1" data-produto="${e(item.produtoId)}" aria-label="Diminuir">−</button>
            <input type="number" value="${item.quantidade}" min="1" max="99" data-qtd-input="${e(item.produtoId)}" aria-label="Quantidade" style="height:36px;width:46px">
            <button type="button" data-qtd-carrinho="1" data-produto="${e(item.produtoId)}" aria-label="Aumentar">+</button>
          </div>
          <span class="texto-pequeno texto-suave">${money(item.precoUnitarioCentavos)} cada</span>
        </div>` : `<span class="texto-pequeno texto-suave">Quantidade: ${item.quantidade} × ${money(item.precoUnitarioCentavos)}</span>`}
      </div>
    </div>`;
  }).join('');
}

export function htmlResumoCarrinho(cart, totais, { mostrarFrete = true } = {}) {
  return `
  <div class="resumo-linha"><span>Subtotal (${totais.quantidadeItens} ${totais.quantidadeItens === 1 ? 'item' : 'itens'})</span><strong>${money(totais.subtotalCentavos)}</strong></div>
  ${totais.descontoCupom > 0 ? `<div class="resumo-linha"><span>Desconto (${e(cart.cupom?.codigo || '')})</span><strong style="color:var(--sucesso)">− ${money(totais.descontoCupom)}</strong></div>` : ''}
  ${mostrarFrete ? `<div class="resumo-linha"><span>Frete</span><strong>${totais.freteGratis ? '<span style="color:var(--sucesso)">Grátis</span>' : (totais.freteCentavos ? money(totais.freteCentavos) : 'Calcular no checkout')}</strong></div>` : ''}
  <div class="resumo-linha total"><span>Total</span><span>${money(totais.totalCentavos)}</span></div>`;
}

export function htmlGavetaCarrinho(cart, totais) {
  return `${htmlItensCarrinho(cart)}
  ${cart.cupom ? `<div class="alerta sucesso mt-2 mb-0">Cupom <strong>${e(cart.cupom.codigo)}</strong> aplicado.
    <button class="botao pequeno secundario" type="button" data-remover-cupom>Remover</button></div>` : ''}`;
}

export function htmlRodapeCarrinho(cart, totais) {
  if (!(cart.itens || []).length) return '';
  return `
  <form class="mb-2" data-form-cupom>
    <div class="linha" style="gap:6px">
      <input class="entrada" type="text" name="codigo" placeholder="Cupom de desconto" aria-label="Cupom de desconto">
      <button class="botao pequeno secundario" type="submit">Aplicar</button>
    </div>
  </form>
  ${htmlResumoCarrinho(cart, totais, { mostrarFrete: false })}
  <a class="botao bloquinho destaque mt-2" href="/checkout">Finalizar compra</a>
  <a class="botao bloquinho secundario mt-1" href="/carrinho">Ver cesta completa</a>`;
}
