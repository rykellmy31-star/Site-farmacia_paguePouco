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
  // Após clicar nas setas/pontos, garantir tempo para ler o banner selecionado.
  // Nunca usar setInterval fixo: ele pode disparar logo depois de um clique.
  const INTERVALO_CARROSSEL_MS = 6000;
  const PAUSA_CARROSSEL_MANUAL_MS = 10000;

  function iniciarCarrosseis() {
    $$('[data-carrossel]').forEach((carrossel) => {
      if (carrossel.dataset.carrosselIniciado === '1') return;
      const trilha = $('[data-trilha]', carrossel);
      if (!trilha) return;
      const slides = Array.from(trilha.children);
      if (!slides.length) return;
      carrossel.dataset.carrosselIniciado = '1';

      const pontos = $$('[data-carrossel-ir]', carrossel);
      const prox = $('[data-carrossel-proximo]', carrossel);
      const ant = $('[data-carrossel-anterior]', carrossel);
      const automatico = slides.length > 1 && carrossel.dataset.autoplay !== 'false' &&
        !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      let indice = 0;
      let timer = null;

      const marcarPonto = () => pontos.forEach((p, k) => p.classList.toggle('ativo', k === indice));
      const ir = (i) => {
        indice = (i + slides.length) % slides.length;
        trilha.scrollTo({ left: slides[indice].offsetLeft, behavior: 'smooth' });
        marcarPonto();
      };
      const agendar = (atraso = INTERVALO_CARROSSEL_MS) => {
        clearTimeout(timer);
        timer = null;
        if (!automatico || document.visibilityState === 'hidden') return;
        timer = setTimeout(() => {
          ir(indice + 1);
          agendar(INTERVALO_CARROSSEL_MS);
        }, atraso);
      };
      const navegarManualmente = (destino) => {
        ir(destino);
        agendar(PAUSA_CARROSSEL_MANUAL_MS);
      };

      prox?.addEventListener('click', () => navegarManualmente(indice + 1));
      ant?.addEventListener('click', () => navegarManualmente(indice - 1));
      pontos.forEach((p, k) => p.addEventListener('click', () => navegarManualmente(k)));

      // Também respeitar quem arrasta o carrossel no celular.
      trilha.addEventListener('pointerdown', () => agendar(PAUSA_CARROSSEL_MANUAL_MS));
      trilha.addEventListener('touchstart', () => agendar(PAUSA_CARROSSEL_MANUAL_MS), { passive: true });

      document.addEventListener('visibilitychange', () => {
        // Evita o avanço imediato ao voltar de outra aba.
        agendar(INTERVALO_CARROSSEL_MS);
      });
      trilha.addEventListener('scroll', () => {
        const novo = Math.round(trilha.scrollLeft / trilha.clientWidth);
        if (Number.isFinite(novo) && novo >= 0 && novo < slides.length && novo !== indice) {
          indice = novo;
          marcarPonto();
        }
      });
      agendar();
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

  /* --------------------- checkout: frete automático ------------------ */
  function iniciarCheckout() {
    const form = $('#formEndereco');
    if (!form) return;
    const opcoes = $('#opcoesFrete');
    const botaoAvancar = $('#botaoIrPagamento');
    const cepInput = $('#campo_cep');
    const enderecoSalvo = $('#usarEnderecoSalvo');
    const campos = $('#camposEndereco');
    const radiosEndereco = $$('input[name=enderecoSalvo]', document);
    let versao = 0;
    let timer = null;
    let ultimoCep = '';
    let enderecoNovoInicializado = false;
    const campoUF = form.querySelector('[name="uf"]');
    const campoCidade = form.querySelector('[name="cidade"]');
    const campoRua = form.querySelector('[name="logradouro"]');
    const campoNumero = form.querySelector('[name="numero"]');
    const campoComplemento = form.querySelector('[name="complemento"]');
    const campoBairro = form.querySelector('[name="bairro"]');
    const statusCep = $('#avisoCepAutomatico');
    const dizerCep = (msg) => { if(statusCep) statusCep.textContent=msg; };
    const limparLocalidade = () => {
      // Nunca herdar número, complemento ou localidade do endereço anterior.
      // Nome e telefone do destinatário continuam preenchidos.
      if(campoUF) campoUF.value='';
      if(campoCidade) campoCidade.value='';
      if(campoRua) campoRua.value='';
      if(campoNumero) campoNumero.value='';
      if(campoComplemento) campoComplemento.value='';
      if(campoBairro) campoBairro.value='';
    };

    // Nunca inserir HTML do cadastro ou da API sem escapar: CEP, cidade e
    // textos da cotação podem conter dados inseridos pelos clientes.
    const escapar = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const opcaoAtual = () => radiosEndereco.find(r => r.checked && r.value !== 'novo');
    const enderecoAtual = () => {
      const salvo = opcaoAtual();
      if(salvo) return {cep:salvo.dataset.cep||'',
        cidade:salvo.dataset.cidade||'',uf:salvo.dataset.uf||'',salvo:true};
      const pegar = (nome) => form.querySelector('[name="'+nome+'"]')?.value || '';
      return {cep:pegar('cep'),cidade:pegar('cidade'),uf:pegar('uf'),salvo:false};
    };
    const alternarCampos = () => {
      const salvo = opcaoAtual();
      if (enderecoSalvo) enderecoSalvo.value = salvo ? '1' : '';
      if(campos){
        campos.hidden=!!salvo;
        $$('input, select, textarea',campos).forEach(campo => campo.disabled=!!salvo);
      }
      const outroEscolhido=radiosEndereco.some(r=>r.checked&&r.value==='novo');
      if(outroEscolhido&&!enderecoNovoInicializado){
        enderecoNovoInicializado=true;
        for(const nome of ['cep','logradouro','numero','complemento','bairro','cidade','uf']){
          const input=form.querySelector('[name="'+nome+'"]');
          if(input)input.value='';
        }
        ultimoCep='';
        dizerCep('Digite o CEP para identificar cidade e estado automaticamente.');
      }
    };
    const aviso = (mensagem) => {
      opcoes.innerHTML='<p class="texto-pequeno texto-suave" role="status">'+escapar(mensagem)+'</p>';
      botaoAvancar.disabled=true;
    };
    const desenhar = (dados) => {
      if(!dados.disponivel||!Array.isArray(dados.opcoes)||!dados.opcoes.length){
        aviso(dados.motivo||'Entrega indisponível para este CEP.');
        return;
      }
      const forma = (dados.opcoes.length===1)
        ? 'Entrega disponível' : 'Selecione como deseja receber';
      opcoes.innerHTML='<h3>'+forma+'</h3>'+
        dados.opcoes.map((o,i)=>'<label class="opcao-frete '+(i===0?'selecionada':'')+'">'+
          '<input type="radio" name="freteOpcao" value="'+escapar(o.id)+'" '+(i===0?'checked':'')+'>'+
          '<span><strong>'+escapar(o.label)+'</strong><br>'+
          '<span class="texto-pequeno texto-suave">'+escapar(o.prazo||'')+
            (o.detalhe?' — '+escapar(o.detalhe):'')+'</span></span>'+
          '<span class="valor">'+(o.valor===0?'Grátis':
            'R$ '+(Number(o.valor||0)/100).toFixed(2).replace('.',','))+'</span>'+
        '</label>').join('')+
        '<p class="texto-pequeno texto-suave">Frete calculado automaticamente para '+
          escapar(dados.cep||'')+'.</p>';
      $$('input[name=freteOpcao]',opcoes).forEach(radio=>radio.addEventListener('change',()=>{
        $$('.opcao-frete',opcoes).forEach(label=>
          label.classList.toggle('selecionada',label.contains(radio)&&radio.checked));
      }));
      botaoAvancar.disabled=false;
    };

    const calcular = async () => {
      const atual = ++versao;
      const destino=enderecoAtual();
      const cep=destino.cep.replace(/\D/g,'');
      if(cep.length!==8) { aviso('Informe um CEP válido com 8 dígitos.');return; }
      aviso('Calculando frete automaticamente...');
      try {
        // Busca sempre o destino atual, com a UF verificada pelo servidor
        // e cidade preenchida por ViaCEP ou BrasilAPI.
        if(!destino.salvo){
          const info=await api('/api/cep/'+cep);
          if(atual!==versao)return;
          if(!info.valido||!info.uf) {
            aviso(info.erro||'CEP inválido. Confira os oito dígitos.');
            return;
          }
          destino.uf=info.uf;
          if(campoUF)campoUF.value=info.uf;
          if(info.cidade) {
            destino.cidade=info.cidade;
            if(campoCidade)campoCidade.value=info.cidade;
          } else {
            destino.cidade=campoCidade?.value.trim()||'';
          }
          if(info.logradouro&&campoRua&&!campoRua.value.trim())
            campoRua.value=info.logradouro;
          if(info.bairro&&campoBairro&&!campoBairro.value.trim())
            campoBairro.value=info.bairro;
          dizerCep(info.cidade
            ? 'CEP identificado: '+info.cidade+'/'+info.uf+'.'
            : 'Estado identificado: '+info.uf+'. Informe a cidade manualmente.');
          if(!destino.cidade) {
            aviso('Não foi possível localizar a cidade automaticamente. Informe a cidade para continuar.');
            return;
          }
        }
        if(atual!==versao)return;
        const dados=await api('/api/frete',{
          method:'POST',body:{cep,cidade:destino.cidade,uf:destino.uf},
        });
        if(atual!==versao)return;
        desenhar(dados);
      }catch(e) {
        if(atual!==versao)return;
        aviso(e.message||'Não foi possível calcular o frete. Confira o CEP.');
      }
    };
    const agendar = () => {
      // Descarta imediatamente preços e opções do CEP anterior.
      versao++;
      clearTimeout(timer);
      aviso('Verificando CEP e calculando frete...');
      timer=setTimeout(calcular,260);
    };
    radiosEndereco.forEach(radio=>radio.addEventListener('change',()=>{
      alternarCampos();agendar();
    }));
    if(cepInput){
      const alterouCep=()=>{
        const cep=cepInput.value.replace(/\D/g,'');
        if(cep!==ultimoCep){
          ultimoCep=cep;
          limparLocalidade();
          dizerCep('Consultando cidade e estado do novo CEP...');
        }
        agendar();
      };
      cepInput.addEventListener('input',alterouCep);
      cepInput.addEventListener('change',alterouCep);
      cepInput.addEventListener('blur',()=>{
        if(cepInput.value.replace(/\D/g,'').length===8)agendar();
      });
    }
    for(const campo of [campoUF,campoCidade]){
      campo?.addEventListener('change',agendar);
    }
    form.addEventListener('submit',ev=>{
      if(botaoAvancar.disabled||!opcoes.querySelector('input[name=freteOpcao]:checked')){
        ev.preventDefault();
        notificar('Confira o CEP e a forma de entrega.', 'erro');
      }
    });
    alternarCampos();
    // Mesmo que exista uma cotação anterior, sempre calcula de novo ao entrar.
    if(radiosEndereco.length||cepInput?.value.replace(/\D/g,'').length===8){
      ultimoCep=cepInput?.value.replace(/\D/g,'')||'';
      agendar();
    }
  }

  /* ------------------- checkout: abas de pagamento ------------------- */
  function iniciarPagamento() {
    const form = $('#formPagamento');
    if (!form) return;
    const radios = $$('input[name=metodoPagamento]', form);
    const detalhe = $('#detalheCredito');
    const dinheiro=$('#detalheDinheiro');
    const valorTroco=$('#trocoPara');
    const resumoTroco=$('#resumoTroco');
    const totalCentavos=Number(dinheiro?.dataset.totalCentavos||0);
    const formatoMoeda=valor=>new Intl.NumberFormat('pt-BR',{
      style:'currency',currency:'BRL'
    }).format(valor/100);
    const atualizarTroco=()=>{
      if(!valorTroco)return;
      const dinheiroAtivo=radios.some(r=>r.checked&&r.value==='cash');
      const digitado=valorTroco.value.trim();
      valorTroco.disabled=!dinheiroAtivo;
      valorTroco.required=false;
      valorTroco.setCustomValidity('');
      if(!resumoTroco)return;
      resumoTroco.hidden=!dinheiroAtivo;
      if(!dinheiroAtivo)return;
      if(!digitado){
        resumoTroco.textContent='Sem troco. Valor do pedido: '+formatoMoeda(totalCentavos)+
          '. Deixe este campo vazio se for pagar o valor exato.';
        return;
      }
      if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(digitado)){
        valorTroco.setCustomValidity('Informe um valor válido, como 100,00.');
        resumoTroco.textContent='Informe um valor válido, como 100,00.';
        return;
      }
      const entregaCentavos=Math.round(Number(digitado.replace(',','.'))*100);
      if(entregaCentavos<totalCentavos){
        valorTroco.setCustomValidity('O valor para troco não pode ser menor que o total do pedido.');
        resumoTroco.textContent='Valor insuficiente: o pedido custa '+
          formatoMoeda(totalCentavos)+'. Informe quanto entregará em dinheiro.';
        return;
      }
      resumoTroco.textContent='Total do pedido: '+formatoMoeda(totalCentavos)+
        ' | Cliente entregará: '+formatoMoeda(entregaCentavos)+
        ' | Troco a separar: '+formatoMoeda(entregaCentavos-totalCentavos)+'.';
    };
    const alternar = () => {
      const marcado = radios.find((r) => r.checked);
      if (detalhe) detalhe.classList.toggle('visivel', !!marcado && marcado.value === 'credit_card');
      const usaDinheiro=marcado?.value==='cash';
      if(dinheiro)dinheiro.hidden=!usaDinheiro;
      atualizarTroco();
      $('.opcao-pagamento', form).forEach((l) => l.classList.toggle('selecionada', !!marcado && l.contains(marcado)));
    };
    radios.forEach((r) => r.addEventListener('change', alternar));
    valorTroco?.addEventListener('input',atualizarTroco);
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
