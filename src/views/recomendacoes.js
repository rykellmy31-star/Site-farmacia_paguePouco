/** Cards compactos de produtos complementares, sem pop-up automático. */
import { escapeHtml as e } from '../lib/security.js';
import { imagemPrincipal, precoVigenteCentavos } from '../lib/catalog.js';
import { money } from './layout.js';

export function secaoRecomendacoes(itens,{titulo='✨ Combine com sua compra',id='recomendacoesCompra'}={}){
  if(!Array.isArray(itens)||!itens.length)return '';
  return '<section class="secao secao-recomendacoes" id="'+e(id)+'" aria-label="'+e(titulo)+'">'+
    '<div class="cabecalho-secao"><h2>'+e(titulo)+'</h2></div>'+
    '<div class="recomendacoes-trilha" aria-label="Produtos que combinam com sua compra">'+
    itens.map(x=>{
      const p=x.produto||x;
      const imagem=imagemPrincipal(p)||'/img/produto-sem-foto.svg';
      return '<article class="recomendacao-card">'+
        '<a href="/produto/'+encodeURIComponent(String(p.slug||''))+
          '" class="recomendacao-imagem" aria-label="'+e(p.nome)+'">'+
        '<img src="'+e(imagem)+'" alt="'+e(p.nome)+'" loading="lazy" width="144" height="144"></a>'+
        '<div class="recomendacao-corpo">'+
          '<a href="/produto/'+encodeURIComponent(String(p.slug||''))+
            '" class="recomendacao-nome">'+e(p.nome)+'</a>'+
          '<strong class="recomendacao-preco">'+money(precoVigenteCentavos(p))+'</strong>'+
          '<button type="button" class="botao pequeno recomendacao-adicionar" '+
            'data-adicionar-carrinho="'+e(p.id)+'" '+
            'data-recomendacao-origem="'+e(x.origemId||'')+'">'+
            '+ Adicionar à cesta</button>'+
        '</div>'+
        '<span class="recomendacao-aviso">Imagem meramente ilustrativa</span>'+
      '</article>';
    }).join('')+'</div></section>';
}
