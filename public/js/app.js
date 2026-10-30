/* ==========================================================================
   FARMÁCIA PAGUE POUCO — JavaScript do site (sem dependências externas)
   Carrinho (gaveta), carrosséis, busca, abas, galeria, CEP e cookies.
   ========================================================================== */
(function () {
  'use strict';

  const CFG = window.PP_CONFIG || {};
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* --------------------------- utilidades --------------------------- */
  function notificar(mensagem, tipo) {
    const el = $('#notificacao');
    if (!el) return;
    el.textContent = mensagem;
    el.style.background = tipo === 'erro' ? 'var(--erro)' : 'var(--primaria-escura)';
    el.classList.add('visivel');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visivel'), 3200);
  }

  async function api(path, opts) {
    const opcoes = Object.assign({ credentials: 'same-origin' }, opts || {});
    opcoes.headers = Object.assign({
      'Content-Type': 'application/json',
      'X-CSRF-Token': CFG.csrf || '',
      'X-Requested-With': 'fetch',
    }, opcoes.headers || {});
    if (opcoes.body && typeof opcoes.body === 'object' && !(opcoes.body instanceof FormData)) {
      opcoes.body = JSON.stringify(opcoes.body);
    }
    if (opcoes.body instanceof FormData) delete opcoes.headers['Content-Type'];
    const r = await fetch(path, opcoes);
    let dados = null;
    try { dados = await r.json(); } catch (e) { dados = null; }
    if (!r.ok || (dados && dados.ok === false)) {
      const msg = (dados && (dados.erro || dados.error)) || 'Não foi possível concluir a operação.';
      throw new Error(msg);
    }
    return dados || {};
  }

  const formatar = (centavos) => 'R$ ' + ((centavos || 0) / 100).toFixed(2).replace('.', ',');

  /* ------------------------- carrinho/gaveta ------------------------ */
  const gaveta = $('#gavetaCarrinho');
  const fundo = $('#fundoEscuro');

  function abrirGaveta() {
    if (!gaveta) return;
    gaveta.classList.add('aberta');
    gaveta.setAttribute('aria-hidden', 'false');
    if (fundo) fundo.classList.add('visivel');
    document.body.style.overflow = 'hidden';
    atualizarCarrinho();
  }
  function fecharGaveta() {
    if (!gaveta) return;
    gaveta.classList.remove('aberta');
    gaveta.setAttribute('aria-hidden', 'true');
    if (fundo) fundo.classList.remove('visivel');
    document.body.style.overflow = '';
  }

  function aplicarHtmlCarrinho(dados) {
    if (dados.html && dados.html.corpo && $('#corpoCarrinho')) $('#corpoCarrinho').innerHTML = dados.html.corpo;
    if (dados.html && dados.html.rodape && $('#rodapeCarrinho')) $('#rodapeCarrinho').innerHTML = dados.html.rodape;
    const contador = $('#contadorCarrinho');
    if (contador) contador.textContent = dados.quantidade || 0;
    const resumoEl = $('#resumoCarrinho');
    if (resumoEl && dados.html) {
      // A página /carrinho calcula o frete somente no próximo passo:
      // manter o mesmo resumo e anúncio de parcelas após cada alteração.
      const emCarrinho = window.location.pathname === '/carrinho';
      const resumoAtual = emCarrinho ? dados.html.resumoSemFrete : dados.html.resumo;
      if (resumoAtual) resumoEl.innerHTML = resumoAtual;
    }
    const itensEl = $('#itensCarrinhoPagina');
    if (itensEl && dados.html && dados.html.itens) {
      itensEl.innerHTML = dados.html.itens;
      if (!dados.quantidade) itensEl.innerHTML = '<div class="carrinho-vazio"><p>Sua cesta está vazia.</p><a class="botao" href="/ofertas">Ver ofertas</a></div>';
    }
    (dados.avisos || []).forEach((a) => notificar(a, 'aviso'));
  }

  async function atualizarCarrinho() {
    try {
      const dados = await api('/api/carrinho');
      aplicarHtmlCarrinho(dados);
    } catch (err) {
      /* silencioso: não atrapalha a navegação */
    }
  }

  async function adicionarAoCarrinho(produtoId, quantidade) {
    try {
      const dados = await api('/api/carrinho/adicionar', { method: 'POST', body: { produtoId, quantidade } });
      aplicarHtmlCarrinho(dados);
      notificar(dados.mensagem || 'Produto adicionado à cesta.');
      gaveta && gaveta.classList.contains('aberta') ? null : null;
    } catch (err) {
      notificar(err.message, 'erro');
    }
  }

  document.addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-adicionar-carrinho]');
    if (add) {
      ev.preventDefault();
      const id = add.getAttribute('data-adicionar-carrinho');
      const inputId = add.getAttribute('data-quantidade-input');
      let qtd = 1;
      if (inputId) {
        const inp = document.getElementById(inputId);
        if (inp) qtd = Math.max(1, parseInt(inp.value, 10) || 1);
      }
      add.disabled = true;
      const rotulo = add.innerHTML;
      add.innerHTML = 'Adicionando...';
      adicionarAoCarrinho(id, qtd).finally(() => { add.disabled = false; add.innerHTML = rotulo; });
      return;
    }

    if (ev.target.closest('#abrirCarrinho') || ev.target.closest('[data-abrir-carrinho]')) {
      ev.preventDefault();
      abrirGaveta();
      return;
    }
    if (ev.target.closest('#fecharCarrinho') || ev.target === fundo) {
      fecharGaveta();
      return;
    }

    // quantidade na página do produto
    const qtdBtn = ev.target.closest('[data-qtd]');
    if (qtdBtn) {
      const delta = parseInt(qtdBtn.getAttribute('data-qtd'), 10);
      const wrap = qtdBtn.closest('.quantidade');
      const input = wrap && wrap.querySelector('input');
      if (input) {
        const max = parseInt(input.getAttribute('max') || '99', 10);
        input.value = Math.max(1, Math.min(max, (parseInt(input.value, 10) || 1) + delta));
      }
      return;
    }

    // quantidade no carrinho
    const qtdCarrinho = ev.target.closest('[data-qtd-carrinho]');
    if (qtdCarrinho) {
      const produto = qtdCarrinho.getAttribute('data-produto');
      const wrap = qtdCarrinho.closest('.quantidade');
      const input = wrap && wrap.querySelector('input');
      const novo = Math.max(1, (parseInt(input.value, 10) || 1) + parseInt(qtdCarrinho.getAttribute('data-qtd-carrinho'), 10));
      api('/api/carrinho/atualizar', { method: 'POST', body: { produtoId: produto, quantidade: novo } })
        .then(aplicarHtmlCarrinho)
        .catch((e) => notificar(e.message, 'erro'));
      return;
    }

    const remover = ev.target.closest('[data-remover]');
    if (remover) {
      api('/api/carrinho/remover', { method: 'POST', body: { produtoId: remover.getAttribute('data-remover') } })
        .then(aplicarHtmlCarrinho)
        .catch((e) => notificar(e.message, 'erro'));
      return;
    }

    const removerCupom = ev.target.closest('[data-remover-cupom]');
    if (removerCupom) {
      api('/api/carrinho/cupom/remover', { method: 'POST', body: {} }).then(aplicarHtmlCarrinho).catch((e) => notificar(e.message, 'erro'));
      return;
    }

    // abas
    const aba = ev.target.closest('[data-aba]');
    if (aba) {
      ev.preventDefault();
      const alvo = aba.getAttribute('data-aba');
      $$('[data-aba]').forEach((b) => {
        const ativo = b === aba;
        b.classList.toggle('ativo', ativo);
        b.setAttribute('aria-selected', ativo ? 'true' : 'false');
      });
      $$('.painel-aba').forEach((p) => p.classList.remove('ativo'));
      const painel = document.getElementById('aba-' + alvo);
      if (painel) painel.classList.add('ativo');
      return;
    }

    // miniaturas da galeria
    const miniatura = ev.target.closest('[data-miniatura]');
    if (miniatura) {
      const img = $('#imagemPrincipal');
      if (img) img.src = miniatura.getAttribute('data-miniatura');
      $$('[data-miniatura]').forEach((m) => m.classList.toggle('ativo', m === miniatura));
      return;
    }
    const videoBtn = ev.target.closest('[data-video]');
    if (videoBtn) {
      const principal = $('.galeria .principal');
      if (principal) {
        principal.innerHTML = '<video src="' + videoBtn.getAttribute('data-video') + '" controls autoplay style="max-height:380px;width:100%"></video>';
      }
      return;
    }

    // menu de departamentos (mobile)
    if (ev.target.closest('#botaoTodosDeptos')) {
      const sub = $('#submenuDeptos');
      if (sub) {
        sub.classList.toggle('visivel');
        const btn = $('#botaoTodosDeptos');
        btn.setAttribute('aria-expanded', sub.classList.contains('visivel') ? 'true' : 'false');
      }
      return;
    }

    // cookies
    const cookieBtn = ev.target.closest('[data-cookies]');
    if (cookieBtn) {
      const acao = cookieBtn.getAttribute('data-cookies');
      fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrf || '' },
        body: JSON.stringify({ acao: acao }),
      }).then(() => {
        const barra = $('#barraCookies');
        if (barra) barra.classList.remove('visivel');
      });
      return;
    }
  });

  // quantidade digitada no carrinho
  document.addEventListener('change', (ev) => {
    const input = ev.target.closest('[data-qtd-input]');
    if (input) {
      const produto = input.getAttribute('data-qtd-input');
      const qtd = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1));
      api('/api/carrinho/atualizar', { method: 'POST', body: { produtoId: produto, quantidade: qtd } })
        .then(aplicarHtmlCarrinho)
        .catch((e) => notificar(e.message, 'erro'));
    }
  });

  // formulário de cupom
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-form-cupom]');
    if (form) {
      ev.preventDefault();
      const input = form.querySelector('input[name=codigo]');
      const codigo = (input.value || '').trim();
      if (!codigo) return;
      api('/api/carrinho/cupom', { method: 'POST', body: { codigo } })
        .then((d) => { aplicarHtmlCarrinho(d); notificar(d.mensagem || 'Cupom aplicado.'); })
        .catch((e) => notificar(e.message, 'erro'));
    }
  });

  /* ---------------------------- carrossel --------------------------- */
  function iniciarCarrosseis() {
    $$('[data-carrossel]').forEach((carrossel) => {
      const trilha = $('[data-trilha]', carrossel);
      if (!trilha) return;
      const slides = Array.from(trilha.children);
      const pontos = $$('[data-carrossel-ir]', carrossel);
      let indice = 0;
      const ir = (i) => {
        indice = (i + slides.length) % slides.length;
        trilha.scrollTo({ left: slides[indice].offsetLeft, behavior: 'smooth' });
        pontos.forEach((p, k) => p.classList.toggle('ativo', k === indice));
      };
      const prox = $('[data-carrossel-proximo]', carrossel);
      const ant = $('[data-carrossel-anterior]', carrossel);
      if (prox) prox.addEventListener('click', () => ir(indice + 1));
      if (ant) ant.addEventListener('click', () => ir(indice - 1));
      pontos.forEach((p, k) => p.addEventListener('click', () => ir(k)));
      if (slides.length > 1 && carrossel.dataset.autoplay !== 'false') {
        setInterval(() => ir(indice + 1), 6000);
      }
      trilha.addEventListener('scroll', () => {
        const novo = Math.round(trilha.scrollLeft / trilha.clientWidth);
        if (novo !== indice) { indice = novo; pontos.forEach((p, k) => p.classList.toggle('ativo', k === indice)); }
      });
    });
  }

  /* ------------------------ busca com sugestões --------------------- */
  function iniciarBusca() {
    const campo = $('#campoBusca');
    const lista = $('#listaSugestoes');
    if (!campo || !lista) return;
    let timer = null;
    campo.addEventListener('input', () => {
      const q = campo.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { lista.classList.remove('visivel'); return; }
      timer = setTimeout(async () => {
        try {
          const dados = await api('/api/busca?q=' + encodeURIComponent(q));
          if (!dados.sugestoes || !dados.sugestoes.length) { lista.classList.remove('visivel'); return; }
          lista.innerHTML = dados.sugestoes.map((s) =>
            '<a href="' + s.url + '"><img src="' + (s.imagem || '/img/produto-sem-foto.svg') + '" alt=""><span>' + s.nome + '</span></a>'
          ).join('') + '<a href="/busca?q=' + encodeURIComponent(q) + '"><span><strong>Ver todos os resultados</strong></span></a>';
          lista.classList.add('visivel');
        } catch (e) { /* ignora */ }
      }, 220);
    });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.busca')) lista.classList.remove('visivel');
    });
  }

  /* ------------------------------- CEP ------------------------------ */
  function iniciarCep() {
    const campo = $('#cepTopo');
    if (!campo) return;
    campo.addEventListener('input', () => {
      let v = campo.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
      campo.value = v;
    });
    campo.addEventListener('blur', () => {
      const v = campo.value.replace(/\D/g, '');
      if (v.length === 8) {
        fetch('/api/cep-sessao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrf || '' },
          body: JSON.stringify({ cep: v }),
        }).then((r) => r.json()).then((d) => {
          if (d.uf) notificar('Frete e prazos serão calculados para ' + d.uf + '.');
        }).catch(() => {});
      }
    });
  }

  /* ----------------------------- cookies ---------------------------- */
  function iniciarCookies() {
    const barra = $('#barraCookies');
    if (!barra) return;
    const jaDecidiu = document.cookie.split('; ').some((c) => c.startsWith('pp_cookies='));
    if (!jaDecidiu) setTimeout(() => barra.classList.add('visivel'), 900);
  }

  /* --------------------- checkout: cálculo de frete ------------------ */
  function iniciarCheckout() {
    const botao = $('#botaoCalcularFrete');
    if (!botao) return;
    const opcoes = $('#opcoesFrete');
    const form = botao.closest('form');
    const pegar = (nome) => {
      const el = form.querySelector(`[name="${nome}"]`);
      return el ? el.value : '';
    };
    botao.addEventListener('click', async () => {
      const cep = pegar('cep').replace(/\D/g, '');
      if (cep.length !== 8) { notificar('Digite um CEP válido com 8 dígitos.', 'erro'); return; }
      botao.disabled = true;
      botao.textContent = 'Calculando...';
      try {
        const dados = await api('/api/frete', {
          method: 'POST',
          body: { cep, cidade: pegar('cidade'), uf: pegar('uf') },
        });
        if (!dados.disponivel || !dados.opcoes.length) {
          opcoes.innerHTML = `<div class="alerta aviso">${dados.motivo || 'Não foi possível calcular o frete para este destino.'}</div>`;
          return;
        }
        opcoes.innerHTML = `
          <h3>Formas de entrega</h3>
          ${dados.opcoes.map((o, i) => `<label class="opcao-frete ${i === 0 ? 'selecionada' : ''}">
            <input type="radio" name="freteOpcao" value="${o.id}" ${i === 0 ? 'checked' : ''}>
            <span><strong>${o.label}</strong><br><span class="texto-pequeno texto-suave">${o.prazo || ''}${o.detalhe ? ' — ' + o.detalhe : ''}</span></span>
            <span class="valor">${o.valor === 0 ? 'Grátis' : 'R$ ' + (o.valor / 100).toFixed(2).replace('.', ',')}</span>
          </label>`).join('')}
          <p class="texto-pequeno texto-suave">Estado identificado: <strong>${dados.ufNome || ''} (${dados.uf || ''})</strong>.
          Valor conforme a tabela de fretes fixos configurada pela farmácia.</p>
          <button class="botao destaque bloquinho mt-2" type="submit">Ir para o pagamento</button>`;
        $$('.opcao-frete input[type=radio]', opcoes).forEach((r) => r.addEventListener('change', () => {
          $$('.opcao-frete', opcoes).forEach((l) => l.classList.toggle('selecionada', l.contains(r)));
        }));
      } catch (err) {
        notificar(err.message, 'erro');
      } finally {
        botao.disabled = false;
        botao.textContent = 'Calcular frete';
      }
    });

    // preenche cidade/UF automaticamente a partir do CEP (quando habilitado)
    const cepInput = form.querySelector('[name="cep"]');
    if (cepInput) {
      cepInput.addEventListener('blur', async () => {
        const cep = cepInput.value.replace(/\D/g, '');
        if (cep.length !== 8) return;
        try {
          const info = await api(`/api/cep/${cep}`);
          if (info.uf) {
            const uf = form.querySelector('[name="uf"]');
            if (uf) uf.value = info.uf;
            if (info.cidade) {
              const cidade = form.querySelector('[name="cidade"]');
              if (cidade && !cidade.value) cidade.value = info.cidade;
            }
          }
        } catch (e) { /* silencioso */ }
      });
    }
  }

  /* ------------------- checkout: abas de pagamento ------------------- */
  function iniciarPagamento() {
    const form = $('#formPagamento');
    if (!form) return;
    const radios = $$('input[name=metodoPagamento]', form);
    const detalhe = $('#detalheCredito');
    const alternar = () => {
      const marcado = radios.find((r) => r.checked);
      if (detalhe) detalhe.classList.toggle('visivel', !!marcado && marcado.value === 'credit_card');
      $$('.opcao-pagamento', form).forEach((l) => l.classList.toggle('selecionada', !!marcado && l.contains(marcado)));
    };
    radios.forEach((r) => r.addEventListener('change', alternar));
    alternar();
    form.addEventListener('submit', (event) => {
      // Guardar a escolha explicita antes de desabilitar o botao principal:
      // botoes disabled nao sao incluidos na serializacao HTML do formulario.
      const escolha = form.querySelector('[name="preferenciaWhatsappPedido"]');
      if (escolha && event.submitter?.name === 'acaoWhatsappPedido') {
        escolha.value = event.submitter.value === 'autorizar' ? 'autorizar' : 'sem';
      }
      const botao = $('#botaoFinalizar');
      if (botao) { botao.disabled = true; botao.textContent = 'Processando...'; }
    });
  }

  /* --------------------------- copiar texto -------------------------- */
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-copiar]');
    if (b) {
      const alvo = document.querySelector(b.getAttribute('data-copiar'));
      if (alvo && navigator.clipboard) {
        navigator.clipboard.writeText(alvo.textContent.trim());
        notificar('Código copiado!');
      }
      return;
    }
    const fav = ev.target.closest('[data-favoritar]');
    if (fav) {
      ev.preventDefault();
      api('/conta/favoritos', { method: 'POST', body: { produtoId: fav.getAttribute('data-favoritar'), acao: fav.dataset.acao || 'adicionar' } })
        .then((d) => notificar('Favoritos atualizados.'))
        .catch((err) => notificar(err.message, 'erro'));
    }
  });

  /* ------------ Pix pago: consultar status sem nova cobrança ------------ */
  function iniciarAtualizacaoPix() {
    if (!document.querySelector('[data-pix-status-auto]')) return;
    // Recarregar a tela do próprio pedido aciona somente GET autenticado
    // /v1/payments/{id}; não cria outra cobrança. No servidor há cooldown
    // persistido de 60s para evitar consultar o provedor em excesso.
    let ultimaTentativa = Date.now();
    const atualizar = () => {
      const agora = Date.now();
      if (document.visibilityState !== 'visible' || agora - ultimaTentativa < 60_000) return;
      ultimaTentativa = agora;
      window.location.reload();
    };
    setInterval(atualizar, 15_000);
    document.addEventListener('visibilitychange', atualizar);
  }

  /* ----------------------------- init ------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    iniciarCarrosseis();
    iniciarBusca();
    iniciarCep();
    iniciarCookies();
    iniciarCheckout();
    iniciarPagamento();
    iniciarAtualizacaoPix();
    atualizarCarrinho();
  });
})();
