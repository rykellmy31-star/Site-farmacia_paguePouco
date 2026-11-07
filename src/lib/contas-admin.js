/**
 * Exclusão explícita de cadastro administrativo inativo.
 * Não apaga vendas, auditoria, fotos nem outros documentos históricos.
 * A identificação anterior do ator permanece na trilha de auditoria.
 */
import { revogarSessoes } from './session-revocation.js';
import { logAdmin } from './audit.js';

export function excluirCadastroAdminInativo(db, id, { operador, emailConfirmacao, req = null } = {}) {
  if (operador?.role !== 'super_admin')
    return { ok: false, status: 403, erro: 'Somente o Super Administrador pode excluir cadastros.' };
  const usuario = db.collection('admins').get(id);
  if (!usuario)
    return { ok: false, status: 404, erro: 'Cadastro não encontrado.' };
  if (String(usuario.id) === String(operador.id))
    return { ok: false, status: 409, erro: 'Você não pode excluir seu próprio cadastro.' };
  if (usuario.ativo !== false)
    return { ok: false, status: 409, erro: 'Desative o usuário antes de excluí-lo.' };
  const email = String(usuario.email || '').trim().toLowerCase();
  if (!email || String(emailConfirmacao || '').trim().toLowerCase() !== email)
    return { ok: false, status: 400, erro: 'Confirme o e-mail exato do cadastro para excluir.' };

  // Não remover conta vinculada à conferência de um pedido ainda em andamento.
  // A exclusão nunca deve apagar ou modificar pedidos, produtos ou histórico.
  const pedidoEmAberto = db.collection('orders').all().some(p =>
    String(p.pedidoRecebidoPor || '') === String(usuario.id) &&
    p.statusOperacional !== 'entregue' && p.statusOperacional !== 'cancelado');
  if (pedidoEmAberto)
    return { ok: false, status: 409, erro: 'Este usuário está vinculado ao recebimento de um pedido em andamento. Finalize ou transfira o atendimento antes de excluir.' };

  const executar = () => {
    const revogadas = revogarSessoes(db, 'admin', usuario.id);
    if (!db.collection('admins').remove(usuario.id))
      throw new Error('Cadastro não foi excluído.');
    logAdmin(db, operador, 'excluiu_usuario_admin_inativo', 'admin', usuario.id, {
      nome: usuario.nome, email: usuario.email, perfil: usuario.role,
      sessoesRevogadas: revogadas,
    }, req);
    return revogadas;
  };
  try {
    // As mutações no Durable Object são atômicas (sessões, cadastro e auditoria).
    const revogadas = typeof db.storage?.transactionSync === 'function'
      ? db.storage.transactionSync(executar) : executar();
    return { ok: true, sessoesRevogadas: revogadas };
  } catch {
    // Evita manter coleções SQL revertidas com índice em memória antigo.
    for (const name of ['admins', 'sessions', 'auditLogs']) db.collections?.delete(name);
    return { ok: false, status: 500, erro: 'Não foi possível concluir a exclusão. Nenhum sucesso foi confirmado.' };
  }
}
