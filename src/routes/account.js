/** routes/account.js — Cadastro, login, recuperação de senha, conta, pedidos, endereços e favoritos. */
import crypto from 'node:crypto';
import { criarContexto } from './context.js';
import {
  telaLogin, telaCadastro, telaEsqueciSenha, telaRedefinirSenha, telaConta,
  telaPedidos, telaPedidoDetalhe, telaEnderecos, telaDados, telaFavoritos,
} from '../views/account.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, validate,
  validators as v, cleanText, onlyDigits, randomToken, escapeHtml,
} from '../lib/security.js';
import { pedidosDoCliente, cancelarPedido } from '../lib/orders.js';
import { sendMail } from '../lib/mailer.js';
import { logCustomer } from '../lib/audit.js';
import { config } from '../config.js';
import { UF_LIST } from '../lib/cep.js';

function exigirLogin(req, res) {
  if (req.user) return true;
  res.redirect(`/conta/login?proximo=${encodeURIComponent(req.pathname + (req.raw.url.includes('?') ? '?' + req.raw.url.split('?')[1] : ''))}`);
  return false;
}

export function registrarRotasConta(app, db) {
  const clientes = () => db.collection('customers');

  /* ------------------------------ LOGIN ---------------------------- */
  app.get('/conta/login', (req, res) => {
    if (req.user) return void res.redirect('/conta');
    const ctx = criarContexto(req, db);
    res.html(telaLogin(ctx, { proximo: req.query.get('proximo') || '', aviso: req.query.get('aviso') || '' }));
  });

  app.post('/conta/login', (req, res) => {
    const ctx = criarContexto(req, db);
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    const cliente = clientes().findOne((c) => String(c.email || '').toLowerCase() === email);
    if (!cliente || !verifyPassword(senha, cliente.senhaHash)) {
      logSystemLogin(db, req, email, false);
      return void res.html(telaLogin(ctx, { erros: { senha: 'E-mail ou senha incorretos.' }, valores: { email }, proximo: req.body.proximo || '' }), 401);
    }
    if (cliente.ativo === false) {
      return void res.html(telaLogin(ctx, { erros: { email: 'Esta conta está desativada. Fale com o atendimento.' } }), 403);
    }
    const sessionId = createSession(db, 'customer', cliente.id, { ip: req.ip, userAgent: req.headers['user-agent'], cartId: req.cookies?.[config.cartCookie] || null });
    // vincula o carrinho atual ao cliente
    const cartId = req.cookies?.[config.cartCookie];
    if (cartId && db.collection('carts').get(cartId)) db.collection('carts').update(cartId, { clienteId: cliente.id });
    db.collection('customers').update(cliente.id, { ultimoAcesso: new Date().toISOString() });
    logSystemLogin(db, req, email, true);
    res.cookie(config.sessionCookie, sessionId, { maxAge: config.sessionTTLHours * 3600, path: '/' });
    const proximo = String(req.body.proximo || '/conta');
    // Impede redirecionamento para URLs externas via caminhos "//host".
    // Não permite barras invertidas ou caracteres de controle no destino.
    res.redirect(/^\/(?!\/)/.test(proximo) && !/[\\\r\n\0]/.test(proximo)
      ? proximo : '/conta');
  });

  /* ---------------------------- CADASTRO --------------------------- */
  app.get('/conta/cadastro', (req, res) => {
    if (req.user) return void res.redirect('/conta');
    const ctx = criarContexto(req, db);
    res.html(telaCadastro(ctx, {}));
  });

  app.post('/conta/cadastro', (req, res) => {
    const ctx = criarContexto(req, db);
    const dados = {
      nome: cleanText(req.body.nome, 120),
      email: String(req.body.email || '').trim().toLowerCase(),
      telefone: cleanText(req.body.telefone, 30),
      cpf: onlyDigits(req.body.cpf),
      dataNascimento: String(req.body.dataNascimento || ''),
      senha: String(req.body.senha || ''),
      senha2: String(req.body.senha2 || ''),
      marketing: !!req.body.marketing,
    };
    const erros = validate(dados, {
      nome: [[(val) => v.required(val) && v.minLen(val, 3), 'Informe seu nome completo.'], [(val) => v.maxLen(val, 120), 'Nome muito longo.']],
      email: [[(val) => v.email(val), 'Informe um e-mail válido.'], [(val) => !clientes().findOne((c) => c.email === val), 'Este e-mail já possui cadastro.']],
      telefone: [[(val) => v.phone(val), 'Informe um telefone válido com DDD.']],
      cpf: [[(val) => val === '' || v.cpf(val), 'CPF inválido.']],
      senha: [
        [(val) => v.minLen(val, 8), 'A senha deve ter no mínimo 8 caracteres.'],
        [(val) => /[A-Za-z]/.test(val) && /\d/.test(val), 'Use letras e números na senha.'],
      ],
      senha2: [[(val) => val === dados.senha, 'As senhas não coincidem.']],
    });
    if (Object.keys(erros).length) return void res.html(telaCadastro(ctx, { erros, valores: dados }), 400);

    const cliente = clientes().insert({
      nome: dados.nome, email: dados.email, senhaHash: hashPassword(dados.senha),
      cpf: dados.cpf, telefone: dados.telefone, dataNascimento: dados.dataNascimento,
      ativo: true, emailConfirmado: false, marketing: dados.marketing,
      enderecos: [], favoritos: [], criadoEm: new Date().toISOString(), ultimoAcesso: null,
    });
    const sessionId = createSession(db, 'customer', cliente.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    const cartId = req.cookies?.[config.cartCookie];
    if (cartId && db.collection('carts').get(cartId)) db.collection('carts').update(cartId, { clienteId: cliente.id });
    logCustomer(db, cliente.id, 'cadastro', 'cliente', cliente.id, { email: cliente.email }, req);

    sendMail(db, {
      to: cliente.email,
      subject: 'Bem-vindo(a) à Farmácia Pague Pouco',
      html: `<h1>Olá, ${escapeHtml(cliente.nome.split(' ')[0])}!</h1>
        <p>Sua conta foi criada com sucesso na loja virtual da Farmácia Pague Pouco.</p>
        <p>Agora você pode acompanhar pedidos, cadastrar endereços e salvar seus produtos favoritos.</p>
        <p><a href="${config.publicBaseUrl}/conta">Acessar minha conta</a></p>`,
    }).catch(() => {});

    res.cookie(config.sessionCookie, sessionId, { maxAge: config.sessionTTLHours * 3600, path: '/' });
    res.redirect('/conta');
  });

  /* -------------------------- ESQUECI SENHA ------------------------ */
  app.get('/conta/esqueci-senha', (req, res) => {
    const ctx = criarContexto(req, db);
    res.html(telaEsqueciSenha(ctx, {}));
  });

  app.post('/conta/esqueci-senha', async (req, res) => {
    const ctx = criarContexto(req, db);
    const email = String(req.body.email || '').trim().toLowerCase();
    const cliente = clientes().findOne((c) => String(c.email || '').toLowerCase() === email);
    // Sem transporte de e-mail em produção, não gere um token secreto que
    // jamais chegará ao destinatário. Nos testes locais em DEV_MODE, a fila
    // permite exercitar recuperação sem provedor externo.
    // A resposta continua genérica para não revelar contas existentes.
    if (cliente && (config.mail.enabled || config.isDev)) {
      const token = randomToken(32);
      db.collection('passwordTokens').insert({
        token, clienteId: cliente.id, usado: false,
        expiraEm: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        criadoEm: new Date().toISOString(), ip: req.ip,
      });
      const link = `${config.publicBaseUrl}/conta/redefinir/${token}`;
      try {
        await sendMail(db, {
        to: cliente.email,
        subject: 'Recuperação de senha — Farmácia Pague Pouco',
        html: `<p>Olá, ${escapeHtml(cliente.nome.split(' ')[0])}.</p>
          <p>Recebemos um pedido para redefinir sua senha. Use o link abaixo (válido por 2 horas):</p>
          <p><a href="${link}">${link}</a></p>
          <p>Se você não pediu a troca, ignore esta mensagem.</p>`,
        });
      } catch {
        // A mensagem não foi gravada; não afirme entrega ao cliente.
      }
      logCustomer(db, cliente.id, 'solicitou_recuperacao_senha', 'cliente', cliente.id, {}, req);
    }
    res.html(telaEsqueciSenha(ctx, {
      mensagem: config.mail.enabled
        ? 'Se o e-mail estiver cadastrado, o link será enviado após o processamento. Verifique o spam.'
        : 'O envio de e-mail ainda não está habilitado. Para recuperar seu acesso, procure o atendimento da farmácia.',
    }));
  });

  app.get('/conta/redefinir/:token', (req, res) => {
    const ctx = criarContexto(req, db);
    const t = db.collection('passwordTokens').findOne((x) => x.token === req.params.token && !x.usado);
    if (!t || new Date(t.expiraEm).getTime() < Date.now()) {
      return void res.html(telaEsqueciSenha(ctx, { erro: 'Este link de recuperação é inválido ou expirou. Solicite um novo.' }));
    }
    res.html(telaRedefinirSenha(ctx, { token: req.params.token }));
  });

  app.post('/conta/redefinir-senha', (req, res) => {
    const ctx = criarContexto(req, db);
    const token = String(req.body.token || '');
    const senha = String(req.body.senha || '');
    const senha2 = String(req.body.senha2 || '');
    const t = db.collection('passwordTokens').findOne((x) => x.token === token && !x.usado);
    const erroBase = { token, erro: 'Link inválido ou expirado. Solicite um novo.' };
    if (!t || new Date(t.expiraEm).getTime() < Date.now()) return void res.html(telaRedefinirSenha(ctx, erroBase), 400);
    if (senha.length < 8 || senha !== senha2) {
      return void res.html(telaRedefinirSenha(ctx, { token, erro: 'As senhas não coincidem ou têm menos de 8 caracteres.' }), 400);
    }
    db.collection('customers').update(t.clienteId, { senhaHash: hashPassword(senha) });
    db.collection('passwordTokens').update(t.id, { usado: true, usadoEm: new Date().toISOString() });
    // encerra sessões existentes do cliente (segurança)
    for (const s of db.collection('sessions').find((sess) => sess.type === 'customer' && sess.userId === t.clienteId)) {
      destroySession(db, s.id);
    }
    logCustomer(db, t.clienteId, 'redefiniu_senha', 'cliente', t.clienteId, {}, req);
    res.redirect('/conta/login?aviso=Senha+alterada+com+sucesso.+Entre+com+a+nova+senha.');
  });

  /* ------------------------------ CONTA ---------------------------- */
  app.get('/conta', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    res.html(telaConta(ctx, { pedidos: pedidosDoCliente(db, req.user.id) }));
  });

  app.get('/conta/sair', (req, res) => {
    if (req.session) destroySession(db, req.session.id);
    res.clearCookie(config.sessionCookie);
    res.redirect('/');
  });

  app.get('/conta/pedidos', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    res.html(telaPedidos(ctx, { pedidos: pedidosDoCliente(db, req.user.id) }));
  });

  app.get('/conta/pedidos/:codigo', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const pedido = db.collection('orders').findOne((o) => o.codigo === req.params.codigo && o.clienteId === req.user.id);
    if (!pedido) return void res.redirect('/conta/pedidos');
    res.html(telaPedidoDetalhe(ctx, { pedido }));
  });

  app.post('/conta/pedidos/:codigo/cancelar', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const pedido = db.collection('orders').findOne((o) => o.codigo === req.params.codigo && o.clienteId === req.user.id);
    if (!pedido) return void res.redirect('/conta/pedidos');
    const r = cancelarPedido(db, pedido.id, { motivo: cleanText(req.body.motivo, 300) || 'Cancelado pelo cliente.', por: req.user.nome });
    if (!r.ok) {
      const ctx = criarContexto(req, db);
      ctx.aviso = escapeHtml(r.erro || 'Não foi possível cancelar este pedido.');
      return void res.html(telaPedidoDetalhe(ctx, { pedido: db.collection('orders').get(pedido.id) }), 409);
    }
    logCustomer(db, req.user.id, 'cancelou_pedido', 'pedido', pedido.id, { motivo: cleanText(req.body.motivo, 300) }, req);
    res.redirect(`/conta/pedidos/${pedido.codigo}`);
  });

  /* ---------------------------- ENDEREÇOS -------------------------- */
  app.get('/conta/enderecos', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const enderecos = req.user.enderecos || [];
    const editarId = req.query.get('editar');
    const editando = editarId ? enderecos.find((e) => e.id === editarId) || null : null;
    res.html(telaEnderecos(ctx, { enderecos, editando }));
  });

  app.post('/conta/enderecos', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const dados = lerEndereco(req);
    const erros = validarEndereco(dados);
    if (Object.keys(erros).length) {
      return void res.html(telaEnderecos(ctx, { enderecos: req.user.enderecos || [], erros }), 400);
    }
    const enderecos = [...(req.user.enderecos || [])];
    if (dados.padrao) enderecos.forEach((e) => { e.padrao = false; });
    if (!enderecos.length) dados.padrao = true;
    enderecos.push({ id: `end_${crypto.randomBytes(6).toString('hex')}`, ...dados });
    db.collection('customers').update(req.user.id, { enderecos });
    res.redirect('/conta/enderecos');
  });

  app.post('/conta/enderecos/:id', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const dados = lerEndereco(req);
    const erros = validarEndereco(dados);
    if (Object.keys(erros).length) {
      return void res.html(telaEnderecos(ctx, { enderecos: req.user.enderecos || [], erros, editando: { id: req.params.id, ...dados } }), 400);
    }
    const enderecos = (req.user.enderecos || []).map((e) => (e.id === req.params.id ? { ...e, ...dados } : { ...e, padrao: dados.padrao ? false : e.padrao }));
    db.collection('customers').update(req.user.id, { enderecos });
    res.redirect('/conta/enderecos');
  });

  app.post('/conta/enderecos/:id/excluir', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const enderecos = (req.user.enderecos || []).filter((e) => e.id !== req.params.id);
    db.collection('customers').update(req.user.id, { enderecos });
    res.redirect('/conta/enderecos');
  });

  /* ------------------------------ DADOS ---------------------------- */
  app.get('/conta/dados', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    res.html(telaDados(ctx, {}));
  });

  app.post('/conta/dados', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const dados = {
      nome: cleanText(req.body.nome, 120),
      email: String(req.body.email || '').trim().toLowerCase(),
      telefone: cleanText(req.body.telefone, 30),
      cpf: onlyDigits(req.body.cpf),
      dataNascimento: String(req.body.dataNascimento || ''),
      marketing: !!req.body.marketing,
    };
    const erros = validate(dados, {
      nome: [[(val) => v.required(val) && v.minLen(val, 3), 'Informe seu nome completo.']],
      email: [[(val) => v.email(val), 'Informe um e-mail válido.'],
        [(val) => !clientes().findOne((c) => c.email === val && c.id !== req.user.id), 'Este e-mail já está em uso.']],
      telefone: [[(val) => v.phone(val), 'Informe um telefone válido com DDD.']],
      cpf: [[(val) => val === '' || v.cpf(val), 'CPF inválido.']],
    });
    if (Object.keys(erros).length) return void res.html(telaDados(ctx, { erros }), 400);
    db.collection('customers').update(req.user.id, dados);
    logCustomer(db, req.user.id, 'atualizou_dados', 'cliente', req.user.id, {}, req);
    res.redirect('/conta/dados?ok=1');
  });

  app.post('/conta/senha', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const atual = String(req.body.senhaAtual || '');
    const nova = String(req.body.senhaNova || '');
    if (!verifyPassword(atual, req.user.senhaHash)) {
      return void res.html(telaDados(ctx, { erros: { senhaAtual: 'A senha atual está incorreta.' } }), 400);
    }
    if (nova.length < 8 || !/[A-Za-z]/.test(nova) || !/\d/.test(nova)) {
      return void res.html(telaDados(ctx, { erros: { senhaNova: 'A nova senha deve ter 8+ caracteres, com letras e números.' } }), 400);
    }
    db.collection('customers').update(req.user.id, { senhaHash: hashPassword(nova) });
    logCustomer(db, req.user.id, 'alterou_senha', 'cliente', req.user.id, {}, req);
    res.redirect('/conta/dados?senha=ok');
  });

  /* ---------------------------- FAVORITOS -------------------------- */
  app.get('/conta/favoritos', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const ctx = criarContexto(req, db);
    const favoritos = (req.user.favoritos || []).map((id) => db.collection('products').get(id)).filter(Boolean);
    res.html(telaFavoritos(ctx, { produtos: favoritos }));
  });

  app.post('/conta/favoritos', (req, res) => {
    if (!exigirLogin(req, res)) return void res.json({ ok: false, erro: 'Faça login para salvar favoritos.' }, 401);
    const id = String(req.body.produtoId || '');
    if (!db.collection('products').get(id)) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    const fav = new Set(req.user.favoritos || []);
    const acao = String(req.body.acao || 'adicionar');
    if (acao === 'remover') fav.delete(id); else fav.add(id);
    db.collection('customers').update(req.user.id, { favoritos: Array.from(fav) });
    res.json({ ok: true, favoritos: Array.from(fav) });
  });

  app.post('/conta/favoritos/remover', (req, res) => {
    if (!exigirLogin(req, res)) return;
    const fav = (req.user.favoritos || []).filter((id) => id !== String(req.body.produtoId || ''));
    db.collection('customers').update(req.user.id, { favoritos: fav });
    res.redirect('/conta/favoritos');
  });
}

/* ------------------------------ helpers ---------------------------- */
function lerEndereco(req) {
  return {
    nome: String(req.body.nome || '').trim().slice(0, 120),
    apelido: String(req.body.apelido || '').trim().slice(0, 40),
    cep: String(req.body.cep || '').replace(/\D/g, ''),
    logradouro: String(req.body.logradouro || '').trim().slice(0, 160),
    numero: String(req.body.numero || '').trim().slice(0, 20),
    complemento: String(req.body.complemento || '').trim().slice(0, 80),
    bairro: String(req.body.bairro || '').trim().slice(0, 80),
    cidade: String(req.body.cidade || '').trim().slice(0, 80),
    uf: String(req.body.uf || '').toUpperCase().slice(0, 2),
    padrao: !!req.body.padrao,
  };
}

function validarEndereco(d) {
  return validate(d, {
    nome: [[(val) => v.required(val), 'Informe o nome do destinatário.']],
    cep: [[(val) => v.cep(val), 'Informe um CEP válido (8 dígitos).']],
    logradouro: [[(val) => v.required(val), 'Informe o endereço.']],
    numero: [[(val) => v.required(val), 'Informe o número.']],
    bairro: [[(val) => v.required(val), 'Informe o bairro.']],
    cidade: [[(val) => v.required(val), 'Informe a cidade.']],
    uf: [[(val) => UF_LIST.includes(val), 'Informe uma UF válida.']],
  });
}

function logSystemLogin(db, req, email, sucesso) {
  db.collection('auditLogs').insert({
    atorId: null, atorNome: 'visitante', atorRole: 'publico',
    acao: sucesso ? 'login_sucesso' : 'login_falha',
    entidade: 'cliente', entidadeId: null,
    detalhes: { email: String(email).slice(0, 80) },
    ip: req.ip, userAgent: (req.headers['user-agent'] || '').slice(0, 200),
    criadoEm: new Date().toISOString(),
  });
}
