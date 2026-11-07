import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Collection } from '../src/lib/store.js';
import { excluirCadastroAdminInativo } from '../src/lib/contas-admin.js';
import { telaUsuarios } from '../src/views/admin/config.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

function banco() {
  const col = new Map();
  const db = { collection(nome) {
    if (!col.has(nome)) col.set(nome, new Collection({ _commit() {} }, nome));
    return col.get(nome);
  }};
  return db;
}
const admin = { id: 'root', nome: 'Operador titular', role: 'super_admin' };
function preparar() {
  const db = banco();
  db.collection('admins').insert({ ...admin, email: 'titular@loja.test', ativo: true });
  db.collection('admins').insert({ id: 'inativo', nome: 'Conta teste', email: 'teste@loja.test', role: 'gerente', ativo: false });
  db.collection('admins').insert({ id: 'ativo', nome: 'Funcionário ativo', email: 'ativo@loja.test', role: 'admin', ativo: true });
  db.collection('sessions').insert({ id: 'adm-s1', type: 'admin', userId: 'inativo' });
  db.collection('sessions').insert({ id: 'adm-s2', type: 'admin', userId: 'inativo' });
  db.collection('sessions').insert({ id: 'adm-root', type: 'admin', userId: 'root' });
  db.collection('sessions').insert({ id: 'cli-s', type: 'customer', userId: 'inativo' });
  db.collection('auditLogs').insert({ id: 'historico', atorId: 'inativo', atorNome: 'Conta teste', acao: 'editou_produto' });
  db.collection('orders').insert({ id: 'pedido-antigo', pedidoRecebidoPor: 'inativo', statusOperacional: 'entregue', totalCentavos: 2000 });
  return db;
}
const excluir = (db, id='inativo', operador=admin, emailConfirmacao='teste@loja.test') =>
  excluirCadastroAdminInativo(db, id, { operador, emailConfirmacao });

test('somente superadmin exclui usuário explicitamente inativo após confirmar e-mail',()=>{
  const db = preparar();
  assert.equal(excluir(db, 'inativo', { id:'outro', role:'admin' }).status, 403);
  assert.equal(excluir(db, 'ativo', admin, 'ativo@loja.test').status, 409);
  assert.equal(excluir(db, 'root', admin, 'titular@loja.test').status, 409);
  assert.equal(excluir(db, 'inativo', admin, 'nao@loja.test').status, 400);
  assert.ok(db.collection('admins').get('inativo'));
  assert.equal(excluir(db).ok, true);
  assert.equal(db.collection('admins').get('inativo'), null);
  assert.equal(db.collection('sessions').get('adm-s1'), null);
  assert.equal(db.collection('sessions').get('adm-s2'), null);
  assert.ok(db.collection('sessions').get('adm-root'));
  assert.ok(db.collection('sessions').get('cli-s'), 'não altera sessões de clientes');
  assert.ok(db.collection('orders').get('pedido-antigo'), 'preserva pedidos');
  assert.ok(db.collection('auditLogs').get('historico'), 'preserva auditoria');
  assert.match(JSON.stringify(db.collection('auditLogs').all()),/excluiu_usuario_admin_inativo/);
  assert.equal(excluir(db).status, 404);
});

test('cadastro inativo responsável por pedido em andamento não é excluído',()=>{
  const db=preparar();
  db.collection('orders').insert({ id:'novo', pedidoRecebidoPor:'inativo', statusOperacional:'separacao' });
  const r=excluir(db);
  assert.equal(r.status,409);
  assert.match(r.erro,/pedido em andamento/);
  assert.ok(db.collection('admins').get('inativo'));
  assert.ok(db.collection('sessions').get('adm-s1'));
});

test('botão aparece somente para contas inativas e apenas para o Super Administrador',()=>{
  const db=preparar();
  const cfg=DEFAULT_SETTINGS();
  const usuarios=db.collection('admins').all();
  const mkCtx=(role)=>({ db, csrf:'segredo', settings:cfg, adminUser:{id:'root',nome:'Operador',role},
    permissoes:{podeGerenciarUsuarios:role==='super_admin'}, req:{query:new URLSearchParams()} });
  const html=telaUsuarios(mkCtx('super_admin'), {usuarios});
  assert.match(html,/data-excluir-usuario="inativo"/);
  assert.doesNotMatch(html,/data-excluir-usuario="ativo"/);
  assert.doesNotMatch(html,/data-excluir-usuario="root"/);
  assert.match(html,/data-email="teste@loja.test"/);
  const semPermissao=telaUsuarios(mkCtx('admin'),{usuarios});
  assert.doesNotMatch(semPermissao,/data-excluir-usuario/);
});

test('interface envia e-mail confirmado usando POST e API possui checagem de superadmin',()=>{
  const js=readFileSync(new URL('../public/js/admin.js', import.meta.url),'utf8');
  const routes=readFileSync(new URL('../src/routes/admin.js', import.meta.url),'utf8');
  assert.match(js,/\[data-excluir-usuario\]/);
  assert.match(js,/emailConfirmacao: digitado\.trim\(\)/);
  assert.match(js,/encodeURIComponent\(excUser\.getAttribute\('data-excluir-usuario'\)\)/);
  assert.match(routes,/app\.post\('\/admin\/api\/usuarios\/:id\/excluir'/);
  assert.match(routes,/excluirCadastroAdminInativo\(db, req\.params\.id/);
});
