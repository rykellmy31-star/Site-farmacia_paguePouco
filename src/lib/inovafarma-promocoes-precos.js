/**
 * Avaliação de descontos InovaFarma no instante da compra.
 * Não muda cadastros nem depende de agendador: a validade termina automaticamente.
 * Uma campanha semanal só funciona no dia explicitamente gravado na importação.
 */
const DIAS = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
const DATA_BR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'
});
export function diaLocalFarmacia(referencia = new Date()) {
  const partes = DATA_BR_FORMATTER.formatToParts(referencia);
  const campo = n => partes.find(p => p.type === n)?.value;
  return [campo('year'),campo('month'),campo('day')].join('-');
}
export function diaSemanaLocalFarmacia(yyyyMmDd) {
  const [y,m,d] = String(yyyyMmDd).split('-').map(Number);
  return DIAS[new Date(Date.UTC(y,m-1,d)).getUTCDay()];
}
export function precoPromocaoInovaVigente(produto, referencia = new Date()) {
  const registros = Array.isArray(produto?.inovaPromocoes) ? produto.inovaPromocoes : [];
  if (!registros.length) return null;
  const hoje = diaLocalFarmacia(referencia);
  const diaSemana = diaSemanaLocalFarmacia(hoje);
  const base = Number(produto.precoCentavos);
  if (!Number.isSafeInteger(base) || base <= 0) return null;
  const atuais = registros.filter(r =>
    r?.inicio && r?.fim && r.inicio <= hoje && r.fim >= hoje &&
    (!r.diaSemana || r.diaSemana === diaSemana) &&
    Number.isSafeInteger(r.precoVendaCentavos) && r.precoVendaCentavos === base &&
    Number.isSafeInteger(r.precoPromocionalCentavos) &&
    r.precoPromocionalCentavos > 0 && r.precoPromocionalCentavos < base);
  // Duas campanhas simultâneas para o mesmo produto não têm prioridade
  // comprovada: não conceder desconto arbitrário ou cumulativo.
  return atuais.length === 1 ? atuais[0].precoPromocionalCentavos : null;
}
