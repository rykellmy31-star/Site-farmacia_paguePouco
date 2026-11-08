// Prévia imediata do selo de desconto (não salva sem clicar em Salvar aparência).
(() => {
  'use strict';
  const controle = document.getElementById('seloDescontoPulsoIntensidade');
  const previa = document.getElementById('previewSeloDesconto');
  const resultado = document.getElementById('valorIntensidadeSelo');
  if (!controle || !previa || !resultado) return;

  function atualizar() {
    const n = Math.min(200, Math.max(0, Math.round(Number(controle.value) || 0)));
    const escala = fator => (1 + (fator - 1) * n / 100).toFixed(3);
    const alfa = fator => Math.min(1, fator * n / 100).toFixed(3);
    const prop = (nome, valor) => previa.style.setProperty(nome, valor);
    prop('--oferta-pulso-animacao', n === 0
      ? 'none' : 'oferta-desconto-pulsar 1.35s ease-in-out infinite');
    prop('--oferta-escala-forte', escala(1.16));
    prop('--oferta-escala-media', escala(1.045));
    prop('--oferta-escala-final', escala(1.12));
    prop('--oferta-brilho-forte', escala(1.12));
    prop('--oferta-brilho-final', escala(1.08));
    prop('--oferta-sombra-vermelha-forte', alfa(0.35));
    prop('--oferta-sombra-amarela-forte', alfa(0.68));
    prop('--oferta-sombra-vermelha-media', alfa(0.15));
    prop('--oferta-sombra-amarela-media', alfa(0.25));
    prop('--oferta-sombra-vermelha-final', alfa(0.32));
    prop('--oferta-sombra-amarela-final', alfa(0.5));
    resultado.textContent = n === 0 ? 'Fixo (sem pulsação)' :
      n + '% · ' + (n < 100 ? 'mais suave' : n === 100 ? 'intensidade atual' : 'mais forte');
  }

  controle.addEventListener('input', atualizar);
  for (const [id, valor] of [['seloDescontoFixo', 0], ['seloDescontoPadrao', 100]]) {
    document.getElementById(id)?.addEventListener('click', () => {
      controle.value = String(valor);
      atualizar();
    });
  }
  atualizar();
})();
