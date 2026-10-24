import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planejarLimpezaCatalogoInova } from '../src/lib/inovafarma-limpeza-previa.js';
import { telaPreviaLimpezaInova } from '../src/views/admin/limpeza-catalogo-inova.js';
import { telaImportacaoEstoque } from '../src/views/admin/importacao-estoque.js';

const relatorio = [
  { ean:'7891234567890', codigoInterno:'10', nome:'Produto existente' },
  { ean:'', codigoInterno:'20', nome:'Produto sem EAN' },
  { ean:'7891234567891', codigoInterno:'30', nome:'Outro produto do Inova' },
];
const produtos = [
  { id:'p1', ean:'7891234567890', nome:'Produto legado reaproveitado', ativo:true },
  { id:'p2', codigoInterno:'20', nome:'Produto interno', ativo:false },
  { id:'p3', ean:'7899999999999', nome:'Produto antigo sem vínculo', ativo:true },
  { id:'p4', ean:'7899999999998', nome:'Produto com pedido', ativo:true },
  { id:'p5', ean:'7899999999997', nome:'Produto com reserva', estoque:{reservado:1} },
  { id:'p6', ean:'7891234567890', codigoInterno:'30', nome:'Cadastro ambíguo', ativo:true },
  { id:'p7', nome:'Produto sem códigos', ativo:true },
];
const pedidos = [{id:'o1',itens:[{produtoId:'p4'}]}];

test('preserva legado reaproveitado e produto sem EAN por código interno', () => {
  const itens = [produtos[0], produtos[1]];
  const r = planejarLimpezaCatalogoInova(itens, relatorio, []);
  assert.equal(r.resumo.preservar, 2);
  assert.equal(r.resumo.candidatosSemHistorico, 0);
  assert.equal(r.somenteLeitura, true);
  assert.equal(r.autorizaExclusao, false);
  assert.equal(itens[0].ativo, true);
});
test('separa candidatos e protege histórico, reservas e identificações ambíguas', () => {
  const r=planejarLimpezaCatalogoInova(produtos,relatorio,pedidos);
  const status = Object.fromEntries(r.itens.map(p=>[p.id,p.status]));
  assert.equal(status.p3,'candidato_sem_historico');
  assert.equal(status.p4,'vinculado_pedidos');
  assert.equal(status.p5,'com_reserva');
  assert.equal(status.p6,'conferir_identificacao');
  assert.equal(status.p7,'conferir_identificacao');
  assert.equal(status.p1,'conferir_identificacao'); // EAN duplicado no catálogo
  assert.equal(status.p2,'preservar');
  assert.equal(r.resumo.produtosNoSite, 7);
  assert.equal(r.resumo.candidatosSemHistorico, 1);
  assert.equal(r.resumo.conferirIdentificacao, 3);
});
test('não compara catálogo sem arquivo e não exclui por marca inovaCatalogo', () => {
  assert.throws(()=>planejarLimpezaCatalogoInova(produtos,[],[]));
  const r=planejarLimpezaCatalogoInova([
    {id:'x',nome:'Novo sem EAN',codigoInterno:'20',inovaCatalogo:undefined},
  ],relatorio,[]);
  assert.equal(r.resumo.preservar,1);
});
const ctx={
  adminUser:{id:'admin',nome:'Super',role:'super_admin'},
  settings:{empresa:{nomeFantasia:'Farmácia'},tema:{}},
  csrf:'CSRF123',req:{pathname:'/admin/estoque/importar',query:new URLSearchParams()}
};
test('formulário exige CSRF e a prévia não contém botões de exclusão',()=>{
  const form=telaImportacaoEstoque(ctx);
  assert.match(form,/action="\/admin\/estoque\/limpeza\/previa"/);
  assert.match(form,/name="_csrf" value="CSRF123"/);
  const html=telaPreviaLimpezaInova(ctx,planejarLimpezaCatalogoInova(produtos,relatorio,pedidos));
  assert.match(html,/Nenhum produto foi alterado ou apagado/);
  assert.match(html,/Candidatos à limpeza/);
  assert.doesNotMatch(html,/action="[^"]*excluir[^"]*"/);
});
test('protege texto de produto contra HTML injetado',()=>{
  const html=telaPreviaLimpezaInova(ctx,planejarLimpezaCatalogoInova([
    {id:'p',ean:'7899999999999',nome:'<script>alert(1)</script>'}
  ],relatorio,[]));
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.match(html,/&lt;script&gt;/);
});
test('endpoint restrito ao superadmin não tem gravações',()=>{
  const routes=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const ini=routes.indexOf("app.post('/admin/estoque/limpeza/previa'");
  const fim=routes.indexOf("app.get('/admin/produtos/importar'",ini);
  assert(ini>0&&fim>ini);
  const bloco=routes.slice(ini,fim);
  assert.match(bloco,/guard\(req, res, 'produtos.excluir'\)/);
  assert.match(bloco,/role !== 'super_admin'/);
  assert.match(bloco,/prepararLimpezaInova/);
  assert.doesNotMatch(bloco,/db\.collection\('products'\)\.(remove|update|insert)\(/);
});
