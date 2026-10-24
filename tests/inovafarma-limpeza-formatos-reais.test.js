import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  lerIdentidadesInovaParaLimpeza, ErroRelatorioInova, prepararLimpezaInova
} from '../src/lib/inovafarma-limpeza-segura.js';

// Fixture sintética, NÃO publica nomes, valores ou cadastro privado da farmácia.
const linha = (cod,ean='',nome='Produto teste')=>{
  const a=Array(21).fill('');
  a[0]=String(cod);a[1]=ean;a[4]=nome;a[6]='-2';a[15]='24,90';
  return a.join(';');
};
const cabeca='Código;Cod. Barra;;;Produto;Fabricante;Estoque;Preço Compra;Total Compra;'+
  'Preço Custo;Total Custo;;Custo Médio;Total Custo Médio;;Preço Venda;Total Venda;;;;Curva ABC';
function posicaoOriginal(quantidade=6128) {
  const linhas=[
    'POSIÇÃO DE ESTOQUE;;;;;;;;;;;;;;;;;;;;',
    '"Tipo: \r\nEmpresa(s): \r\nEstoque:";;;"POSIÇÃO DO ESTOQUE\r\nFARMACIA EXEMPLO\r\nESTOQUE GERAL";;;;;;;;;;;;;;;;;',
    cabeca
  ];
  for(let n=1;n<=quantidade;n++)
    linhas.push(linha(800000+n,n%40===0?'':String(7891000000000+n),
      n===1?'Café e Saúde ABC':'Produto teste '+n));
  linhas.push('ESTOQUE:;;;;;;;;;;;;;;;;;16.321;;;');
  linhas.push(';;;;;;;;;;;TOTAL VENDA:;;;;;;;379.633,17;;');
  linhas.push('Fonte: INOVAFARMA;;Origem: FARMACIA EXEMPLO;;;;;;;;;;;;Extraído em 24/10/2026 às 12:45;;;;;1;');
  // cp1252 equivalente: latin1 cobre os acentos da fixture
  return Buffer.from(linhas.join('\r\n'),'latin1');
}
function pronto(quantidade=6062) {
  const linhas=['\uFEFFEAN;Descricao;Quantidade;Preco de Venda;Codigo Interno;Marca'];
  for(let n=1;n<=quantidade;n++)
    linhas.push([
      n%40===0?'':String(7891000000000+n),
      'Produto da farmácia '+n,0,'20,00',800000+n,'',
    ].join(';'));
  return Buffer.from(linhas.join('\r\n'),'utf8');
}
test('relatório original cp1252 com capa e quebra dentro de aspas é reconhecido',()=>{
  const r=lerIdentidadesInovaParaLimpeza(posicaoOriginal());
  assert.equal(r.itens.length,6128);
  assert.equal(r.estatisticas.coberturaCompleta,true);
  assert.equal(r.estatisticas.tipoRelatorio,'inovafarma_original');
  assert.equal(r.estatisticas.semBarras,Math.floor(6128/40));
  assert.equal(r.itens[0].codigoInterno,'800001');
  assert.equal(r.itens[0].nome,'Café e Saúde ABC');
  assert.equal(r.itens[0].ean,'7891000000001');
  assert.equal(r.itens.at(-1).codigoInterno,'806128');
});
test('CSV simples de 6128 códigos sem valores de custo é aceito com segurança',()=>{
  const rows=['Codigo Interno;EAN;Descricao'];
  for(let n=1;n<=6128;n++)rows.push((800000+n)+';'+
    (n%53===0?'':(7891000000000+n))+';Produto teste '+n);
  const r=lerIdentidadesInovaParaLimpeza(Buffer.from('\uFEFF'+rows.join('\r\n')));
  assert.equal(r.estatisticas.coberturaCompleta,true);
  assert.equal(r.itens.length,6128);
  assert.equal(r.estatisticas.semBarras,Math.floor(6128/53));
});
test('CSV preparado de 6062 é LIDO, mas limpeza permanece BLOQUEADA',()=>{
  const r=lerIdentidadesInovaParaLimpeza(pronto());
  assert.equal(r.estatisticas.total,6062);
  assert.equal(r.estatisticas.coberturaCompleta,false);
  assert.equal(r.estatisticas.minimoEsperado,6128);
});
test('relatório de promoções e exportação do site apresentam orientação específica',()=>{
  assert.throws(()=>lerIdentidadesInovaParaLimpeza(Buffer.from('RELATÓRIO DE PROMOÇÕES;...')),
    e=>e instanceof ErroRelatorioInova && e.codigo==='TIPO_PROMOCOES' &&
      /Posição de Estoque/.test(e.message));
  assert.throws(()=>lerIdentidadesInovaParaLimpeza(Buffer.from(
    'Nome;EAN;Preço;SKU\r\nProduto teste;7891000000000;20,00;A01')),
    e=>e instanceof ErroRelatorioInova &&
      /Código Interno/.test(e.message));
});
test('códigos duplicados bloqueiam a limpeza mesmo com total 6128',()=>{
  const csv=posicaoOriginal().toString('latin1').replace(
    /806128;7891000006128;/,'800001;7891000006128;');
  const r=lerIdentidadesInovaParaLimpeza(Buffer.from(csv,'latin1'));
  assert.equal(r.estatisticas.repetidos,1);
  assert.equal(r.estatisticas.coberturaCompleta,false);
});
test('falhas de banco não são classificadas como CSV inválido',()=>{
  const source=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const at=source.indexOf("app.post('/admin/estoque/limpeza/previa'");
  const next=source.indexOf("app.post('/admin/estoque/limpeza/aplicar'",at);
  assert(at>0 && next>at);
  const texto=source.slice(at,next);
  assert.match(texto,/err instanceof ErroRelatorioInova/);
  assert.match(texto,/esperado \? 400 : 500/);
  assert.match(texto,/O catálogo não foi alterado/);
});
