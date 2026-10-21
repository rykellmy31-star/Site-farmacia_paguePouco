/**
 * Diagnóstico mínimo e seguro de falhas do gateway.
 * Nunca persistir body bruto da API (pode conter CPF, email, token etc.).
 */
const CODIGOS_VALIDOS = new Set(['2067','2072','2198','4006','4037','4050','4051','4292']);
const NOMES_VALIDOS = new Set(['invalid_parameter','invalid_token','unauthorized','forbidden','invalid_payer','invalid_identification']);
export function diagnosticarFalhaPix(status, data = null) {
  const httpStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 0;
  const candidatos = [data?.code, data?.cause?.[0]?.code, data?.error];
  const codigo = candidatos.map(x => String(x ?? '').toLowerCase()).find(x =>
    CODIGOS_VALIDOS.has(x) || NOMES_VALIDOS.has(x)) || 'nao_informado';
  let motivo;
  if (httpStatus === 401) motivo = 'A credencial de acesso foi recusada pelo Mercado Pago. Verifique o Access Token e o ambiente.';
  else if (httpStatus === 403) motivo = 'A conta não está autorizada a receber esta cobrança. Confira a habilitação do Pix na conta Mercado Pago.';
  else if (httpStatus === 400 || httpStatus === 422) {
    if (['2067','4006','invalid_identification','invalid_payer'].includes(codigo))
      motivo = 'O Mercado Pago recusou os dados do pagador. Confira CPF e dados cadastrais.';
    else if (['2072','4037'].includes(codigo))
      motivo = 'O Mercado Pago recusou o valor enviado. Verifique as condições e limites do Pix.';
    else if (codigo === '2198')
      motivo = 'O Mercado Pago recusou o e-mail usado no ambiente de testes.';
    else motivo = 'O Mercado Pago não aceitou a solicitação. Confira os dados e a configuração do Pix.';
  } else motivo = 'A solicitação ao Mercado Pago não foi aceita.';
  return { httpStatus, codigo, motivo };
}
