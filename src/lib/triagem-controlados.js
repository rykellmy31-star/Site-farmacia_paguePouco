/**
 * Triagem NÃO conclusiva de possíveis medicamentos sujeitos a controle especial.
 * Lê o CSV já recebido pelo robô V3, sem tocar no InovaFarma, produtos ou vendas.
 * A lista é somente um conjunto inicial de nomes para sinalização; NÃO representa
 * a lista completa/vigente da Portaria SVS/MS 344/1998.
 * Fonte para revisão: https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/lista-substancias
 *
 * Nomes comerciais sem princípio ativo no CSV podem escapar à triagem.
 * Somente conferência farmacêutica dos produtos/registros determina o enquadramento.
 */
import {identificarPossivelControlado as identificarTermos,
  criarAvaliadorControlados} from './bloqueio-controlados-inova.js';
export const identificarPossivelControlado = identificarTermos;

export function avaliarUltimoRelatorioControlados(db, {pagina = 1, porPagina = 50} = {}) {
  const cfg = db.collection('inovaRoboConfiguracao').get('principal');
  const job = cfg?.ultimaExecucao
    ? db.collection('inovaRoboExecucoes').get(cfg.ultimaExecucao) : null;
  if (!job || job.status !== 'concluido') {
    return {disponivel: false, motivo: 'aguardando_relatorio_completo', itens: [], total: 0};
  }
  const encontrados = [];
  const avaliar = criarAvaliadorControlados(db);
  let analisados = 0;
  for (let bloco = 0; bloco < job.blocos; bloco++) {
    const lote = db.collection('inovaRoboBlocos').get(job.id + ':' + bloco);
    if (!lote?.aplicadoEm || !Array.isArray(lote.items)) {
      return {disponivel: false, motivo: 'relatorio_sem_bloco', itens: [], total: 0};
    }
    for (const item of lote.items) {
      analisados++;
      const match = avaliar(item);
      if (!match.bloqueado) continue;
      const substancias = match.termos;
      encontrados.push({
        codigoInterno: String(item.codigoInterno || ''),
        ean: String(item.ean || ''),
        nome: String(item.nome || ''),
        substancias, motivo:match.motivo,
      });
    }
  }
  if (analisados !== job.total) {
    return {disponivel: false, motivo: 'relatorio_inconsistente', itens: [], total: 0};
  }
  encontrados.sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR') ||
    a.codigoInterno.localeCompare(b.codigoInterno));
  const tamanho = Number.isSafeInteger(porPagina) ? Math.min(100, Math.max(1, porPagina)) : 50;
  const paginas = Math.max(1, Math.ceil(encontrados.length / tamanho));
  const solicitada = Number.isSafeInteger(pagina) ? pagina : 1;
  const atual = Math.min(Math.max(1, solicitada), paginas);
  return {
    disponivel: true, geradoEm: job.geradoEm, analisados,
    total: encontrados.length, pagina: atual, paginas,
    itens: encontrados.slice((atual - 1) * tamanho, atual * tamanho),
    tipo: 'bloqueio_por_lista_e_termos_preliminares',
  };
}
