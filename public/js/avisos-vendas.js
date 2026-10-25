/* Alertas de pedidos pagos até confirmação persistida pelo funcionário.
 * Necessário painel aberto, Chrome autorizado e sessão autenticada.
 */
(() => {
  'use strict';
  const botao = document.getElementById('pp-avisos-vendas');
  if (!botao) return;
  const CHAVE = 'pp_avisos_pagos_ativo_v2';
  const BASELINE = 'pp_avisos_pagos_baseline_v2';
  const TEMPO = 20000;
  const MINUTO = 60000;
  let ativo = false, ocupado = false, intervalo = null;
  let audio = null;
  const suporte = 'Notification' in window && window.isSecureContext;
  const ultimaNotificacao = new Map();
  const ler = (chave) => { try { return localStorage.getItem(chave); } catch { return null; } };
  const gravar = (chave, valor) => { try { localStorage.setItem(chave, valor); } catch {} };
  const estado = (texto) => { botao.textContent = texto; };
  function som() {
    try {
      if (!audio) return;
      const agora = audio.currentTime;
      for (const [freq,atraso] of [[880,0],[1175,.12],[1568,.24]]) {
        const osc=audio.createOscillator(),ganho=audio.createGain();
        osc.type='sine'; osc.frequency.value=freq;
        ganho.gain.setValueAtTime(.0001,agora+atraso);
        ganho.gain.exponentialRampToValueAtTime(.13,agora+atraso+.018);
        ganho.gain.exponentialRampToValueAtTime(.0001,agora+atraso+.14);
        osc.connect(ganho);ganho.connect(audio.destination);
        osc.start(agora+atraso);osc.stop(agora+atraso+.15);
      }
    } catch {}
  }
  function desligar(texto='🔕 Ativar avisos') {
    ativo=false;
    if(intervalo)clearInterval(intervalo);
    intervalo=null;ultimaNotificacao.clear();
    gravar(CHAVE,'0');estado(texto);
  }
  async function consultar(inicial=false) {
    if(!ativo||ocupado)return;
    ocupado=true;
    try {
      const resposta=await fetch('/admin/api/avisos-vendas',{
        credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},
      });
      if(resposta.status===401||resposta.status===403){desligar('🔕 Sessão encerrada');return;}
      if(!resposta.ok)throw Error('Consulta falhou');
      const dados=await resposta.json();
      if(!dados.ok||!Array.isArray(dados.vendas))throw Error('Resposta inválida');
      const pendentes=dados.vendas;
      const ids=new Set(pendentes.map(p=>p.id+':'+p.aprovadoEm));
      for(const chave of ultimaNotificacao.keys())if(!ids.has(chave))ultimaNotificacao.delete(chave);
      if(inicial) {
        // Não alertar retroativamente na primeira ativação; ciclos futuros lembrarão pendências.
        for(const venda of pendentes)ultimaNotificacao.set(venda.id+':'+venda.aprovadoEm,Date.now());
        gravar(BASELINE,'1');
      } else {
        const agora=Date.now();
        const avisar=pendentes.filter(v=>{
          const ultima=ultimaNotificacao.get(v.id+':'+v.aprovadoEm);
          return !ultima||agora-ultima>=MINUTO;
        });
        for(const venda of avisar)ultimaNotificacao.set(venda.id+':'+venda.aprovadoEm,agora);
        if(avisar.length&&Notification.permission==='granted') {
          som();
          for(const venda of avisar.slice(0,3)){
            const valor=(Math.max(0,Number(venda.totalCentavos)||0)/100)
              .toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
            const n=new Notification('🔔 Pedido aguardando recebimento — '+venda.codigo,{
              body:'Pagamento aprovado: '+valor+'\nConfirme “Pedido Recebido” no painel.',
              tag:'pp-recebimento-'+venda.id,
              renotify:true,
              requireInteraction:true,
              icon:'/img/favicon.svg?v=20261021-vermelho',
            });
            n.onclick=()=>{window.focus();window.location.assign('/admin/pedidos/'+encodeURIComponent(venda.id));n.close();};
          }
          if(avisar.length>3)new Notification('Farmácia Pague Pouco — pedidos pendentes',{
            body:'Há '+avisar.length+' pedidos aguardando confirmação.',
            tag:'pp-pedidos-resumo',renotify:true,
          });
        }
      }
      estado('🔔 Avisos ligados · '+pendentes.length+' pendente(s)');
    } catch {
      if(ativo)estado('🔔 Avisos ligados (verificar conexão)');
    } finally { ocupado=false; }
  }
  async function ligar(retomada=false) {
    if(!suporte){estado('🔕 Navegador sem suporte');return;}
    let permissao=Notification.permission;
    if(!retomada&&permissao!=='granted')permissao=await Notification.requestPermission();
    if(permissao!=='granted'){desligar('🔕 Permissão negada');return;}
    if(!retomada){
      try{
        const AudioContext=window.AudioContext||window.webkitAudioContext;
        if(AudioContext){audio=new AudioContext();await audio.resume();}
      }catch{}
    }
    ativo=true;gravar(CHAVE,'1');
    await consultar(!retomada&&ler(BASELINE)!=='1');
    if(ativo&&!intervalo)intervalo=setInterval(()=>consultar(false),TEMPO);
  }
  botao.addEventListener('click',()=>ativo?desligar():ligar(false));
  if(suporte&&Notification.permission==='granted'&&ler(CHAVE)==='1')ligar(true);
})();
