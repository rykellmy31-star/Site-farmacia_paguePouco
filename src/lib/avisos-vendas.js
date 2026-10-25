/** Avisos locais para navegadores autenticados no painel de pedidos.
 * Dados mínimos: nenhum nome, e-mail, telefone, endereço ou CPF.
 * Apenas eventos financeiros confirmados na trilha auditável do pedido.
 */
const HORIZONTE_MS = 48 * 60 * 60 * 1000;
export function listarVendasPagasParaAviso(db, {agoraMs=Date.now(),limite=100}={}) {
  const inicio=agoraMs-HORIZONTE_MS;
  return db.collection('orders').all().filter(p=>p?.statusFinanceiro==='aprovado' && !p?.pedidoRecebidoEm)
    .map(p=>{
      const confirmado=(p.historico||[]).findLast(
        h=>h?.tipo==='financeiro'&&h?.status==='aprovado'&&Number.isFinite(Date.parse(h.em)));
      if(!confirmado)return null;
      const ts=Date.parse(confirmado.em);
      if(ts<inicio||ts>agoraMs+5*60*1000)return null;
      return {
        id:String(p.id), codigo:String(p.codigo||'Pedido').slice(0,40),
        totalCentavos:Number.isSafeInteger(p.totalCentavos)&&p.totalCentavos>=0
          ?p.totalCentavos:0,
        aprovadoEm:confirmado.em,
      };
    }).filter(Boolean)
    .sort((a,b)=>Date.parse(b.aprovadoEm)-Date.parse(a.aprovadoEm)||
      a.id.localeCompare(b.id))
    .slice(0,Math.min(100,Math.max(1,limite)));
}
