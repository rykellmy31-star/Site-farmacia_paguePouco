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
