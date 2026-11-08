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

export function autorizouVisitas(req) {
  return req?.cookies?.[CONSENTIMENTO] === 'aceito';
}

/** O servidor cria a chave; nunca aceita ID de visitante enviado no corpo da requisição. */
export function registrarVisita(db, req, res, tipo, { cliente = null, pedidoId = null } = {}) {
  if (!autorizouVisitas(req) || !TIPOS.has(tipo) || req?.adminUser) return { registrado: false };
  const agora = new Date().toISOString();
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
      id, primeiroAcesso: agora, ultimoAcesso: agora,
      clienteId: clienteReal?.id || null,
      visitas: 0, paginas: 0, cliquesCarrinho: 0,
      iniciosCheckout: 0, pedidosCriados: 0, logins: 0, cadastros: 0,
      ultimaSessaoEm: null, ultimoCheckoutEm: null, ultimoPedidoId: null,
    });
  }
  const dados = { ultimoAcesso: agora };
  if (clienteReal?.id && !atual.clienteId) dados.clienteId = clienteReal.id;
  if (tipo === 'pagina') {
    dados.paginas = (atual.paginas || 0) + 1;
    const anterior = Date.parse(atual.ultimaSessaoEm || '');
    if (!Number.isFinite(anterior) || Date.now() - anterior >= INATIVIDADE_MS) {
      dados.visitas = (atual.visitas || 0) + 1;
    }
    dados.ultimaSessaoEm = agora;
  }
  if (tipo === 'carrinho') dados.cliquesCarrinho = (atual.cliquesCarrinho || 0) + 1;
  if (tipo === 'checkout') {
    const anterior = Date.parse(atual.ultimoCheckoutEm || '');
    // Uma tentativa durante 30 min, mesmo que a página recarregue.
    if (!Number.isFinite(anterior) || Date.now() - anterior >= INATIVIDADE_MS)
      dados.iniciosCheckout = (atual.iniciosCheckout || 0) + 1;
    dados.ultimoCheckoutEm = agora;
  }
  if (tipo === 'pedido' && pedidoId && atual.ultimoPedidoId !== pedidoId) {
    dados.pedidosCriados = (atual.pedidosCriados || 0) + 1;
    dados.ultimoPedidoId = pedidoId;
  }
  if (tipo === 'login') dados.logins = (atual.logins || 0) + 1;
  if (tipo === 'cadastro') dados.cadastros = (atual.cadastros || 0) + 1;
  col.update(id, dados);
  return { registrado: true };
}

export function revogarVisitas(db, req, res) {
  const id = String(req?.cookies?.[COOKIE] || '');
  if (ID_VALIDO.test(id)) db.collection(COLECAO).remove(id);
  res?.clearCookie?.(COOKIE);
  if (req.cookies) delete req.cookies[COOKIE];
}

/** Dados resumidos: não reter páginas de saúde, EAN, IP nem user agent. */
export function relatorioVisitas(db, { agora = Date.now(), dias = 90, limite = 200 } = {}) {
  const col = db.collection(COLECAO);
  const fimRetencao = agora - LIMITE_DIAS * 86_400_000;
  for (const v of col.all()) {
    const ultimo = Date.parse(v.ultimoAcesso || '');
    if (!Number.isFinite(ultimo) || ultimo < fimRetencao) col.remove(v.id);
  }
  const inicio = agora - Math.max(1, Math.min(LIMITE_DIAS, Number(dias) || 90)) * 86_400_000;
  const todos = col.all().filter(v => Date.parse(v.ultimoAcesso) >= inicio)
    .sort((a,b)=>String(b.ultimoAcesso).localeCompare(String(a.ultimoAcesso)));
  const soma = chave => todos.reduce((total, v)=>total + Number(v[chave]||0),0);
  const clientes = new Set(todos.filter(v=>v.clienteId).map(v=>v.clienteId));
  return {
    registros: todos.length, clientesIdentificados: clientes.size,
    visitas: soma('visitas'), paginas: soma('paginas'),
    cliquesCarrinho: soma('cliquesCarrinho'), iniciosCheckout: soma('iniciosCheckout'),
    pedidosCriados: soma('pedidosCriados'), logins: soma('logins'),
    linhas: todos.slice(0, Math.max(1, Math.min(500, limite))),
    dias,
  };
}
