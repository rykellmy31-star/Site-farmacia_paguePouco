/* ==========================================================================
   FARMÁCIA PAGUE POUCO — JavaScript do PAINEL ADMINISTRATIVO
   Uploads, editor de texto rico, ações AJAX e galeria de mídia.
   ========================================================================== */
(function () {
  'use strict';

  const CFG = window.PP_ADMIN || { csrf: '' };
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

  function notificar(msg, tipo) {
    const el = $('#notificacaoAdmin');
    if (!el) return;
    el.textContent = msg;
    el.style.background = tipo === 'erro' ? 'var(--erro)' : 'var(--primaria-escura)';
    el.classList.add('visivel');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visivel'), 3600);
  }

  async function api(path, opts) {
    const o = Object.assign({ credentials: 'same-origin' }, opts || {});
    o.headers = Object.assign({ 'X-CSRF-Token': CFG.csrf, 'X-Requested-With': 'fetch' }, o.headers || {});
    if (o.body && !(o.body instanceof FormData)) {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const r = await fetch(path, o);
    let dados = null;
    try { dados = await r.json(); } catch (e) { dados = null; }
    if (!r.ok || (dados && dados.ok === false)) throw new Error((dados && dados.erro) || 'Não foi possível concluir.');
    return dados || { ok: true };
  }

  async function post(path, body) { return api(path, { method: 'POST', body: body || {} }); }

  /* ------------------------------ uploads ------------------------------ */
  function configurarUpload(zonaSel, inputSel, aoEnviar) {
    const zona = $(zonaSel);
    const input = $(inputSel);
    if (!zona || !input) return;
    const abrir = () => input.click();
    zona.addEventListener('click', abrir);
    zona.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } });
    ['dragenter', 'dragover'].forEach((evt) => zona.addEventListener(evt, (ev) => { ev.preventDefault(); zona.style.borderColor = 'var(--primaria)'; }));
    ['dragleave', 'drop'].forEach((evt) => zona.addEventListener(evt, (ev) => { ev.preventDefault(); zona.style.borderColor = ''; }));
    zona.addEventListener('drop', (ev) => {
      if (ev.dataTransfer && ev.dataTransfer.files.length) enviar(ev.dataTransfer.files);
    });
    input.addEventListener('change', () => { if (input.files.length) enviar(input.files); });

    async function enviar(files) {
      const fd = new FormData();
      Array.from(files).slice(0, 10).forEach((f) => fd.append('arquivo', f));
      zona.style.opacity = '.6';
      try {
        const dados = await api('/admin/api/upload', { method: 'POST', body: fd });
        const ok = (dados.arquivos || []).filter((a) => a.ok);
        const falhas = (dados.arquivos || []).filter((a) => !a.ok);
        if (ok.length) notificar(`${ok.length} arquivo(s) enviado(s) com sucesso.`);
        if (falhas.length) notificar(falhas.map((f) => f.erro).join(' '), 'erro');
        if (aoEnviar) aoEnviar(ok.map((a) => a.arquivo), falhas);
      } catch (err) {
        notificar(err.message, 'erro');
      } finally {
        zona.style.opacity = '';
        input.value = '';
      }
    }
  }

  function adicionarAoFormProduto(arquivos) {
    const form = $('#formProduto');
    if (!form) return;
    const galeria = $('#galeriaProduto');
    arquivos.forEach((a) => {
      if (a.tipo === 'image') {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'imagens[]';
        input.value = a.url;
        form.appendChild(input);
        const leg = document.createElement('input');
        leg.type = 'hidden';
        leg.name = 'imagemLegenda[]';
        leg.value = '';
        form.appendChild(leg);
        if (galeria) {
          const div = document.createElement('div');
          div.className = 'item-midia';
          div.innerHTML = `<img src="${a.url}" alt=""><div class="acoes-item texto-pequeno">Nova imagem (salve o produto para confirmar)</div>`;
          galeria.appendChild(div);
        }
      } else if (a.tipo === 'video') {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'videos[]';
        input.value = a.url;
        form.appendChild(input);
        if (galeria) {
          const div = document.createElement('div');
          div.className = 'item-midia';
          div.innerHTML = `<video src="${a.url}" muted></video><div class="acoes-item texto-pequeno">Novo vídeo (salve para confirmar)</div>`;
          galeria.appendChild(div);
        }
      }
    });
  }

  configurarUpload('#zonaUpload', '#inputUpload', adicionarAoFormProduto);
  configurarUpload('#zonaUploadMidia', '#inputUploadMidia', () => setTimeout(() => location.reload(), 900));
  configurarUpload('#zonaUploadBanner', '#inputUploadBanner', (arquivos) => {
    const campo = $('#campoBannerImagem');
    if (campo && arquivos[0]) campo.value = arquivos[0].url;
  });

  /* --------------------------- editor de texto -------------------------- */
  $$('[data-editor]').forEach((editor) => {
    const botoes = $$('.ferramentas button', editor);
    const area = $('.area', editor);
    botoes.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const cmd = btn.getAttribute('data-cmd');
        area.focus();
        if (cmd && cmd.startsWith('formatBlock:')) {
          document.execCommand('formatBlock', false, cmd.split(':')[1]);
        } else if (cmd === 'createLink') {
          const url = prompt('Endereço do link (comece com https:// ou /):', 'https://');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
      });
    });
  });

  // sincroniza editores com os campos ocultos antes de enviar
  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    const edPagina = $('#editorPagina');
    if (edPagina && $('#campoConteudo') && form.contains(edPagina)) {
      $('#campoConteudo').value = edPagina.innerHTML;
    }
    const edDesc = $('#editorDescricao');
    if (edDesc && $('#campoDescricao') && form.contains(edDesc)) {
      $('#campoDescricao').value = edDesc.innerHTML;
    }
  });

  /* ------------------------- características --------------------------- */
  function renderCaracteristicas() {
    const wrap = $('[data-caracteristicas]');
    if (!wrap) return;
    let dados = {};
    try { dados = JSON.parse(wrap.getAttribute('data-caracteristicas') || '{}'); } catch (e) { dados = {}; }
    const desenhar = () => {
      wrap.innerHTML = Object.entries(dados).map(([k, val], i) => `
        <div class="campo-linha" data-carac="${i}">
          <div class="campo"><label>Nome</label><input class="entrada" type="text" value="${k.replace(/"/g, '&quot;')}" data-carac-nome="${i}"></div>
          <div class="campo"><label>Valor</label><input class="entrada" type="text" value="${String(val).replace(/"/g, '&quot;')}" data-carac-valor="${i}"></div>
          <div class="campo" style="flex:0 0 auto;display:flex;align-items:flex-end">
            <button class="botao pequeno perigo" type="button" data-carac-remover="${i}">Remover</button>
          </div>
        </div>`).join('') +
        `<div class="campo-linha">
          <div class="campo"><label>Nova característica</label><input class="entrada" type="text" id="novaCaracNome" placeholder="Ex.: Tipo de pele"></div>
          <div class="campo"><label>Valor</label><input class="entrada" type="text" id="novaCaracValor" placeholder="Ex.: Oleosa"></div>
          <div class="campo" style="flex:0 0 auto;display:flex;align-items:flex-end">
            <button class="botao pequeno" type="button" id="addCarac">Adicionar</button>
          </div>
        </div>`;
      $$('[data-carac-remover]', wrap).forEach((b) => b.addEventListener('click', () => {
        const idx = Number(b.getAttribute('data-carac-remover'));
        const chaves = Object.keys(dados);
        delete dados[chaves[idx]];
        sincronizar(wrap, dados);
        desenhar();
      }));
      const add = $('#addCarac', wrap);
      if (add) add.addEventListener('click', () => {
        const n = $('#novaCaracNome', wrap).value.trim();
        const v = $('#novaCaracValor', wrap).value.trim();
        if (!n) return;
        dados[n] = v;
        sincronizar(wrap, dados);
        desenhar();
      });
      $$('[data-carac-nome]', wrap).forEach((inp) => inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-carac-nome'));
        const chaves = Object.keys(dados);
        const velho = chaves[idx];
        const novo = inp.value.trim();
        if (!novo || novo === velho) return;
        const valores = Object.entries(dados);
        dados = {};
        valores.forEach(([k, val], i) => { dados[i === idx ? novo : k] = val; });
        sincronizar(wrap, dados);
        desenhar();
      }));
      $$('[data-carac-valor]', wrap).forEach((inp) => inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-carac-valor'));
        const chave = Object.keys(dados)[idx];
        dados[chave] = inp.value.trim();
        sincronizar(wrap, dados);
      }));
    };
    desenhar();
  }
  function sincronizar(wrap, dados) {
    wrap.setAttribute('data-caracteristicas', JSON.stringify(dados));
    const form = $('#formProduto');
    if (!form) return;
    let campo = form.querySelector('input[name=caracteristicas]');
    if (!campo) {
      campo = document.createElement('input');
      campo.type = 'hidden';
      campo.name = 'caracteristicas';
      form.appendChild(campo);
    }
    campo.value = JSON.stringify(dados);
  }
  renderCaracteristicas();

  /* --------------------------- ações genéricas -------------------------- */
  document.addEventListener('click', async (ev) => {
    const alvo = (seletor) => ev.target.closest(seletor);

    const excluirProd = alvo('[data-excluir-produto]');
    if (excluirProd) {
      const id = excluirProd.getAttribute('data-excluir-produto');
      const nome = excluirProd.getAttribute('data-nome') || 'este produto';
      if (!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita (produtos com pedidos são apenas desativados).`)) return;
      try {
        const r = await post(`/admin/api/produtos/${id}/excluir`);
        notificar(r.mensagem || 'Produto excluído.');
        setTimeout(() => location.reload(), 700);
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altProd = alvo('[data-alternar-produto]');
    if (altProd) {
      try { await post(`/admin/api/produtos/${altProd.getAttribute('data-alternar-produto')}/ativar`); location.reload(); }
      catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const aprovarProd = alvo('[data-aprovar-produto]');
    if (aprovarProd) {
      const id = aprovarProd.getAttribute('data-aprovar-produto');
      const status = aprovarProd.getAttribute('data-status');
      if (!id) { notificar('Salve o produto antes de aprovar.', 'erro'); return; }
      try {
        await post(`/admin/api/produtos/${id}/aprovar`, { status });
        notificar('Situação sanitária atualizada.');
        setTimeout(() => location.reload(), 600);
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const defPrincipal = alvo('[data-definir-principal]');
    if (defPrincipal) {
      const idx = Number(defPrincipal.getAttribute('data-definir-principal'));
      const itens = $$('#galeriaProduto .item-midia[data-tipo=image]');
      const alvo2 = itens[idx];
      if (!alvo2 || !alvo2.parentNode) return;
      alvo2.parentNode.insertBefore(alvo2, alvo2.parentNode.firstChild);
      notificar('Imagem marcada como principal (salve o produto para confirmar).');
      return;
    }

    const removerImg = alvo('[data-remover-imagem]');
    if (removerImg) {
      const idx = Number(removerImg.getAttribute('data-remover-imagem'));
      const item = $$('#galeriaProduto .item-midia[data-tipo=image]')[idx];
      if (item) item.remove();
      notificar('Imagem removida (salve o produto para confirmar).');
      return;
    }

    const removerVideo = alvo('[data-remover-video]');
    if (removerVideo) {
      const idx = Number(removerVideo.getAttribute('data-remover-video'));
      const item = $$('#galeriaProduto .item-midia[data-tipo=video]')[idx];
      if (item) item.remove();
      notificar('Vídeo removido (salve o produto para confirmar).');
      return;
    }

    const editarCat = alvo('[data-editar-categoria]');
    if (editarCat) {
      const id = editarCat.getAttribute('data-editar-categoria');
      const linha = editarCat.closest('tr');
      const nomeAtual = linha.children[0].textContent.replace('↳', '').trim();
      const nome = prompt('Nome da categoria:', nomeAtual);
      if (nome == null) return;
      const icone = prompt('Ícone/emoji:', linha.children[1].textContent.trim());
      const ordem = prompt('Ordem:', linha.children[3].textContent.trim() || '99');
      try {
        await post(`/admin/api/categorias/${id}`, { nome, icone, ordem });
        notificar('Categoria atualizada.');
        location.reload();
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altCat = alvo('[data-alternar-categoria]');
    if (altCat) {
      try { await post(`/admin/api/categorias/${altCat.getAttribute('data-alternar-categoria')}/ativar`); location.reload(); }
      catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const excCat = alvo('[data-excluir-categoria]');
    if (excCat) {
      if (!confirm(`Excluir a categoria "${excCat.getAttribute('data-nome')}"?`)) return;
      try {
        await post(`/admin/api/categorias/${excCat.getAttribute('data-excluir-categoria')}/excluir`);
        location.reload();
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const excMidia = alvo('[data-excluir-midia]');
    if (excMidia) {
      if (!confirm('Excluir este arquivo?')) return;
      try {
        await post(`/admin/api/midia/${excMidia.getAttribute('data-excluir-midia')}/excluir`);
        notificar('Arquivo excluído.');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        if (confirm(`${err.message}\n\nDeseja forçar a exclusão mesmo assim?`)) {
          try {
            await post(`/admin/api/midia/${excMidia.getAttribute('data-excluir-midia')}/excluir`, { forcar: '1' });
            setTimeout(() => location.reload(), 600);
          } catch (e2) { notificar(e2.message, 'erro'); }
        }
      }
      return;
    }

    const copiarUrl = alvo('[data-copiar-url]');
    if (copiarUrl) {
      const url = location.origin + copiarUrl.getAttribute('data-copiar-url');
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      notificar('URL copiada: ' + url);
      return;
    }

    const copiar = alvo('[data-copiar]');
    if (copiar) {
      const el = document.querySelector(copiar.getAttribute('data-copiar'));
      if (el && navigator.clipboard) {
        navigator.clipboard.writeText(el.textContent.trim());
        notificar('Conteúdo copiado.');
      }
      return;
    }

    const altBanner = alvo('[data-alternar-banner]');
    if (altBanner) {
      try { await post(`/admin/api/banners/${altBanner.getAttribute('data-alternar-banner')}/ativar`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }
    const excBanner = alvo('[data-excluir-banner]');
    if (excBanner) {
      if (!confirm('Excluir este banner?')) return;
      try { await post(`/admin/api/banners/${excBanner.getAttribute('data-excluir-banner')}/excluir`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altCupom = alvo('[data-alternar-cupom]');
    if (altCupom) {
      try { await post(`/admin/api/cupons/${altCupom.getAttribute('data-alternar-cupom')}/ativar`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }
    const excCupom = alvo('[data-excluir-cupom]');
    if (excCupom) {
      if (!confirm('Excluir este cupom?')) return;
      try { await post(`/admin/api/cupons/${excCupom.getAttribute('data-excluir-cupom')}/excluir`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const simular = alvo('[data-simular-pagamento]');
    if (simular) {
      const status = simular.getAttribute('data-status');
      if (!confirm(status === 'approved' ? 'Simular APROVAÇÃO do pagamento (ambiente de testes)?' : 'Simular RECUSA do pagamento?')) return;
      try {
        const pedidoId = location.pathname.split('/').pop();
        await post(`/admin/api/pedidos/${pedidoId}/simular-pagamento`, { status });
        notificar('Pagamento atualizado. O estoque e o status foram processados.');
        setTimeout(() => location.reload(), 800);
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const estornar = alvo('[data-estornar-pagamento]');
    if (estornar) {
      if (!confirm('Solicitar ESTORNO deste pagamento?')) return;
      try {
        const pedidoId = location.pathname.split('/').pop();
        await post(`/admin/api/pedidos/${pedidoId}/estornar`);
        notificar('Estorno solicitado.');
        setTimeout(() => location.reload(), 800);
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altCliente = alvo('[data-alternar-cliente]');
    if (altCliente) {
      try { await post(`/admin/api/clientes/${altCliente.getAttribute('data-alternar-cliente')}/ativar`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altPagina = alvo('[data-alternar-pagina]');
    if (altPagina) {
      try { await post(`/admin/api/paginas/${altPagina.getAttribute('data-alternar-pagina')}/publicar`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }
    const excPagina = alvo('[data-excluir-pagina]');
    if (excPagina) {
      if (!confirm(`Excluir a página "${excPagina.getAttribute('data-nome')}"?`)) return;
      try { await post(`/admin/api/paginas/${excPagina.getAttribute('data-excluir-pagina')}/excluir`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altUser = alvo('[data-alternar-usuario]');
    if (altUser) {
      try { await post(`/admin/api/usuarios/${altUser.getAttribute('data-alternar-usuario')}/ativar`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }
    const resetUser = alvo('[data-resetar-senha]');
    if (resetUser) {
      const nova = prompt('Nova senha provisória (mínimo 8 caracteres, com letras e números). Deixe vazio para gerar automaticamente:', '');
      if (nova === null) return;
      try {
        const r = await post(`/admin/api/usuarios/${resetUser.getAttribute('data-resetar-senha')}/senha`, { senha: nova });
        alert(`Senha redefinida.\n\nSenha provisória: ${r.senhaProvisoria}\n\n${r.aviso || ''}`);
      } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const excExc = alvo('[data-excluir-excecao]');
    if (excExc) {
      if (!confirm('Excluir esta exceção de frete?')) return;
      try { await post(`/admin/api/fretes/excecao/${excExc.getAttribute('data-excluir-excecao')}/excluir`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }

    const altVitrine = alvo('[data-alternar-vitrine]');
    if (altVitrine) {
      try { await post(`/admin/api/aparencia/vitrines/${altVitrine.getAttribute('data-alternar-vitrine')}/ativar`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }
    const excVitrine = alvo('[data-excluir-vitrine]');
    if (excVitrine) {
      if (!confirm('Excluir esta vitrine?')) return;
      try { await post(`/admin/api/aparencia/vitrines/${excVitrine.getAttribute('data-excluir-vitrine')}/excluir`); location.reload(); } catch (err) { notificar(err.message, 'erro'); }
      return;
    }
  });

  /* --------------------- máscara de CEP e preços ------------------------ */
  $$('input[data-mascara-cep]').forEach((inp) => {
    inp.addEventListener('input', () => {
      let v = inp.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
      inp.value = v;
    });
  });
})();
