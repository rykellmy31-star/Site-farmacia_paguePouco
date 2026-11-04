/** Prévia de correspondências de categoria: nenhuma mutação até confirmação. */
import {escapeHtml as e} from '../../lib/security.js';
import {paginaAdmin,painel} from './layout.js';

export function telaOrganizarCategoriasProdutos(ctx,plano,{mensagem=''}={}){
 const {resumo,amostra,sugestoes,fingerprint}=plano;
 const exemplos=amostra.map(item=>'<tr><td>'+e(item.nome)+'</td><td>'+
   e(item.categoriaNome)+(item.subcategoriaNome?' / '+e(item.subcategoriaNome):'')+
   '</td></tr>').join('');
 const conteudo='<h1>Organizar categorias dos produtos</h1>'+
   '<p><a class="botao secundario" href="/admin/produtos">← Voltar aos produtos</a></p>'+
   (mensagem?'<div class="alerta info">'+e(mensagem)+'</div>':'')+
   '<div class="alerta info"><strong>Primeiro conferimos, depois aplicamos.</strong> '+
   'São utilizadas somente as categorias já cadastradas e ativas. '+
   'Não serão alteradas fotos, preços, estoque, promoções, situação sanitária ou '+
   'categorias já preenchidas. Produtos arquivados e nomes duvidosos permanecem intactos.</div>'+
   painel({titulo:'Resumo da classificação sugerida',corpo:
      '<p><strong>Produtos existentes:</strong> '+e(resumo.totalProdutos)+
      ' · <strong>Sem categoria:</strong> '+e(resumo.semCategoria)+'</p>'+
      '<p><strong>Correspondências seguras:</strong> '+e(resumo.sugeridos)+
      ' · <strong>Para revisão manual:</strong> '+e(resumo.paraRevisao)+
      ' · <strong>Registros preservados:</strong> '+e(resumo.preservados)+'</p>'+
      '<p class="texto-pequeno">A classificação por nome funciona principalmente em higiene, '+
      'fraldas, beleza, alimentação e aparelhos. Medicamentos e termos ambíguos não são '+
      'classificados por suposição.</p>'})+
   painel({titulo:'Prévia (primeiros '+e(amostra.length)+' de '+e(sugestoes.length)+')',corpo:
     '<div style="overflow-x:auto"><table class="tabela"><thead><tr>'+
     '<th>Produto</th><th>Categoria sugerida</th></tr></thead><tbody>'+
     (exemplos||'<tr><td colspan="2">Nenhum produto com correspondência segura.</td></tr>')+
     '</tbody></table></div>'})+
   (resumo.sugeridos?painel({titulo:'Aplicar organização',corpo:
     '<form method="post" action="/admin/produtos/organizar-categorias/aplicar">'+
     '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
     '<input type="hidden" name="fingerprint" value="'+e(fingerprint)+'">'+
     '<p>Confira os exemplos acima. Se o catálogo for alterado antes da confirmação, '+
     'a aplicação será recusada e deverá ser conferida novamente.</p>'+
     '<label for="confirmarOrganizacao">Digite <strong>CLASSIFICAR PRODUTOS</strong></label>'+
     '<input id="confirmarOrganizacao" class="entrada" name="confirmacao" '+
     'autocomplete="off" required maxlength="50" placeholder="CLASSIFICAR PRODUTOS">'+
     '<button type="submit" class="botao mt-2">Aplicar somente as correspondências seguras</button>'+
     '</form>'}):'');
 return paginaAdmin(ctx,{titulo:'Organizar categorias',ativo:'produtos',conteudo});
}
