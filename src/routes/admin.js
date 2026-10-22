/**
 * routes/admin.js — Painel Super Administrador: páginas HTML e API.
 * Todas as permissões são verificadas no SERVIDOR (nunca apenas no menu).
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { config } from '../config.js';
import { inovaAtiva } from '../lib/inovafarma-stock.js';
import { diagnosticoInova, salvarConfiguracaoInova, armazenarCredencialInova, apagarCredencialInova } from '../lib/inovafarma-panel.js';
import { telaIntegracaoInova } from '../views/admin/inovafarma.js';
import { telaImportacaoCatalogoInova } from '../views/admin/inovafarma-catalog.js';
import { listarCandidatosInova, revisarCandidatoInova } from '../lib/inovafarma-catalog-import.js';
import { can, ROLES, ROLE_LIST } from '../lib/permissions.js';
import { createSession, destroySession, hashPassword, verifyPassword, randomToken, escapeHtml as e, validators as v, validate, cleanText, onlyDigits, slugify, csrfToken } from '../lib/security.js';
import { paginaAdmin } from '../views/admin/layout.js';
import {
  telaDashboard, telaProdutos, telaProdutoForm, telaImportar, telaCategorias,
  telaEstoque, telaMidia, telaBanners, telaPromocoes,
} from '../views/admin/catalogo.js';
import {
  telaPedidos, telaPedido, telaClientes, telaCliente, telaPagamentosAdmin, telaRelatorios,
} from '../views/admin/vendas.js';
import {
  telaFretes, telaWhatsApp, telaConfiguracoes, telaPaginas, telaPaginaForm,
  telaUsuarios, telaAuditoria, telaSistema, telaAparencia,
} from '../views/admin/config.js';
import {
  montarArvore, slugUnicoProduto, slugUnicoCategoria, marcasDisponiveis, podeVender,
} from '../lib/catalog.js';
import { saveUpload, deleteUpload, uploadStats, countUsages } from '../lib/uploads.js';
import {
  registrarMovimentoEstoque, atualizarStatusOperacional, atualizarStatusFinanceiro, concluirDevolucaoEstornada,
  cancelarPedido, validarCancelamentoOperacional, pedidoPrecisaConferencia, metricas, vendasPorDia, produtosMaisVendidos, validarReservaParaAprovacao,
} from '../lib/orders.js';
import { logAdmin, queryLogs } from '../lib/audit.js';
import { outbox } from '../lib/mailer.js';
import { getSetting, setSetting, patchSetting, getAllSettings } from '../lib/settings.js';
import { UFS, UF_LIST } from '../lib/cep.js';
import { linkWhatsApp } from '../views/layout.js';
import { simulateApproval } from '../lib/payments/internal.js';
import { refundPayment, providerPublicInfo, enabledMethods } from '../lib/payments/index.js';
import { diagnosticoFinanceiro } from '../lib/payments/ops-health.js';
import { estadoCredenciaisMercadoPago, salvarCredenciaisMercadoPago, removerCredenciaisMercadoPago } from '../lib/payments/credentials.js';
import { toCents, formatBRL } from '../lib/format.js';
import { normalizeFreightConfig } from '../lib/freight.js';
import { revogarSessoes } from '../lib/session-revocation.js';
import { cadastrarVendedor, editarVendedor, metricasVendedores } from '../lib/sellers.js';
import { telaVendedores } from '../views/admin/sellers.js';
import { validarNovoCupom } from '../lib/coupon-validation.js';
import { pedidoOcultoDoCliente, ocultarPedidoDoCliente, restaurarPedidoAoCliente } from '../lib/order-visibility.js';

const CARTAO_403 = (req) => ({
  ok: false, erro: 'Seu perfil não tem permissão para esta ação.',
});

function guard(req, res, permission) {
  if (!req.adminUser) {
    res.redirect(`/admin/login?next=${encodeURIComponent(req.pathname)}`);
    return false;
  }
  if (!can(req.adminUser, permission)) {
    res.status(403).html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css?v=confirmacao-pix-20261021"></head>
      <body><div class="container mt-3"><div class="pagina-conteudo">
      <h1>403 — Sem permissão</h1>
      <p>Seu perfil (<strong>${e(ROLES[req.adminUser.role]?.nome || req.adminUser.role)}</strong>) não tem permissão para esta área.</p>
      <p><a class="botao" href="/admin">Voltar ao painel</a></p>
      </div></div></body></html>`);
    return false;
  }
  return true;
}

function guardApi(req, res, permission) {
  if (!req.adminUser) return res.json({ ok: false, erro: 'Não autenticado.' }, 401), false;
  if (!can(req.adminUser, permission)) return res.json(CARTAO_403(req), 403), false;
  return true;
}

function ctxAdmin(req, db) {
  const settings = getAllSettings(db);
  return {
    req, db, settings,
    adminUser: req.adminUser,
    csrf: csrfToken(req),
    podeAprovar: can(req.adminUser, 'produtos.aprovar') || can(req.adminUser, 'sanitario.*'),
    permissoes: {
      podeGerenciarUsuarios: req.adminUser?.role === 'super_admin',
      podeEditarPedidos: can(req.adminUser, 'pedidos.editar'),
      podeOcultarPedidos: req.adminUser?.role === 'super_admin',
      podeEstornar: can(req.adminUser, 'pagamentos.estornar'),
      podeSimularPagamento: can(req.adminUser, 'pagamentos.estornar') || req.adminUser?.role === 'super_admin',
      podeEditarVendedores: can(req.adminUser, 'vendedores.editar'),
    },
  };
}

export function registrarRotasAdmin(app, db) {
  /* ============================ AUTENTICAÇÃO ============================ */
  app.get('/admin', (req, res) => {
    if (!req.adminUser) return void res.redirect('/admin/login');
    if (!guard(req, res, 'dashboard.ver')) return;
    const ctx = ctxAdmin(req, db);
    // Atendentes e operadores podem abrir o painel, mas não têm
    // permissão para acessar faturamento, ticket médio ou rankings.
    // Entregue apenas atalhos das áreas autorizadas, sem carregar métricas.
    if (!can(req.adminUser, 'relatorios.ver')) {
      const atalhos = [
        ['pedidos.ver', '/admin/pedidos', 'Pedidos'],
        ['clientes.ver', '/admin/clientes', 'Clientes'],
        ['produtos.ver', '/admin/produtos', 'Produtos'],
        ['estoque.ver', '/admin/estoque', 'Estoque'],
        ['paginas.ver', '/admin/paginas', 'Páginas'],
      ].filter(([permissao]) => can(req.adminUser, permissao));
      return void res.html(paginaAdmin(ctx, {
        titulo: 'Painel', ativo: 'dashboard',
        conteudo: `<h1>Painel da loja</h1>
          <p>Selecione uma área disponível para o seu perfil.</p>
          <div class="linha" style="gap:12px;flex-wrap:wrap">
          ${atalhos.map(([, url, nome]) =>
            `<a class="botao secundario" href="${url}">${nome}</a>`).join('')}
          </div>`,
      }));
    }
    const agora = new Date();
    const de = new Date(agora.getTime() - 30 * 86400000).toISOString();
    const m = metricas(db, { de });
    res.html(telaDashboard(ctx, {
      metricas: m,
      grafico: vendasPorDia(db, 30),
      pedidosRecentes: db.collection('orders').all().sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 8),
      estoqueBaixo: db.collection('products').all().filter((p) => Number(p.estoque?.quantidade || 0) <= Number(p.estoque?.minimo || 0)).slice(0, 10),
      topProdutos: produtosMaisVendidos(db, 8),
      infoPagamento: providerPublicInfo(db),
    }));
  });

  app.get('/admin/login', (req, res) => {
    if (req.adminUser) return void res.redirect('/admin');
    const loginLogoUrl = getAllSettings(db).tema?.logoUrl || '';
    res.html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Painel — Farmácia Pague Pouco</title><link rel="stylesheet" href="/styles.css?v=confirmacao-pix-20261021">
      <link rel="icon" type="image/svg+xml" href="/img/favicon.svg?v=20261021-vermelho"></head>
      <body style="background:var(--fundo);display:flex;align-items:center;justify-content:center;min-height:100vh">
      <div style="width:100%;max-width:420px;padding:14px">
        <div class="pagina-conteudo">
          ${loginLogoUrl ? `<img src="${e(loginLogoUrl)}" alt="Farmácia Pague Pouco" style="max-width:100%;width:320px;max-height:90px;object-fit:contain;margin:0 auto 18px">` : ''}
          <h1 class="texto-centro">Painel administrativo</h1>
          <p class="texto-centro texto-pequeno texto-suave">Farmácia Pague Pouco</p>
          ${req.query.get('erro') ? `<div class="alerta erro">${e(req.query.get('erro'))}</div>` : ''}
          <form method="post" action="/admin/login">
            <input type="hidden" name="_csrf" value="${e(csrfToken(req))}">
            <input type="hidden" name="next" value="${e(req.query.get('next') || '')}">
            <div class="campo"><label for="email">E-mail</label>
              <input type="email" id="email" name="email" required autofocus autocomplete="username"></div>
            <div class="campo"><label for="senha">Senha</label>
              <input type="password" id="senha" name="senha" required autocomplete="current-password"></div>
            <button class="botao bloquinho destaque" type="submit">Entrar</button>
          </form>
          <p class="texto-pequeno texto-suave mb-0 mt-2 texto-centro">Acesso restrito. As tentativas são registradas na auditoria.</p>
        </div>
      </div></body></html>`);
  });

  app.post('/admin/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    const admin = db.collection('admins').findOne((a) => String(a.email || '').toLowerCase() === email);
    if (!admin || !verifyPassword(senha, admin.senhaHash) || admin.ativo === false) {
      logAdmin(db, admin || { id: null, nome: 'desconhecido', role: 'publico' }, 'login_admin_falha', 'admin', admin?.id || null, { email }, req);
      return void res.redirect('/admin/login?erro=' + encodeURIComponent('E-mail ou senha incorretos, ou usuário inativo.'));
    }
    const sessionId = createSession(db, 'admin', admin.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    db.collection('admins').update(admin.id, { ultimoAcesso: new Date().toISOString() });
    logAdmin(db, admin, 'login_admin', 'admin', admin.id, {}, req);
    res.cookie('pp_admin_sess', sessionId, { maxAge: config.adminSessionTTLHours * 3600, path: '/' });
    const next = String(req.body.next || '/admin');
    // Senha provisória é uma barreira de autenticação: nunca use next para
    // contorná-la, mesmo se o link for uma rota interna do painel.
    if (admin.deveTrocarSenha === true) return void res.redirect('/admin/alterar-senha');
    // Apenas caminhos internos do painel; evita open redirect e "/admin.evil".
    res.redirect(/^\/admin(?:\/|\?|$)/.test(next) && !next.startsWith('//') &&
      !/[\\\r\n]/.test(next) ? next : '/admin');
  });

  app.get('/admin/sair', (req, res) => {
    if (req.adminSession) {
      logAdmin(db, req.adminUser, 'logout_admin', 'admin', req.adminUser?.id, {}, req);
      destroySession(db, req.adminSession.id);
    }
    res.clearCookie('pp_admin_sess');
    res.redirect('/admin/login');
  });

  /* =================== TROCA OBRIGATÓRIA DE SENHA ==================== */
  app.get('/admin/alterar-senha', (req, res) => {
    if (!req.adminUser || !req.adminSession) return void res.redirect('/admin/login');
    const obrigatoria = req.adminUser.deveTrocarSenha === true;
    res.set('Cache-Control', 'no-store');
    res.html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Alterar senha — Farmácia Pague Pouco</title>
      <link rel="stylesheet" href="/styles.css?v=confirmacao-pix-20261021">
      <link rel="icon" type="image/svg+xml" href="/img/favicon.svg?v=20261021-vermelho"></head>
      <body style="background:var(--fundo);display:flex;align-items:center;justify-content:center;min-height:100vh">
      <main class="pagina-conteudo" style="max-width:480px;width:100%">
        <h1>${obrigatoria ? 'Troca de senha obrigatória' : 'Alterar minha senha'}</h1>
        <p>${obrigatoria ? 'Sua senha é provisória. Defina uma senha pessoal antes de acessar o painel.'
          : 'Para continuar com segurança, confirme a senha atual.'}</p>
        <form method="post" action="/admin/alterar-senha">
          <input type="hidden" name="_csrf" value="${e(csrfToken(req))}">
          <div class="campo"><label for="senhaAtual">Senha atual</label>
            <input type="password" id="senhaAtual" name="senhaAtual" required autocomplete="current-password"></div>
          <div class="campo"><label for="senhaNova">Nova senha (12+ caracteres, letras e números)</label>
            <input type="password" id="senhaNova" name="senhaNova" minlength="12" required autocomplete="new-password"></div>
          <div class="campo"><label for="senha2">Confirme a nova senha</label>
            <input type="password" id="senha2" name="senha2" minlength="12" required autocomplete="new-password"></div>
          <button class="botao destaque" type="submit">Salvar nova senha</button>
          <a class="botao secundario" href="/admin/sair">Sair</a>
        </form>
      </main></body></html>`);
  });

  app.post('/admin/alterar-senha', (req, res) => {
    if (!req.adminUser || !req.adminSession) return void res.redirect('/admin/login');
    const antiga = String(req.body.senhaAtual || '');
    const nova = String(req.body.senhaNova || '');
    const confirmar = String(req.body.senha2 || '');
    if (!verifyPassword(antiga, req.adminUser.senhaHash)) {
      return void res.html('<h1>Senha atual incorreta.</h1><a href="/admin/alterar-senha">Tentar novamente</a>', 400);
    }
    if (nova.length < 12 || !/[A-Za-z]/.test(nova) || !/\d/.test(nova) ||
        nova !== confirmar || verifyPassword(nova, req.adminUser.senhaHash)) {
      return void res.html('<h1>Nova senha inválida, repetida ou diferente da confirmação.</h1><a href="/admin/alterar-senha">Tentar novamente</a>', 400);
    }
    db.collection('admins').update(req.adminUser.id, {
      senhaHash: hashPassword(nova), deveTrocarSenha: false,
      senhaAlteradaEm: new Date().toISOString(),
    });
    revogarSessoes(db, 'admin', req.adminUser.id, { preservar: req.adminSession.id });
    logAdmin(db, req.adminUser, 'alterou_propria_senha', 'admin', req.adminUser.id, {}, req);
    res.redirect('/admin');
  });

  /* ============================== PRODUTOS ============================== */
  app.get('/admin/produtos', (req, res) => {
    if (!guard(req, res, 'produtos.ver')) return;
    const ctx = ctxAdmin(req, db);
    const busca = String(req.query.get('q') || '').trim();
    const categoria = req.query.get('categoria') || '';
    const status = req.query.get('status') || '';
    const pagina = Number(req.query.get('pagina')) || 1;
    const porPagina = 25;
    let todos = db.collection('products').all();
    if (busca) {
      const b = busca.toLowerCase();
      todos = todos.filter((p) => [p.nome, p.sku, p.ean, p.marca, p.codigoInterno].some((f) => String(f || '').toLowerCase().includes(b)));
    }
    if (categoria) todos = todos.filter((p) => p.categoriaId === categoria || p.subcategoriaId === categoria);
    if (status === 'ativo') todos = todos.filter((p) => p.ativo);
    if (status === 'inativo') todos = todos.filter((p) => !p.ativo);
    if (status === 'estoque_baixo') todos = todos.filter((p) => Number(p.estoque?.quantidade || 0) <= Number(p.estoque?.minimo || 0));
    if (status === 'bloqueado') todos = todos.filter((p) => p.ativo && !podeVender(p).ok);
    todos.sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')));
    const total = todos.length;
    const produtos = todos.slice((pagina - 1) * porPagina, pagina * porPagina);
    res.html(telaProdutos(ctx, { produtos, total, pagina, porPagina, busca, categorias: db.collection('categories').all().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')), filtros: { categoria, status } }));
  });

  app.get('/admin/produtos/novo', (req, res) => {
    if (!guard(req, res, 'produtos.criar')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaProdutoForm(ctx, {
      categorias: db.collection('categories').all().sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999)),
      marcas: marcasDisponiveis(db),
      todasMidia: db.collection('midia').all().slice(0, 60),
    }));
  });

  app.get('/admin/produtos/importar', (req, res) => {
    if (!guard(req, res, 'produtos.criar')) return;
    res.html(telaImportar(ctxAdmin(req, db)));
  });

  // Revisão do catálogo recebido da InovaFarma. Permissão exclusiva de Super
  // Administrador: todos os demais perfis são bloqueados NO SERVIDOR.
  // Esta página não contata o ERP e não aciona publicações automáticas.
  app.get('/admin/produtos/inovafarma', (req, res) => {
    if (!guard(req, res, 'inovafarma.ver')) return;
    if (req.adminUser.role !== 'super_admin')
      return void res.status(403).html('403 — Somente Super Administrador pode revisar o catálogo InovaFarma.');
    const busca=String(req.query.get('q')||'').slice(0,100);
    const situacao=String(req.query.get('situacao')||'').slice(0,40);
    const saldo=req.query.get('saldo')==='todos'?'todos':'disponivel';
    const lista=listarCandidatosInova(db,{
      busca,situacao,saldo,pagina:req.query.get('pagina'),
    });
    res.set('Cache-Control','no-store');
    res.html(telaImportacaoCatalogoInova(ctxAdmin(req,db),{
      lista,busca,situacao,saldo,erro:req.query.get('erro')||'',
    }));
  });

  app.post('/admin/produtos/inovafarma/revisar', { maxBodyBytes: 6 * 1024 }, (req, res) => {
    if (!guard(req, res, 'inovafarma.ver')) return;
    if (req.adminUser.role !== 'super_admin')
      return void res.status(403).html('403 — Sem autorização para importar produtos.');
    const eansRaw=req.body['eans[]'];
    const eans=Array.isArray(eansRaw)?eansRaw:eansRaw?[eansRaw]:[];
    const acao=String(req.body.acao||'');
    if (!['importar','ignorar'].includes(acao) || eans.length===0 || eans.length>50 ||
        eans.some(e => !/^[0-9]{8,14}$/.test(String(e))) ||
        new Set(eans).size !== eans.length)
      return void res.status(400).html('Seleção inválida. Escolha de 1 a 50 EANs distintos.');
    const resultados=[];
    for(const ean of eans) {
      const r=revisarCandidatoInova(db,String(ean),acao);
      resultados.push(r);
    }
    const ok=resultados.filter(r=>r.ok).length;
    const erros=resultados.length-ok;
    logAdmin(db,req.adminUser,'revisou_catalogo_inova','integracao','inovafarma',
      {acao,quantidade:ok,erros},req);
    res.redirect('/admin/produtos/inovafarma?resultado='+ok+
      (erros?'&erro='+encodeURIComponent(erros+' produto(s) não puderam ser revisados.'):''));
  });

  app.get('/admin/produtos/:id', (req, res) => {
    if (!guard(req, res, 'produtos.ver')) return;
    const ctx = ctxAdmin(req, db);
    const produto = db.collection('products').get(req.params.id);
    if (!produto) return void res.redirect('/admin/produtos');
    res.html(telaProdutoForm(ctx, {
      produto,
      categorias: db.collection('categories').all().sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999)),
      marcas: marcasDisponiveis(db),
      todasMidia: db.collection('midia').all().slice(0, 60),
    }));
  });

  /* ============================= CATEGORIAS ============================= */
  app.get('/admin/categorias', (req, res) => {
    if (!guard(req, res, 'categorias.ver')) return;
    res.html(telaCategorias(ctxAdmin(req, db), { arvore: montarArvore(db) }));
  });

  /* =============================== ESTOQUE ============================== */
  app.get('/admin/estoque', (req, res) => {
    if (!guard(req, res, 'estoque.ver')) return;
    const ctx = ctxAdmin(req, db);
    const produtos = db.collection('products').all().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const movimentacoes = db.collection('stockMovements')
      .all()
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .slice(0, 60);
    res.html(telaEstoque(ctx, {
      produtos,
      movimentacoes,
      alertas: produtos.filter((p) => Number(p.estoque?.quantidade || 0) <= Number(p.estoque?.minimo || 0)),
    }));
  });

  /* ================================ MÍDIA =============================== */
  app.get('/admin/midia', (req, res) => {
    if (!guard(req, res, 'midia.ver')) return;
    const ctx = ctxAdmin(req, db);
    const filtro = req.query.get('tipo') || '';
    let arquivos = db.collection('midia').all().sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
    if (filtro) arquivos = arquivos.filter((m) => m.tipo === filtro);
    res.html(telaMidia(ctx, { arquivos, stats: uploadStats(db), filtro }));
  });

  /* ============================== BANNERS =============================== */
  app.get('/admin/banners', (req, res) => {
    if (!guard(req, res, 'banners.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaBanners(ctx, {
      banners: db.collection('banners').all().sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99)),
      editando: can(req.adminUser, 'banners.editar') ? db.collection('banners').get(String(req.query.get('editar') || '')) : null,
      midias: db.collection('midia').all().filter((m) => m.tipo === 'image').slice(0, 40),
      categorias: db.collection('categories').all().sort((a,b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    }));
  });

  /* ============================= PROMOÇÕES ============================== */
  app.get('/admin/promocoes', (req, res) => {
    if (!guard(req, res, 'promocoes.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaPromocoes(ctx, {
      cupons: db.collection('coupons').all().sort((a, b) => String(a.codigo).localeCompare(String(b.codigo))),
      categorias: db.collection('categories').all(),
    }));
  });

  /* ======================== INTEGRAÇÃO INOVAFARMA ======================= */
  app.get('/admin/inovafarma', (req, res) => {
    if (!guard(req, res, 'inovafarma.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.set('Cache-Control', 'no-store');
    res.html(telaIntegracaoInova(ctx, {
      dados: diagnosticoInova(db),
      erro: req.query.get('erro') || '',
      salvo: req.query.get('salvo') || '',
    }));
  });

  const guardInovaSuper = (req, res) => {
    if (!req.adminUser) return void res.redirect('/admin/login'), false;
    if (req.adminUser.role !== 'super_admin') {
      res.status(403).html('403 — Somente Super Administrador pode alterar a integração InovaFarma.');
      return false;
    }
    return true;
  };
  const falhaInova = (res, msg) => res.redirect('/admin/inovafarma?erro=' + encodeURIComponent(msg));
  app.post('/admin/inovafarma/configuracao', (req, res) => {
    if (!guardInovaSuper(req, res)) return;
    const r = salvarConfiguracaoInova(db, {
      urlConector: req.body.urlConector,
      estabelecimento: req.body.estabelecimento,
      intervaloMinutos: req.body.intervaloMinutos,
    });
    if (!r.ok) return void falhaInova(res, r.erro);
    logAdmin(db, req.adminUser, 'salvou_configuracao_inova', 'integracao', 'inovafarma',
      { status: 'aguardando_homologacao' }, req);
    res.redirect('/admin/inovafarma?salvo=1');
  });
  app.post('/admin/inovafarma/credencial', { maxBodyBytes: 5 * 1024 }, (req, res) => {
    if (!guardInovaSuper(req, res)) return;
    const r = armazenarCredencialInova(db, req.body.credencial);
    if (!r.ok) return void falhaInova(res, r.erro);
    // O conteúdo e o tamanho da credencial jamais entram em auditoria.
    logAdmin(db, req.adminUser, 'salvou_credencial_inova', 'integracao', 'inovafarma', {}, req);
    res.redirect('/admin/inovafarma?salvo=credencial');
  });
  app.post('/admin/inovafarma/credencial/remover', (req, res) => {
    if (!guardInovaSuper(req, res)) return;
    apagarCredencialInova(db);
    logAdmin(db, req.adminUser, 'removeu_credencial_inova', 'integracao', 'inovafarma', {}, req);
    res.redirect('/admin/inovafarma?salvo=remocao');
  });

  /* ============================== VENDEDORES ============================ */
  app.get('/admin/vendedores', (req, res) => {
    if (!guard(req, res, 'vendedores.ver')) return;
    const q = String(req.query.get('q') || '').slice(0,120).trim().toLowerCase();
    const situacao = String(req.query.get('situacao') || '');
    const todos = db.collection('sellers').all();
    const vendedores = todos.filter(v =>
      (!q || String(v.nome).toLowerCase().includes(q) ||
        String(v.codigoInova).toLowerCase().includes(q)) &&
      (!['ativo', 'inativo'].includes(situacao) ||
        v.ativo === (situacao === 'ativo')))
      .sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const editId = req.query.get('editar');
    const editando = can(req.adminUser, 'vendedores.editar') && editId
      ? db.collection('sellers').get(editId) : null;
    res.set('Cache-Control', 'no-store');
    res.html(telaVendedores(ctxAdmin(req, db), {
      vendedores, editando, filtros: { q, situacao },
      metricas: metricasVendedores(db),
      erro: req.query.get('erro') || '', salvo: req.query.get('salvo') || '',
    }));
  });
  const erroVendedor = (res, msg) => res.redirect('/admin/vendedores?erro=' + encodeURIComponent(msg) + '#cadastro');

  app.post('/admin/vendedores', (req, res) => {
    if (!guard(req, res, 'vendedores.editar')) return;
    const resultado = cadastrarVendedor(db, {
      nome: req.body.nome, codigoInova: req.body.codigoInova, ativo: req.body.ativo === '1',
    });
    if (!resultado.ok) return void erroVendedor(res, resultado.erro);
    logAdmin(db, req.adminUser, 'criou_vendedor', 'vendedor', resultado.vendedor.id,
      { nome: resultado.vendedor.nome, codigoInova: resultado.vendedor.codigoInova }, req);
    res.redirect('/admin/vendedores?salvo=1');
  });

  app.post('/admin/vendedores/:id', (req, res) => {
    if (!guard(req, res, 'vendedores.editar')) return;
    const anterior = db.collection('sellers').get(req.params.id);
    if (!anterior) return void res.status(404).html('Vendedor não encontrado.');
    const resultado = editarVendedor(db, anterior.id, {
      nome: req.body.nome, codigoInova: req.body.codigoInova, ativo: req.body.ativo === '1',
    });
    if (!resultado.ok) return void erroVendedor(res, resultado.erro);
    logAdmin(db, req.adminUser, 'editou_vendedor', 'vendedor', anterior.id, {
      antes: { nome: anterior.nome, codigoInova: anterior.codigoInova, ativo: anterior.ativo },
      depois: { nome: resultado.vendedor.nome, codigoInova: resultado.vendedor.codigoInova, ativo: resultado.vendedor.ativo },
    }, req);
    res.redirect('/admin/vendedores?salvo=1');
  });

  app.post('/admin/vendedores/:id/situacao', (req, res) => {
    if (!guard(req, res, 'vendedores.editar')) return;
    const anterior = db.collection('sellers').get(req.params.id);
    if (!anterior) return void res.status(404).html('Vendedor não encontrado.');
    if (!['0','1'].includes(String(req.body.ativo))) {
      return void res.status(400).html('Situação inválida.');
    }
    const ativo = req.body.ativo === '1';
    if (anterior.ativo !== ativo) {
      db.collection('sellers').update(anterior.id, { ativo, atualizadoEm: new Date().toISOString() });
      logAdmin(db, req.adminUser, ativo ? 'ativou_vendedor' : 'desativou_vendedor',
        'vendedor', anterior.id, { nome: anterior.nome, codigoInova: anterior.codigoInova }, req);
    }
    res.redirect('/admin/vendedores?salvo=1');
  });

  /* =============================== PEDIDOS ============================== */
  app.get('/admin/pedidos', (req, res) => {
    if (!guard(req, res, 'pedidos.ver')) return;
    const ctx = ctxAdmin(req, db);
    const filtros = {
      q: req.query.get('q') || '',
      financeiro: req.query.get('financeiro') || '',
      operacional: req.query.get('operacional') || '',
      periodo: req.query.get('periodo') || '',
      pendencia: req.query.get('pendencia') === '1' ? '1' : '',
      vendedor: req.query.get('vendedor') || '',
      visibilidade: req.adminUser.role === 'super_admin' && req.query.get('visibilidade') === 'ocultos'
        ? 'ocultos' : 'visiveis',
    };
    let pedidos = db.collection('orders').all();
    const totalOcultos = pedidos.filter(pedidoOcultoDoCliente).length;
    pedidos = pedidos.filter(p => filtros.visibilidade === 'ocultos'
      ? pedidoOcultoDoCliente(p) : !pedidoOcultoDoCliente(p));
    if (filtros.q) {
      const b = String(filtros.q).toLowerCase();
      pedidos = pedidos.filter((p) => [p.codigo, p.cliente?.nome, p.cliente?.email, p.cliente?.cpf].some((f) => String(f || '').toLowerCase().includes(b)));
    }
    if (filtros.vendedor) pedidos = pedidos.filter((p) => p.vendedor?.id === filtros.vendedor);
    if (filtros.financeiro) pedidos = pedidos.filter((p) => p.statusFinanceiro === filtros.financeiro);
    if (filtros.operacional) pedidos = pedidos.filter((p) => p.statusOperacional === filtros.operacional);
    if (filtros.pendencia) pedidos = pedidos.filter(pedidoPrecisaConferencia);
    if (filtros.periodo) {
      const dias = filtros.periodo === 'hoje' ? 1 : Number(filtros.periodo);
      const limite = new Date(Date.now() - (dias - 1) * 86400000).toISOString().slice(0, 10);
      pedidos = pedidos.filter((p) => String(p.criadoEm).slice(0, 10) >= limite);
    }
    pedidos.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
    const total = pedidos.length;
    const pagina = Number(req.query.get('pagina')) || 1;
    const porPagina = 25;
    res.html(telaPedidos(ctx, { pedidos: pedidos.slice((pagina - 1) * porPagina, pagina * porPagina), total, pagina, porPagina, filtros, totalOcultos, aviso: req.query.get('aviso') || '', vendedores: db.collection('sellers').all() }));
  });

  // Exclusão apenas visual e reversível. Histórico e relatórios financeiros
  // continuam contendo todos os pedidos originais no banco.
  app.post('/admin/pedidos/:id/ocultar', (req, res) => {
    if (!req.adminUser) return void res.redirect('/admin/login');
    if (req.adminUser.role !== 'super_admin')
      return void res.status(403).html('403 — Somente o Super Administrador pode ocultar pedidos.');
    const resultado = ocultarPedidoDoCliente(db, req.params.id, { por: req.adminUser.id });
    if (!resultado.ok) return void res.redirect('/admin/pedidos?aviso=' + encodeURIComponent(resultado.erro));
    logAdmin(db, req.adminUser, 'ocultou_pedido_do_cliente', 'pedido', resultado.pedido.id,
      { codigo: resultado.pedido.codigo, visibilidade: 'oculto' }, req);
    res.redirect('/admin/pedidos?aviso=' + encodeURIComponent('Pedido ocultado da conta do cliente; histórico preservado.'));
  });

  app.post('/admin/pedidos/:id/restaurar', (req, res) => {
    if (!req.adminUser) return void res.redirect('/admin/login');
    if (req.adminUser.role !== 'super_admin')
      return void res.status(403).html('403 — Somente o Super Administrador pode restaurar pedidos.');
    const resultado = restaurarPedidoAoCliente(db, req.params.id);
    if (!resultado.ok) return void res.redirect('/admin/pedidos?visibilidade=ocultos&aviso=' + encodeURIComponent(resultado.erro));
    logAdmin(db, req.adminUser, 'restaurou_pedido_ao_cliente', 'pedido', resultado.pedido.id,
      { codigo: resultado.pedido.codigo, visibilidade: 'visivel' }, req);
    res.redirect('/admin/pedidos?visibilidade=ocultos&aviso=' + encodeURIComponent('Pedido restaurado para a conta do cliente.'));
  });

  app.get('/admin/pedidos/:id', (req, res) => {
    if (!guard(req, res, 'pedidos.ver')) return;
    const ctx = ctxAdmin(req, db);
    const pedido = db.collection('orders').get(req.params.id);
    if (!pedido) return void res.redirect('/admin/pedidos');
    res.html(telaPedido(ctx, {
      pedido,
      pagamento: pedido.pagamentoId ? db.collection('payments').get(pedido.pagamentoId) : null,
      eventos: [],
    }));
  });

  /* ============================== CLIENTES ============================== */
  app.get('/admin/clientes', (req, res) => {
    if (!guard(req, res, 'clientes.ver')) return;
    const ctx = ctxAdmin(req, db);
    const busca = String(req.query.get('q') || '').trim().toLowerCase();
    let clientes = db.collection('customers').all();
    if (busca) clientes = clientes.filter((c) => [c.nome, c.email, c.cpf, c.telefone].some((f) => String(f || '').toLowerCase().includes(busca)));
    clientes.sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
    const pagina = Number(req.query.get('pagina')) || 1;
    const porPagina = 25;
    res.html(telaClientes(ctx, { clientes: clientes.slice((pagina - 1) * porPagina, pagina * porPagina), total: clientes.length, pagina, porPagina, busca: req.query.get('q') || '' }));
  });

  app.get('/admin/clientes/:id', (req, res) => {
    if (!guard(req, res, 'clientes.ver')) return;
    const ctx = ctxAdmin(req, db);
    const cliente = db.collection('customers').get(req.params.id);
    if (!cliente) return void res.redirect('/admin/clientes');
    res.html(telaCliente(ctx, {
      cliente,
      pedidos: db.collection('orders').find((o) => o.clienteId === cliente.id).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))),
      enderecos: cliente.enderecos || [],
    }));
  });

  /* ============================= PAGAMENTOS ============================= */
  app.get('/admin/pagamentos', (req, res) => {
    if (!guard(req, res, 'pagamentos.ver')) return;
    const ctx = ctxAdmin(req, db);
    const pagamentos = db.collection('payments').all().sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 100);
    const aprovados = pagamentos.filter((p) => p.status === 'approved');
    res.set('Cache-Control', 'no-store');
    res.html(telaPagamentosAdmin(ctx, {
      pagamentos,
      provedor: providerPublicInfo(db),
      configPag: ctx.settings.pagamentos || {},
      credenciais: req.adminUser.role === 'super_admin' ? estadoCredenciaisMercadoPago(db) : null,
      urlWebhook: `${config.publicBaseUrl}/webhooks/mercadopago`,
      falhas: req.adminUser.role === 'super_admin'
        ? db.collection('orders').all().filter((p) => p.falhaPagamento ||
          p.historico?.some((h) => h.status === 'cancelado' &&
            String(h.obs || '').includes('Cobrança recusada ou integração não configurada')))
          .sort((a,b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 10)
        : [],
      metricas: {
        total: pagamentos.length,
        aprovadas: aprovados.length,
        pendentes: pagamentos.filter((p) => p.status === 'pending').length,
        valorAprovado: aprovados.reduce((a, p) => a + Number(p.valorCentavos || 0), 0),
      },
    }));
  });

  /* ============================= RELATÓRIOS ============================= */
  app.get('/admin/relatorios', (req, res) => {
    if (!guard(req, res, 'relatorios.ver')) return;
    const ctx = ctxAdmin(req, db);
    const hoje = new Date().toISOString().slice(0, 10);
    const trinta = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const de = req.query.get('de') || trinta;
    const ate = req.query.get('ate') || hoje;
    const pedidos = db.collection('orders').all().filter((o) => String(o.criadoEm).slice(0, 10) >= de && String(o.criadoEm).slice(0, 10) <= ate);
    const pagos = pedidos.filter((o) => o.statusFinanceiro === 'aprovado');
    const porEstadoMap = new Map();
    const porCatMap = new Map();
    for (const o of pagos) {
      const uf = o.endereco?.uf || '—';
      const atual = porEstadoMap.get(uf) || { uf, pedidos: 0, receitaCentavos: 0 };
      atual.pedidos++;
      atual.receitaCentavos += Number(o.totalCentavos || 0);
      porEstadoMap.set(uf, atual);
      for (const it of o.itens || []) {
        const cat = db.collection('categories').get(it.categoriaId);
        const nome = cat?.nome || 'Sem categoria';
        const c = porCatMap.get(nome) || { nome, quantidade: 0, receitaCentavos: 0 };
        c.quantidade += it.quantidade;
        c.receitaCentavos += it.subtotalCentavos;
        porCatMap.set(nome, c);
      }
    }
    const inicioMs = Date.parse(de + 'T00:00:00.000Z');
    const fimMs = Date.parse(ate + 'T00:00:00.000Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) ||
        !Number.isFinite(inicioMs) || !Number.isFinite(fimMs) || inicioMs > fimMs ||
        fimMs - inicioMs > 366 * 86400000) {
      return void res.html('<h1>Período inválido</h1><p>Escolha datas válidas em um intervalo de até 366 dias.</p><a href="/admin/relatorios">Voltar aos relatórios</a>', 400);
    }
    const diasPeriodo = Math.round((fimMs - inicioMs) / 86400000) + 1;
    const dias = vendasPorDia(db, diasPeriodo, new Date(fimMs));
    res.html(telaRelatorios(ctx, {
      metricas: metricas(db, { de: `${de}T00:00:00.000Z`, ate: `${ate}T23:59:59.999Z` }),
      grafico: dias,
      topProdutos: produtosMaisVendidos(db, 10, { de, ate }),
      porEstado: Array.from(porEstadoMap.values()).sort((a, b) => b.receitaCentavos - a.receitaCentavos),
      porCategoria: Array.from(porCatMap.values()).sort((a, b) => b.receitaCentavos - a.receitaCentavos),
      periodo: { de, ate },
    }));
  });

  /* =============================== FRETES =============================== */
  app.get('/admin/fretes', (req, res) => {
    if (!guard(req, res, 'fretes.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaFretes(ctx, {
      frete: normalizeFreightConfig(ctx.settings.frete),
      categorias: db.collection('categories').all(),
      produtos: db.collection('products').all(),
    }));
  });

  /* ============================== WHATSAPP ============================== */
  app.get('/admin/whatsapp', (req, res) => {
    if (!guard(req, res, 'whatsapp.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaWhatsApp(ctx, { whatsapp: ctx.settings.whatsapp || {}, linkExemplo: linkWhatsApp(ctx.settings.whatsapp) }));
  });

  /* =========================== CONFIGURAÇÕES ============================ */
  app.get('/admin/configuracoes', (req, res) => {
    if (!guard(req, res, 'configuracoes.ver')) return;
    res.html(telaConfiguracoes(ctxAdmin(req, db), { settings: getAllSettings(db) }));
  });

  /* ======================= EDITOR VISUAL (APARÊNCIA) ==================== */
  app.get('/admin/aparencia', (req, res) => {
    if (!guard(req, res, 'configuracoes.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaAparencia(ctx, {
      secoes: (ctx.settings.home?.secoes || []).slice().sort((a, b) => a.ordem - b.ordem),
      vitrines: db.collection('showcases').all().sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99)),
      categorias: db.collection('categories').all().filter((c) => !c.paiId),
      marcas: marcasDisponiveis(db),
    }));
  });

  /* =============================== PÁGINAS ============================== */
  app.get('/admin/paginas', (req, res) => {
    if (!guard(req, res, 'paginas.ver')) return;
    res.html(telaPaginas(ctxAdmin(req, db), {
      paginas: db.collection('pages').all().sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), 'pt-BR')),
    }));
  });

  app.get('/admin/paginas/nova', (req, res) => {
    if (!guard(req, res, 'paginas.criar')) return;
    res.html(telaPaginaForm(ctxAdmin(req, db), {}));
  });

  app.get('/admin/paginas/:slug', (req, res) => {
    if (!guard(req, res, 'paginas.ver')) return;
    const pagina = db.collection('pages').findOne((p) => p.slug === req.params.slug);
    if (!pagina) return void res.redirect('/admin/paginas');
    res.html(telaPaginaForm(ctxAdmin(req, db), { pagina }));
  });

  /* ============================== USUÁRIOS ============================== */
  app.get('/admin/usuarios', (req, res) => {
    if (!guard(req, res, 'usuarios.ver')) return;
    const ctx = ctxAdmin(req, db);
    res.html(telaUsuarios(ctx, { usuarios: db.collection('admins').all().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')) }));
  });

  /* ============================== AUDITORIA ============================= */
  app.get('/admin/auditoria', (req, res) => {
    if (!guard(req, res, 'auditoria.ver')) return;
    const ctx = ctxAdmin(req, db);
    const filtros = { q: req.query.get('q') || '', tipo: req.query.get('tipo') || 'admin', acao: req.query.get('acao') || '' };
    res.html(telaAuditoria(ctx, { logs: queryLogs(db, filtros).slice(0, 200), filtros }));
  });

  /* =============================== SISTEMA ============================== */
  app.get('/admin/sistema', (req, res) => {
    // Sistema revela fila de e-mails, destinatários e opções de backup.
    // Somente superadministradores podem consultar esse conteúdo sensível.
    if (!guard(req, res, 'sistema.*')) return;
    const ctx = ctxAdmin(req, db);
    let backups = [];
    try {
      if (!config.isCloudflare) backups = fs.readdirSync(path.join(db.dataDir, 'backups')).sort().reverse();
    } catch { /* sem pasta */ }
    res.html(telaSistema(ctx, {
      emails: outbox(db, 40),
      logs: db.collection('systemLogs').all().sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 60),
      stats: {
        midia: uploadStats(db),
        pedidos: db.collection('orders').count(),
        produtos: db.collection('products').count(),
        logs: db.collection('systemLogs').count(),
        emails: db.collection('mailOutbox').count(),
        backups,
        conciliacaoFinanceira: diagnosticoFinanceiro(db),
        backupMidias: config.isCloudflare && typeof db.exportMediaManifest === 'function'
          ? db.exportMediaManifest() : null,
      },
      versao: { node: process.version, app: '1.0.0' },
    }));
  });

  registrarApi(app, db);
}

/* ====================================================================== */
/*                                  API                                    */
/* ====================================================================== */
function registrarApi(app, db) {
  const admin = reqAdmin();

  /* --------------------------- UPLOAD DE MÍDIA -------------------------- */
  app.post('/admin/api/upload', async (req, res) => {
    if (!guardApi(req, res, 'midia.criar')) return;
    if (!req.files || !req.files.length) return void res.json({ ok: false, erro: 'Nenhum arquivo enviado.' }, 400);
    const resultados = [];
    for (const file of req.files.slice(0, 10)) {
      try {
        const ehVideo = /^video\//.test(file.contentType);
        const registro = await saveUpload(db, file, {
          kind: ehVideo ? 'video' : (/pdf/.test(file.contentType) ? 'doc' : 'image'),
          userId: req.adminUser.id,
          userType: 'admin',
        });
        resultados.push({ ok: true, arquivo: registro });
      } catch (err) {
        resultados.push({ ok: false, nome: file.filename, erro: err.message });
      }
    }
    logAdmin(db, req.adminUser, 'upload_midia', 'midia', null, { quantidade: resultados.length }, req);
    res.json({ ok: true, arquivos: resultados });
  });

  /* ------------------------------ PRODUTOS ------------------------------ */
  const lerProdutoDoForm = (body) => {
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const imagens = arr(body['imagens[]']).map((url, i) => ({
      url,
      principal: i === 0,
      ordem: i + 1,
      legenda: (arr(body['imagemLegenda[]'])[i] || ''),
    }));
    const videos = arr(body['videos[]']).map((url, i) => ({ url, titulo: `Vídeo ${i + 1}` }));
    let caracteristicas = {};
    if (body.caracteristicas) {
      try {
        caracteristicas = typeof body.caracteristicas === 'string' ? JSON.parse(body.caracteristicas) : body.caracteristicas;
      } catch { caracteristicas = {}; }
    }
    const preco = toCents(body.preco || '0');
    const precoPromo = toCents(body.precoPromocional || '0');
    return {
      nome: cleanText(body.nome, 200),
      slug: slugify(body.nome),
      codigoInterno: cleanText(body.codigoInterno, 40),
      sku: cleanText(body.sku, 40),
      ean: cleanText(body.ean, 32),
      marca: cleanText(body.marca, 80),
      fabricante: cleanText(body.fabricante, 120),
      categoriaId: body.categoriaId || null,
      subcategoriaId: body.subcategoriaId || null,
      descricao: String(body.descricao || ''),
      caracteristicas,
      precoCentavos: preco,
      precoPromocionalCentavos: precoPromo > 0 && precoPromo < preco ? precoPromo : 0,
      peso: Number(body.peso) || 0,
      dimensoes: { largura: Number(body.largura) || 0, altura: Number(body.altura) || 0, comprimento: Number(body.comprimento) || 0 },
      imagens,
      videos,
      ativo: body.ativo === '1' || body.ativo === 'on' || body.ativo === true,
      destaque: body.destaque === '1' || body.destaque === 'on',
      sanitario: {
        classificacao: body.classificacao || 'nao_aplicavel',
        requerReceita: body.requerReceita === '1' || body.requerReceita === 'on',
        controlado: body.controlado === '1' || body.controlado === 'on',
        registroMS: cleanText(body.registroMS, 60),
        apresentacao: cleanText(body.apresentacao, 120),
        concentracao: cleanText(body.concentracao, 80),
        principioAtivo: cleanText(body.principioAtivo, 120),
        fabricante: cleanText(body.fabricante, 120),
        bulaUrl: cleanText(body.bulaUrl, 300),
        restricaoTransporte: body.restricaoTransporte === '1' || body.restricaoTransporte === 'on',
        restricaoAdvertencia: cleanText(body.restricaoAdvertencia, 300),
      },
    };
  };

  app.post('/admin/api/produtos', (req, res) => {
    if (!guardApi(req, res, 'produtos.criar')) return;
    if (!cleanText(req.body.nome, 200)) return void res.json({ ok: false, erro: 'Informe o nome do produto.' }, 400);
    const dados = lerProdutoDoForm(req.body);
    dados.slug = slugUnicoProduto(db, dados.nome);
    const quantidadeInicial = Math.max(0, Number(req.body.quantidade) || 0);
    if (inovaAtiva() && quantidadeInicial > 0) {
      return void res.json({ ok: false, erro: 'Estoque é controlado pela InovaFarma.' }, 409);
    }
    // Estoque inicia zerado; a movimentação abaixo faz a única entrada
    // e grava o histórico. Inicializar com quantidadeInicial duplicava o saldo.
    dados.estoque = { quantidade: 0, minimo: Number(req.body.estoqueMinimo) || 5, reservado: 0 };
    dados.vendas = 0;
    dados.relacionados = [];
    dados.criadoEm = new Date().toISOString();
    const produto = db.collection('products').insert(dados);
    if (quantidadeInicial > 0) {
      registrarMovimentoEstoque(db, {
        produtoId: produto.id, tipo: 'entrada', quantidade: quantidadeInicial,
        origem: 'cadastro_inicial', usuarioId: req.adminUser.id, observacao: 'Estoque inicial no cadastro',
      });
    }
    logAdmin(db, req.adminUser, 'criou_produto', 'produto', produto.id, { nome: produto.nome }, req);
    res.json({ ok: true, id: produto.id, url: `/admin/produtos/${produto.id}` });
  });

  app.post('/admin/api/produtos/:id', (req, res) => {
    if (!guardApi(req, res, 'produtos.editar')) return;
    const produto = db.collection('products').get(req.params.id);
    if (!produto) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    const dados = lerProdutoDoForm(req.body);
    dados.slug = produto.slug;
    if (dados.nome !== produto.nome) dados.slug = slugUnicoProduto(db, dados.nome, produto.id);
    const estoque = { ...(produto.estoque || {}) };
    const novaQtd = Number(req.body.quantidade);
    if (inovaAtiva() && Number.isFinite(novaQtd) && novaQtd !== Number(estoque.quantidade || 0)) {
      return void res.json({ ok: false, erro: 'Quantidade gerenciada pela InovaFarma: edite o estoque no ERP.' }, 409);
    }
    if (Number.isFinite(novaQtd) && novaQtd !== Number(estoque.quantidade || 0)) {
      registrarMovimentoEstoque(db, {
        produtoId: produto.id, tipo: 'ajuste', quantidade: novaQtd,
        origem: 'edicao_produto', usuarioId: req.adminUser.id,
        observacao: `Ajuste manual pelo painel (de ${estoque.quantidade || 0} para ${novaQtd})`,
      });
    }
    estoque.quantidade = Number.isFinite(novaQtd) ? novaQtd : Number(estoque.quantidade || 0);
    estoque.minimo = Number(req.body.estoqueMinimo) || Number(estoque.minimo || 0);
    dados.estoque = estoque;
    // Preserva a aprovação sanitária (apenas o responsável técnico altera)
    dados.sanitario = { ...(produto.sanitario || {}), ...dados.sanitario, aprovadoFarmaceutico: produto.sanitario?.aprovadoFarmaceutico || false, aprovadoPor: produto.sanitario?.aprovadoPor || '', aprovadoEm: produto.sanitario?.aprovadoEm || null };
    db.collection('products').update(produto.id, dados);
    logAdmin(db, req.adminUser, 'editou_produto', 'produto', produto.id, { nome: dados.nome }, req);
    res.json({ ok: true, id: produto.id });
  });

  app.post('/admin/api/produtos/:id/ativar', (req, res) => {
    if (!guardApi(req, res, 'produtos.editar')) return;
    const p = db.collection('products').get(req.params.id);
    if (!p) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    db.collection('products').update(p.id, { ativo: !p.ativo });
    logAdmin(db, req.adminUser, p.ativo ? 'desativou_produto' : 'ativou_produto', 'produto', p.id, { nome: p.nome }, req);
    res.json({ ok: true, ativo: !p.ativo });
  });

  app.post('/admin/api/produtos/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'produtos.excluir')) return;
    const p = db.collection('products').get(req.params.id);
    if (!p) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    const emPedidos = db.collection('orders').findOne((o) => (o.itens || []).some((i) => i.produtoId === p.id));
    if (emPedidos) {
      // Preserva o histórico: desativa em vez de apagar
      db.collection('products').update(p.id, { ativo: false });
      logAdmin(db, req.adminUser, 'desativou_produto_com_pedidos', 'produto', p.id, { nome: p.nome }, req);
      return void res.json({ ok: true, desativado: true, mensagem: 'Produto com pedidos vinculados foi desativado (o histórico é preservado).' });
    }
    db.collection('products').remove(p.id);
    logAdmin(db, req.adminUser, 'excluiu_produto', 'produto', p.id, { nome: p.nome }, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/produtos/:id/aprovar', (req, res) => {
    if (!guardApi(req, res, 'produtos.aprovar')) return;
    const p = db.collection('products').get(req.params.id);
    if (!p) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    const aprovar = String(req.body.status || '1') === '1';
    const sanitario = {
      ...(p.sanitario || {}),
      aprovadoFarmaceutico: aprovar,
      aprovadoPor: aprovar ? `${req.adminUser.nome}${req.adminUser.crf ? ` — CRF ${req.adminUser.crf}` : ''}` : '',
      aprovadoEm: aprovar ? new Date().toISOString() : null,
    };
    db.collection('products').update(p.id, { sanitario });
    logAdmin(db, req.adminUser, aprovar ? 'aprovou_produto_sanitario' : 'revogou_aprovacao_sanitaria', 'produto', p.id, { nome: p.nome }, req);
    res.json({ ok: true, aprovado: aprovar });
  });

  app.get('/admin/api/produtos/exportar.csv', (req, res) => {
    if (!req.adminUser || !can(req.adminUser, 'produtos.ver')) return void res.json({ ok: false, erro: 'Sem permissão.' }, 403);
    const linhas = [['nome', 'sku', 'ean', 'marca', 'fabricante', 'categoria', 'subcategoria', 'preco', 'precoPromocional', 'quantidade', 'estoqueMinimo', 'peso', 'ativo'].join(',')];
    for (const p of db.collection('products').all()) {
      const cat = db.collection('categories').get(p.categoriaId);
      const sub = db.collection('categories').get(p.subcategoriaId);
      linhas.push([
        csv(p.nome), csv(p.sku), csv(p.ean), csv(p.marca), csv(p.fabricante),
        csv(cat?.nome), csv(sub?.nome),
        (p.precoCentavos / 100).toFixed(2), (p.precoPromocionalCentavos / 100).toFixed(2),
        p.estoque?.quantidade ?? 0, p.estoque?.minimo ?? 0, p.peso ?? 0, p.ativo ? '1' : '0',
      ].join(','));
    }
    res.set('Content-Disposition', 'attachment; filename="produtos-pague-pouco.csv"');
    res.text(linhas.join('\n'), 200, 'text/csv; charset=utf-8');
  });

  app.post('/admin/api/produtos/importar', (req, res) => {
    if (!guardApi(req, res, 'produtos.criar')) return;
    const arquivo = (req.files || [])[0];
    if (!arquivo) return void res.json({ ok: false, erro: 'Envie um arquivo CSV.' }, 400);
    const texto = arquivo.data.toString('utf8');
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
    if (linhas.length < 2) return void res.json({ ok: false, erro: 'CSV sem dados.' }, 400);
    const cabecalho = linhas[0].split(/[,;]/).map((c) => c.trim().toLowerCase());
    let criados = 0, atualizados = 0, erros = 0;
    for (const linha of linhas.slice(1)) {
      try {
        const cols = linha.split(/[,;]/);
        const obj = {};
        cabecalho.forEach((c, i) => { obj[c] = (cols[i] || '').trim(); });
        if (!obj.nome) { erros++; continue; }
        const existente = obj.sku ? db.collection('products').findOne((p) => p.sku === obj.sku) : null;
        const cat = obj.categoria ? db.collection('categories').findOne((c) => c.nome.toLowerCase() === obj.categoria.toLowerCase()) : null;
        const sub = obj.subcategoria ? db.collection('categories').findOne((c) => c.nome.toLowerCase() === obj.subcategoria.toLowerCase()) : null;
        const dados = {
          nome: obj.nome,
          sku: obj.sku || '',
          ean: obj.ean || '',
          marca: obj.marca || '',
          fabricante: obj.fabricante || '',
          categoriaId: cat?.id || null,
          subcategoriaId: sub?.id || null,
          precoCentavos: toCents(obj.preco || '0'),
          precoPromocionalCentavos: toCents(obj.precoPromocional || '0'),
          peso: Number(obj.peso) || 0,
          ativo: obj.ativo !== '0',
          descricao: obj.descricao || '',
        };
        if (existente) {
          db.collection('products').update(existente.id, dados);
          if (obj.quantidade && !inovaAtiva()) {
            registrarMovimentoEstoque(db, { produtoId: existente.id, tipo: 'ajuste', quantidade: Number(obj.quantidade), origem: 'importacao_csv', usuarioId: req.adminUser.id });
          }
          atualizados++;
        } else {
          const novo = db.collection('products').insert({
            ...dados,
            slug: slugUnicoProduto(db, obj.nome),
            codigoInterno: obj.codigoInterno || '',
            caracteristicas: {}, imagens: [], videos: [], vendas: 0, relacionados: [],
            sanitario: { classificacao: 'nao_aplicavel', requerReceita: false, controlado: false, registroMS: '', apresentacao: '', concentracao: '', principioAtivo: '', fabricante: obj.fabricante || '', bulaUrl: '', aprovadoFarmaceutico: false, restricaoTransporte: false, restricaoAdvertencia: '' },
            estoque: { quantidade: inovaAtiva() ? 0 : (Number(obj.quantidade) || 0), minimo: Number(obj.estoqueMinimo) || 5, reservado: 0 },
          });
          if (!inovaAtiva() && Number(obj.quantidade) > 0) {
            registrarMovimentoEstoque(db, { produtoId: novo.id, tipo: 'entrada', quantidade: Number(obj.quantidade), origem: 'importacao_csv', usuarioId: req.adminUser.id });
          }
          criados++;
        }
      } catch {
        erros++;
      }
    }
    logAdmin(db, req.adminUser, 'importou_produtos_csv', 'produto', null, { criados, atualizados, erros }, req);
    res.json({ ok: true, criados, atualizados, erros });
  });

  /* ----------------------------- CATEGORIAS ----------------------------- */
  app.post('/admin/api/categorias', (req, res) => {
    if (!guardApi(req, res, 'categorias.criar')) return;
    const nome = cleanText(req.body.nome, 80);
    if (!nome) return void res.json({ ok: false, erro: 'Informe o nome da categoria.' }, 400);
    const cat = db.collection('categories').insert({
      nome,
      slug: slugUnicoCategoria(db, nome),
      icone: cleanText(req.body.icone, 8),
      paiId: req.body.paiId || null,
      descricao: cleanText(req.body.descricao, 500),
      ativa: req.body.ativa === '1' || req.body.ativa === 'on',
      destaque: false,
      ordem: Number(req.body.ordem) || 99,
    });
    logAdmin(db, req.adminUser, 'criou_categoria', 'categoria', cat.id, { nome }, req);
    res.json({ ok: true, id: cat.id });
  });

  app.post('/admin/api/categorias/:id', (req, res) => {
    if (!guardApi(req, res, 'categorias.editar')) return;
    const cat = db.collection('categories').get(req.params.id);
    if (!cat) return void res.json({ ok: false, erro: 'Categoria não encontrada.' }, 404);
    db.collection('categories').update(cat.id, {
      nome: cleanText(req.body.nome || cat.nome, 80),
      icone: cleanText(req.body.icone ?? cat.icone, 8),
      descricao: cleanText(req.body.descricao ?? cat.descricao, 500),
      ordem: Number(req.body.ordem ?? cat.ordem) || 99,
      paiId: req.body.paiId !== undefined ? (req.body.paiId || null) : cat.paiId,
    });
    logAdmin(db, req.adminUser, 'editou_categoria', 'categoria', cat.id, {}, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/categorias/:id/ativar', (req, res) => {
    if (!guardApi(req, res, 'categorias.editar')) return;
    const cat = db.collection('categories').get(req.params.id);
    if (!cat) return void res.json({ ok: false, erro: 'Categoria não encontrada.' }, 404);
    db.collection('categories').update(cat.id, { ativa: !(cat.ativa !== false) });
    res.json({ ok: true, ativa: !(cat.ativa !== false) });
  });

  app.post('/admin/api/categorias/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'categorias.excluir')) return;
    const cat = db.collection('categories').get(req.params.id);
    if (!cat) return void res.json({ ok: false, erro: 'Categoria não encontrada.' }, 404);
    const emUso = db.collection('products').count((p) => p.categoriaId === cat.id || p.subcategoriaId === cat.id);
    if (emUso) return void res.json({ ok: false, erro: `Existem ${emUso} produto(s) nesta categoria. Mova-os antes de excluir.` }, 400);
    const filhas = db.collection('categories').count((c) => c.paiId === cat.id);
    if (filhas) return void res.json({ ok: false, erro: 'Exclua primeiro as subcategorias.' }, 400);
    db.collection('categories').remove(cat.id);
    logAdmin(db, req.adminUser, 'excluiu_categoria', 'categoria', cat.id, { nome: cat.nome }, req);
    res.json({ ok: true });
  });

  /* ------------------------------- ESTOQUE ------------------------------ */
  app.post('/admin/api/estoque/movimentar', (req, res) => {
    if (!guardApi(req, res, 'estoque.movimentar')) return;
    if (inovaAtiva()) return void res.json({ ok: false, erro: 'Movimentações de estoque devem ser feitas na InovaFarma.' }, 409);
    const { produtoId, tipo, quantidade, lote, validade, observacao } = req.body;
    if (!produtoId) return void res.json({ ok: false, erro: 'Selecione o produto.' }, 400);
    const qtd = Number(quantidade);
    if (!Number.isSafeInteger(qtd) || qtd <= 0) {
      return void res.json({ ok: false, erro: 'Informe uma quantidade inteira e positiva.' }, 400);
    }
    if (!['entrada', 'saida', 'ajuste'].includes(tipo || 'entrada')) {
      return void res.json({ ok: false, erro: 'Tipo de movimentação inválido.' }, 400);
    }
    const produto = db.collection('products').get(produtoId);
    if (!produto) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    const saldo = Number(produto.estoque?.quantidade || 0);
    const reservado = Number(produto.estoque?.reservado || 0);
    if ((tipo === 'saida' && qtd > saldo - reservado) ||
        (tipo === 'ajuste' && qtd < reservado)) {
      return void res.json({ ok: false, erro: 'Movimentação excede estoque disponível ou compromete reservas de pedidos.' }, 409);
    }
    const mov = registrarMovimentoEstoque(db, {
      produtoId, tipo: tipo || 'entrada', quantidade: qtd,
      origem: 'painel', lote: lote || null, validade: validade || null,
      usuarioId: req.adminUser.id, observacao: cleanText(observacao, 300),
    });
    if (!mov) return void res.json({ ok: false, erro: 'Produto não encontrado.' }, 404);
    logAdmin(db, req.adminUser, `estoque_${tipo || 'entrada'}`, 'produto', produtoId, { quantidade: qtd }, req);
    res.json({ ok: true, saldo: mov.saldoDepois });
  });

  /* -------------------------------- MÍDIA ------------------------------- */
  app.get('/admin/api/midia', (req, res) => {
    if (!guardApi(req, res, 'midia.ver')) return;
    res.json({
      ok: true,
      arquivos: db.collection('midia').all().sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).slice(0, 200),
    });
  });

  app.post('/admin/api/midia/:id/excluir', async (req, res) => {
    if (!guardApi(req, res, 'midia.excluir')) return;
    const r = await deleteUpload(db, req.params.id, { force: req.body.forcar === '1' });
    if (!r.ok) return void res.json({ ok: false, erro: r.erro, usos: r.usos }, 400);
    logAdmin(db, req.adminUser, 'excluiu_midia', 'midia', req.params.id, {}, req);
    res.json({ ok: true });
  });

  /* ------------------------------- PEDIDOS ------------------------------ */
  app.post('/admin/api/pedidos/:id/status', (req, res) => {
    if (!guardApi(req, res, 'pedidos.editar')) return;
    const pedido = db.collection('orders').get(req.params.id);
    if (!pedido) return void res.json({ ok: false, erro: 'Pedido não encontrado.' }, 404);
    const r = atualizarStatusOperacional(db, pedido.id, req.body.status, {
      obs: cleanText(req.body.obs, 300), por: req.adminUser.nome,
    });
    if (!r.ok) return void res.json(r, 400);
    logAdmin(db, req.adminUser, 'alterou_status_pedido', 'pedido', pedido.id, { status: req.body.status }, req);
    res.json({ ok: true, status: req.body.status });
  });

  app.post('/admin/api/pedidos/:id/concluir-devolucao', (req, res) => {
    if (!guardApi(req, res, 'pedidos.editar')) return;
    const decisao = String(req.body.decisao || '');
    const justificativa = cleanText(req.body.justificativa, 500);
    const r = concluirDevolucaoEstornada(db, req.params.id, {
      decisao, justificativa, por: req.adminUser.nome,
    });
    if (!r.ok) return void res.json(r, 409);
    logAdmin(db, req.adminUser, 'concluiu_conferencia_devolucao', 'pedido', req.params.id,
      { decisao, status: r.pedido.statusOperacional }, req);
    res.json({ ok: true, status: r.pedido.statusOperacional });
  });

  app.post('/admin/api/pedidos/:id/rastreio', (req, res) => {
    if (!guardApi(req, res, 'pedidos.editar')) return;
    const pedido = db.collection('orders').get(req.params.id);
    if (!pedido) return void res.json({ ok: false, erro: 'Pedido não encontrado.' }, 404);
    const rastreioUrl = cleanText(req.body.url, 300).trim();
    if (rastreioUrl) {
      let url;
      try { url = new URL(rastreioUrl); } catch { /* endereço inválido */ }
      if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
        return void res.json({ ok: false, erro: 'O rastreamento exige um link HTTPS válido.' }, 400);
      }
    }
    const r = atualizarStatusOperacional(db, pedido.id, pedido.statusOperacional, {
      rastreio: {
        codigo: cleanText(req.body.codigo, 60),
        transportadora: cleanText(req.body.transportadora, 60),
        url: rastreioUrl,
        enviadoEm: req.body.codigo ? new Date().toISOString() : null,
      },
      obs: 'Rastreio atualizado.', por: req.adminUser.nome,
    });
    if (!r.ok) return void res.json(r, 400);
    logAdmin(db, req.adminUser, 'atualizou_rastreio', 'pedido', pedido.id, { codigo: req.body.codigo }, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/pedidos/:id/cancelar', async (req, res) => {
    if (!guardApi(req, res, 'pedidos.editar')) return;
    const pedido = db.collection('orders').get(req.params.id);
    if (!pedido) return void res.json({ ok: false, erro: 'Pedido não encontrado.' }, 404);
    // Nunca tente estornar uma venda já expedida/entregue: o cancelamento
    // seria recusado depois e o dinheiro já poderia ter sido devolvido.
    const preflight = validarCancelamentoOperacional(pedido);
    if (!preflight.ok) return void res.json(preflight, 409);
    if (pedido.statusFinanceiro === 'estorno_solicitado') {
      if (!guardApi(req, res, 'pagamentos.estornar')) return;
      if (!pedido.cancelamentoPendenteEstorno) {
        // O estorno já pode ter sido solicitado separadamente. O usuário
        // pode optar por cancelar sem repetir a requisição ao provedor.
        db.collection('orders').update(pedido.id, {
          cancelamentoPendenteEstorno: {
            solicitadoEm: new Date().toISOString(),
            motivo: 'Cancelado pelo painel administrativo.',
            por: req.adminUser.nome,
          },
        });
        logAdmin(db, req.adminUser, 'aguardando_estorno_para_cancelar', 'pedido',
          pedido.id, { codigo: pedido.codigo }, req);
      }
      return void res.json({
        ok: true, aguardandoEstorno: true,
        mensagem: 'O estorno está pendente de confirmação. Nenhuma nova solicitação foi enviada.',
      }, 202);
    }
    if (pedido.statusFinanceiro === 'aprovado') {
      if (!guardApi(req, res, 'pagamentos.estornar')) return;
      const pagamento = db.collection('payments').get(pedido.pagamentoId);
      if (!pagamento) return void res.json({ ok: false, erro: 'Cobrança aprovada não encontrada.' }, 409);
      let estorno;
      try { estorno = await refundPayment(db, pagamento); }
      catch { return void res.json({ ok: false, erro: 'Erro ao consultar estorno no provedor.' }, 502); }
      if (!estorno.ok) return void res.json(estorno, 409);
      const confirmacao = atualizarStatusFinanceiro(db, pedido.id,
        estorno.status === 'refunded' ? 'estornado' : 'estorno_solicitado',
        { obs: 'Estorno solicitado antes do cancelamento.', por: req.adminUser.nome });
      if (!confirmacao.ok) return void res.json(confirmacao, 409);
      if (estorno.status !== 'refunded') {
        // O alarme do Worker só cancela após confirmação do provedor.
        // Sem esta intenção persistida, o estorno seria confirmado, porém
        // o pedido continuaria em separação indefinidamente.
        db.collection('orders').update(pedido.id, {
          cancelamentoPendenteEstorno: {
            solicitadoEm: new Date().toISOString(),
            motivo: 'Cancelado pelo painel administrativo.',
            por: req.adminUser.nome,
          },
        });
        logAdmin(db, req.adminUser, 'aguardando_estorno_para_cancelar', 'pedido',
          pedido.id, { codigo: pedido.codigo }, req);
        return void res.json({ ok: true, aguardandoEstorno: true,
          mensagem: 'Pedido não cancelado: aguardando confirmação do estorno pelo provedor.' }, 202);
      }
    }
    const resultado = cancelarPedido(db, pedido.id, { motivo: 'Cancelado pelo painel administrativo.', por: req.adminUser.nome });
    if (!resultado.ok) return void res.json(resultado, 409);
    logAdmin(db, req.adminUser, 'cancelou_pedido', 'pedido', pedido.id, { codigo: pedido.codigo }, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/pedidos/:id/simular-pagamento', async (req, res) => {
    if (!guardApi(req, res, 'pagamentos.estornar')) return;
    const pedido = db.collection('orders').get(req.params.id);
    if (!pedido || !pedido.pagamentoId) return void res.json({ ok: false, erro: 'Pedido ou cobrança não encontrados.' }, 404);
    const status = String(req.body.status || 'approved');
    if (!['approved', 'rejected'].includes(status) || pedido.statusFinanceiro !== 'pendente' ||
        pedido.statusOperacional === 'cancelado') {
      return void res.json({ ok: false, erro: 'Pedido ou transição incompatível com simulação.' }, 409);
    }
    if (status === 'approved') {
      // Rejeita ANTES de alterar o registro financeiro quando a reserva
      // ou os itens não permitem concluir o pedido.
      const preflight = validarReservaParaAprovacao(db, pedido.id);
      if (!preflight.ok) return void res.json(preflight, 409);
    }
    const r = await simulateApproval(db, pedido.pagamentoId, { aprovado: status === 'approved', origem: `painel:${req.adminUser.email}` });
    if (!r.ok) return void res.json(r, 400);
    const resultado = atualizarStatusFinanceiro(db, pedido.id, status === 'approved' ? 'aprovado' : 'recusado', {
      obs: status === 'approved' ? 'Aprovado em ambiente de testes (simulação pelo painel).' : 'Recusado em ambiente de testes (simulação pelo painel).',
      por: req.adminUser.nome,
    });
    if (!resultado.ok) {
      logAdmin(db, req.adminUser, 'simulacao_exige_conciliacao', 'pedido', pedido.id, { motivo: resultado.erro }, req);
      return void res.json({ ok: false, erro: 'Cobrança e pedido exigem conciliação manual. ' + resultado.erro }, 409);
    }
    logAdmin(db, req.adminUser, 'simulou_pagamento', 'pedido', pedido.id, { status }, req);
    res.json({ ok: true, status });
  });

  app.post('/admin/api/pedidos/:id/estornar', async (req, res) => {
    if (!guardApi(req, res, 'pagamentos.estornar')) return;
    const pedido = db.collection('orders').get(req.params.id);
    if (!pedido || !pedido.pagamentoId) return void res.json({ ok: false, erro: 'Cobrança não encontrada.' }, 404);
    if (pedido.statusFinanceiro !== 'aprovado') return void res.json({ ok: false, erro: 'Pedido não tem pagamento aprovado para estornar.' }, 409);
    const pagamento = db.collection('payments').get(pedido.pagamentoId);
    if (!pagamento) return void res.json({ ok: false, erro: 'Cobrança não encontrada.' }, 404);
    let r;
    try { r = await refundPayment(db, pagamento, req.body.valor ? toCents(req.body.valor) : null); }
    catch { return void res.json({ ok: false, erro: 'Falha externa ao solicitar estorno.' }, 502); }
    if (!r.ok) return void res.json(r, 409);
    const status = r.status === 'refunded' ? 'estornado' : 'estorno_solicitado';
    const atualizacao = atualizarStatusFinanceiro(db, pedido.id, status, { obs: 'Solicitação de estorno pelo painel.', por: req.adminUser.nome });
    if (!atualizacao.ok) return void res.json(atualizacao, 409);
    logAdmin(db, req.adminUser, 'solicitou_estorno', 'pedido', pedido.id, { pagamentoId: pagamento.id }, req);
    res.json({ ok: true, confirmado: r.status === 'refunded', status });
  });

  app.get('/admin/api/pedidos/exportar.csv', (req, res) => {
    if (!req.adminUser || !can(req.adminUser, 'pedidos.ver')) return void res.json({ ok: false, erro: 'Sem permissão.' }, 403);
    const linhas = [['codigo', 'data', 'cliente', 'email', 'uf', 'itens', 'subtotal', 'desconto', 'frete', 'total', 'pagamento', 'entrega'].join(',')];
    for (const p of db.collection('orders').all()) {
      linhas.push([
        csv(p.codigo), csv(String(p.criadoEm).slice(0, 10)), csv(p.cliente?.nome), csv(p.cliente?.email),
        csv(p.endereco?.uf), (p.itens || []).reduce((a, i) => a + i.quantidade, 0),
        (p.subtotalCentavos / 100).toFixed(2), (p.descontoCentavos / 100).toFixed(2),
        (p.freteCentavos / 100).toFixed(2), (p.totalCentavos / 100).toFixed(2),
        p.statusFinanceiro, p.statusOperacional,
      ].join(','));
    }
    res.set('Content-Disposition', 'attachment; filename="pedidos-pague-pouco.csv"');
    res.text(linhas.join('\n'), 200, 'text/csv; charset=utf-8');
  });

  /* ------------------------------ CLIENTES ------------------------------ */
  app.post('/admin/api/clientes/:id/ativar', (req, res) => {
    if (!guardApi(req, res, 'clientes.editar')) return;
    const c = db.collection('customers').get(req.params.id);
    if (!c) return void res.json({ ok: false, erro: 'Cliente não encontrado.' }, 404);
    db.collection('customers').update(c.id, { ativo: !(c.ativo !== false) });
    logAdmin(db, req.adminUser, c.ativo !== false ? 'desativou_cliente' : 'ativou_cliente', 'cliente', c.id, {}, req);
    res.json({ ok: true, ativo: !(c.ativo !== false) });
  });

  /* ------------------------------- CUPONS ------------------------------- */
  app.post('/admin/api/cupons', (req, res) => {
    if (!guardApi(req, res, 'promocoes.criar')) return;
    const valida = validarNovoCupom(req.body);
    if (!valida.ok) return void res.json({ ok: false, erro: valida.erro }, 400);
    const { codigo } = valida.dados;
    if (db.collection('coupons').findOne((c) => c.codigo === codigo)) {
      return void res.json({ ok: false, erro: 'Já existe um cupom com este código.' }, 400);
    }
    db.collection('coupons').insert({
      ...valida.dados,
      ativo: req.body.ativo === '1' || req.body.ativo === 'on',
      usos: 0,
      categoriasPermitidas: String(req.body.categoriasPermitidas || '').split(',').map((s) => s.trim()).filter(Boolean),
      primeiroPedido: req.body.primeiroPedido === '1' || req.body.primeiroPedido === 'on',
      descricao: cleanText(req.body.descricao, 200),
    });
    logAdmin(db, req.adminUser, 'criou_cupom', 'cupom', codigo, {}, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/cupons/:id/ativar', (req, res) => {
    if (!guardApi(req, res, 'promocoes.editar')) return;
    const c = db.collection('coupons').get(req.params.id);
    if (!c) return void res.json({ ok: false, erro: 'Cupom não encontrado.' }, 404);
    db.collection('coupons').update(c.id, { ativo: !c.ativo });
    res.json({ ok: true, ativo: !c.ativo });
  });

  app.post('/admin/api/cupons/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'promocoes.excluir')) return;
    db.collection('coupons').remove(req.params.id);
    res.json({ ok: true });
  });

  /* ------------------------------- BANNERS ------------------------------ */
  app.post('/admin/api/banners', (req, res) => {
    if (!guardApi(req, res, 'banners.criar')) return;
    const imagem = cleanText(req.body.imagem, 300) || '/img/fundo-banner-vermelho.svg';
    if (!imagem) return void res.json({ ok: false, erro: 'Informe a imagem do banner.' }, 400);
    const linkBanner = cleanText(req.body.link, 300).trim();
    const destinoLocal = linkBanner.startsWith('/') && !linkBanner.startsWith('//') &&
      !/[\\\\\u0000-\u001f]/.test(linkBanner);
    const destinoExterno = /^https:\/\/[^\s/]+/i.test(linkBanner);
    if (!linkBanner || (!destinoLocal && !destinoExterno))
      return void res.json({ ok: false, erro: 'Destino inválido: use uma página interna ou endereço HTTPS.' }, 400);
    const posicao = ['principal', 'secundario'].includes(req.body.posicao) ? req.body.posicao : 'principal';
    const existentes = db.collection('banners').find(b => (b.posicao || 'principal') === posicao);
    const ultimaOrdem = existentes.reduce((max, b) => Math.max(max, Number.isFinite(Number(b.ordem)) ? Number(b.ordem) : 0), 0);
    const proximaOrdem = ultimaOrdem + 1;
    db.collection('banners').insert({
      titulo: cleanText(req.body.titulo, 120),
      descricao: cleanText(req.body.descricao, 240),
      imagem,
      imagemMobile: cleanText(req.body.imagemMobile, 300),
      link: linkBanner,
      posicao,
      ordem: proximaOrdem,
      ativo: req.body.ativo === '1' || req.body.ativo === 'on',
      inicio: null, fim: null,
    });
    logAdmin(db, req.adminUser, 'criou_banner', 'banner', null, { titulo: req.body.titulo }, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/banners/:id/editar', (req, res) => {
    if (!guardApi(req, res, 'banners.editar')) return;
    const antigo = db.collection('banners').get(req.params.id);
    if (!antigo) return void res.json({ ok: false, erro: 'Banner não encontrado.' }, 404);
    const titulo = cleanText(req.body.titulo, 120);
    const imagem = cleanText(req.body.imagem, 300);
    const link = cleanText(req.body.link, 300).trim();
    const destinoLocal = link.startsWith('/') && !link.startsWith('//') &&
      !/[\\\\\u0000-\u001f]/.test(link);
    const destinoExterno = /^https:\/\/[^\s/]+/i.test(link);
    if (!titulo || !imagem || !link || (!destinoLocal && !destinoExterno))
      return void res.json({ ok: false, erro: 'Informe título, imagem e destino válido.' }, 400);
    const posicao = ['principal','secundario'].includes(req.body.posicao) ? req.body.posicao : (antigo.posicao || 'principal');
    const novaPosicao = posicao !== (antigo.posicao || 'principal');
    const outros = db.collection('banners').find(b => b.id !== antigo.id && (b.posicao || 'principal') === posicao);
    const ordem = novaPosicao
      ? outros.reduce((maior,b) => Math.max(maior, Number(b.ordem) || 0), 0) + 1
      : antigo.ordem;
    db.collection('banners').update(antigo.id, {
      titulo, descricao: cleanText(req.body.descricao, 240), imagem,
      imagemMobile: cleanText(req.body.imagemMobile, 300), link, posicao, ordem,
      ativo: req.body.ativo === '1' || req.body.ativo === 'on',
    });
    logAdmin(db, req.adminUser, 'editou_banner', 'banner', antigo.id, { titulo, posicao }, req);
    res.json({ ok: true });
  });

  app.post('/admin/api/banners/:id/ativar', (req, res) => {
    if (!guardApi(req, res, 'banners.editar')) return;
    const b = db.collection('banners').get(req.params.id);
    if (!b) return void res.json({ ok: false, erro: 'Banner não encontrado.' }, 404);
    db.collection('banners').update(b.id, { ativo: !(b.ativo !== false) });
    res.json({ ok: true, ativo: !(b.ativo !== false) });
  });

  app.post('/admin/api/banners/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'banners.excluir')) return;
    db.collection('banners').remove(req.params.id);
    res.json({ ok: true });
  });

  /* ---------------------------- CONFIGURAÇÕES --------------------------- */
  app.post('/admin/api/config/empresa', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    patchSetting(db, 'empresa', {
      nomeFantasia: cleanText(req.body.nomeFantasia, 120),
      razaoSocial: cleanText(req.body.razaoSocial, 160),
      cnpj: cleanText(req.body.cnpj, 30),
      inscricaoEstadual: cleanText(req.body.inscricaoEstadual, 30),
      telefone: cleanText(req.body.telefone, 30),
      email: cleanText(req.body.email, 120),
      farmaceuticoResponsavel: cleanText(req.body.farmaceuticoResponsavel, 120),
      crf: cleanText(req.body.crf, 30),
      autorizacaoSanitaria: cleanText(req.body.autorizacaoSanitaria, 120),
      horarioAtendimento: cleanText(req.body.horarioAtendimento, 200),
      endereco: {
        cep: cleanText(req.body.cep, 12), logradouro: cleanText(req.body.logradouro, 160),
        numero: cleanText(req.body.numero, 20), bairro: cleanText(req.body.bairro, 80),
        cidade: cleanText(req.body.cidade, 80), uf: String(req.body.uf || '').toUpperCase().slice(0, 2),
      },
      redes: { instagram: cleanText(req.body.instagram, 120), facebook: cleanText(req.body.facebook, 120) },
    }, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_config_empresa', 'configuracao', 'empresa', {}, req);
    res.redirect('/admin/configuracoes?salvo=empresa');
  });

  app.post('/admin/api/config/tema', async (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    const dados = {
      corPrimaria: cleanText(req.body.corPrimaria, 9),
      corPrimariaEscura: cleanText(req.body.corPrimariaEscura, 9),
      corSecundaria: cleanText(req.body.corSecundaria, 9),
      corTexto: cleanText(req.body.corTexto, 9),
      corFundo: cleanText(req.body.corFundo, 9),
      logoAltura: Number(req.body.logoAltura) || 44,
      barraTopoAtiva: req.body.barraTopoAtiva === '1',
      barraTopoTexto: cleanText(req.body.barraTopoTexto, 200),
      mostrarConsultaCep: req.body.mostrarConsultaCep === '1',
    };
    const arquivo = (req.files || [])[0];
    if (arquivo) {
      try {
        const reg = await saveUpload(db, arquivo, { kind: 'image', userId: req.adminUser.id, nome: 'Logotipo' });
        dados.logoUrl = reg.url;
      } catch (err) {
        return void res.json({ ok: false, erro: err.message }, 400);
      }
    }
    patchSetting(db, 'tema', dados, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_aparencia', 'configuracao', 'tema', {}, req);
    res.redirect('/admin/configuracoes?salvo=tema');
  });

  app.post('/admin/api/config/loja', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    patchSetting(db, 'loja', {
      lojaAberta: req.body.lojaAberta === '1',
      mensagemLojaFechada: cleanText(req.body.mensagemLojaFechada, 300),
      exigirLoginParaComprar: req.body.exigirLoginParaComprar === '1',
      valorMinimoPedido: toCents(req.body.valorMinimoPedido || '0'),
      mostrarAvisoSanitario: req.body.mostrarAvisoSanitario === '1',
      avisoMedicamento: cleanText(req.body.avisoMedicamento, 400),
      avisoAutomedicacao: cleanText(req.body.avisoAutomedicacao, 400),
    }, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_config_loja', 'configuracao', 'loja', {}, req);
    res.redirect('/admin/configuracoes?salvo=loja');
  });

  app.post('/admin/api/config/seo', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    patchSetting(db, 'seo', {
      tituloPadrao: cleanText(req.body.tituloPadrao, 200),
      descricaoPadrao: cleanText(req.body.descricaoPadrao, 500),
      palavrasChave: cleanText(req.body.palavrasChave, 300),
      googleAnalyticsId: cleanText(req.body.googleAnalyticsId, 40),
      pixelFacebookId: cleanText(req.body.pixelFacebookId, 40),
    }, req.adminUser, req);
    res.redirect('/admin/configuracoes?salvo=seo');
  });

  app.post('/admin/api/config/rodape', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    patchSetting(db, 'rodape', {
      textoInstitucional: cleanText(req.body.textoInstitucional, 500),
      formasPagamento: String(req.body.formasPagamento || '').split(',').map((s) => s.trim()).filter(Boolean),
    }, req.adminUser, req);
    res.redirect('/admin/configuracoes?salvo=rodape');
  });

  app.post('/admin/api/mercadopago/credenciais', { maxBodyBytes: 12 * 1024 }, (req, res) => {
    if (!guardApi(req, res, 'integracoes.editar')) return;
    res.set('Cache-Control', 'no-store');
    const resultado = salvarCredenciaisMercadoPago(db, {
      accessToken: req.body.accessToken,
      publicKey: req.body.publicKey,
      webhookSecret: req.body.webhookSecret,
      ambiente: req.body.ambiente,
    });
    if (!resultado.ok) return void res.json(resultado, 400);
    logAdmin(db, req.adminUser, 'atualizou_credenciais_mp', 'integracao', 'mercadopago',
      { ambiente: String(req.body.ambiente || 'testes') }, req);
    res.redirect('/admin/pagamentos?salvo=credenciais');
  });

  app.post('/admin/api/mercadopago/remover', { maxBodyBytes: 1024 }, (req, res) => {
    if (!guardApi(req, res, 'integracoes.editar')) return;
    res.set('Cache-Control', 'no-store');
    removerCredenciaisMercadoPago(db);
    // Sem credenciais no cofre, o pagamento real só pode usar um secret de ambiente existente.
    logAdmin(db, req.adminUser, 'removeu_credenciais_mp', 'integracao', 'mercadopago', {}, req);
    res.redirect('/admin/pagamentos?salvo=removidas');
  });

  app.post('/admin/api/config/pagamentos', (req, res) => {
    if (!guardApi(req, res, 'pagamentos.editar')) return;
    if (req.body.provedor === 'mercadopago' && req.body.ambienteTestes !== '1' &&
        req.body.habilitarProducao !== '1') {
      return void res.json({ ok: false,
        erro: 'Para habilitar cobranças reais, marque a confirmação explícita de produção.' }, 400);
    }
    patchSetting(db, 'pagamentos', {
      provedor: req.body.provedor || 'internal',
      ambienteTestes: req.body.ambienteTestes === '1',
      meios: {
        pix: req.body.meios_pix === '1',
        credit_card: req.body.meios_credit_card === '1',
        debit_card: req.body.meios_debit_card === '1',
      },
      parcelamentoMaximo: Number(req.body.parcelamentoMaximo) || 6,
      parcelasSemJuros: Number(req.body.parcelasSemJuros) || 3,
      taxaJurosMes: Number(req.body.taxaJurosMes) || 0,
      valorMinimoParcela: toCents(req.body.valorMinimoParcela || '5'),
      descontoPixPercentual: Number(req.body.descontoPixPercentual) || 0,
      mensagemCheckout: cleanText(req.body.mensagemCheckout, 500),
    }, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_config_pagamentos', 'configuracao', 'pagamentos', {}, req);
    res.redirect('/admin/pagamentos?salvo=1');
  });

  /* ------------------------------- WHATSAPP ----------------------------- */
  app.post('/admin/api/whatsapp', (req, res) => {
    if (!guardApi(req, res, 'whatsapp.editar')) return;
    const numero = onlyDigits(req.body.numero);
    if (numero && (numero.length < 12 || numero.length > 14)) {
      return void res.json({ ok: false, erro: 'Número inválido. Use DDI + DDD + número (ex.: 5573988887777).' }, 400);
    }
    const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
    const horarios = dias.map((dia) => ({
      dia,
      ativo: req.body[`dia_ativo_${dia}`] === '1',
      inicio: cleanText(req.body[`dia_inicio_${dia}`], 5) || '08:00',
      fim: cleanText(req.body[`dia_fim_${dia}`], 5) || '20:00',
    }));
    patchSetting(db, 'whatsapp', {
      ativo: req.body.ativo === '1',
      numero,
      mensagem: cleanText(req.body.mensagem, 400),
      textoBotao: cleanText(req.body.textoBotao, 60),
      posicao: req.body.posicao === 'esquerda' ? 'esquerda' : 'direita',
      paginas: String(req.body.paginas || 'todas').split(',').map((s) => s.trim()).filter(Boolean),
      respeitarHorario: req.body.respeitarHorario === '1',
      mensagemIndisponivel: cleanText(req.body.mensagemIndisponivel, 300),
      avisoCheckout: cleanText(req.body.avisoCheckout, 300),
      horarios,
    }, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_whatsapp', 'configuracao', 'whatsapp', { numero }, req);
    res.redirect('/admin/whatsapp?salvo=1');
  });

  /* -------------------------------- FRETES ------------------------------ */
  app.post('/admin/api/fretes', (req, res) => {
    if (!guardApi(req, res, 'fretes.editar')) return;
    const cfg = normalizeFreightConfig(getSetting(db, 'frete'));
    for (const u of UFS) {
      const st = cfg.states[u.uf];
      st.ativo = req.body[`uf_ativo_${u.uf}`] === '1';
      st.valor = toCents(req.body[`uf_valor_${u.uf}`] || '0');
      st.prazoMin = Number(req.body[`uf_min_${u.uf}`]) || 0;
      st.prazoMax = Number(req.body[`uf_max_${u.uf}`]) || 0;
      const custo = req.body[`uf_custo_${u.uf}`];
      st.custoPostagemEstimado = custo ? toCents(custo) : null;
      st.observacao = cleanText(req.body[`uf_obs_${u.uf}`], 200);
    }
    cfg.freteGratis = {
      ativo: req.body.fg_ativo === '1',
      valorMinimo: toCents(req.body.fg_valorMinimo || '0'),
      aplicaPara: req.body.fg_aplicaPara || 'todos',
      estados: String(req.body.fg_estados || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => UF_LIST.includes(s)),
    };
    cfg.entregaLocal = {
      ativo: req.body.loc_ativo === '1',
      cidades: String(req.body.loc_cidades || '').split(',').map((s) => s.trim()).filter(Boolean),
      valor: toCents(req.body.loc_valor || '0'),
      prazoMin: 0,
      prazoMax: Number(req.body.loc_prazoMax) || 2,
      label: cfg.entregaLocal?.label || 'Entrega local (cidade da farmácia)',
    };
    cfg.retirada = {
      ...cfg.retirada,
      ativo: req.body.ret_ativo === '1',
      endereco: cleanText(req.body.ret_endereco, 200),
      horario: cleanText(req.body.ret_horario, 120),
      prazoMin: 0,
      prazoMax: Number(req.body.ret_prazoMax) || 1,
    };
    cfg.peso = {
      limiteKg: Number(req.body.peso_limiteKg) || 30,
      franquiaKg: Number(req.body.peso_franquiaKg) || 5,
      valorKgExcedente: toCents(req.body.peso_valorKgExcedente || '0'),
      cubagemLimiteM3: Number(req.body.peso_cubagemLimite) || 0.3,
    };
    cfg.bloqueios = {
      categorias: String(req.body.bloq_categorias || '').split(',').map((s) => s.trim()).filter(Boolean),
      produtos: String(req.body.bloq_produtos || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
    cfg.mensagemIndisponivel = cleanText(req.body.msgIndisponivel, 400);
    setSetting(db, 'frete', cfg, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_fretes', 'configuracao', 'frete', {}, req);
    res.redirect('/admin/fretes?salvo=1');
  });

  app.post('/admin/api/fretes/excecao', (req, res) => {
    if (!guardApi(req, res, 'fretes.editar')) return;
    const cfg = normalizeFreightConfig(getSetting(db, 'frete'));
    cfg.excecoes.push({
      id: `exc_${Date.now().toString(36)}`,
      ativo: true,
      tipo: req.body.tipo === 'faixa-cep' ? 'faixa-cep' : 'cidade',
      uf: String(req.body.uf || '').toUpperCase().slice(0, 2),
      cidade: cleanText(req.body.cidade, 80),
      cepIni: onlyDigits(req.body.cepIni),
      cepFim: onlyDigits(req.body.cepFim),
      valor: req.body.valor !== '' && req.body.valor != null ? toCents(req.body.valor) : null,
      prazoMin: req.body.prazoMin ? Number(req.body.prazoMin) : null,
      prazoMax: req.body.prazoMax ? Number(req.body.prazoMax) : null,
      bloqueado: req.body.bloqueado === '1',
      motivo: cleanText(req.body.motivo, 200),
    });
    setSetting(db, 'frete', cfg, req.adminUser, req);
    logAdmin(db, req.adminUser, 'criou_excecao_frete', 'configuracao', 'frete', {}, req);
    res.redirect('/admin/fretes?salvo=excecao');
  });

  app.post('/admin/api/fretes/excecao/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'fretes.editar')) return;
    const cfg = normalizeFreightConfig(getSetting(db, 'frete'));
    cfg.excecoes = cfg.excecoes.filter((x) => x.id !== req.params.id);
    setSetting(db, 'frete', cfg, req.adminUser, req);
    res.json({ ok: true });
  });

  /* -------------------------------- PÁGINAS ----------------------------- */
  app.post('/admin/api/paginas', (req, res) => {
    if (!guardApi(req, res, 'paginas.criar')) return;
    const titulo = cleanText(req.body.titulo, 160);
    if (!titulo) return void res.json({ ok: false, erro: 'Informe o título.' }, 400);
    const slug = slugify(req.body.slug || titulo);
    if (db.collection('pages').findOne((p) => p.slug === slug)) {
      return void res.json({ ok: false, erro: 'Já existe uma página com este endereço.' }, 400);
    }
    const pagina = db.collection('pages').insert({
      titulo, slug,
      resumo: cleanText(req.body.resumo, 300),
      conteudo: String(req.body.conteudo || ''),
      publicada: req.body.publicada === '1',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    });
    logAdmin(db, req.adminUser, 'criou_pagina', 'pagina', pagina.id, { titulo }, req);
    res.redirect(`/admin/paginas/${pagina.slug}?salvo=1`);
  });

  app.post('/admin/api/paginas/:id', (req, res) => {
    if (!guardApi(req, res, 'paginas.editar')) return;
    const pagina = db.collection('pages').get(req.params.id);
    if (!pagina) return void res.json({ ok: false, erro: 'Página não encontrada.' }, 404);
    db.collection('pages').update(pagina.id, {
      titulo: cleanText(req.body.titulo, 160),
      resumo: cleanText(req.body.resumo, 300),
      conteudo: String(req.body.conteudo || ''),
      publicada: req.body.publicada === '1',
      atualizadoEm: new Date().toISOString(),
    });
    logAdmin(db, req.adminUser, 'editou_pagina', 'pagina', pagina.id, { titulo: req.body.titulo }, req);
    res.redirect(`/admin/paginas/${pagina.slug}?salvo=1`);
  });

  app.post('/admin/api/paginas/:id/publicar', (req, res) => {
    if (!guardApi(req, res, 'paginas.editar')) return;
    const pagina = db.collection('pages').get(req.params.id);
    if (!pagina) return void res.json({ ok: false, erro: 'Página não encontrada.' }, 404);
    db.collection('pages').update(pagina.id, { publicada: !pagina.publicada, atualizadoEm: new Date().toISOString() });
    res.json({ ok: true, publicada: !pagina.publicada });
  });

  app.post('/admin/api/paginas/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'paginas.excluir')) return;
    db.collection('pages').remove(req.params.id);
    res.json({ ok: true });
  });

  /* ------------------------------- USUÁRIOS ----------------------------- */
  app.post('/admin/api/usuarios', (req, res) => {
    if (req.adminUser?.role !== 'super_admin') return void res.json({ ok: false, erro: 'Somente o Super Administrador cria usuários.' }, 403);
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    const erros = validate({ email, senha, nome: req.body.nome }, {
      nome: [[(val) => v.required(val) && v.minLen(val, 3), 'Informe o nome.']],
      email: [[(val) => v.email(val), 'E-mail inválido.'], [(val) => !db.collection('admins').findOne((a) => a.email === val), 'Já existe usuário com este e-mail.']],
      senha: [[(val) => v.minLen(val, 8), 'A senha deve ter no mínimo 8 caracteres.'], [(val) => /[A-Za-z]/.test(val) && /\d/.test(val), 'Use letras e números.']],
    });
    if (Object.keys(erros).length) return void res.json({ ok: false, erros }, 400);
    const role = ROLES[req.body.role] ? req.body.role : 'atendente';
    db.collection('admins').insert({
      nome: cleanText(req.body.nome, 120),
      email,
      senhaHash: hashPassword(senha),
      role,
      crf: cleanText(req.body.crf, 30),
      ativo: true,
      criadoEm: new Date().toISOString(),
      deveTrocarSenha: true,
    });
    logAdmin(db, req.adminUser, 'criou_usuario_admin', 'admin', email, { role }, req);
    res.redirect('/admin/usuarios?salvo=1');
  });

  app.post('/admin/api/usuarios/:id/ativar', (req, res) => {
    if (req.adminUser?.role !== 'super_admin') return void res.json({ ok: false, erro: 'Sem permissão.' }, 403);
    const u = db.collection('admins').get(req.params.id);
    if (!u) return void res.json({ ok: false, erro: 'Usuário não encontrado.' }, 404);
    if (u.id === req.adminUser.id) return void res.json({ ok: false, erro: 'Você não pode desativar a si mesmo.' }, 400);
    db.collection('admins').update(u.id, { ativo: !(u.ativo !== false) });
    logAdmin(db, req.adminUser, u.ativo !== false ? 'desativou_usuario' : 'ativou_usuario', 'admin', u.id, { email: u.email }, req);
    res.json({ ok: true, ativo: !(u.ativo !== false) });
  });

  app.post('/admin/api/usuarios/:id/senha', (req, res) => {
    if (req.adminUser?.role !== 'super_admin') return void res.json({ ok: false, erro: 'Sem permissão.' }, 403);
    const u = db.collection('admins').get(req.params.id);
    if (!u) return void res.json({ ok: false, erro: 'Usuário não encontrado.' }, 404);
    // Nunca crie senhas administrativas com Math.random(): exige
    // entropia criptográfica mesmo quando o campo vem em branco.
    const nova = String(req.body.senha || '').trim() || `${randomToken(18)}Aa1`;
    if (nova.length < 8 || !/[A-Za-z]/.test(nova) || !/\d/.test(nova)) {
      return void res.json({ ok: false, erro: 'A senha deve ter no mínimo 8 caracteres, letras e números.' }, 400);
    }
    db.collection('admins').update(u.id, { senhaHash: hashPassword(nova), deveTrocarSenha: true });
    // Mudança de senha invalida sessões anteriores para que acesso
    // revogado não continue ativo após o reset administrativo.
    revogarSessoes(db, 'admin', u.id);
    logAdmin(db, req.adminUser, 'redefiniu_senha_usuario', 'admin', u.id, { email: u.email }, req);
    res.json({ ok: true, senhaProvisoria: nova, aviso: 'Envie esta senha ao usuário por canal seguro e oriente a troca no primeiro acesso.' });
  });

  /* -------------------------- EDITOR VISUAL (API) ----------------------- */
  app.post('/admin/api/aparencia/secoes', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const ids = arr(req.body['secao_id[]']);
    const titulos = arr(req.body['secao_titulo[]']);
    const ativos = arr(req.body['secao_ativo[]']);
    const ordens = arr(req.body['secao_ordem[]']);
    const atuais = (getSetting(db, 'home')?.secoes) || [];
    const secoes = ids.map((id, i) => {
      const base = atuais.find((s) => s.id === id) || { id, tipo: id };
      return { ...base, titulo: titulos[i] || base.titulo, ativo: ativos[i] === '1', ordem: Number(ordens[i]) || (i + 1) };
    });
    patchSetting(db, 'home', { secoes }, req.adminUser, req);
    logAdmin(db, req.adminUser, 'alterou_secoes_home', 'configuracao', 'home', {}, req);
    res.redirect('/admin/aparencia?salvo=secoes');
  });

  app.post('/admin/api/aparencia/vitrines', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    const titulo = cleanText(req.body.titulo, 120);
    if (!titulo) return void res.json({ ok: false, erro: 'Informe o título da vitrine.' }, 400);
    db.collection('showcases').insert({
      titulo,
      tipo: req.body.tipo || 'categoria',
      categoriaSlug: cleanText(req.body.categoriaSlug, 80),
      categoriaId: null,
      marca: cleanText(req.body.marca, 80),
      origem: req.body.origem || 'destaques',
      produtosIds: [],
      limite: Number(req.body.limite) || 8,
      ordem: Number(req.body.ordem) || 99,
      link: cleanText(req.body.link, 300),
      ativa: true,
      rolagem: true,
    });
    logAdmin(db, req.adminUser, 'criou_vitrine', 'vitrine', null, { titulo }, req);
    res.redirect('/admin/aparencia?salvo=vitrine');
  });

  app.post('/admin/api/aparencia/vitrines/:id/ativar', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    const v = db.collection('showcases').get(req.params.id);
    if (!v) return void res.json({ ok: false, erro: 'Vitrine não encontrada.' }, 404);
    db.collection('showcases').update(v.id, { ativa: !(v.ativa !== false) });
    res.json({ ok: true });
  });

  app.post('/admin/api/aparencia/vitrines/:id/excluir', (req, res) => {
    if (!guardApi(req, res, 'configuracoes.editar')) return;
    db.collection('showcases').remove(req.params.id);
    res.json({ ok: true });
  });

  /* -------------------------------- SISTEMA ----------------------------- */
  app.post('/admin/api/sistema/backup', async (req, res) => {
    if (!guardApi(req, res, 'sistema.*')) return;
    if (config.isCloudflare) {
      logAdmin(db, req.adminUser, 'exportou_backup', 'sistema', null, {}, req);
      res.set('Content-Disposition', 'attachment; filename="pague-pouco-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
      res.set('Cache-Control', 'no-store');
      return void res.json(db.exportData());
    }
    const destino = path.join(db.dataDir, 'backups', `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await db.backup(destino);
    logAdmin(db, req.adminUser, 'gerou_backup', 'sistema', destino, {}, req);
    res.redirect('/admin/sistema?salvo=backup');
  });

  // Backup de mídia separado do JSON: evita carregar todos os arquivos
  // na memória do Worker e mantém cada download restrito ao superadministrador.
  app.get('/admin/api/sistema/backup/midias.json', (req, res) => {
    if (!guardApi(req, res, 'sistema.*')) return;
    if (!config.isCloudflare || typeof db.exportMediaManifest !== 'function') {
      return void res.json({ ok: false, erro: 'Manifesto de mídia disponível no Cloudflare Worker.' }, 501);
    }
    logAdmin(db, req.adminUser, 'exportou_manifesto_midia', 'sistema', null, {}, req);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', 'attachment; filename="pague-pouco-midias-manifest.json"');
    res.json(db.exportMediaManifest());
  });

  app.get('/admin/api/sistema/backup/arquivo/:chave', async (req, res) => {
    if (!guardApi(req, res, 'sistema.*')) return;
    if (!config.isCloudflare || typeof db.fileResponse !== 'function') {
      return void res.json({ ok: false, erro: 'Exportação de arquivo disponível no Cloudflare Worker.' }, 501);
    }
    const chave = String(req.params.chave || '');
    if (!/^[a-zA-Z0-9_-]{1,500}$/.test(chave)) {
      return void res.json({ ok: false, erro: 'Chave de arquivo inválida.' }, 400);
    }
    const caminho = Buffer.from(chave, 'base64url').toString('utf8');
    if (Buffer.from(caminho, 'utf8').toString('base64url') !== chave ||
        !caminho || caminho.startsWith('/') ||
        caminho.split('/').some(p => p === '.' || p === '..')) {
      return void res.json({ ok: false, erro: 'Chave de arquivo inválida.' }, 400);
    }
    const arquivo = db.fileResponse(caminho, new Request('https://backup.invalid/' + chave));
    if (!arquivo) return void res.json({ ok: false, erro: 'Arquivo não encontrado.' }, 404);
    const nome = caminho.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '_');
    logAdmin(db, req.adminUser, 'exportou_arquivo_midia', 'sistema', null, { caminho }, req);
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', 'attachment; filename="' + nome + '"');
    res.end(Buffer.from(await arquivo.arrayBuffer()));
  });

  app.get('/admin/api/relatorios/vendas.csv', (req, res) => {
    if (!req.adminUser || !can(req.adminUser, 'relatorios.ver')) return void res.json({ ok: false, erro: 'Sem permissão.' }, 403);
    const de = req.query.get('de') || '';
    const ate = req.query.get('ate') || '';
    const pagos = db.collection('orders').all()
      .filter((o) => o.statusFinanceiro === 'aprovado')
      .filter((o) => (!de || String(o.criadoEm).slice(0, 10) >= de) && (!ate || String(o.criadoEm).slice(0, 10) <= ate));
    const linhas = [['data', 'pedido', 'cliente', 'uf', 'itens', 'subtotal', 'desconto', 'frete', 'total'].join(',')];
    for (const o of pagos) {
      linhas.push([
        csv(String(o.criadoEm).slice(0, 10)), csv(o.codigo), csv(o.cliente?.nome), csv(o.endereco?.uf),
        (o.itens || []).reduce((a, i) => a + i.quantidade, 0),
        (o.subtotalCentavos / 100).toFixed(2), (o.descontoCentavos / 100).toFixed(2),
        (o.freteCentavos / 100).toFixed(2), (o.totalCentavos / 100).toFixed(2),
      ].join(','));
    }
    res.set('Content-Disposition', `attachment; filename="vendas-${de || 'inicio'}-a-${ate || 'hoje'}.csv"`);
    res.text(linhas.join('\n'), 200, 'text/csv; charset=utf-8');
  });
}

/* ------------------------------- helpers ------------------------------- */
function reqAdmin() {
  return true;
}

function csv(valor) {
  const texto = String(valor ?? '');
  // CSV aberto no Excel/LibreOffice pode executar fórmulas vindas de
  // nomes de produtos, categorias ou clientes, mesmo entre aspas.
  const protegido = /^[\s\u0000-\u001f]*[=+@-]/.test(texto) ? "'" + texto : texto;
  return '"' + protegido.replace(/"/g, '""') + '"';
}
