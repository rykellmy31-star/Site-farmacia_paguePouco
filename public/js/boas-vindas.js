(() => {
  'use strict';
  const modal=document.getElementById('ppbv');
  if(!modal) return;
  const iniciar=modal.querySelector('[data-bv-iniciar]');
  const confirmar=modal.querySelector('[data-bv-confirmar]');
  const sucesso=modal.querySelector('[data-bv-concluido]');
  const feedback=modal.querySelector('[data-bv-feedback]');
  // A chave nova ignora a antiga pausa de 7 dias aplicada a quem só fechou.
  const chave='pp_bv_proxima_exibicao_v2';
  const cadastroConcluido='pp_bv_cadastro_confirmado_v2';
  const previsualizacao=new URLSearchParams(location.search).get('visualizarBoasVindas')==='1';
  const horas=Number(modal.dataset.intervaloHoras);
  const intervaloHoras=Number.isSafeInteger(horas)&&horas>=1&&horas<=168?horas:6;
  let desafio='';
  let cadastroConfirmado=false;
  const podeAbrir=()=>{
    try {
      return localStorage.getItem(cadastroConcluido)!=='1' &&
        Date.now()>=Number(localStorage.getItem(chave)||0);
    } catch { return !cadastroConfirmado; }
  };
  if(!previsualizacao && !podeAbrir()) return;
  const anterior=document.activeElement;
  const fechar=()=>{
    modal.hidden=true;
    document.body.classList.remove('ppbv-aberto');
    if(!previsualizacao && !cadastroConfirmado) {
      try { localStorage.setItem(chave,String(Date.now()+intervaloHoras*3600000)); } catch {}
    }
    anterior?.focus?.();
  };
  const mostrarMensagem=(mensagem)=>{
    feedback.textContent=mensagem;
    feedback.hidden=!mensagem;
  };
  modal.querySelector('[data-bv-fechar]').addEventListener('click',()=>fechar());
  modal.addEventListener('click',event=>{if(event.target===modal) fechar();});
  document.addEventListener('keydown',event=>{
    if(!modal.hidden && event.key==='Escape') fechar();
  });
  setTimeout(()=>{
    if(!previsualizacao && !podeAbrir()) return;
    modal.hidden=false;
    document.body.classList.add('ppbv-aberto');
    modal.querySelector('[data-bv-fechar]')?.focus();
  },1800);

  async function enviar(url,payload){
    const response=await fetch(url,{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json',
        'X-CSRF-Token':window.PP_CONFIG?.csrf||'',
        'X-Requested-With':'fetch'},
      body:JSON.stringify(payload)
    });
    const body=await response.json();
    if(!response.ok || !body.ok)
      throw new Error(body.erro||body.error||'Não foi possível concluir. Tente novamente.');
    return body;
  }
  iniciar.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=iniciar.querySelector('button[type="submit"]');
    button.disabled=true;
    mostrarMensagem('');
    const data=new FormData(iniciar);
    try{
      const result=await enviar('/api/boas-vindas/iniciar',{
        nome:data.get('nome'),email:data.get('email'),telefone:data.get('telefone'),
        politica:data.has('politica')?'1':'0',
        marketing:data.has('marketing')?'1':'0',
        receberCupomWhatsapp:data.has('receberCupomWhatsapp')?'1':'0'
      });
      desafio=result.desafio;
      iniciar.hidden=true;
      confirmar.hidden=false;
      confirmar.querySelector('input')?.focus();
    }catch(erro){mostrarMensagem(erro.message);}
    finally{button.disabled=false;}
  });
  confirmar.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=confirmar.querySelector('button[type="submit"]');
    button.disabled=true;
    mostrarMensagem('');
    try{
      const result=await enviar('/api/boas-vindas/confirmar',{
        desafio,codigo:confirmar.querySelector('[name="codigo"]').value
      });
      confirmar.hidden=true;
      sucesso.hidden=false;
      sucesso.querySelector('[data-bv-cupom]').textContent=result.codigo;
      const data=new Date(result.expiraEm);
      sucesso.querySelector('[data-bv-validade]').textContent=
        'Válido até '+data.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+
        ' ('+result.validadeHoras+' horas após a confirmação).';
      cadastroConfirmado=true;
      try {
        localStorage.setItem(cadastroConcluido,'1');
        localStorage.removeItem(chave);
      } catch {}
    }catch(erro){mostrarMensagem(erro.message);}
    finally{button.disabled=false;}
  });
})();
