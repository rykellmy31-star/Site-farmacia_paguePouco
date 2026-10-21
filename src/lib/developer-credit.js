/**
 * Crédito institucional do desenvolvimento, exibido no rodapé de toda
 * resposta HTML (loja, conta, checkout, painel e páginas de erro).
 * Não altera respostas JSON, arquivos ou dados do banco.
 */
export const NOME_DESENVOLVEDOR = 'Carlos Rykellmy Santos Correia';

export function adicionarCreditoDesenvolvedor(html) {
  if (typeof html !== 'string' || !html.trim() || html.includes('data-credito-desenvolvedor=')) return html;
  const credito = '<div class="credito-desenvolvedor" data-credito-desenvolvedor="true">' +
    'Projeto desenvolvido por <strong>' + NOME_DESENVOLVEDOR + '</strong></div>';
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, credito + '\n</body>');
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, credito + '\n</html>');
  return html + '\n' + credito;
}
