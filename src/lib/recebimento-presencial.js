/** Conferência de pagamento PRESENCIAL efetivamente recebido. */
export const METODOS_RECEBIMENTO=Object.freeze({
  pix:'Pix',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',cash:'Dinheiro',
});
export const BANDEIRAS=Object.freeze({
  visa:'Visa',mastercard:'Mastercard',elo:'Elo',amex:'American Express',
  hipercard:'Hipercard',outra:'Outra',
});
export function validarRecebimentoPresencial(body={}){
  const metodo=String(body.metodoRecebido||'');
  if(!Object.hasOwn(METODOS_RECEBIMENTO,metodo))
    return {ok:false,erro:'Informe a forma de pagamento realmente recebida.'};
  if(String(body.confirmouRecebimento||'')!=='1')
    return {ok:false,erro:'Confirme que recebeu o pagamento de verdade.'};
  const cartao=metodo==='credit_card'||metodo==='debit_card';
  const bandeira=cartao?String(body.bandeira||''):'';
  if(cartao&&!Object.hasOwn(BANDEIRAS,bandeira))
    return {ok:false,erro:'Informe a bandeira do cartão recebido.'};
  const numero=cartao?Number(body.parcelas||1):1;
  if(!Number.isSafeInteger(numero)||numero<1||numero>12)
    return {ok:false,erro:'Número de parcelas inválido.'};
  if(metodo==='debit_card'&&numero!==1)
    return {ok:false,erro:'Débito deve ser à vista.'};
  const parcelas=metodo==='credit_card'?numero:1;
  return {ok:true,recebimento:{
    metodo,bandeira:cartao?bandeira:null,parcelas,
    condicao:parcelas===1?'a_vista':'parcelado',
  }};
}
