/**
 * Interface administrativa para zerar a coleção de produtos e importar IDs
 * inteiramente novos do CSV InovaFarma, após revisão e backup externo.
 */
import { escapeHtml as e } from '../../lib/security.js';
import { paginaAdmin, painel } from './layout.js';

const txt=v=>e(String(v??''));
const qtd=v=>Number(v||0).toLocaleString('pt-BR');

export function telaSubstituirCatalogoInova(ctx) {
  return paginaAdmin(ctx,{
    titulo:'Substituir todo o catálogo',ativo:'produtos',
    conteudo:
      '<h1>Substituir todo o catálogo pelos produtos do InovaFarma</h1>'+
      '<div class="alerta erro"><strong>Atenção: substituição integral.</strong> Esta operação não reaproveita '+
      'nenhum cadastro antigo, nem os 6.062 que já foram importados. Todos os produtos atuais sairão '+
      'da tabela de produtos e serão criados novos cadastros com novos IDs, exatamente a partir do CSV. '+
      'As fotos, categorias, descrições extras, promoções manuais e aprovações anteriores não serão transferidas.</div>'+
      '<p>O histórico de pedidos e pagamentos será mantido. Uma cópia privada dos produtos removidos '+
      'será guardada para auditoria e recuperação emergencial, <strong>fora do catálogo atual</strong>.</p>'+
      '<p><strong>Antes de continuar:</strong> acesse <a href="/admin/sistema">Sistema → Backup</a>, '+
      'baixe o backup JSON para um local seguro e confirme que ele foi salvo. '+
      'Não prossiga se houver pedidos aguardando pagamento, entregas pendentes ou estoques reservados.</p>'+
      painel({titulo:'Enviar um único arquivo com todos os produtos',corpo:
        '<p>Utilize <strong>inovafarma_catalogo_novo_6128_produtos.csv</strong>, preparado a partir do '+
        'relatório original do InovaFarma. O arquivo deve conter Código Interno, EAN, Descrição, '+
        'Quantidade e Preço de Venda. Produtos sem EAN são aceitos pelo código interno; '+
        'estoques negativos devem estar zerados na coluna de importação.</p>'+
        '<form method="post" action="/admin/estoque/substituicao/preparar" enctype="multipart/form-data">'+
        '<input type="hidden" name="_csrf" value="'+txt(ctx.csrf)+'">'+
        '<div class="campo"><label for="novoCatalogoInova">Arquivo CSV integral</label>'+
        '<input type="file" id="novoCatalogoInova" name="arquivo" '+
        'accept=".csv,text/csv" required></div>'+
        '<button class="botao" type="submit">Conferir substituição completa, sem apagar ainda</button>'+
        '</form>'})+
      '<p><a class="botao secundario" href="/admin/produtos">Voltar aos produtos</a></p>',
  });
}
function detalhesPendenciasSubstituicao(bloqueios) {
  if(!bloqueios)return '';
  const pedidos=bloqueios.pedidos||[];
  const produtos=bloqueios.produtos||[];
  if(!pedidos.length&&!produtos.length)return '';
  const linhasPedidos=pedidos.slice(0,20).map(p=>
    '<tr><td><strong>'+txt(p.codigo)+'</strong></td>'+
    '<td>'+txt(p.financeiro)+'</td><td>'+txt(p.operacional)+'</td>'+
    '<td>'+(p.conferenciaPagamento
      ? '<strong>Confira a cobrança no Mercado Pago antes de cancelar.</strong>'
      : 'Confira a situação real deste pedido, sem alterar o financeiro indevidamente.')+
    '</td><td><a class="botao pequeno secundario" href="/admin/pedidos/'+
    txt(encodeURIComponent(p.id))+'">Abrir pedido</a></td></tr>'
  ).join('');
  const linhasProdutos=produtos.slice(0,20).map(p=>{
    const relacionados=(p.pedidosRelacionados||[]).slice(0,3).map(o=>
      '<a href="/admin/pedidos/'+txt(encodeURIComponent(o.id))+'">'+
      txt(o.codigo)+'</a>').join(', ');
    return '<tr><td><strong>'+txt(p.nome)+'</strong><br>'+
      '<span class="texto-pequeno">Código interno: '+txt(p.codigoInterno||'—')+'</span></td>'+
      '<td>'+txt(p.reservado)+'</td><td>'+txt(p.quarentena)+'</td>'+
      '<td>'+txt(p.inovaPendente)+'</td>'+
      '<td>'+(relacionados||'Sem relação com os pedidos abertos')+'</td>'+
      '<td><a class="botao pequeno secundario" href="/admin/produtos/'+
      txt(encodeURIComponent(p.id))+'">Abrir produto</a></td></tr>';
  }).join('');
  return painel({titulo:'Pendências que impedem a substituição — identifique e resolva',corpo:
    '<div class="alerta aviso"><strong>Não é erro do CSV.</strong> A troca está bloqueada '+
    'para proteger pagamentos, entregas e reservas. Não cancele pedidos pagos nem '+
    'zere reservas ou quarentena apenas para desbloquear esta operação.</div>'+
    (pedidos.length?
      '<h3>Pedidos que precisam ser conferidos ('+txt(pedidos.length)+')</h3>'+
      '<div style="overflow-x:auto"><table class="tabela">'+
      '<thead><tr><th>Pedido</th><th>Pagamento</th><th>Entrega</th><th>Atenção</th>'+
      '<th>Ação</th></tr></thead><tbody>'+linhasPedidos+'</tbody></table></div>'+
      '<p class="texto-pequeno">Se a cobrança estiver pendente, confira o status '+
      'no provedor antes de concluir ou cancelar. Se a venda já foi paga, '+
      'conclua a entrega verdadeira ou siga o fluxo regular de estorno/devolução.</p>'
      :'')+
    (produtos.length?
      '<h3>Produtos com estoque comprometido ('+txt(produtos.length)+')</h3>'+
      '<div style="overflow-x:auto"><table class="tabela">'+
      '<thead><tr><th>Produto</th><th>Reservado</th><th>Quarentena</th>'+
      '<th>Pendente Inova</th><th>Pedido relacionado</th><th>Ação</th></tr></thead>'+
      '<tbody>'+linhasProdutos+'</tbody></table></div>'+
      '<p class="texto-pequeno">Reservas de pedidos são liberadas automaticamente '+
      'somente pelos fluxos financeiros/operacionais legítimos. Estoque em '+
      'quarentena ou pendência de sincronização exige conciliação real do estoque. '+
      '<a href="/admin/estoque">Abrir Controle de estoque</a>.</p>'
      :'')+
    '<p><a class="botao secundario" href="/admin/produtos/substituir-catalogo">'+
    'Reenviar CSV depois de resolver as pendências</a></p>'+
    '<p class="texto-pequeno">O envio deve ser repetido porque a proposta anterior '+
    'é invalidada sempre que pedidos ou produtos forem alterados.</p>',
  });
}

export function telaRevisaoSubstituirCatalogoInova(ctx,previa) {
  const r=previa.resumo;
  const impeditivo=r.bloqueado;
  const resumo=
    '<p><strong>Produtos atuais que sairão do catálogo:</strong> '+txt(qtd(r.remover))+'</p>'+
    '<p><strong>Produtos inteiramente novos para importar:</strong> '+txt(qtd(r.importar))+'</p>'+
    '<p><strong>Sem EAN (somente código interno):</strong> '+txt(qtd(r.semEAN))+
    ' · <strong>Estoque negativo zerado:</strong> '+txt(qtd(r.estoqueNegativo))+
    ' · <strong>Produtos sem saldo:</strong> '+txt(qtd(r.semEstoque))+'</p>'+
    '<p><strong>Pedidos não encerrados:</strong> '+txt(qtd(r.pedidosAbertos))+
    ' · <strong>Produtos com reservas/quarentena:</strong> '+txt(qtd(r.estoqueReservado))+
    ' · <strong>Carrinhos a esvaziar:</strong> '+txt(qtd(r.carrinhosASeremEsvaziados))+'</p>';
  const formulario = impeditivo
    ? '<div class="alerta erro"><strong>Substituição bloqueada.</strong> Resolva todos os pedidos '+
      'pendentes, estornos e reservas/quarentena antes de prosseguir. Nenhum cadastro foi alterado.</div>'
    : '<form method="post" action="/admin/estoque/substituicao/aplicar">'+
      '<input type="hidden" name="_csrf" value="'+txt(ctx.csrf)+'">'+
      '<input type="hidden" name="loteId" value="'+txt(previa.id)+'">'+
      '<div class="campo"><label><input type="checkbox" name="backupConfirmado" value="1" required> '+
      'Já baixei e guardei fora do site uma cópia de segurança completa (Sistema → Backup).</label></div>'+
      '<div class="campo"><label><input type="checkbox" name="autorizou" value="1" required> '+
      'Autorizo apagar todos os registros atuais de produtos da tabela de catálogo e '+
      'importar somente os '+txt(qtd(r.importar))+' produtos novos do CSV. '+
      'Todos entrarão INATIVOS e precisarão de revisão para venda.</label></div>'+
      '<div class="campo"><label for="fraseZerar">Digite SUBSTITUIR TODO O CATALOGO</label>'+
      '<input id="fraseZerar" name="frase" type="text" autocomplete="off" required '+
      'placeholder="SUBSTITUIR TODO O CATALOGO"></div>'+
      '<button class="botao perigo" type="submit">Apagar catálogo antigo e importar novos produtos</button>'+
      '</form>';
  return paginaAdmin(ctx,{
    titulo:'Confirmar substituição integral',ativo:'produtos',
    conteudo:
      '<h1>Conferência final da substituição</h1>'+
      '<div class="alerta erro"><strong>Esta é uma troca integral, não a limpeza por comparação.</strong> '+
      'Nenhum produto antigo será aproveitado. As informações de produtos antigos serão mantidas '+
      'somente no backup e em arquivo privado separado, nunca na lista de produtos novos.</div>'+
      painel({titulo:'O que acontecerá com o catálogo',corpo:resumo})+
      (impeditivo ? detalhesPendenciasSubstituicao(previa.bloqueios) : '')+
      painel({titulo:'Autorizar substituição integral',corpo:
        '<p>Pedidos e pagamentos anteriores permanecerão. Carrinhos antigos serão esvaziados. '+
        'Ofertas e vitrines que usavam IDs antigos deverão ser reconfiguradas. '+
        'Todos os novos produtos iniciarão inativos até aprovação comercial e sanitária.</p>'+
        formulario+
        '<p class="texto-pequeno">A prévia expira após 20 minutos e é invalidada se '+
        'produtos, pedidos ou carrinhos mudarem antes da confirmação.</p>'})+
      '<p><a class="botao secundario" href="/admin/produtos/substituir-catalogo">'+
      'Voltar sem alterar nada</a></p>',
  });
}
