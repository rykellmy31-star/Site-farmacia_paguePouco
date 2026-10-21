/**
 * Regras imutáveis dos endereços da conta.
 * Nunca altere o endereço principal ao receber um ID inexistente.
 * Se houver endereços, exatamente um deve permanecer como principal.
 */
export function normalizarPrincipal(enderecos, preferidoId = null) {
  const lista = (enderecos || []).map(e => ({ ...e }));
  if (!lista.length) return lista;
  const principal = (preferidoId && lista.find(e => e.id === preferidoId)) ||
    lista.find(e => e.padrao) || lista[0];
  return lista.map(e => ({ ...e, padrao: e.id === principal.id }));
}

export function adicionarEndereco(enderecos, novo) {
  const lista = (enderecos || []).map(e => ({ ...e }));
  if (!novo?.id || lista.some(e => e.id === novo.id)) {
    return { ok: false, erro: 'Identificador de endereço inválido ou duplicado.' };
  }
  const novoPrincipal = !!novo.padrao || lista.length === 0;
  lista.push({ ...novo });
  return {
    ok: true,
    enderecos: normalizarPrincipal(lista, novoPrincipal ? novo.id : null),
  };
}

export function editarEndereco(enderecos, id, dados) {
  const lista = (enderecos || []).map(e => ({ ...e }));
  const atual = lista.find(e => e.id === id);
  if (!atual) return { ok: false, erro: 'Endereço não encontrado.' };
  const atualizados = lista.map(e => e.id === id ? { ...e, ...dados, id: e.id } : e);
  // Desmarcar o endereço principal não remove o único endereço principal;
  // para mudar o principal, marque explicitamente outro endereço.
  const principalAnterior = lista.find(e => e.padrao)?.id || lista[0]?.id;
  return {
    ok: true,
    enderecos: normalizarPrincipal(atualizados, dados.padrao ? id : principalAnterior),
  };
}

export function excluirEndereco(enderecos, id) {
  const lista = (enderecos || []).map(e => ({ ...e }));
  if (!lista.some(e => e.id === id)) return { ok: false, erro: 'Endereço não encontrado.' };
  const restantes = lista.filter(e => e.id !== id);
  return { ok: true, enderecos: normalizarPrincipal(restantes) };
}
