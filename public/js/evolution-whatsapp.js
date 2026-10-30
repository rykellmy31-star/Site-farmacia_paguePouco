/* QR Code e estado da conexão da farmácia (sem chave de API no navegador). */
(() => {
  'use strict';
  const button = document.getElementById('evo-gerar-qr');
  const status = document.getElementById('evo-status');
  const box = document.getElementById('evo-qr-caixa');
  const img = document.getElementById('evo-qr-imagem');
  const input = document.getElementById('f_instancia');
  if (!button || !status || !box || !img || !input) return;
  const nomeSalvo = input.value.trim();
  let ocupado = false;
  const nomes = {
    conectado:'✅ WhatsApp conectado',
    conectando:'⏳ Aguardando leitura do QR Code',
    desconectado:'⚠️ WhatsApp desconectado',
    nao_criada:'Instância ainda não conectada',
  };
  function atualizar(estado,erro) {
    status.textContent = erro || nomes[estado] || 'Estado indisponível';
    if (estado === 'conectado') {box.hidden = true;img.removeAttribute('src');}
  }
  async function requisitar(url, options) {
    const response = await fetch(url, {
      credentials:'same-origin',cache:'no-store',
      headers:{'X-Requested-With':'fetch',...options?.headers},
      ...options,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.erro || 'Falha na conexão com a Evolution API.');
    return data;
  }
  async function consultar() {
    if (ocupado || !nomeSalvo) {if(!nomeSalvo) atualizar('', 'Salve o nome da instância para começar.');return;}
    try {
      const data = await requisitar('/admin/api/evolution-whatsapp/status');
      atualizar(data.estado);
    } catch (err) {atualizar('',err.message);}
  }
  button.addEventListener('click',async() => {
    if (ocupado) return;
    if (!nomeSalvo || input.value.trim() !== nomeSalvo) {
      atualizar('', 'Salve as configurações antes de conectar o WhatsApp.');
      return;
    }
    ocupado=true;button.disabled=true;
    atualizar('', 'Gerando conexão segura...');
    try {
      const data=await requisitar('/admin/api/evolution-whatsapp/qr',{
        method:'POST',headers:{'Content-Type':'application/json',
          'X-CSRF-Token':window.PP_ADMIN?.csrf || ''},
        body:'{}',
      });
      atualizar(data.estado);
      if (data.qr && data.qr.startsWith('data:image/png;base64,')) {
        img.src=data.qr;box.hidden=false;
      } else if (data.estado!=='conectado') {
        atualizar(data.estado,'Conexão solicitada. Se o QR não aparecer, clique novamente em Gerar QR Code.');
      }
    } catch(err) {atualizar('',err.message);}
    finally {ocupado=false;button.disabled=false;}
  });
  consultar();
  window.setInterval(() => {if (!document.hidden) consultar();},15000);
})();
