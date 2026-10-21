/**
 * Executa a reconciliação periódica sem deixar uma falha isolada impedir
 * as demais cobranças ou o reagendamento do próximo alarme Cloudflare.
 *
 * Todas as funções são injetadas para testar falhas sem pagamento real.
 */
export async function executarAlarmeFinanceiro({
  pix, estornos, pedidos = null, persistir, reagendar, registrar = () => {},
}) {
  const falhas = [];
  const executar = async (nome, acao) => {
    try {
      const resultado = await acao();
      if (resultado?.erros) registrar(nome, resultado.erros);
      return resultado;
    } catch (erro) {
      falhas.push(erro);
      registrar(nome, erro?.message || String(erro));
      return null;
    }
  };
  // Mesmo quando Pix ou estornos lançam uma exceção, o outro fluxo continua.
  try {
    // Reparo de vínculos locais não executa cobrança nem altera estoque.
    // Se falhar, Pix e estornos continuam sendo conciliados normalmente.
    if (pedidos) await executar('pedidos', pedidos);
    await executar('pix', pix);
    await executar('estornos', estornos);
  } finally {
    // Tente reagendar mesmo se a persistência falhar; o próximo alarme
    // poderá recuperar cobranças que não foram conciliadas nesta rodada.
    await executar('persistencia', persistir);
    await executar('reagendamento', reagendar);
  }
  if (falhas.length) throw new AggregateError(falhas,
    'Falhas na conciliação financeira: próximo alarme foi solicitado.');
}
