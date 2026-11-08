/* Contagem consentida de visitas, sem MAC, IP nem páginas específicas.
   Quem recusa cookies não é identificado. */
(() => {
  'use strict';
  let registrado = false;
  const autorizou = () => document.cookie.split('; ').some(x => x === 'pp_cookies=aceito');
  async function registrar() {
    if (registrado || !autorizou()) return;
    registrado = true;
    try {
      const csrf = window.PP_CONFIG?.csrf || '';
      const r = await fetch('/api/visitantes/evento', {
        method:'POST', credentials:'same-origin', keepalive: true,
        headers: { 'Content-Type':'application/json','X-CSRF-Token':csrf,
          'X-Requested-With':'fetch' },
        body: JSON.stringify({ tipo:'pagina' }),
      });
      if (!r.ok) registrado = false;
    } catch { registrado = false; }
  }
  document.addEventListener('pp:consentimento', ev => {
    if (ev.detail?.aceito) registrar();
  });
  registrar();
})();
