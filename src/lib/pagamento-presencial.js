/** Checkout presencial: só permitido quando CEP de destino === CEP da sede. */
import { normalizeCep, isValidCep } from './cep.js';
import { toCents } from './format.js';

export const METODOS_PRESENCIAIS=Object.freeze({
  pix:'Pix na entrega ou retirada',
  credit_card:'Cartão de crédito na entrega ou retirada',
  debit_card:'Cartão de débito na entrega ou retirada',
  cash:'Dinheiro na entrega ou retirada',
});
export function pedidoPresencialPorCEP(cepDestino,cepFarmacia){
  const destino=normalizeCep(cepDestino),loja=normalizeCep(cepFarmacia);
  return isValidCep(destino)&&isValidCep(loja)&&destino===loja;
}
export function validarPagamentoPresencial({metodo,precisaTroco,trocoPara,totalCentavos}){
  if(!Object.hasOwn(METODOS_PRESENCIAIS,metodo))
    return {ok:false,erro:'Selecione Pix, crédito, débito ou dinheiro para pagar na entrega ou retirada.'};
  const troco=precisaTroco==='1'||precisaTroco===true;
  if(metodo!=='cash'&&troco)
    return {ok:false,erro:'Troco é permitido somente para pagamento em dinheiro.'};
  if(metodo!=='cash'||!troco)return {ok:true,presencial:{
    metodo,precisaTroco:false,trocoParaCentavos:null,trocoCentavos:null,
  }};
  const str=String(trocoPara??'').trim();
  if(!/^(?:\d{1,7})(?:[.,]\d{1,2})?$/.test(str))
    return {ok:false,erro:'Informe um valor válido para o troco, por exemplo 100,00.'};
  const valor=toCents(str);
  if(!Number.isSafeInteger(valor)||valor<=0||valor<totalCentavos)
    return {ok:false,erro:'O valor informado para troco deve ser igual ou maior que o total do pedido.'};
  return {ok:true,presencial:{metodo,precisaTroco:true,trocoParaCentavos:valor,
    trocoCentavos:valor-totalCentavos}};
}
