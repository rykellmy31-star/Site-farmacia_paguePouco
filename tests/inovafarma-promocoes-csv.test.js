import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarPromocoesInovaCsv } from '../src/lib/inovafarma-promocoes-csv.js';

function fixture({desconto='10,00',inicio='01/10/2026',fim='31/10/2026'}={}) {
  const row = Array(29).fill('');
  row[0]='Código';row[1]='Produto';row[21]='Desc.%';row[24]='Preço Venda';row[27]='Preço Promoção';
  const p=Array(29).fill('');
  p[0]='12345';p[1]='Produto teste';p[21]=desconto;p[24]='18,00';p[27]='16,20';
  return ['RELATÓRIO DE PROMOÇÕES','Promoção;;111;;;OFERTA OUTUBRO',
    'Início;;Final',`${inicio};;${fim}`,row.join(';'),p.join(';')].join('\n');
}
test('lê campanha, código, preço e desconto sem escrever em banco',()=>{
  const r=analisarPromocoesInovaCsv(fixture());
  assert.equal(r.total,1);
  assert.equal(r.promocoes[0].codigoInterno,'12345');
  assert.equal(r.promocoes[0].descontoPercentual,10);
  assert.equal(r.promocoes[0].precoVendaCentavos,1800);
  assert.equal(r.promocoes[0].precoPromocionalCentavos,1620);
  assert.equal(r.promocoes[0].campanha.fim,'2026-10-31');
});
test('rejeita formato não reconhecido',()=>{
  assert.throws(()=>analisarPromocoesInovaCsv('EAN;Desconto\n123;10'));
});
test('sinaliza linha com desconto inválido, sem aplicar',()=>{
  assert.throws(()=>analisarPromocoesInovaCsv(fixture({desconto:'150,00'})));
});
test('rejeita período impossível',()=>{
  assert.throws(()=>analisarPromocoesInovaCsv(fixture({inicio:'31/02/2026'})));
});
