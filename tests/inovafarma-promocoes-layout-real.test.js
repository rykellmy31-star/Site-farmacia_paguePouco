import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarPromocoesInovaCsv } from '../src/lib/inovafarma-promocoes-csv.js';
import { previsualizarPromocoesInova } from '../src/lib/inovafarma-promocoes-previa.js';

const csv = [
  'RELATÓRIO DE PROMOÇÕES' + ';'.repeat(28),
  '"Empresa:\nStatus:";;;;"FARMACIA PAGUE POUCO\nAPENAS PROMOÇÕES ATIVAS"' + ';'.repeat(24),
  'Promoção;;111;;;OFERTA DE OUTUBRO' + ';'.repeat(23),
  'Início;;Final;;;;Formas de pagamento' + ';'.repeat(22),
  '01/10/2026;;31/10/2026;;;;Vista;[X];Cheque;;[X];Cartão;;;[X];Cart. Digital;;;[X];Prazo;;;Red. Prazo;;;0,00 %;;;',
  'Código;Produto;;;;;;;;Grupo;;;;Grupo de preço;;;;Seção;;;;Desc.%;;Custo Médio;Preço Venda;;;Preço Promoção;',
  '834991;3 EM 1 BOCA LINDA (BATOM, GLOSS E LIPTINT);;;;;;;;PERFUMARIA;;;;;;;PERFUMES COSMETICOS E MAKE;;;;;30,00;;10,00;24,55;;;17,19;'
].join('\r\n');

test('aceita o layout do relatório exportado do InovaFarma', () => {
  const r = analisarPromocoesInovaCsv(csv);
  assert.equal(r.total, 1);
  assert.equal(r.promocoes[0].codigoInterno, '834991');
  assert.equal(r.promocoes[0].precoVendaCentavos, 2455);
  assert.equal(r.promocoes[0].precoPromocionalCentavos, 1719);
  assert.equal(r.promocoes[0].descontoPercentual, 30);
  assert.equal(r.promocoes[0].campanha.inicio, '2026-10-01');
  assert.ok(r.promocoes[0].campanha.formasPagamento.includes('a_vista'));
});
test('prévia cruza código interno e sinaliza regra de pagamento sem gravar', () => {
  const db = { collection(name) {
    assert.equal(name, 'products');
    return { all: () => [{ id:'produto1', codigoInterno:'834991', ean:'7891234567890' }] };
  }};
  const r = previsualizarPromocoesInova(db, csv, new Date('2026-10-24T12:00:00Z'));
  assert.equal(r.resumo.codigos, 1);
  assert.equal(r.resumo.regrasDePagamento, 1);
  assert.equal(r.itens[0].produtoId, 'produto1');
  assert.equal(r.somenteLeitura, true);
  assert.equal(r.aplicarAutomaticamente, false);
});
test('prévia sinaliza campanhas vencidas', () => {
  const db = { collection: () => ({ all: () => [{id:'1', codigoInterno:'834991'}] }) };
  const r = previsualizarPromocoesInova(db, csv, new Date('2026-11-01T12:00:00Z'));
  assert.equal(r.resumo.foraDaVigencia, 1);
});


test('campanha semanal sem data final permanece pendente de revisão', () => {
  const linhas = csv.split('\r\n');
  linhas[2] = 'Promoção;;151;;;TERÇA DO SUPLEMENTO';
  linhas[4] = ';;;;;;Vista;[X];Cheque;;[X];Cartão;;;[X]';
  linhas.splice(5, 0, '25/06/2025;;;;;;;;;;;;;;;Cart. Digital;;;[X]');
  const semanal = linhas.join('\r\n');
  const lido = analisarPromocoesInovaCsv(semanal);
  assert.equal(lido.promocoes[0].campanha.fim, null);
  assert.equal(lido.promocoes[0].campanha.diaSugerido, 'terca');
  const db = { collection: () => ({ all: () => [{id:'1', codigoInterno:'834991'}] }) };
  const previa = previsualizarPromocoesInova(db, semanal, new Date('2026-10-24T12:00:00Z'));
  assert.equal(previa.resumo.recorrenciaParaRevisar, 1);
  assert.equal(previa.aplicarAutomaticamente, false);
});
