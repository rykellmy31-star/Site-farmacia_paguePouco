/**
 * Jornada de compra real no Worker local, sem cobranças, e-mails externos
 * ou alterações na loja de produção. Dados descartáveis por execução.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

class Browser {
  constructor(origin) {
    this.origin = origin;
    this.cookies = new Map();
    this.csrf = null;
  }
  async request(url, opts = {}) {
    const headers = { Cookie: [...this.cookies].map(([k, v]) => k + '=' + v).join('; '), ...opts.headers };
    const response = await fetch(this.origin + url, { ...opts, redirect: 'manual', headers });
    for (const c of response.headers.getSetCookie()) {
      const part = c.split(';')[0];
      const pos = part.indexOf('=');
      if (pos > 0) this.cookies.set(part.slice(0, pos), part.slice(pos + 1));
    }
    return response;
  }
  async get(url) { return this.request(url); }
  async token(url) {
    const page = await this.get(url);
    assert.equal(page.status, 200, 'GET ' + url + ' precisa abrir');
    const html = await page.text();
    const m = /name="_csrf"\s+value="([^"]+)"/.exec(html) || /"csrf":"([^"]+)"/.exec(html);
    assert.ok(m?.[1], 'CSRF deve estar no HTML de ' + url);
    this.csrf = m[1];
    return html;
  }
  async form(url, obj, token = this.csrf) {
    return this.request(url, {
      method: 'POST',
      body: new URLSearchParams({ _csrf: token || '', ...obj }),
    });
  }
  async json(url, body) {
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf },
      body: JSON.stringify(body),
    });
  }
}

test('jornada integral: catálogo, carrinho, cadastro, entrega, Pix simulado e painel de vendas', { timeout: 180000 }, async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'pague-pouco-journey-'));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  let child, logs = '';
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const p = child;
    const exited = once(p, 'exit');
    p.kill('SIGTERM');
    const timeout = setTimeout(() => p.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timeout); }
    child = null;
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  child = spawn(process.execPath, [
    path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', folder,
    '--var', 'ADMIN_EMAIL:auditoria@tests.example',
    '--var', 'ADMIN_PASSWORD:SomenteTeste-Worker-2026',
  ], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', s => { logs = (logs + s).slice(-12000); });
  child.stderr.on('data', s => { logs = (logs + s).slice(-12000); });
  let started = false;
  for (let i = 0; i < 140; i++) {
    if (child.exitCode !== null) throw new Error('Worker encerrou: ' + logs);
    try {
      const res = await fetch(origin + '/__health', { signal: AbortSignal.timeout(1500) });
      if (res.ok) { started = true; break; }
    } catch {}
    await pause(200);
  }
  assert.ok(started, 'Worker não iniciou: ' + logs);

  const admin = new Browser(origin);
  await admin.token('/admin/login');
  const adminLogin = await admin.form('/admin/login', {
    email: 'auditoria@tests.example', senha: 'SomenteTeste-Worker-2026',
  });
  assert.equal(adminLogin.status, 303);
  assert.equal(adminLogin.headers.get('location'), '/admin');
  await admin.token('/admin/produtos/novo');

  // Smoke test real do painel administrativo no Worker: cada área acessível
  // ao superadministrador deve devolver HTML, nunca 404, 500 ou JSON cru.
  const areasAdmin = [
    '/admin', '/admin/produtos', '/admin/produtos/novo',
    '/admin/produtos/importar', '/admin/categorias', '/admin/estoque',
    '/admin/midia', '/admin/banners', '/admin/promocoes', '/admin/pedidos',
    '/admin/clientes', '/admin/pagamentos', '/admin/relatorios', '/admin/fretes',
    '/admin/whatsapp', '/admin/configuracoes', '/admin/aparencia',
    '/admin/paginas', '/admin/paginas/nova', '/admin/usuarios',
    '/admin/auditoria', '/admin/sistema',
  ];
  for (const route of areasAdmin) {
    const response = await admin.get(route);
    assert.equal(response.status, 200, 'Área do administrador indisponível: ' + route);
    const html = await response.text();
    assert.match(html, /<html/i, 'Área administrativa deve servir HTML: ' + route);
    assert.match(html, /window.PP_ADMIN=/, 'Área deve publicar contexto de sessão: ' + route);
  }

  // Cadastra produto não medicinal: sem liberar medicamentos sem responsável técnico.
  const novo = await admin.form('/admin/api/produtos', {
    nome: 'Sabonete Teste Jornada', sku: 'WORKER-JORNADA-001',
    preco: '19.90', quantidade: '10', estoqueMinimo: '1',
    classificacao: 'nao_aplicavel', ativo: '1',
  });
  assert.equal(novo.status, 200);
  const produto = await novo.json();
  assert.equal(produto.ok, true);
  assert.ok(produto.id);

  const snapshot = async () => {
    const response = await admin.form('/admin/api/sistema/backup', {});
    assert.equal(response.status, 200);
    return (await response.json()).collections;
  };
  const product = (await snapshot()).products.find(p => p.id === produto.id);
  assert.equal(product.precoCentavos, 1990);
  assert.equal(product.estoque.quantidade, 10);

  // Texto inserido por terceiros nunca vira fórmula executável ao exportar.
  const csvProbe = await admin.form('/admin/api/produtos', {
    nome: '=SUM(2,3) Produto Teste', sku: 'CSV-DEFESA-001',
    preco: '1.00', quantidade: '0', classificacao: 'nao_aplicavel', ativo: '1',
  });
  assert.equal(csvProbe.status, 200);
  const productCsv = await admin.get('/admin/api/produtos/exportar.csv');
  assert.equal(productCsv.status, 200);
  assert.ok((await productCsv.text()).includes('"\'=SUM(2,3) Produto Teste"'),
    'exportação CSV deve neutralizar fórmulas em nomes cadastrados');

  const client = new Browser(origin);
  assert.equal((await client.get('/')).status, 200);
  const search = await client.get('/busca?q=Sabonete%20Teste%20Jornada');
  assert.equal(search.status, 200);
  assert.match(await search.text(), /Sabonete Teste Jornada/);
  const detail = await client.get('/produto/' + product.slug);
  assert.equal(detail.status, 200);
  assert.match(await detail.text(), /Sabonete Teste Jornada/);
  await client.token('/conta/cadastro');
  const add = await client.json('/api/carrinho/adicionar', {
    produtoId: produto.id, quantidade: 2, precoUnitarioCentavos: 1,
  });
  assert.equal(add.status, 200);
  const cart = await add.json();
  assert.equal(cart.ok, true);
  assert.equal(cart.subtotal, 3980, 'preço deve vir do cadastro, nunca do navegador');
  assert.equal(cart.quantidade, 2);
  const noLogin = await client.get('/checkout/endereco');
  assert.equal(noLogin.status, 303);
  assert.match(noLogin.headers.get('location'), /conta\/login/);

  // Registro de cliente e preservação de carrinho após autenticação.
  const signUp = await client.form('/conta/cadastro', {
    nome: 'Comprador Jornada Teste',
    email: 'comprador-jornada@tests.example',
    telefone: '11988887777', cpf: '',
    senha: 'ClienteTeste123', senha2: 'ClienteTeste123',
  });
  assert.equal(signUp.status, 303);
  assert.equal(signUp.headers.get('location'), '/conta');
  assert.ok(client.cookies.get('pp_sess') || client.cookies.get('pp_session'));
  await client.token('/conta/enderecos');
  const afterRegistration = await client.get('/api/carrinho');
  assert.equal(afterRegistration.status, 200);
  assert.equal((await afterRegistration.json()).quantidade, 2, 'carrinho preservado ao cadastrar');

  // Sem transporte de e-mail configurado no Worker, a recuperação deve
  // ser honesta e não deixar tokens secretos inúteis no banco persistente.
  await client.token('/conta/esqueci-senha');
  const forgot = await client.form('/conta/esqueci-senha', {
    email: 'comprador-jornada@tests.example',
  });
  assert.equal(forgot.status, 200);
  assert.match(await forgot.text(), /O envio de e-mail ainda não está habilitado/);
  const beforeCheckout = await snapshot();
  assert.equal(beforeCheckout.passwordTokens?.length || 0, 0,
    'sem serviço de e-mail não se deve gerar token de recuperação inacessível');


  // Promoção restrita deve respeitar as categorias, nunca descontar
  // produtos que não participam da promoção.
  const restricted = await admin.form('/admin/api/cupons', {
    codigo: 'TESTECATEGORIAVAZIA', tipo: 'percentual',
    valor: '50', ativo: '1', categoriasPermitidas: 'categoria-inexistente',
  });
  assert.equal(restricted.status, 200);
  const ineligible = await client.json('/api/carrinho/cupom', { codigo: 'TESTECATEGORIAVAZIA' });
  assert.equal(ineligible.status, 400, 'cupom não deve descontar categoria não elegível');
  assert.equal((await ineligible.json()).ok, false);

  const couponAdmin = await admin.form('/admin/api/cupons', {
    codigo: 'TESTEJORNADA10', tipo: 'percentual',
    valor: '10', ativo: '1', usoMaximo: '1',
  });
  assert.equal(couponAdmin.status, 200);
  const couponClient = await client.json('/api/carrinho/cupom', { codigo: 'TESTEJORNADA10' });
  assert.equal(couponClient.status, 200);
  const applied = await couponClient.json();
  assert.equal(applied.ok, true);
  assert.equal(applied.desconto, 398, 'cupom de 10% deve aplicar sobre R$ 39,80');

  const address = await client.form('/conta/enderecos', {
    nome: 'Comprador Jornada Teste', apelido: 'Casa',
    cep: '01001000', logradouro: 'Rua de teste', numero: '55',
    bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', padrao: '1',
  });
  assert.equal(address.status, 303, 'cliente pode salvar endereço');
  const addressPage = await client.get('/conta/enderecos');
  assert.match(await addressPage.text(), /Rua de teste/);
  await client.token('/checkout/endereco');
  const frete = await client.form('/checkout/endereco', {
    nome: 'Comprador Jornada Teste', telefone: '11988887777',
    cep: '01001000', logradouro: 'Rua de teste', numero: '55',
    bairro: 'Centro', cidade: 'São Paulo', uf: 'SP',
  });
  assert.equal(frete.status, 303, 'frete deve ser calculado no servidor');
  assert.equal(frete.headers.get('location'), '/checkout/pagamento');

  const paymentPage = await client.token('/checkout/pagamento');
  assert.match(paymentPage, /value="pix"/);
  const purchase = await client.form('/checkout/finalizar', { metodoPagamento: 'pix' });
  assert.equal(purchase.status, 303);
  const confirmationUrl = purchase.headers.get('location');
  assert.match(confirmationUrl, /^\/checkout\/confirmacao\/PP/);
  const confirm = await client.get(confirmationUrl);
  assert.equal(confirm.status, 200);
  const confirmHtml = await confirm.text();
  assert.match(confirmHtml, /PIX-SIMULADO|simulad/i, 'nenhum Pix cobrável deve ser gerado');
  const myOrders = await client.get('/conta/pedidos');
  assert.equal(myOrders.status, 200);
  assert.match(await myOrders.text(), /PP20/);

  // Fluxos da área do cliente além da compra.
  await client.token('/conta/favoritos');
  const liked = await client.json('/conta/favoritos', { produtoId: produto.id });
  assert.equal(liked.status, 200);
  assert.ok((await liked.json()).favoritos.includes(produto.id));
  assert.match(await (await client.get('/conta/favoritos')).text(), /Sabonete Teste Jornada/);
  const unliked = await client.form('/conta/favoritos/remover', { produtoId: produto.id });
  assert.equal(unliked.status, 303);

  await client.token('/conta/dados');
  const wrongPassword = await client.form('/conta/senha', {
    senhaAtual: 'senha-errada', senhaNova: 'NovaSenha789',
  });
  assert.equal(wrongPassword.status, 400, 'senha atual errada não pode ser trocada');
  const goodPassword = await client.form('/conta/senha', {
    senhaAtual: 'ClienteTeste123', senhaNova: 'NovaSenha789',
  });
  assert.equal(goodPassword.status, 303, 'troca de senha deve ser permitida');

  // Tenta forçar destino externo pela entrada "proximo": o login deve
  // redirecionar apenas dentro do próprio site.
  const secondLogin = new Browser(origin);
  await secondLogin.token('/conta/login');
  const failOld = await secondLogin.form('/conta/login', {
    email: 'comprador-jornada@tests.example', senha: 'ClienteTeste123',
  });
  assert.equal(failOld.status, 401, 'senha antiga deixa de autenticar');
  const relogin = await secondLogin.form('/conta/login', {
    email: 'comprador-jornada@tests.example', senha: 'NovaSenha789',
    proximo: '//exemplo-inseguro.invalid/painel',
  });
  assert.equal(relogin.status, 303);
  assert.equal(relogin.headers.get('location'), '/conta', 'login nunca redireciona para domínio externo');

  const data = await snapshot();
  const order = data.orders.find(o => o.cliente?.email === 'comprador-jornada@tests.example');
  assert.ok(order, 'pedido deve ser gravado no SQLite');
  assert.equal(order.statusFinanceiro, 'pendente', 'checkout do cliente nunca aprova pagamento sozinho');
  assert.equal(order.itens[0].precoUnitarioCentavos, 1990);
  assert.equal(order.itens[0].quantidade, 2);
  assert.equal(order.descontoCentavos, 398, 'pedido deve preservar desconto válido calculado no servidor');
  assert.equal(data.coupons.find(c => c.codigo === 'TESTEJORNADA10').usos, 1);
  assert.equal(order.pagamentoId != null, true);
  const payment = data.payments.find(p => p.id === order.pagamentoId);
  assert.ok(payment);
  assert.equal(payment.provedor, 'internal');
  assert.equal(payment.status, 'pending');
  assert.equal(payment.simulado, true);
  assert.equal(data.products.find(p => p.id === produto.id).estoque.reservado, 2);

  // Reserva é um compromisso com o cliente; movimentações manuais não
  // podem consumir a quantidade prometida nem aceitar valores inválidos.
  for (const [tipo, quantidade, expected] of [
    ['saida', '9', 409], ['ajuste', '1', 409],
    ['entrada', '-4', 400], ['entrada', '1.5', 400],
    ['entrada', '0', 400], ['reserva', '1', 400],
  ]) {
    const resp = await admin.json('/admin/api/estoque/movimentar', {
      produtoId: produto.id, tipo, quantidade,
    });
    assert.equal(resp.status, expected, 'Estoque deve recusar ' + tipo + ' x ' + quantidade);
    assert.equal((await resp.json()).ok, false);
  }
  const rejectedTracking = await admin.json('/admin/api/pedidos/' + order.id + '/rastreio', {
    codigo: 'PENDENTE', url: 'https://entrega.example/rastreio',
  });
  assert.equal(rejectedTracking.status, 400, 'pedido não pago não admite rastreio');
  assert.equal((await rejectedTracking.json()).ok, false);
  assert.equal((await snapshot()).products.find(p => p.id === produto.id).estoque.quantidade, 10,
    'tentativas recusadas não podem alterar estoque');

  // Um visitante e outro cliente não podem ler a confirmação privada.
  const outsider = new Browser(origin);
  const blocked = await outsider.get(confirmationUrl);
  assert.equal(blocked.status, 303);
  assert.match(blocked.headers.get('location'), /conta\/login/);

  const secondCustomer = new Browser(origin);
  await secondCustomer.token('/conta/cadastro');
  const secondSignUp = await secondCustomer.form('/conta/cadastro', {
    nome: 'Outro Cliente de Teste', email: 'outro@tests.example',
    telefone: '11999998888', cpf: '', senha: 'OutroCliente123', senha2: 'OutroCliente123',
  });
  assert.equal(secondSignUp.status, 303);
  const forbiddenOrder = await secondCustomer.get('/conta/pedidos/' + order.codigo);
  assert.equal(forbiddenOrder.status, 303, 'cliente diferente não pode consultar pedido de outro');
  assert.equal(forbiddenOrder.headers.get('location'), '/conta/pedidos');

  const pendingInPanel = await admin.get('/admin/pedidos/' + order.id);
  assert.equal(pendingInPanel.status, 200);
  assert.match(await pendingInPanel.text(), new RegExp(order.codigo));

  // Somente simulação pelo administrador — sem transação financeira real.
  const simulated = await admin.json('/admin/api/pedidos/' + order.id + '/simular-pagamento',
    { status: 'approved' });
  assert.equal(simulated.status, 200);
  assert.equal((await simulated.json()).ok, true);
  const afterApproval = await snapshot();
  const approved = afterApproval.orders.find(o => o.id === order.id);
  assert.equal(approved.statusFinanceiro, 'aprovado');
  assert.equal(afterApproval.products.find(p => p.id === produto.id).estoque.quantidade, 8);
  assert.equal(afterApproval.products.find(p => p.id === produto.id).estoque.reservado, 0);

  // Aprovação duplicada não pode baixar o estoque duas vezes.
  const secondApproval = await admin.json('/admin/api/pedidos/' + order.id + '/simular-pagamento',
    { status: 'approved' });
  assert.equal(secondApproval.status, 409, 'A API deve recusar simulação de pagamento finalizado.');
  assert.equal((await secondApproval.json()).ok, false);
  const afterDuplicate = await snapshot();
  assert.equal(afterDuplicate.products.find(p => p.id === produto.id).estoque.quantidade, 8);
  assert.equal(afterDuplicate.orders.find(o => o.id === order.id).statusFinanceiro, 'aprovado');
  assert.equal(afterDuplicate.payments.find(p => p.id === payment.id).eventos.length,
    afterApproval.payments.find(p => p.id === payment.id).eventos.length,
    'notificações duplicadas não devem criar eventos financeiros duplicados');

  // Auditoria de relatórios: datas aplicadas também aos produtos mais
  // vendidos. Um período futuro não deve exibir o ranking de hoje.
  const hojeRelatorio = new Date().toISOString().slice(0, 10);
  const relatorioAtual = await admin.get('/admin/relatorios?de=' + hojeRelatorio + '&ate=' + hojeRelatorio);
  assert.equal(relatorioAtual.status, 200);
  assert.match(await relatorioAtual.text(), /Sabonete Teste Jornada/);
  const relatorioVazio = await admin.get('/admin/relatorios?de=2099-01-01&ate=2099-01-03');
  assert.equal(relatorioVazio.status, 200);
  assert.doesNotMatch(await relatorioVazio.text(), /Sabonete Teste Jornada/,
    'rankings não devem mostrar produtos vendidos fora do período');
  const relatorioInvalido = await admin.get('/admin/relatorios?de=2099-01-03&ate=2099-01-01');
  assert.equal(relatorioInvalido.status, 400, 'filtro invertido deve ser recusado');
  const csvVazio = await admin.get('/admin/api/relatorios/vendas.csv?de=2099-01-01&ate=2099-01-03');
  assert.equal(csvVazio.status, 200);
  assert.doesNotMatch(await csvVazio.text(), new RegExp(order.codigo),
    'CSV de outro período não pode incluir venda atual');

  // Criação de atendente real no SQLite local e teste das permissões de
  // acesso, estorno, backup e redefinição segura da senha administrativa.
  const staffEmail = 'atendente-auditoria@tests.example';
  const staffPassword = 'SomenteAtendente123';
  const createdStaff = await admin.form('/admin/api/usuarios', {
    nome: 'Atendente Auditoria', email: staffEmail, senha: staffPassword, role: 'atendente',
  });
  assert.equal(createdStaff.status, 303, 'superadministrador cria atendente');
  const staffRecord = (await snapshot()).admins.find(a => a.email === staffEmail);
  assert.ok(staffRecord);
  const staff = new Browser(origin);
  await staff.token('/admin/login');
  const staffLogin = await staff.form('/admin/login', { email: staffEmail, senha: staffPassword });
  assert.equal(staffLogin.status, 303);
  await staff.token('/admin/pedidos');
  assert.equal((await staff.get('/admin/pedidos')).status, 200);
  assert.equal((await staff.get('/admin/sistema')).status, 403, 'backup não deve abrir para atendente');
  assert.equal((await staff.get('/admin/usuarios')).status, 403, 'atendente não administra usuários');
  assert.equal((await staff.get('/admin/relatorios')).status, 403, 'relatórios financeiros exigem permissão');
  assert.equal((await staff.get('/admin/api/relatorios/vendas.csv')).status, 403, 'CSV financeiro deve ser protegido');
  assert.equal((await staff.get('/admin/api/sistema/backup/midias.json')).status, 403, 'mídia privada de backup exige superadmin');
  const unauthorizedRefund = await staff.json('/admin/api/pedidos/' + order.id + '/estornar', {});
  assert.equal(unauthorizedRefund.status, 403, 'atendente não pode estornar cobranças');
  assert.equal((await unauthorizedRefund.json()).ok, false);
  const unauthorizedCancel = await staff.json('/admin/api/pedidos/' + order.id + '/cancelar', {});
  assert.equal(unauthorizedCancel.status, 403, 'cancelar pedido pago exige poder de estorno');

  const weakReset = await admin.json('/admin/api/usuarios/' + staffRecord.id + '/senha', { senha: 'abcdefgh' });
  assert.equal(weakReset.status, 400, 'superadmin não pode definir senha fraca');
  const safeReset = await admin.json('/admin/api/usuarios/' + staffRecord.id + '/senha', { senha: '' });
  assert.equal(safeReset.status, 200);
  const passwordReset = await safeReset.json();
  assert.equal(passwordReset.ok, true);
  assert.ok(passwordReset.senhaProvisoria.length >= 20, 'senha automática deve ter alta entropia');
  assert.equal((await staff.get('/admin/pedidos')).status, 303, 'reset encerra sessão anterior do atendente');
  await staff.token('/admin/login');
  const staffRelogin = await staff.form('/admin/login', {
    email: staffEmail, senha: passwordReset.senhaProvisoria,
  });
  assert.equal(staffRelogin.status, 303);
  assert.equal((await staff.get('/admin/pedidos')).status, 200, 'nova senha permite acesso após reset');

  // Painel de vendas: o pedido aprovado deve aparecer em relatórios e
  // exportações sem permitir acesso anônimo aos dados.
  for (const [url, tipo] of [
    ['/admin/api/pedidos/exportar.csv', 'text/csv'],
    ['/admin/api/produtos/exportar.csv', 'text/csv'],
    ['/admin/api/relatorios/vendas.csv', 'text/csv'],
  ]) {
    const csv = await admin.get(url);
    assert.equal(csv.status, 200, 'Exportação administrativa falhou: ' + url);
    assert.match(csv.headers.get('content-type') || '', new RegExp(tipo));
  }
  const clientOrders = await client.get('/conta/pedidos/' + order.codigo);
  assert.equal(clientOrders.status, 200);
  assert.match(await clientOrders.text(), new RegExp(order.codigo));

  // Segurança do rastreamento e transições de entrega.
  const invalidTracking = await admin.json('/admin/api/pedidos/' + order.id + '/rastreio', {
    codigo: 'COD123', url: 'javascript:alert(1)',
  });
  assert.equal(invalidTracking.status, 400, 'link de rastreamento não pode executar JavaScript');
  const insecureTracking = await admin.json('/admin/api/pedidos/' + order.id + '/rastreio', {
    codigo: 'COD123', url: 'http://exemplo.com/rastreio',
  });
  assert.equal(insecureTracking.status, 400, 'rastreio deve ser HTTPS');
  const validTracking = await admin.json('/admin/api/pedidos/' + order.id + '/rastreio', {
    codigo: 'OBJ-123', transportadora: 'Teste Logístico',
    url: 'https://entrega.example/objeto/123',
  });
  assert.equal(validTracking.status, 200);
  assert.equal((await validTracking.json()).ok, true);
  assert.match(await (await client.get('/conta/pedidos/' + order.codigo)).text(),
    /https:\/\/entrega\.example\/objeto\/123/);

  const alterar = (status) => admin.json('/admin/api/pedidos/' + order.id + '/status', { status });
  const separacao = await alterar('em_separacao');
  assert.equal(separacao.status, 200, 'etapa repetida é idempotente');
  for (const status of ['preparando_envio', 'enviado', 'saiu_para_entrega', 'entregue']) {
    const change = await alterar(status);
    assert.equal(change.status, 200, 'etapa ' + status + ' deve funcionar');
    assert.equal((await change.json()).ok, true);
    if (status === 'enviado') {
      const cancelShipped = await admin.json('/admin/api/pedidos/' + order.id + '/cancelar', {});
      assert.equal(cancelShipped.status, 409, 'pedido enviado não pode ser cancelado pelo formulário');
      assert.equal((await cancelShipped.json()).ok, false);
      const unchanged = await snapshot();
      assert.equal(unchanged.payments.find(p => p.id === payment.id).status, 'approved',
        'pedido enviado não pode ter a cobrança estornada antes de rejeitar cancelamento');
      assert.equal(unchanged.orders.find(p => p.id === order.id).statusFinanceiro, 'aprovado');
    }
  }
  for (const status of ['em_separacao', 'enviado', 'aguardando_pagamento']) {
    const change = await alterar(status);
    assert.equal(change.status, 400, 'não pode voltar de entregue para ' + status);
    assert.equal((await change.json()).ok, false);
  }
  const finished = (await snapshot()).orders.find(p => p.id === order.id);
  assert.equal(finished.statusOperacional, 'entregue');
  const cancelledFinished = await admin.json('/admin/api/pedidos/' + order.id + '/cancelar', {});
  assert.equal(cancelledFinished.status, 409, 'entrega finalizada não pode ser cancelada pelo formulário');
  assert.equal((await cancelledFinished.json()).ok, false);
  const afterForbiddenCancellation = await snapshot();
  assert.equal(afterForbiddenCancellation.payments.find(p => p.id === payment.id).status, 'approved',
    'cancelamento de entrega finalizada NUNCA deve estornar a cobrança');
  assert.equal(afterForbiddenCancellation.orders.find(p => p.id === order.id).statusFinanceiro, 'aprovado',
    'pedido entregue mantém estado financeiro sem solicitação de reembolso');
  assert.equal(afterForbiddenCancellation.products.find(p => p.id === produto.id).estoque.quantidade, 8,
    'nenhuma tentativa de cancelamento mexe no estoque entregue');

  // Novo pedido simulado: cancelamento antes do envio só é concluído após
  // estorno confirmado, sem repor automaticamente o produto no estoque.
  await client.token('/checkout/endereco');
  const addRefund = await client.json('/api/carrinho/adicionar', {
    produtoId: produto.id, quantidade: 1,
  });
  assert.equal(addRefund.status, 200);
  const freightRefund = await client.form('/checkout/endereco', {
    nome: 'Comprador Jornada Teste', telefone: '11988887777',
    cep: '01001000', logradouro: 'Rua de teste', numero: '55',
    bairro: 'Centro', cidade: 'São Paulo', uf: 'SP',
  });
  assert.equal(freightRefund.status, 303);
  await client.token('/checkout/pagamento');
  const finishRefund = await client.form('/checkout/finalizar', { metodoPagamento: 'pix' });
  assert.equal(finishRefund.status, 303, 'segunda compra simulada deve concluir');
  const allOrders = (await snapshot()).orders;
  const refundOrder = allOrders.find(p => p.cliente?.email === 'comprador-jornada@tests.example' && p.id !== order.id);
  assert.ok(refundOrder);
  const approveRefund = await admin.json('/admin/api/pedidos/' + refundOrder.id + '/simular-pagamento',
    { status: 'approved' });
  assert.equal(approveRefund.status, 200);
  const cancelApproved = await admin.json('/admin/api/pedidos/' + refundOrder.id + '/cancelar', {});
  assert.equal(cancelApproved.status, 200);
  assert.equal((await cancelApproved.json()).ok, true);
  const afterRefund = await snapshot();
  const refunded = afterRefund.orders.find(p => p.id === refundOrder.id);
  assert.equal(refunded.statusFinanceiro, 'estornado');
  assert.equal(refunded.statusOperacional, 'cancelado');
  const refundedPayment = afterRefund.payments.find(p => p.id === refunded.pagamentoId);
  assert.equal(refundedPayment.status, 'refunded');
  assert.equal(afterRefund.products.find(p => p.id === produto.id).estoque.quantidade, 7,
    'reembolso não devolve fisicamente produto já baixado');
  const cancelAgain = await admin.json('/admin/api/pedidos/' + refundOrder.id + '/cancelar', {});
  assert.equal(cancelAgain.status, 409);
  const afterRetry = await snapshot();
  assert.equal(afterRetry.payments.find(p => p.id === refundedPayment.id).eventos.length,
    refundedPayment.eventos.length, 'reenvio do cancelamento não duplica reembolso');
});