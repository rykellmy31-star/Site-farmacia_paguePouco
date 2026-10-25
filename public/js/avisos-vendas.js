/* Avisos de vendas pagas da Farmácia Pague Pouco.
 * Requer Chrome em HTTPS, sessão administrativa, aba aberta e permissão concedida.
 * Não depende do V3/V4, não usa webhook público nem expõe dados de clientes.
 */
(() => {
  'use strict';
  const botao = document.getElementById('pp-avisos-vendas');
  if (!botao) return;
  const ATIVO = 'pp_avisos_pagos_ativo_v1';
  const VISTOS = 'pp_avisos_pagos_vistos_v1';
  const INTERVALO = 20000;
  let ativo = false, carregando = false, timer = null;
  const suportado = 'Notification' in window && window.isSecureContext;
  const memoria = new Set();

  function lerVistos() {
    try {
      const arr = JSON.parse(localStorage.getItem(VISTOS) || '[]');
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string').slice(-200) : [];
    } catch { return []; }
  }
  function salvarVistos(items) {
    try { localStorage.setItem(VISTOS, JSON.stringify(items.slice(-200))); }
    catch { /* storage indisponível: a memória desta aba continua */ }
  }
  function status(mensagem) {
    botao.textContent = mensagem;
    botao.title = 'Notificações de pagamentos aprovados. Mantenha o painel aberto numa aba do Chrome.';
  }
  function desativar(mensagem = '🔕 Ativar avisos') {
    ativo = false;
    if (timer) clearInterval(timer);
    timer = null;
    try { localStorage.setItem(ATIVO, '0'); } catch {}
    status(mensagem);
  }
  async function consultar(inicial = false) {
    if (!ativo || carregando) return;
    carregando = true;
    try {
      const r = await fetch('/admin/api/avisos-vendas', {
        credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401 || r.status === 403) {
        desativar('🔕 Sessão encerrada');
        return;
      }
      if (!r.ok) throw Error('Consulta indisponível');
      const dados = await r.json();
      if (!dados.ok || !Array.isArray(dados.vendas)) throw Error('Formato inválido');
      const conhecidas = new Set([...lerVistos(), ...memoria]);
      const novidades = [];
      // O servidor retorna da mais recente para a mais antiga.
      for (const venda of dados.vendas.slice().reverse()) {
        if (!venda || typeof venda.id !== 'string' || typeof venda.aprovadoEm !== 'string') continue;
        const chave = venda.id + ':' + venda.aprovadoEm;
        if (conhecidas.has(chave)) continue;
        conhecidas.add(chave);
        memoria.add(chave);
        if (!inicial) novidades.push(venda);
      }
      // Grava antes de notificar; impede reaviso após F5 e em outras abas.
      salvarVistos([...conhecidas]);
      if (Notification.permission !== 'granted') {
        desativar('🔕 Permissão desativada');
        return;
      }
      if (novidades.length) {
        const maximo = 3;
        for (const venda of novidades.slice(-maximo)) {
          const preco = (Math.max(0, Number(venda.totalCentavos) || 0) / 100)
            .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const aviso = new Notification('✅ Venda paga — ' + String(venda.codigo || 'Pedido'), {
            body: 'Pagamento aprovado: ' + preco + '\nClique para abrir o pedido.',
            tag: 'pp-pedido-' + venda.id,
            icon: '/img/favicon.svg?v=20261021-vermelho',
          });
          aviso.onclick = () => {
            window.focus();
            window.location.assign('/admin/pedidos/' + encodeURIComponent(venda.id));
            aviso.close();
          };
        }
        if (novidades.length > maximo) {
          new Notification('Farmácia Pague Pouco — novas vendas', {
            body: 'Mais ' + (novidades.length - maximo) + ' pagamentos aprovados. Confira o painel.',
            tag: 'pp-vendas-resumo',
          });
        }
      }
      status('🔔 Avisos ligados');
    } catch {
      if (ativo) status('🔔 Avisos ligados (conferir rede)');
    } finally {
      carregando = false;
    }
  }
  async function ativar({retomada = false} = {}) {
    if (!suportado) { status('🔕 Navegador sem suporte'); return; }
    let permissao = Notification.permission;
    // Solicitação disparada somente por ação explícita do usuário.
    if (!retomada && permissao !== 'granted') permissao = await Notification.requestPermission();
    if (permissao !== 'granted') { desativar('🔕 Permissão negada'); return; }
    ativo = true;
    try { localStorage.setItem(ATIVO, '1'); } catch {}
    status('🔔 Avisos ligados');
    // Na primeira ativação não emitir alertas antigos.
    await consultar(!retomada || (!lerVistos().length));
    if (ativo && !timer) timer = setInterval(() => consultar(false), INTERVALO);
  }
  botao.addEventListener('click', () => {
    if (ativo) desativar();
    else ativar();
  });
  if (suportado && Notification.permission === 'granted') {
    try { if (localStorage.getItem(ATIVO) === '1') ativar({retomada:true}); } catch {}
  } else if (suportado && Notification.permission === 'denied') {
    status('🔕 Permissão negada');
  }
})();
