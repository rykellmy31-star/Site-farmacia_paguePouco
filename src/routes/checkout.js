/** routes/checkout.js — Carrinho, endereço/frete, pagamento e confirmação do pedido. */
import { criarContexto } from './context.js';
import { telaCarrinho, telaEndereco, telaPagamento, telaConfirmacao, telaCheckoutVazio } from '../views/checkout.js';
import {
  getCart, calcularTotais, normalizeCart, aplicarCupom, removerCupom, clearCart, attachCartCookie,
} from '../lib/cart.js';
import { calcularFrete, resolverFreteEscolhido } from '../lib/freight.js';
import { criarPedido, cancelarPedido } from '../lib/orders.js';
import { createPayment, installmentOptions, enabledMethods, providerPublicInfo } from '../lib/payments/index.js';
import { validate, validators as v, cleanText, onlyDigits, escapeHtml } from '../lib/security.js';
import { lookupCep, UF_LIST } from '../lib/cep.js';
import { logCustomer } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { config } from '../config.js';
import { uid } from '../lib/store.js';

function exigirLoginCompra(req, res, db) {
  if (req.user) return true;
  const exigir = (db.collection('settings').get('loja') || {}).exigirLoginParaComprar !== false;
  if (exigir) {
    res.redirect(`/conta/login?proximo=${encodeURIComponent(req.pathname)}`);
    return false;
  }
  return true;
}

export function registrarRotasCheckout(app, db) {
  /* ----------------------------- CESTA ----------------------------- */
  app.get('/carrinho', (req, res) => {
    const ctx = criarContexto(req, db);
    const normalizado = normalizeCart(db, ctx.cart);
    ctx.cart = normalizado.cart;
    const totais = calcularTotais(db, ctx.cart, { freteValor: ctx.cart.frete?.valor || 0 });
    res.html(telaCarrinho(ctx, { totais, avisos: normalizado.avisos.map((a) => a.mensagem), erro: req.query.get('erro') || '' }));
  });

  app.post('/carrinho/cupom', (req, res) => {
    const cart = getCart(db, req);
    const codigo = String(req.body.codigo || '').trim();
    if (codigo) {
      const totais = calcularTotais(db, cart, {});
      aplicarCupom(db, cart, codigo, { subtotalCentavos: totais.subtotalCentavos, clienteId: req.user?.id || null, itens: cart.itens || [] });
      if (!db.collection('carts').get(cart.id)?.cupom) {
        return void res.redirect('/carrinho?erro=' + encodeURIComponent('Cupom inválido ou não aplicável a esta compra.'));
      }
    }
    res.redirect('/carrinho');
  });

  app.post('/carrinho/cupom/remover', (req, res) => {
    const cart = getCart(db, req);
    removerCupom(db, cart);
    res.redirect('/carrinho');
  });

  /* --------------------------- CHECKOUT ---------------------------- */
  app.get('/checkout', (req, res) => {
    if (!exigirLoginCompra(req, res, db)) return;
    const cart = getCart(db, req);
    if (!(cart.itens || []).length) {
      const ctx = criarContexto(req, db);
      return void res.html(telaCheckoutVazio(ctx));
    }
    res.redirect('/checkout/endereco');
  });

  app.get('/checkout/endereco', (req, res) => {
    if (!exigirLoginCompra(req, res, db)) return;
    const ctx = criarContexto(req, db);
    const cart = normalizeCart(db, ctx.cart).cart;
    ctx.cart = cart;
    if (!cart.itens.length) return void res.html(telaCheckoutVazio(ctx));
    const totais = calcularTotais(db, cart, {});
    const salvaguarda = cart.frete?.endereco;
    res.html(telaEndereco(ctx, {
      totais,
      enderecos: req.user?.enderecos || [],
      calculo: cart.frete?.opcoes ? cart.frete.opcoes : null,
      freteSelecionado: cart.frete?.opcaoId || '',
      erroFrete: req.query.get('erroFrete') || '',
    }));
  });

  app.post('/checkout/endereco', (req, res) => {
    if (!exigirLoginCompra(req, res, db)) return;
    const ctx = criarContexto(req, db);
    let cart = normalizeCart(db, ctx.cart).cart;
    ctx.cart = cart;
    const totais = calcularTotais(db, cart, {});

    let endereco;
    const usarSalvo = req.body.usarEnderecoSalvo === '1' && req.body.enderecoSalvo;
    if (usarSalvo) {
      const en = (req.user.enderecos || []).find((x) => x.id === req.body.enderecoSalvo);
      if (!en) return void res.redirect('/checkout/endereco?erroFrete=' + encodeURIComponent('Endereço selecionado não encontrado.'));
      endereco = { ...en, telefone: req.user.telefone || '' };
    } else {
      endereco = {
        nome: cleanText(req.body.nome, 120),
        apelido: cleanText(req.body.apelido, 40),
        cep: onlyDigits(req.body.cep),
        logradouro: cleanText(req.body.logradouro, 160),
        numero: cleanText(req.body.numero, 20),
        complemento: cleanText(req.body.complemento, 80),
        bairro: cleanText(req.body.bairro, 80),
        cidade: cleanText(req.body.cidade, 80),
        uf: String(req.body.uf || '').toUpperCase(),
        telefone: cleanText(req.body.telefone, 30),
      };
      const erros = validate(endereco, {
        nome: [[(val) => v.required(val), 'Informe o nome do destinatário.']],
        cep: [[(val) => v.cep(val), 'Informe um CEP válido.']],
        logradouro: [[(val) => v.required(val), 'Informe o endereço.']],
        numero: [[(val) => v.required(val), 'Informe o número.']],
        bairro: [[(val) => v.required(val), 'Informe o bairro.']],
        cidade: [[(val) => v.required(val), 'Informe a cidade.']],
        uf: [[(val) => UF_LIST.includes(val), 'Informe uma UF válida.']],
        telefone: [[(val) => v.phone(val), 'Informe um telefone válido com DDD.']],
      });
      if (Object.keys(erros).length) {
        return void res.html(telaEndereco(ctx, { totais, enderecos: req.user?.enderecos || [], erros }), 400);
      }
    }

    // frete sempre recalculado no servidor
    const calc = calcularFrete({
      config: ctx.settings.frete,
      cep: endereco.cep, uf: endereco.uf, cidade: endereco.cidade,
      items: cart.itens, subtotalCents: totais.subtotalCentavos,
      cupomFreteGratis: !!cart.cupom?.freteGratis,
    });
    if (!calc.disponivel) {
      return void res.html(telaEndereco(ctx, {
        totais, enderecos: req.user?.enderecos || [], erroFrete: calc.motivo || 'Entrega indisponível.',
      }), 400);
    }
    const escolhida = calc.opcoes.find((o) => o.id === req.body.freteOpcao) || calc.opcoes[0];

    db.collection('carts').update(cart.id, {
      frete: {
        endereco,
        opcaoId: escolhida.id,
        valor: escolhida.valor,
        label: escolhida.label,
        prazo: escolhida.prazo,
        detalhe: escolhida.detalhe || '',
        uf: calc.uf,
        opcoes: calc,
        calculadoEm: new Date().toISOString(),
      },
      atualizadoEm: new Date().toISOString(),
    });

    // salva o endereço no cadastro, se o cliente quiser reutilizar
    if (!usarSalvo && req.body.salvarEndereco === '1' && req.user) {
      const enderecos = [...(req.user.enderecos || [])];
      enderecos.push({ id: `end_${Date.now().toString(36)}`, ...endereco, padrao: !enderecos.length });
      db.collection('customers').update(req.user.id, { enderecos });
    }

    res.redirect('/checkout/pagamento');
  });

  app.post('/checkout/frete', (req, res) => {
    const ctx = criarContexto(req, db);
    const cart = getCart(db, req);
    const cep = onlyDigits(req.body.cep);
    const cidade = cleanText(req.body.cidade, 80);
    const uf = String(req.body.uf || '').toUpperCase();
    const totais = calcularTotais(db, cart, {});
    const calc = calcularFrete({
      config: ctx.settings.frete, cep, uf, cidade,
      items: cart.itens || [], subtotalCents: totais.subtotalCentavos,
      cupomFreteGratis: !!cart.cupom?.freteGratis,
    });
    res.json({ ok: true, ...calc });
  });

  /* --------------------------- PAGAMENTO --------------------------- */
  app.get('/checkout/pagamento', (req, res) => {
    if (!exigirLoginCompra(req, res, db)) return;
    const ctx = criarContexto(req, db);
    const cart = normalizeCart(db, ctx.cart).cart;
    ctx.cart = cart;
    if (!cart.itens.length) return void res.html(telaCheckoutVazio(ctx));
    if (!cart.frete?.endereco) return void res.redirect('/checkout/endereco');

    // revalida o frete no servidor (preços/estoque podem ter mudado)
    const revalidado = resolverFreteEscolhido({
      config: ctx.settings.frete,
      cep: cart.frete.endereco.cep, uf: cart.frete.endereco.uf, cidade: cart.frete.endereco.cidade,
      items: cart.itens, subtotalCents: calcularTotais(db, cart, {}).subtotalCentavos,
      opcaoId: cart.frete.opcaoId, cupomFreteGratis: !!cart.cupom?.freteGratis,
    });
    if (!revalidado.ok) {
      return void res.redirect('/checkout/endereco?erroFrete=' + encodeURIComponent(revalidado.erro));
    }
    db.collection('carts').update(cart.id, {
      frete: { ...cart.frete, valor: revalidado.valor, label: revalidado.opcao.label, prazo: revalidado.opcao.prazo, opcaoId: revalidado.opcao.id },
    });
    cart.frete = { ...cart.frete, valor: revalidado.valor, label: revalidado.opcao.label, prazo: revalidado.opcao.prazo, opcaoId: revalidado.opcao.id };

    const totais = calcularTotais(db, cart, { freteValor: revalidado.valor, freteGratisPorCupom: !!cart.cupom?.freteGratis });
    ctx.infoPagamento = providerPublicInfo(db);
    const formas = enabledMethods(db);
    const cfgPag = ctx.settings.pagamentos || {};
    res.html(telaPagamento(ctx, {
      totais,
      erros: req.query.get('erro') ? { pagamento: req.query.get('erro') } : {},
      parcelas: installmentOptions(db, totais.totalCentavos),
      formasPagamento: {
        ...formas,
        descontoPix: Number(cfgPag.descontoPixPercentual || 0),
      },
      endereco: cart.frete.endereco,
      frete: { label: revalidado.opcao.label, prazo: revalidado.opcao.prazo },
    }));
  });

  /* --------------------------- FINALIZAR --------------------------- */
  app.post('/checkout/finalizar', async (req, res) => {
    if (!exigirLoginCompra(req, res, db)) return;
    const ctx = criarContexto(req, db);
    let cart = normalizeCart(db, ctx.cart).cart;
    ctx.cart = cart;
    if (!cart.itens.length) return void res.redirect('/carrinho');
    if (!cart.frete?.endereco) return void res.redirect('/checkout/endereco');

    const metodo = String(req.body.metodoPagamento || 'pix');
    const formas = enabledMethods(db);
    const permitido = (metodo === 'pix' && formas.pix) || (metodo === 'credit_card' && formas.credit_card) || (metodo === 'debit_card' && formas.debit_card);
    if (!permitido) {
      return void res.redirect('/checkout/pagamento?erro=' + encodeURIComponent('Forma de pagamento indisponível.'));
    }

    const parcelas = Math.max(1, Number(req.body.parcelas) || 1);
    const carrinhoOriginal = { itens: [...(cart.itens || [])], cupom: cart.cupom, frete: cart.frete };
    const resultado = await criarPedido(db, {
      cart, cliente: req.user, endereco: cart.frete.endereco,
      freteOpcaoId: cart.frete.opcaoId, metodoPagamento: metodo, parcelas,
      freteConfig: ctx.settings.frete, cupomCodigo: cart.cupom?.codigo || null, req,
    });

    if (!resultado.ok) {
      return void res.redirect('/checkout/pagamento?erro=' + encodeURIComponent(resultado.erro));
    }

    const pedido = resultado.pedido;

    // Cria a cobrança no provedor configurado. Timeout não equivale a recusa.
    let cobranca, erroIndeterminado = false;
    try { cobranca = await createPayment(db, {
      order: pedido,
      method: metodo,
      payer: { nome: pedido.cliente?.nome, email: pedido.cliente?.email, cpf: req.user?.cpf },
      installments: parcelas,
      cardToken: req.body.cardToken || null,
      paymentMethodId: req.body.paymentMethodId || null,
      issuerId: req.body.issuerId || null,
      returnUrls: { notificationUrl: `${config.publicBaseUrl}/webhooks/mercadopago` },
    }); } catch (err) {
      erroIndeterminado = true;
      cobranca = { ok: false, erro: 'Não foi possível determinar se o provedor registrou a cobrança.' };
    }
    if (!cobranca?.ok || !cobranca.pagamento) {
      if (erroIndeterminado) {
        db.collection('orders').update(pedido.id, {
          pendenciaPagamento: 'conciliacao_necessaria',
          historico: [...(pedido.historico || []), {
            tipo: 'financeiro', status: 'conciliacao_necessaria', em: new Date().toISOString(),
            por: 'sistema', obs: 'Resposta indeterminada do provedor; reserva mantida até conciliação.',
          }],
        });
        return void res.redirect(`/checkout/confirmacao/${pedido.codigo}`);
      }
      cancelarPedido(db, pedido.id, { motivo: 'Cobrança não criada; estoque liberado.', por: 'sistema' });
      // Restaura o carrinho original: a compra NÃO foi finalizada.
      db.collection('carts').update(cart.id, { ...carrinhoOriginal, atualizadoEm: new Date().toISOString() });
      return void res.redirect('/checkout/pagamento?erro=' +
        encodeURIComponent(cobranca?.erro || 'Não foi possível iniciar o pagamento.'));
    }

    if (cobranca && cobranca.ok && cobranca.pagamento) {
      const pagamentoId = cobranca.pagamento.id;
      db.collection('orders').update(pedido.id, { pagamentoId });
      pedido.pagamentoId = pagamentoId;
    }
    db.collection('orders').update(pedido.id, {
      historico: [...(pedido.historico || []), {
        tipo: 'financeiro', status: 'pendente', em: new Date().toISOString(), por: 'sistema',
        obs: cobranca?.ok ? 'Cobrança criada no provedor de pagamento.' : `Falha ao criar cobrança: ${cobranca?.erro || 'erro desconhecido'}`,
      }],
    });

    sendMail(db, {
      to: pedido.cliente?.email || req.user?.email || '',
      subject: `Pedido ${pedido.codigo} recebido — Farmácia Pague Pouco`,
      html: `<h1>Recebemos seu pedido ${escapeHtml(pedido.codigo)}</h1>
        <p>Olá, ${escapeHtml(String(pedido.cliente?.nome || '').split(' ')[0])}!</p>
        <p>Registramos seu pedido no valor de <strong>${escapeHtml((Number(pedido.totalCentavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</strong>.</p>
        <p>Assim que o pagamento for confirmado, seu pedido entra em separação e você recebe um novo aviso.</p>
        <p><a href="${config.publicBaseUrl}/conta/pedidos/${pedido.codigo}">Acompanhar pedido</a></p>`,
    }).catch(() => {});

    if (req.user) logCustomer(db, req.user.id, 'criou_pedido', 'pedido', pedido.id, { codigo: pedido.codigo, total: pedido.totalCentavos }, req);

    // Após o pedido, o cliente recebe uma CESTA NOVA (o carrinho anterior fica
    // vinculado ao pedido). Isso mantém a proteção contra duplicidade sem
    // impedir uma compra legítima em seguida.
    const cestaNova = db.collection('carts').insert({
      id: `c_${uid()}`, clienteId: req.user?.id || null, itens: [], cupom: null, frete: null,
      criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
    });
    attachCartCookie(res, cestaNova.id);

    res.redirect(`/checkout/confirmacao/${pedido.codigo}`);
  });

  app.get('/checkout/confirmacao/:codigo', (req, res) => {
    if (!exigirLoginCompra(req, res, db)) return;
    const ctx = criarContexto(req, db);
    const pedido = db.collection('orders').findOne((o) => o.codigo === req.params.codigo && o.clienteId === req.user.id);
    if (!pedido) return void res.redirect('/conta/pedidos');
    const pagamento = pedido.pagamentoId ? db.collection('payments').get(pedido.pagamentoId) : null;
    res.html(telaConfirmacao(ctx, { pedido, pagamento }));
  });

  /* ------------------------- FRETE (API CEP) ----------------------- */
  app.get('/checkout/cep/:cep', async (req, res) => {
    const info = await lookupCep(req.params.cep);
    res.json(info);
  });
}

