/**
 * Métricas próprias, sem MAC/IP, localização, itens comprados ou fingerprinting.
 * Somente navegadores que aceitaram cookies analíticos geram registros.
 * Um identificador representa um navegador/perfil (não uma pessoa física).
 */
import { randomToken } from './security.js';

const COLECAO = 'visitantesSite';
const COOKIE = 'pp_visitante';
const CONSENTIMENTO = 'pp_cookies';
const LIMITE_DIAS = 90;
const INATIVIDADE_MS = 30 * 60_000;
const TIPOS = new Set(['pagina','carrinho','checkout','pedido','login','cadastro']);
const ID_VALIDO = /^[A-Za-z0-9_-]{20,64}$/;

const COLECAO_DIAS = 'visitasSitePorDia';
const COLECAO_CONTROLE = 'visitasSiteControle';
const DIA_MS = 86_400_000;
function diaLocal(instante) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instante));
  const p = chave => partes.find(x => x.type === chave)?.value;
  return p('year') + '-' + p('month') + '-' + p('day');
}
function deslocarDia(dia, quantidade) {
  return new Date(Date.parse(dia + 'T12:00:00Z') + quantidade * DIA_MS)
    .toISOString().slice(0, 10);
}
// Limpeza diária, por dia civil, sem necessidade de cron ou acesso do administrador.
function limparAntigos(db, agora) {
  const hoje = diaLocal(agora);
  const controle = db.collection(COLECAO_CONTROLE);
  if (controle.get('limpeza')?.dia === hoje) return;
  const limite = deslocarDia(hoje, 1 - LIMITE_DIAS);
  const diarios = db.collection(COLECAO_DIAS);
  for (const v of diarios.all()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.data || '') || v.data < limite) diarios.remove(v.id);
  }
  const navegadores = db.collection(COLECAO);
  for (const v of navegadores.all()) {
    const ultimo = Date.parse(v.ultimoAcesso || '');
    if (!Number.isFinite(ultimo) || ultimo < agora - LIMITE_DIAS * DIA_MS)
      navegadores.remove(v.id);
  }
  if (controle.get('limpeza')) controle.update('limpeza', { dia: hoje });
  else controle.insert({ id: 'limpeza', dia: hoje });
}
function dadosEvento(atual, tipo, instante, agora, pedidoId, clienteId) {
  const dados = { ultimoAcesso: instante };
  if (clienteId && !atual.clienteId) dados.clienteId = clienteId;
  if (tipo === 'pagina') {
    dados.paginas = (atual.paginas || 0) + 1;
    const anterior = Date.parse(atual.ultimaSessaoEm || '');
    if (!Number.isFinite(anterior) || agora - anterior >= INATIVIDADE_MS)
      dados.visitas = (atual.visitas || 0) + 1;
    dados.ultimaSessaoEm = instante;
  }
  if (tipo === 'carrinho') dados.cliquesCarrinho = (atual.cliquesCarrinho || 0) + 1;
  if (tipo === 'checkout') {
    const anterior = Date.parse(atual.ultimoCheckoutEm || '');
    if (!Number.isFinite(anterior) || agora - anterior >= INATIVIDADE_MS)
      dados.iniciosCheckout = (atual.iniciosCheckout || 0) + 1;
    dados.ultimoCheckoutEm = instante;
  }
  if (tipo === 'pedido' && pedidoId && atual.ultimoPedidoId !== pedidoId) {
    dados.pedidosCriados = (atual.pedidosCriados || 0) + 1;
    dados.ultimoPedidoId = pedidoId;
  }
  if (tipo === 'login') dados.logins = (atual.logins || 0) + 1;
  if (tipo === 'cadastro') dados.cadastros = (atual.cadastros || 0) + 1;
  return dados;
}


export function autorizouVisitas(req) {
  return req?.cookies?.[CONSENTIMENTO] === 'aceito';
}

/** O servidor cria a chave; nunca aceita ID de visitante enviado no corpo da requisição. */
export function registrarVisita(db, req, res, tipo, { cliente = null, pedidoId = null, agora = Date.now() } = {}) {
  if (!autorizouVisitas(req) || !TIPOS.has(tipo) || req?.adminUser) return { registrado: false };
  const instante = new Date(agora).toISOString();
  limparAntigos(db, agora);
  let id = String(req.cookies?.[COOKIE] || '');
  const col = db.collection(COLECAO);
  let atual = ID_VALIDO.test(id) ? col.get(id) : null;
  const clienteReal = cliente || req?.user || null;
  // Em computador compartilhado, uma segunda conta não herda o histórico
  // associado à primeira. Nunca fundir cookies antigos de outros clientes.
  if (atual?.clienteId && clienteReal?.id && atual.clienteId !== clienteReal.id) {
    atual = null;
    id = '';
  }
  if (!atual) {
    id = randomToken(18);
    res?.cookie?.(COOKIE, id, {
      path: '/', maxAge: 60 * 60 * 24 * LIMITE_DIAS,
      httpOnly: true, sameSite: 'Lax', secure: true,
    });
    if (req.cookies) req.cookies[COOKIE] = id;
    atual = col.insert({
      id, primeiroAcesso: instante, ultimoAcesso: instante,
      clienteId: clienteReal?.id || null,
      visitas: 0, paginas: 0, cliquesCarrinho: 0,
      iniciosCheckout: 0, pedidosCriados: 0, logins: 0, cadastros: 0,
      ultimaSessaoEm: null, ultimoCheckoutEm: null, ultimoPedidoId: null,
    });
  }
  // Mantém o agregado legado apenas por compatibilidade; o painel usa as linhas por dia.
  const dados = dadosEvento(atual, tipo, instante, agora, pedidoId, clienteReal?.id);
  col.update(id, dados);

  // Cada navegador tem uma linha independente por dia local. Amanhã começa do zero.
  const data = diaLocal(agora);
  const diario = db.collection(COLECAO_DIAS);
  const idDiario = id + ':' + data;
  let linha = diario.get(idDiario);
  if (!linha) {
    linha = diario.insert({
      id: idDiario, navegadorId: id, data, codigoDia: randomToken(9), primeiroAcesso: instante,
      ultimoAcesso: instante, clienteId: clienteReal?.id || null,
      visitas: 0, paginas: 0, cliquesCarrinho: 0, iniciosCheckout: 0,
      pedidosCriados: 0, logins: 0, cadastros: 0,
      ultimaSessaoEm: null, ultimoCheckoutEm: null, ultimoPedidoId: null,
    });
  }
  diario.update(idDiario, dadosEvento(linha, tipo, instante, agora, pedidoId, clienteReal?.id));
  return { registrado: true };
}

/** Ao sair da conta, impede atribuir navegação posterior à pessoa anterior. */
export function separarVisitaAoSair(req,res) {
  res?.clearCookie?.(COOKIE);
  if (req.cookies) delete req.cookies[COOKIE];
}

export function revogarVisitas(db, req, res) {
  const id = String(req?.cookies?.[COOKIE] || '');
  if (ID_VALIDO.test(id)) {
    db.collection(COLECAO).remove(id);
    const diario = db.collection(COLECAO_DIAS);
    for (const v of diario.all()) if (v.navegadorId === id) diario.remove(v.id);
  }
  res?.clearCookie?.(COOKIE);
  if (req.cookies) delete req.cookies[COOKIE];
}

/** Dados resumidos: não reter páginas de saúde, EAN, IP nem user agent. */
export function relatorioVisitas(db,
  { agora = Date.now(), periodo = 'hoje', data = '', limite = 200 } = {}) {
  limparAntigos(db, agora);
  const hoje = diaLocal(agora);
  const limiteHistorico = deslocarDia(hoje, 1 - LIMITE_DIAS);
  const permitidos = new Set(['hoje','ontem','7','30','90','dia']);
  let escolha = permitidos.has(periodo) ? periodo : 'hoje';
  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data) &&
    !Number.isNaN(Date.parse(data + 'T12:00:00Z')) &&
    new Date(data + 'T12:00:00Z').toISOString().slice(0, 10) === data &&
    data >= limiteHistorico && data <= hoje;
  if (escolha === 'dia' && !dataValida) escolha = 'hoje';
  let inicio = hoje, fim = hoje;
  if (escolha === 'ontem') inicio = fim = deslocarDia(hoje, -1);
  if (['7','30','90'].includes(escolha)) inicio = deslocarDia(hoje, 1 - Number(escolha));
  if (escolha === 'dia') inicio = fim = data;

  const todos = db.collection(COLECAO_DIAS).all()
    .filter(v => v.data >= inicio && v.data <= fim)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) ||
      String(b.ultimoAcesso).localeCompare(String(a.ultimoAcesso)));
  const soma = chave => todos.reduce((total, v) => total + Number(v[chave] || 0), 0);
  const navegadores = new Set(todos.map(v => v.navegadorId));
  const clientes = new Set(todos.filter(v => v.clienteId).map(v => v.clienteId));
  const rotulos = { hoje:'Hoje', ontem:'Ontem', 7:'Últimos 7 dias',
    30:'Últimos 30 dias', 90:'Últimos 90 dias', dia:'Dia selecionado' };
  return {
    periodo: escolha, data: escolha === 'dia' ? data : '', hoje,
    limiteHistorico, inicio, fim, rotulo: rotulos[escolha],
    registros: navegadores.size, clientesIdentificados: clientes.size,
    visitas: soma('visitas'), paginas: soma('paginas'),
    cliquesCarrinho: soma('cliquesCarrinho'), iniciosCheckout: soma('iniciosCheckout'),
    pedidosCriados: soma('pedidosCriados'), logins: soma('logins'),
    possiveisDesistencias: todos.reduce((total, v) => total +
      Math.max(0, Number(v.iniciosCheckout || 0) - Number(v.pedidosCriados || 0)), 0),
    linhas: todos.slice(0, Math.max(1, Math.min(500, limite))),
    totalLinhas: todos.length,
  };
}
