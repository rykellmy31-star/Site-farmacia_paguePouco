/** Observabilidade financeira restrita ao painel Sistema (Super Administrador).
 * Nunca grava IDs de pedidos, CPFs, tokens, valores nem respostas de provedores.
 */
import { nowISO } from '../store.js';

export function pendenciasFinanceiras(db) {
  const pedidos=db.collection('orders').all();
  return {
    pixPendentes:pedidos.filter(p=>p.metodoPagamento==='pix' &&
      p.statusFinanceiro==='pendente' && !!p.pagamentoId).length,
    estornosPendentes:pedidos.filter(p=>p.statusFinanceiro==='estorno_solicitado' ||
      (p.statusFinanceiro==='estornado' && !!p.cancelamentoPendenteEstorno)).length,
    checkoutsInterrompidos:pedidos.filter(p=>p.statusFinanceiro==='pendente' &&
      !p.pagamentoId && (p.pendenciaPagamento==null ||
        p.pendenciaPagamento==='criacao_em_andamento')).length,
    conferencias:pedidos.filter(p=>p.pendenciaPagamento==='conciliacao_necessaria').length,
  };
}

export function registrarCicloFinanceiro(db,{resultados={},falhas=[]}={}) {
  const numeros={};
  for(const nome of ['pedidos','pix','estornos']) {
    const d=resultados[nome]||{};
    numeros[nome]={};
    for(const campo of ['verificados','recuperados','sinalizados','atualizados',
      'confirmados','cancelados','pendentes','erros']) {
      if(Number.isSafeInteger(d[campo]) && d[campo]>=0)
        numeros[nome][campo]=Math.min(d[campo],1000000);
    }
  }
  const errosDeResultados=Object.values(numeros).reduce((s,fluxo)=>s+(fluxo.erros||0),0);
  const situacao=falhas.length || errosDeResultados ? 'atencao':'concluida';
  const colecao=db.collection('financeAlarmHealth'),data={
    ultimaExecucaoEm:nowISO(),situacao,
    falhas:falhas.filter(n=>['pedidos','pix','estornos','persistencia','reagendamento'].includes(n)).slice(0,5),
    resultados:numeros,
  };
  if(colecao.get('ultimo_ciclo')) colecao.update('ultimo_ciclo',data);
  else colecao.insert({id:'ultimo_ciclo',...data});
  return data;
}

export function diagnosticoFinanceiro(db) {
  const ultimo=db.collection('financeAlarmHealth').get('ultimo_ciclo');
  return {
    ...pendenciasFinanceiras(db),
    ultimaExecucaoEm:ultimo?.ultimaExecucaoEm||null,
    situacao:ultimo?.situacao||'sem_execucao_registrada',
    falhas:ultimo?.falhas||[],
    resultados:ultimo?.resultados||{},
  };
}
