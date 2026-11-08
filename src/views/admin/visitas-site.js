/** Painel restrito de visitas: dados agregados, sem IP/MAC nem produtos vistos. */
import { paginaAdmin, painel } from './layout.js';
import { escapeHtml as e } from '../../lib/security.js';

function inteiro(n) { return Number(n||0).toLocaleString('pt-BR'); }
function momento(s) {
  const d = new Date(s || '');
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    timeZone:'America/Bahia', day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',
  }).format(d);
}
function caixa(numero, rotulo) {
  return '<div class="cartao" style="min-width:145px;flex:1;padding:16px">'+
    '<div class="texto-pequeno texto-suave">'+e(rotulo)+'</div>'+
    '<strong style="font-size:1.45rem">'+inteiro(numero)+'</strong></div>';
}

export function telaVisitasSite(ctx,{relatorio,db}) {
  const {linhas} = relatorio;
  const possiveisDesistencias = linhas.reduce((s,v)=>s+
    Math.max(0,Number(v.iniciosCheckout||0)-Number(v.pedidosCriados||0)),0);
  const corpo = `
    <p class="texto-suave">Identifique quantos navegadores autorizaram as métricas,
      quantas visitas fizeram e quantas tentativas de compra ocorreram.
      Esta aba <strong>não coleta endereços MAC, IP, localização nem produtos visualizados</strong>.</p>
    <div class="linha" style="display:flex;flex-wrap:wrap;gap:10px">
      ${caixa(relatorio.registros,'Navegadores autorizados')}
      ${caixa(relatorio.clientesIdentificados,'Clientes identificados')}
      ${caixa(relatorio.visitas,'Sessões de visita')}
      ${caixa(relatorio.paginas,'Páginas abertas')}
      ${caixa(relatorio.cliquesCarrinho,'Adições à cesta')}
      ${caixa(relatorio.iniciosCheckout,'Inícios de compra')}
      ${caixa(relatorio.pedidosCriados,'Pedidos criados')}
      ${caixa(possiveisDesistencias,'Inícios sem pedido (estimativa)')}
    </div>
    <p class="texto-pequeno texto-suave mt-2">
      Cada navegador autorizado recebe um código aleatório, <strong>não é o MAC</strong>.
      O mesmo cliente pode ter vários códigos (computador/celular/navegadores).
      Sessões são separadas por 30 minutos de inatividade.
      Totais acumulados nos navegadores ativos nos últimos 90 dias.
      Início sem pedido não comprova abandono definitivo nem ausência de pagamento.
      Visitas anteriores à ativação e de quem recusou cookies não aparecem.</p>`;
  const body = linhas.map(v=>{
    const cliente = v.clienteId ? db.collection('customers').get(v.clienteId) : null;
    const identificador = 'Navegador •••' + String(v.id).slice(-6);
    const semPedido = Math.max(0,Number(v.iniciosCheckout||0)-Number(v.pedidosCriados||0));
    return '<tr>'+
      '<td><strong>'+e(identificador)+'</strong><br><small>Primeiro: '+e(momento(v.primeiroAcesso))+'</small></td>'+
      '<td>'+(cliente?'<a href="/admin/clientes/'+encodeURIComponent(cliente.id)+'">'+e(cliente.nome || 'Cliente cadastrado')+'</a>':'Não identificado')+'</td>'+
      '<td>'+inteiro(v.visitas)+'</td>'+
      '<td>'+inteiro(v.paginas)+'</td>'+
      '<td>'+inteiro(v.cliquesCarrinho)+'</td>'+
      '<td>'+inteiro(v.iniciosCheckout)+'</td>'+
      '<td>'+inteiro(v.pedidosCriados)+'</td>'+
      '<td>'+inteiro(semPedido)+'</td>'+
      '<td>'+inteiro(v.logins)+'</td>'+
      '<td>'+e(momento(v.ultimoAcesso))+'</td></tr>';
  }).join('');
  const tabela = '<div class="tabela-rolagem"><table class="tabela">'+
    '<thead><tr><th>Navegador</th><th>Cliente (após login)</th><th>Visitas</th>'+
    '<th>Páginas</th><th>Adições à cesta</th><th>Checkouts</th><th>Pedidos</th>'+
    '<th>Sem pedido¹</th><th>Logins</th><th>Último acesso</th></tr></thead>'+
    '<tbody>'+(body||'<tr><td colspan="10">Ainda não há visitas consentidas registradas.</td></tr>')+
    '</tbody></table></div>'+
    '<p class="texto-pequeno texto-suave">¹ Estimativa: inícios de checkout menos pedidos criados; '+
    'não equivale a abandono comprovado. Cadastro e login são registrados apenas com cookies aceitos.</p>';
  return paginaAdmin(ctx,{
    titulo:'Visitas e conversões',
    ativo:'visitas_site',
    conteudo:'<h1>Visitas e conversões</h1>'+corpo+
      painel({titulo:'Histórico de navegadores (até 200 mais recentes)',semPadding:true,corpo:tabela}),
  });
}
