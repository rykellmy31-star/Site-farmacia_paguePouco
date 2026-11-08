/**
 * Intensidade da pulsação do selo verde OFF.
 * 0 = fixo; 100 = efeito anterior; 200 = destaque maior.
 * Só números normalizados chegam ao CSS público (evita injeção).
 */
export const INTENSIDADE_SELO_PADRAO = 100;
export function intensidadeSeloDesconto(valor) {
  if (valor === undefined || valor === null || valor === '') return INTENSIDADE_SELO_PADRAO;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(200, Math.max(0, Math.round(n))) : INTENSIDADE_SELO_PADRAO;
}

export function variaveisSeloDesconto(valor) {
  const n = intensidadeSeloDesconto(valor);
  const fixo = n === 0;
  const a = valor => Math.min(1, valor * n / 100).toFixed(3);
  const escala = valor => (1 + (valor - 1) * n / 100).toFixed(3);
  return {
    '--oferta-pulso-animacao': fixo ? 'none' : 'oferta-desconto-pulsar 1.35s ease-in-out infinite',
    '--oferta-escala-forte': escala(1.16),
    '--oferta-escala-media': escala(1.045),
    '--oferta-escala-final': escala(1.12),
    '--oferta-brilho-forte': escala(1.12),
    '--oferta-brilho-final': escala(1.08),
    '--oferta-sombra-vermelha-forte': a(0.35),
    '--oferta-sombra-amarela-forte': a(0.68),
    '--oferta-sombra-vermelha-media': a(0.15),
    '--oferta-sombra-amarela-media': a(0.25),
    '--oferta-sombra-vermelha-final': a(0.32),
    '--oferta-sombra-amarela-final': a(0.5),
  };
}

export function estiloSeloDesconto(valor) {
  return Object.entries(variaveisSeloDesconto(valor))
    .map(([chave, conteudo]) => chave + ':' + conteudo + ';').join('');
}
