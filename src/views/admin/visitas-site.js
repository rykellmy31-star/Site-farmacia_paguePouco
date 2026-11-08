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
  const possiveisDesistencias = relatorio.possiveisDesistencias;
  const opcoes = [
    ['hoje','Hoje'], ['ontem','Ontem'], ['7','7 dias'],
    ['30','30 dias'], ['90','90 dias'],
  ];
  const filtros = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0 18px">'+
    opcoes.map(([valor,rotulo]) =>
      '<a href="/admin/visitas?periodo='+valor+'"'+
      (relatorio.periodo === valor ? ' aria-current="page"' : '')+
      ' style="padding:9px 13px;border:1px solid #bbb;border-radius:8px;text-decoration:none;'+
      (relatorio.periodo === valor ? 'background:#174e44;color:#fff;' : '')+'">'+rotulo+'</a>'
    ).join('')+
    '<form action="/admin/visitas" method="get" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'+
      '<input type="hidden" name="periodo" value="dia">'+
      '<label for="dia-visitas">Escolher dia:</label>'+
      '<input id="dia-visitas" type="date" name="data" required min="'+e(relatorio.limiteHistorico)+
        '" max="'+e(relatorio.hoje)+'" value="'+e(relatorio.data || relatorio.hoje)+'">'+
      '<button type="submit">Ver dia</button>'+
      '<a href="/admin/visitas?periodo='+encodeURIComponent(relatorio.periodo)+
        (relatorio.data ? '&data='+encodeURIComponent(relatorio.data) : '')+
        '" style="padding:8px">Atualizar agora ↻</a>'+
    '</form></div>';
  const corpo = `
    <p class="texto-suave">Identifique quantos navegadores autorizaram as métricas,
      quantas visitas fizeram e quantas tentativas de compra ocorreram.
      Esta aba <strong>não coleta endereços MAC, IP, localização nem produtos visualizados</strong>.</p>
    <div class="linha" style="display:flex;flex-wrap:wrap;gap:10px">
      ${caixa(relatorio.registros,'Navegadores únicos')}
      ${caixa(relatorio.clientesIdentificados,'Clientes identificados')}
      ${caixa(relatorio.visitas,'Sessões de visita')}
      ${caixa(relatorio.paginas,'Páginas abertas')}
      ${caixa(relatorio.cliquesCarrinho,'Adições à cesta')}
      ${caixa(relatorio.iniciosCheckout,'Inícios de compra')}
      ${caixa(relatorio.pedidosCriados,'Pedidos criados')}
      ${caixa(possiveisDesistencias,'Inícios sem pedido (estimativa)')}
    </div>
    <p class="texto-pequeno texto-suave mt-2">
      <strong>${e(relatorio.rotulo)}</strong> • ${e(relatorio.inicio.split('-').reverse().join('/'))}
      a ${e(relatorio.fim.split('-').reverse().join('/'))}.
      Um navegador aparece <strong>uma vez por dia com atividade</strong>. Amanhã, o filtro Hoje
      começa com seus próprios registros, sem repetir os de hoje. Acesse Ontem ou outro período
      para consultar o histórico. Uma sessão reinicia após 30 minutos sem acesso ou no dia seguinte.
      Os dados anteriores a esta atualização eram acumulados por navegador e não podem ser
      redistribuídos por dia com precisão. Somente quem aceitou cookies é contado;
      não coletamos IP, MAC, localização nem produtos consultados.
      Inícios de compra sem pedido são estimativas, não perdas confirmadas.
    </p>`;
  const body = linhas.map(v=>{
    const cliente = v.clienteId ? db.collection('customers').get(v.clienteId) : null;
    const identificador = 'Navegador •••' + String(v.navegadorId).slice(-6);
    const semPedido = Math.max(0,Number(v.iniciosCheckout||0)-Number(v.pedidosCriados||0));
    return '<tr>'+
      '<td>'+e(String(v.data).split('-').reverse().join('/'))+'</td>'+
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
    '<thead><tr><th>Dia</th><th>Navegador</th><th>Cliente (após login)</th><th>Visitas</th>'+
    '<th>Páginas</th><th>Adições à cesta</th><th>Checkouts</th><th>Pedidos</th>'+
    '<th>Sem pedido¹</th><th>Logins</th><th>Último acesso</th></tr></thead>'+
    '<tbody>'+(body||'<tr><td colspan="11">Nenhuma visita consentida neste período.</td></tr>')+
    '</tbody></table></div>'+
    '<p class="texto-pequeno texto-suave">¹ Estimativa: inícios de checkout menos pedidos criados; '+
    'não equivale a abandono comprovado. Cadastro e login são registrados apenas com cookies aceitos.</p>';
  return paginaAdmin(ctx,{
    titulo:'Visitas e conversões',
    ativo:'visitas_site',
    conteudo:'<h1>Visitas e conversões</h1>'+filtros+corpo+
      painel({titulo:'Registros por navegador e dia (até 200 de '+inteiro(relatorio.totalLinhas)+')',semPadding:true,corpo:tabela}),
  });
}
