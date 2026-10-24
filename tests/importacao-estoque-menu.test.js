import test from 'node:test';
import assert from 'node:assert/strict';
import { paginaAdmin } from '../src/views/admin/layout.js';
import { telaImportacaoEstoque } from '../src/views/admin/importacao-estoque.js';
import { telaPreviaRelatorioInova } from '../src/views/admin/inova-csv.js';
import { readFileSync } from 'node:fs';

function contexto(role='super_admin') {
  return {
    adminUser: { role, nome: 'Operador teste', id: 'admin-teste' },
    settings: { empresa:{nomeFantasia:'Farmácia teste'}, tema:{} },
    csrf: 'CSRF_TESTE',
    req:{pathname:'/admin/estoque/importar',query:new URLSearchParams()},
  };
}
test('menu superadmin mostra Importação de estoque e não mostra integração antiga',()=>{
  const html=paginaAdmin(contexto(),{titulo:'Painel',conteudo:'Teste'});
  assert.match(html, /href="\/admin\/estoque\/importar"/);
  assert.match(html, /> Importação de estoque<\/a>/);
  assert.doesNotMatch(html, /Integração InovaFarma/);
  assert.doesNotMatch(html, /href="\/admin\/inovafarma"/);
});
test('menu de admin comum não expõe a opção exclusiva do superadmin',()=>{
  const html=paginaAdmin(contexto('admin'),{titulo:'Painel',conteudo:'Teste'});
  assert.doesNotMatch(html, /href="\/admin\/estoque\/importar"/);
});
test('tela de importação usa o endpoint CSV já homologado, sem pedir credenciais',()=>{
  const html=telaImportacaoEstoque(contexto());
  assert.match(html,/Importação de estoque/);
  assert.match(html,/action="\/admin\/api\/produtos\/inova-csv\/preparar"/);
  assert.match(html,/accept="\.csv,text\/csv"/);
  assert.match(html,/name="_csrf" value="CSRF_TESTE"/);
  assert.doesNotMatch(html,/name="credencial"/);
  assert.doesNotMatch(html,/Integração InovaFarma/);
});
test('prévia mantém link de volta à nova página e deixa saldos intactos até confirmar',()=>{
  const html=telaPreviaRelatorioInova(contexto(),{
    id:'csv_00000000-0000-0000-0000-000000000000',
    resumo:{novos:1,ajustes:0,semAlteracao:0,esgotados:1,conflitos:0,total:1},
    aplicado:false,
    plano:[{ean:'7891234567890',nome:'Produto demonstrativo',quantidade:0,tipo:'novo',motivo:''}],
  });
  assert.match(html,/href="\/admin\/estoque\/importar"/);
  assert.match(html,/Confirmar importação inicial/);
  assert.match(html,/name="confirmar" value="1"/);
});
test('rota antiga redireciona ao CSV sem ler ou escrever configurações e bloqueia POST legado',()=>{
  const s=readFileSync(new URL('../src/routes/admin.js',import.meta.url),'utf8');
  const start=s.indexOf("app.get('/admin/inovafarma'");
  const end=s.indexOf("/* ============================== VENDEDORES",start);
  assert(start>0 && end>start);
  const block=s.slice(start,end);
  assert.match(block,/res\.redirect\('\/admin\/estoque\/importar'\)/);
  assert.match(block,/\b410\b/);
  assert.doesNotMatch(block,/salvarConfiguracaoInova|armazenarCredencialInova|apagarCredencialInova/);
});
