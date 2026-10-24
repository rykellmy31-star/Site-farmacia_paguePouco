/**
 * Conferência SOMENTE LEITURA do catálogo existente contra o relatório atual do ERP.
 *
 * Nunca remove, desativa ou altera produtos. Não decide por marca de importação:
 * produtos antigos que já correspondem a um EAN/código interno do InovaFarma
 * devem ser preservados (a importação inicial pode tê-los atualizado).
 */
const chave = v => String(v ?? '').trim();
const valido = v => Boolean(chave(v));
const indexar = (itens, campo) => {
  const mapa = new Map();
  for (const item of itens) {
    const valor = chave(item[campo]);
    if (!valor) continue;
    const encontrados = mapa.get(valor) || [];
    encontrados.push(item);
    mapa.set(valor, encontrados);
  }
  return mapa;
};
const contemReferencia = (item, porEan, porCodigo) => {
  const ean = chave(item.ean);
  const codigo = chave(item.codigoInterno);
  const porBarras = ean ? (porEan.get(ean) || []) : [];
  const porInterno = codigo ? (porCodigo.get(codigo) || []) : [];
  return { porBarras, porInterno };
};

/**
 * @param {object[]} produtos - snapshot do catálogo do site
 * @param {object[]} relatorio - itens validados do relatório do InovaFarma
 * @param {object[]} pedidos - pedidos armazenados; preservar vínculos históricos
 * @returns prévia; não contém função de execução
 */
export function planejarLimpezaCatalogoInova(produtos, relatorio, pedidos = []) {
  if (!Array.isArray(produtos) || !Array.isArray(relatorio) || !Array.isArray(pedidos) ||
      !relatorio.length || !produtos.length && pedidos.length)
    throw new Error('Catálogo ou relatório inválido para conferência.');
  const porEan = indexar(relatorio, 'ean');
  const porCodigo = indexar(relatorio, 'codigoInterno');
  const atuaisPorEan = indexar(produtos, 'ean');
  const atuaisPorCodigo = indexar(produtos, 'codigoInterno');
  const emPedidos = new Set();
  for (const pedido of pedidos) {
    for (const item of pedido.itens || []) {
      if (valido(item.produtoId)) emPedidos.add(chave(item.produtoId));
    }
  }
  const resumo = {
    produtosNoSite: produtos.length, registrosNoRelatorio: relatorio.length,
    preservar: 0, conferirIdentificacao: 0, candidatosSemHistorico: 0,
    vinculadosPedidos: 0, comReserva: 0, jaArquivados: 0,
  };
  const itens = produtos.map(p => {
    const ean = chave(p.ean), codigoInterno = chave(p.codigoInterno);
    const { porBarras, porInterno } = contemReferencia(p, porEan, porCodigo);
    const idsRelatorio = [...new Set([...porBarras, ...porInterno])];
    const codigosDuplicados = (ean && (atuaisPorEan.get(ean)?.length || 0) > 1) ||
      (codigoInterno && (atuaisPorCodigo.get(codigoInterno)?.length || 0) > 1);
    const identificacaoConflitante = idsRelatorio.length > 1 ||
      porBarras.length > 1 || porInterno.length > 1 || codigosDuplicados ||
      (porBarras.length === 1 && codigoInterno &&
        porBarras[0].codigoInterno &&
        chave(porBarras[0].codigoInterno) !== codigoInterno) ||
      (porInterno.length === 1 && ean && porInterno[0].ean &&
        chave(porInterno[0].ean) !== ean);
    const pedidoVinculado = emPedidos.has(chave(p.id));
    const estoque = p.estoque || {};
    const reservado = Number(estoque.reservado || 0);
    const quarentena = Number(estoque.quarentena || 0);
    const reservaAtiva = !Number.isFinite(reservado) || reservado > 0 ||
      !Number.isFinite(quarentena) || quarentena > 0;
    let status;
    if (p.inovaArquivado?.em) status = 'ja_arquivado';
    else if (identificacaoConflitante || (!ean && !codigoInterno))
      status = 'conferir_identificacao';
    else if (idsRelatorio.length === 1)
      status = 'preservar';
    else if (pedidoVinculado)
      status = 'vinculado_pedidos';
    else if (reservaAtiva)
      status = 'com_reserva';
    else
      status = 'candidato_sem_historico';
    const resumoCampo = {
      conferir_identificacao: 'conferirIdentificacao', preservar: 'preservar',
      ja_arquivado: 'jaArquivados',
      vinculado_pedidos: 'vinculadosPedidos', com_reserva: 'comReserva',
      candidato_sem_historico: 'candidatosSemHistorico',
    }[status];
    resumo[resumoCampo] += 1;
    return {
      id: chave(p.id), nome: chave(p.nome), ean, codigoInterno,
      ativo: Boolean(p.ativo), status,
      pedidoVinculado, reservaAtiva,
    };
  });
  return {
    somenteLeitura: true, autorizaExclusao: false,
    resumo, itens,
    aviso: 'Prévia: nenhum produto foi excluído ou desativado. Conferir backup, vínculo a pedidos, carrinhos, promoções e duplicidades antes de autorizar limpeza.',
  };
}
