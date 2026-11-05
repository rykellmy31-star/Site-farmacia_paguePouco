/**
 * Fundo visual da página inicial — mantém o tema geral intacto.
 * Apenas cores hexadecimais e imagens de uploads locais são aceitas no CSS.
 */
const MODOS = new Set(['padrao', 'cor', 'imagem']);
const POSICOES = { centro: 'center center', topo: 'center top', baixo: 'center bottom' };

export function corHexValida(valor) {
  return /^#[0-9a-f]{6}$/i.test(String(valor || ''));
}

export function urlImagemFundoValida(valor) {
  const url = String(valor || '');
  return /^\/uploads\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(url) ? url : '';
}

export function normalizarFundoHome(valor = {}) {
  const fundo = valor && typeof valor === 'object' ? valor : {};
  const modo = MODOS.has(fundo.modo) ? fundo.modo : 'padrao';
  const cor = corHexValida(fundo.cor) ? fundo.cor : '#fffafa';
  const imagemUrl = urlImagemFundoValida(fundo.imagemUrl);
  const posicao = Object.hasOwn(POSICOES, fundo.posicao) ? fundo.posicao : 'centro';
  return {
    modo: modo === 'imagem' && !imagemUrl ? 'padrao' : modo,
    cor,
    imagemUrl,
    posicao,
    posicaoCss: POSICOES[posicao],
  };
}
