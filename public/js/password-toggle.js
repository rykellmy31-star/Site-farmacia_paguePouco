/**
 * Olhinho de senha — recurso somente visual, sem armazenamento ou envio de dados.
 */
(() => {
  'use strict';
  const olho = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const cortado = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4 20 20"/><path d="M9.9 5.3A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-4 4.7"/><path d="M6.8 6.8C3.7 8.6 2 12 2 12s3.6 7 10 7c1.5 0 2.9-.4 4.2-1"/><path d="M10 10a3 3 0 0 0 4 4"/></svg>';
  function iniciar() {
    document.querySelectorAll('input[type="password"]').forEach(input => {
      if (input.dataset.olhoSenhaPronto === '1' || !input.parentNode) return;
      input.dataset.olhoSenhaPronto = '1';
      const wrapper = document.createElement('div');
      wrapper.className = 'campo-senha-visivel';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);
      const botao = document.createElement('button');
      botao.type = 'button'; // jamais enviar o formulário ao tocar no olho
      botao.className = 'alternar-visibilidade-senha';
      if (input.id) botao.setAttribute('aria-controls', input.id);
      wrapper.appendChild(botao);

      const alternar = mostrar => {
        input.type = mostrar ? 'text' : 'password';
        botao.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
        botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
        botao.title = mostrar ? 'Ocultar senha' : 'Mostrar senha';
        botao.innerHTML = mostrar ? cortado : olho;
      };
      alternar(false);
      botao.addEventListener('click', () => alternar(input.type === 'password'));
      input.form?.addEventListener('submit', () => alternar(false));
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) alternar(false);
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, {once:true});
  } else {
    iniciar();
  }
})();
