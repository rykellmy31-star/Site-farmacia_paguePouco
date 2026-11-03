/** Relatório operacional para digitação manual no InovaFarma.
 * Uma venda = um pedido aprovado, independentemente da quantidade de itens.
 * Recusados, pendentes e estornados nunca entram como vendas.
 */
export function dataDaLoja(instant){
  const d=new Date(instant);
  if(!Number.isFinite(d.getTime()))return '';
  const partes=Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',
      day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(d)
      .filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return partes.year+'-'+partes.month+'-'+partes.day;
}
export function periodoValido(de,ate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(de)||!/^\d{4}-\d{2}-\d{2}$/.test(ate))
    return false;
  const inicio=Date.parse(de+'T00:00:00.000Z'),fim=Date.parse(ate+'T00:00:00.000Z');
  return Number.isFinite(inicio)&&Number.isFinite(fim)&&
    new Date(inicio).toISOString().slice(0,10)===de&&
    new Date(fim).toISOString().slice(0,10)===ate&&
    fim>=inicio&&fim-inicio<=366*86400000;
}
function dataPagamento(p){
  // Priorizar a confirmação real, em vez da data da encomenda.
  const evento=(p.historico||[]).filter(h=>h.tipo==='financeiro'&&
    h.status==='aprovado'&&Number.isFinite(Date.parse(h.em))).at(-1);
  return evento?.em||p.pagamentoPresencial?.confirmadoEm||p.criadoEm;
}
const NOMES_METODOS={pix:'Pix',credit_card:'Crédito',debit_card:'Débito',cash:'Dinheiro'};
const NOMES_BANDEIRAS={visa:'Visa',mastercard:'Mastercard',elo:'Elo',amex:'American Express',
  hipercard:'Hipercard',outra:'Outra'};
export function relatorioOperacionalVendas(pedidos,{de,ate}){
  if(!periodoValido(de,ate))throw new Error('Período inválido (máximo de 366 dias).');
  const vendas=pedidos.filter(p=>p?.statusFinanceiro==='aprovado').map(p=>{
    const data=dataPagamento(p);
    const dia=dataDaLoja(data);
    if(dia<de||dia>ate)return null;
    const recebido=p.pagamentoPresencial?.recebimento;
    const metodo=recebido?.metodo||p.metodoPagamento||'';
    return {pedido:p,data,dia,valorCentavos:Number(p.totalCentavos)||0,
      metodo,forma:NOMES_METODOS[metodo]||metodo,
      bandeira:recebido?.bandeira?NOMES_BANDEIRAS[recebido.bandeira]||recebido.bandeira:'',
      parcelas:recebido?.parcelas||p.parcelas||1,
      pagamentoLocal:!!p.pagamentoPresencial,
      itens:(p.itens||[]).map(i=>({...i})),
      qtdItens:(p.itens||[]).reduce((n,i)=>n+(Number(i.quantidade)||0),0),
    };
  }).filter(Boolean).sort((a,b)=>String(b.data).localeCompare(String(a.data))||
    String(a.pedido.codigo).localeCompare(String(b.pedido.codigo)));
  const porMetodo={};
  for(const v of vendas)porMetodo[v.forma]=(porMetodo[v.forma]||0)+v.valorCentavos;
  return {de,ate,vendas,quantidade:vendas.length,
    receitaCentavos:vendas.reduce((n,v)=>n+v.valorCentavos,0),
    qtdItens:vendas.reduce((n,v)=>n+v.qtdItens,0),porMetodo};
}
