(() => {
  'use strict';
  const modal=document.getElementById('ppbv');
  if(!modal) return;
  const iniciar=modal.querySelector('[data-bv-iniciar]');
  const confirmar=modal.querySelector('[data-bv-confirmar]');
  const sucesso=modal.querySelector('[data-bv-concluido]');
  const feedback=modal.querySelector('[data-bv-feedback]');
  const chave='pp_bv_exibir_apos';
  let desafio='';
  const podeAbrir=()=>{
    try { return Date.now()>=Number(localStorage.getItem(chave)||0); }
    catch { return true; }
  };
  if(!podeAbrir()) return;
  const anterior=document.activeElement;
  const fechar=(dias=7)=>{
    modal.hidden=true;
    document.body.classList.remove('ppbv-aberto');
    try { localStorage.setItem(chave,String(Date.now()+dias*86400000)); } catch {}
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
    if(!podeAbrir()) return;
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
      try {localStorage.setItem(chave,String(Date.now()+365*86400000));}catch{}
    }catch(erro){mostrarMensagem(erro.message);}
    finally{button.disabled=false;}
  });
})();
