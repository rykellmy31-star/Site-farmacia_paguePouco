/* Painel do entregador: sequência manual e confirmação de pagamento no local. */
(function(){
  'use strict';
  const selecao=document.querySelectorAll('[data-driver-pedido]');
  const ordem=[];
  const hidden=document.getElementById('ordemEntregas');
  const sair=document.getElementById('sairComEntregas');
  function desenhar(){
    selecao.forEach(x=>{
      const id=x.getAttribute('data-driver-pedido');
      const numero=x.closest('[data-driver-opcao]')?.querySelector('[data-driver-numero]');
      if(numero)numero.textContent=ordem.includes(id)?String(ordem.indexOf(id)+1):'—';
    });
    if(hidden)hidden.value=ordem.join(',');
    if(sair){
      sair.disabled=!ordem.length;
      sair.textContent='🛵 Sair com entregas ('+ordem.length+')';
    }
  }
  selecao.forEach(x=>x.addEventListener('change',()=>{
    const id=x.getAttribute('data-driver-pedido');
    const i=ordem.indexOf(id);
    if(i>=0)ordem.splice(i,1);
    if(x.checked)ordem.push(id);
    desenhar();
  }));
  desenhar();
  document.querySelectorAll('[data-driver-pagamento]').forEach(select=>{
    const form=select.closest('form');
    const detalhes=form?.querySelector('[data-driver-cartao]');
    const bandeira=detalhes?.querySelector('select[name=bandeira]');
    const parcelas=detalhes?.querySelector('select[name=parcelas]');
    function atualizar(){
      const cartao=select.value==='credit_card'||select.value==='debit_card';
      if(detalhes)detalhes.hidden=!cartao;
      if(bandeira)bandeira.required=cartao;
      if(parcelas){
        parcelas.disabled=!cartao;
        if(select.value==='debit_card')parcelas.value='1';
        [...parcelas.options].forEach(o=>{
          o.disabled=select.value==='debit_card'&&o.value!=='1';
        });
      }
    }
    select.addEventListener('change',atualizar);
    atualizar();
  });
  document.querySelectorAll('[data-driver-confirmar-problema]').forEach(el=>
    el.addEventListener('click',ev=>{
      if(!confirm('Confirmar entrega não realizada? O pedido ficará pendente de conferência da farmácia.'))
        ev.preventDefault();
    }));
})();
