/**
 * permissions.js — Perfis e permissões do painel.
 * As permissões são verificadas SEMPRE NO SERVIDOR (middleware requireRole),
 * nunca apenas escondendo itens de menu na interface.
 */

export const ROLES = {
  super_admin: {
    id: 'super_admin',
    nome: 'Super Administrador',
    descricao: 'Acesso total, incluindo usuários, integrações e configurações sensíveis.',
    permissoes: ['*'],
  },
  admin: {
    id: 'admin',
    nome: 'Administrador',
    descricao: 'Administra a loja inteira, exceto usuários e segredos de integração.',
    permissoes: [
      'dashboard.ver', 'produtos.*', 'categorias.*', 'estoque.*', 'midia.*',
      'pedidos.*', 'clientes.ver', 'clientes.editar', 'fretes.*', 'pagamentos.ver',
      'pagamentos.estornar', 'whatsapp.*', 'banners.*', 'promocoes.*', 'paginas.*',
      'relatorios.ver', 'configuracoes.*', 'auditoria.ver', 'vendedores.ver', 'vendedores.editar',
    ],
  },
  gerente: {
    id: 'gerente',
    nome: 'Gerente',
    descricao: 'Gestão comercial: produtos, preços, promoções, pedidos e relatórios.',
    permissoes: [
      'dashboard.ver', 'produtos.*', 'categorias.*', 'estoque.*', 'midia.ver', 'midia.criar',
      'pedidos.*', 'clientes.ver', 'promocoes.*', 'banners.*', 'relatorios.ver', 'vendedores.ver',
    ],
  },
  farmaceutico: {
    id: 'farmaceutico',
    nome: 'Responsável técnico (farmacêutico)',
    descricao: 'Revisa e aprova cadastros de medicamentos e informações sanitárias.',
    permissoes: [
      'dashboard.ver', 'produtos.ver', 'produtos.editar', 'produtos.aprovar',
      'categorias.ver', 'estoque.ver', 'midia.ver', 'sanitario.*', 'relatorios.ver',
    ],
  },
  atendente: {
    id: 'atendente',
    nome: 'Atendente',
    descricao: 'Atendimento ao cliente: pedidos, clientes e conteúdo institucional.',
    permissoes: ['dashboard.ver', 'pedidos.ver', 'pedidos.editar', 'clientes.ver', 'clientes.editar', 'paginas.ver', 'paginas.editar', 'midia.ver'],
  },
  operador_pedidos: {
    id: 'operador_pedidos',
    nome: 'Operador de pedidos',
    descricao: 'Separação, expedição e atualização de status de pedidos.',
    permissoes: ['dashboard.ver', 'pedidos.ver', 'pedidos.editar', 'produtos.ver', 'estoque.ver', 'estoque.movimentar'],
  },
};

export const ROLE_LIST = Object.values(ROLES);

export function can(user, permission) {
  if (!user) return false;
  const role = ROLES[user.role];
  if (!role) return false;
  if (role.permissoes.includes('*')) return true;
  if (role.permissoes.includes(permission)) return true;
  const prefix = permission.split('.')[0];
  return role.permissoes.includes(`${prefix}.*`);
}

export function requireRole(permission, opts = {}) {
  return (req, res, next) => {
    if (!req.adminUser) {
      if (opts.api) return res.json({ ok: false, erro: 'Não autenticado.' }, 401);
      return res.redirect(`/admin/login?next=${encodeURIComponent(req.pathname)}`);
    }
    if (!can(req.adminUser, permission)) {
      if (opts.api) return res.json({ ok: false, erro: 'Sem permissão para esta ação.' }, 403);
      res.status(403);
      return res.html('<h1>403 — Acesso não permitido</h1><p>Seu perfil não tem permissão para esta área.</p><a href="/admin">Voltar</a>');
    }
    return next();
  };
}

export function permissoesDoPapel(roleId) {
  return ROLES[roleId]?.permissoes || [];
}
