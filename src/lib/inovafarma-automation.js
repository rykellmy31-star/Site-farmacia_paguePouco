/**
 * Automação local dos módulos InovaFarma.
 *
 * O conector oficial, quando homologado e habilitado fora do painel, faz
 * os envios/consultas remotas. Este módulo registra eventos autenticados,
 * detecta saldos desatualizados e mantém o monitoramento automaticamente.
 *
 * NÃO realiza HTTP, não altera saldo nem cria vendas no ERP.
 */
import { config } from '../config.js';
import { nowISO } from './store.js';

const ID = 'inovafarma';
const MAX_EVENTOS = 100;
const TIPOS = new Set(['estoque_recebido', 'vendas_confirmadas',
  'falha_validacao_estoque', 'falha_validacao_vendas', 'estado_alterado']);

function registrarEvento(db, tipo, detalhes = {}, data = nowISO()) {
  if (!TIPOS.has(tipo)) throw new Error('Evento Inova não reconhecido.');
  const eventos = db.collection('inovaAutomationEvents');
  eventos.insert({ tipo, ...detalhes, criadoEm: data });
  // Histórico operacional limitado, sem guardar payload de fornecedor.
  const todos = eventos.all().sort((a,b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
  for(const antigo of todos.slice(0, Math.max(0,todos.length-MAX_EVENTOS))) eventos.remove(antigo.id);
}

function estadoAtual(db) {
  return db.collection('inovaAutomationMeta').get(ID) || null;
}

export function registrarAtividadeConectorInova(db, tipo, {
  quantidade = 0, data = nowISO(),
} = {}) {
  if (!TIPOS.has(tipo) || tipo === 'estado_alterado')
    throw new Error('Tipo de atividade inválido.');
  const qtd = Math.max(0, Math.min(100000, Number.isSafeInteger(quantidade) ? quantidade : 0));
  const cols = db.collection('inovaAutomationMeta'), atual = estadoAtual(db) || {};
  const sucesso = tipo === 'estoque_recebido' || tipo === 'vendas_confirmadas';
  const patch = {
    ultimaAtividadeEm: data,
    ultimaAtividade: tipo,
    ...(sucesso ? { ultimaConexaoValidada: data } : {
      falhasValidacao: Number(atual.falhasValidacao || 0) + 1,
    }),
    ...(tipo === 'estoque_recebido' ? {
      ultimaSincronizacaoSucessoEm: data,
      produtosAtualizadosAcumulado: Number(atual.produtosAtualizadosAcumulado || 0) + qtd,
    } : {}),
    ...(tipo === 'vendas_confirmadas' ? {
      ultimaConfirmacaoVendaEm: data,
      vendasConfirmadasAcumulado: Number(atual.vendasConfirmadasAcumulado || 0) + qtd,
    } : {}),
  };
  if (atual.id) cols.update(ID, patch);
  else cols.insert({ id: ID, ...patch });
  registrarEvento(db, tipo, { quantidade: qtd }, data);
  return { ok: true };
}

/** Checagem de saúde sem comunicação externa: pode ser executada por DO Alarm. */
export function avaliarAutomacaoInova(db, { agora = Date.now(), persistir = false } = {}) {
  const habilitada = config.inova?.enabled === true;
  const ultimoLote = db.collection('inovaSyncMeta').get('estoque');
  const recebido = Date.parse(ultimoLote?.recebidoEm || '');
  const maxIdade = Math.max(1, Number(config.inova?.maxAgeMinutes || 15)) * 60000;
  const estoqueDesatualizado = !Number.isFinite(recebido) ||
    recebido > agora + 60000 || agora - recebido > maxIdade;
  const produtos = db.collection('products').all().filter(p=>p.ativo!==false);
  const eanSemCorrespondencia = produtos.filter(p=>!/^\d{8,14}$/.test(String(p.ean||''))).length;
  const pedidos = db.collection('orders').all();
  const vendasAguardando = pedidos.filter(p => p.inovaEnvioPendente === true &&
    !p.inovaConfirmadoEm && p.statusFinanceiro === 'aprovado' &&
    p.statusOperacional !== 'cancelado').length;
  const vendasConfirmadas = pedidos.filter(p => !!p.inovaConfirmadoEm).length;
  const vendasParaConferir = pedidos.filter(p => p.inovaEnvioPendente === true &&
    !p.inovaConfirmadoEm && (p.statusFinanceiro !== 'aprovado' ||
    p.statusOperacional === 'cancelado' || (p.itens || []).some(it =>
      !/^\d{8,14}$/.test(String(it.ean ||
        db.collection('products').get(it.produtoId)?.ean || ''))))).length;
  const problemas = [];
  if (habilitada && estoqueDesatualizado) problemas.push('estoque_desatualizado');
  if (habilitada && eanSemCorrespondencia) problemas.push('ean_incompleto');
  if (habilitada && vendasParaConferir) problemas.push('vendas_sem_ean');
  const status = !habilitada ? 'aguardando_homologacao' :
    problemas.length ? 'atencao' : 'monitorando';
  const diagnostico = {
    status, habilitada, estoqueDesatualizado, eanSemCorrespondencia,
    vendasAguardando, vendasConfirmadas, vendasParaConferir, problemas,
  };
  if (persistir && habilitada) {
    const cols = db.collection('inovaAutomationMeta'), atual = estadoAtual(db) || {};
    const novoEstado = JSON.stringify({ status, problemas });
    const mudou = atual.ultimoEstadoHash !== novoEstado;
    const patch = { ultimaAvaliacaoEm: new Date(agora).toISOString(),
      ultimoEstadoHash: novoEstado, estadoAutomatico: status };
    if (atual.id) cols.update(ID, patch);
    else cols.insert({ id: ID, ...patch });
    if (mudou) registrarEvento(db,'estado_alterado',{
      estado: status, problemas: [...problemas],
    },new Date(agora).toISOString());
  }
  return diagnostico;
}

export function statusAutomaticoInova(db) {
  const diagnostico = avaliarAutomacaoInova(db);
  const meta = estadoAtual(db);
  return {
    ...diagnostico,
    // Contatos autenticados reais, nunca inferidos de token ou URL cadastrada.
    ultimaConexaoValidada: meta?.ultimaConexaoValidada || null,
    ultimaConfirmacaoVendaEm: meta?.ultimaConfirmacaoVendaEm || null,
    ultimaAvaliacaoEm: meta?.ultimaAvaliacaoEm || null,
    ultimaAtividade: meta?.ultimaAtividade || null,
    falhasValidacao: Number(meta?.falhasValidacao || 0),
    eventos: db.collection('inovaAutomationEvents').all()
      .sort((a,b)=>String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0,20),
  };
}
