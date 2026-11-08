import {escapeHtml as e} from '../../lib/security.js';
import {paginaAdmin,painel} from './layout.js';

const dinheiro=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const motivos={
  apto:'Apto para atualizar',sem_cadastro:'Não existe no site',
  identificacao_ambigua:'Código/EAN ambíguo',ean_divergente:'EAN divergente (código interno validado)',
  arquivado:'Produto arquivado',controlado:'Produto controlado — não aplicar',
  alteracao_grande:'Diferença expressiva do preço base',desconto_manual:'Desconto manual no site',
  campanha_preco_base:'Campanha existente no site',
  preco_base_invalido:'Preço atual inválido',desconto_extremo:'Desconto superior a 80%',
  sem_mudanca:'Sem alteração',
};
export function telaPreviaPrecosInternos(ctx,previa){
  const r=previa.resumo,fonte=previa.fonte;
  const resumo='<p>Produtos no Excel: <strong>'+e(fonte.linhas)+'</strong> · '+
    'Preços promocionais válidos: <strong>'+e(fonte.precoPromocional)+'</strong> · '+
    'Sem desconto: '+e(fonte.semPromocao)+' · Promocionais inválidos ignorados: '+
    e(fonte.promocaoInvalida)+'.</p>'+
    '<p>Alterações aptas: <strong>'+e(r.aplicaveis)+'</strong> · '+
    'Com desconto: '+e(r.comDesconto)+' · Sem desconto: '+e(r.semDesconto)+
    ' · Já iguais: '+e(r.semMudanca)+'.</p>'+
    '<p>Sem cadastro: '+e(r.semCadastro)+' · EAN divergente (aviso): '+e(r.eanDivergente)+
    ' · Identificações ambíguas: '+e(r.identificacaoAmbigua)+
    ' · Produtos com desconto manual (sem bloqueio): '+e(r.promocaoManual)+
    ' · Produtos controlados ignorados: '+e(r.controlados)+
    ' · Produtos com campanhas (sem bloqueio): '+e(r.campanhaConflitante)+
    ' · Diferenças expressivas (aviso): '+e(r.alertasPreco)+'.</p>';
  // Busca um SKU mesmo quando não está entre os 100 primeiros.
  const filtro=String(ctx.req?.query?.get('codigo')||'').trim().slice(0,80);
  const filtrados=filtro?previa.plano.filter(p=>String(p.codigo)===filtro||
    String(p.nome||'').toLocaleLowerCase('pt-BR').includes(filtro.toLocaleLowerCase('pt-BR'))):previa.plano;
  const linhas=filtrados.slice(0,100).map(p=>
    '<tr><td><code>'+e(p.codigo)+'</code></td><td>'+e(p.nome)+'</td>'+
    '<td>'+dinheiro(p.atualBase)+'</td><td>'+dinheiro(p.novoBase)+'</td>'+
    '<td>'+(p.atualPromo?dinheiro(p.atualPromo):'Sem desconto')+'</td>'+
    '<td>'+(p.novoPromo?dinheiro(p.novoPromo):'Sem desconto')+'</td>'+
    '<td>'+e(motivos[p.motivo]||p.motivo)+'</td></tr>').join('');
  const tabela='<div class="tabela-rolagem"><table class="tabela">'+
    '<thead><tr><th>Código</th><th>Produto</th><th>Preço atual</th>'+
    '<th>Preço venda Excel</th><th>Promoção atual no site</th><th>Preço promoção Excel</th><th>Situação</th></tr></thead>'+
    '<tbody>'+linhas+'</tbody></table></div>'+
    (!filtrados.length?'<p class="alerta aviso">Nenhum produto encontrado neste arquivo com o código ou nome informado.</p>':'')+
    (filtrados.length>100?'<p>Exibindo 100 dos '+filtrados.length+' resultados. Filtre por código.</p>':'');
  const confirmar=previa.aplicado
    ?'<div class="alerta sucesso">Este lote já foi aplicado.</div>'
    :r.aplicaveis?'<div class="alerta aviso"><strong>Antes de aplicar:</strong> confirme '+
    'que esses preços promocionais internos valem para vendas online. O Excel não '+
    'informa validade; os preços passarão a valer no checkout até uma nova exportação.</div>'+
    '<form method="post" action="/admin/estoque/precos-internos/aplicar">'+
    '<input type="hidden" name="_csrf" value="'+e(ctx.csrf)+'">'+
    '<input type="hidden" name="loteId" value="'+e(previa.id)+'">'+
    '<label><input type="checkbox" required name="confirmado" value="1"> '+
    'Conferi os valores e autorizo somente os itens aptos.</label><br>'+
    '<label><input type="checkbox" required name="autorizacaoOnline" value="1"> '+
    'Autorizo estes preços para Pix, crédito e débito no e-commerce.</label>'+
    '<div class="campo mt-2"><label for="frasePrecosInova">Digite APLICAR PRECOS INTERNOS INOVA</label>'+
    '<input id="frasePrecosInova" type="text" name="frase" autocomplete="off" required></div>'+
    '<button class="botao" type="submit">Aplicar preços internos após conferência</button></form>'
    :'<p>Nenhuma alteração elegível. Confira o arquivo e os cadastros.</p>';
  return paginaAdmin(ctx,{
    titulo:'Conferir preços internos InovaFarma',ativo:'importacao_estoque',
    conteudo:'<h1>Preços internos InovaFarma — prévia</h1>'+
      '<p><a href="/admin/estoque/importar">← Voltar à Importação de estoque</a></p>'+
      '<div class="alerta aviso"><strong>Nenhum produto foi alterado nesta etapa.</strong> '+
      'Este é o Excel de Gerenciar Produtos, não o relatório de promoções por período. '+
      'EAN, estoque, ativação, imagens, dados sanitários e pedidos são preservados.</div>'+
      painel({titulo:'Conferência antes de atualizar',corpo:resumo+
        '<form method="get" action="/admin/estoque/precos-internos/revisar/'+encodeURIComponent(previa.id)+'">'+
        '<label for="codigoInovaConferir">Localizar código interno ou nome no Excel</label>'+
        '<input id="codigoInovaConferir" type="search" name="codigo" value="'+e(filtro)+
        '" placeholder="Ex.: 797222" maxlength="80">'+
        '<button class="botao secundario" type="submit">Verificar produto</button></form>'+
        '<div class="alerta info">Descontos internos sem data final informada no arquivo. '+
        'O desconto interno do Inova tem prioridade; promoções manuais e campanhas permanecem cadastradas. '+
        'Uma nova exportação XLSX será necessária para atualizar alterações futuras.</div>'+
        tabela+confirmar}),
  });
}
