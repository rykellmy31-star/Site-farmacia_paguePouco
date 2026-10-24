import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { telaImportacaoEstoque } from '../src/views/admin/importacao-estoque.js';
import { telaPreviaPromocoesInova } from '../src/views/admin/inovafarma-promocoes-previa.js';

const ctx = {
  adminUser: { id:'super1', role:'super_admin', nome:'Operador' },
  settings: { empresa:{nomeFantasia:'Farmácia exemplo'}, tema:{} },
  csrf:'TOKEN_TESTE', req:{pathname:'/admin/estoque/importar',query:new URLSearchParams()}
};
test('importação de estoque oferece prévia CSV de promoções com CSRF e sem aplicar descontos',()=>{
  const html=telaImportacaoEstoque(ctx);
  assert.match(html,/action="\/admin\/estoque\/promocoes\/conferir"/);
  assert.match(html,/name="_csrf" value="TOKEN_TESTE"/);
  assert.match(html,/Somente conferir promoções/);
  assert.match(html,/formaction="\/admin\/estoque\/promocoes\/preparar"/);
  assert.doesNotMatch(html,/action="\/admin\/estoque\/promocoes\/aplicar"/);
});
test('prévia mostra conflitos e protege HTML do relatório',()=>{
  const html=telaPreviaPromocoesInova(ctx,{
    resumo:{registros:1,codigos:1,campanhas:1,semProduto:0,cadastroAmbiguo:0,
      multiplasCampanhas:1,foraDaVigencia:0,recorrenciaParaRevisar:0,
      regrasDePagamento:0,candidatosParaRevisao:0},
    itens:[{codigoInterno:'123',nome:'<img src=x onerror=alert(1)>',ean:'7891234567890',
      status:'campanhas_sobrepostas',
      campanhas:[{nome:'Ofertas',inicio:'2026-10-01',fim:'2026-10-31',
        descontoPercentual:10,precoVendaCentavos:1800,precoPromocionalCentavos:1620}]}],
    erros:[],dataReferencia:'2026-10-24'
  });
  assert.match(html,/Mais de uma campanha vigente/);
  assert.match(html,/R\$ 16,20/);
  assert.doesNotMatch(html,/<img src=x onerror=alert\(1\)>/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/Confirmar importação inicial/);
});
test('rota de prévia exige permissão e não define escrita',()=>{
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const inicio=routes.indexOf("app.post('/admin/estoque/promocoes/conferir'");
  const fim=routes.indexOf("app.get('/admin/produtos/importar'",inicio);
  assert(inicio>0 && fim>inicio);
  const bloco=routes.slice(inicio,fim);
  assert.match(bloco,/guard\(req, res, 'produtos.criar'\)/);
  assert.match(bloco,/role !== 'super_admin'/);
  assert.match(bloco,/previsualizarPromocoesInova\(db, texto\)/);
  assert.doesNotMatch(bloco,/\.collection\(.+\)\.(insert|update|delete)\(/);
});
