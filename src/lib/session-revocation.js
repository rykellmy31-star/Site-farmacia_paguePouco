/**
 * Revoga sessões autenticadas de uma conta depois de mudanças de senha.
 * O reset administrativo deve revogar TODAS; a troca voluntária pode manter
 * somente a sessão que comprovou conhecimento da senha anterior.
 */
export function revogarSessoes(db, tipo, usuarioId, { preservar = null } = {}) {
  const sessions = db.collection('sessions');
  let removidas = 0;
  for (const sessao of sessions.find(s => s.type === tipo && String(s.userId) === String(usuarioId))) {
    if (preservar != null && sessao.id === preservar) continue;
    sessions.remove(sessao.id);
    removidas++;
  }
  return removidas;
}

/** Invalida TODOS os links anteriores depois de uma troca de senha. */
export function invalidarRecuperacoesSenha(db, clienteId) {
  const tokens = db.collection('passwordTokens');
  let invalidos = 0;
  for (const t of tokens.find(t => String(t.clienteId) === String(clienteId) && !t.usado)) {
    tokens.update(t.id, { usado: true, usadoEm: new Date().toISOString() });
    invalidos++;
  }
  return invalidos;
}
