export const isActiveUser = user => Boolean(user && user.ativo && user.deletado !== 'S');
export const isAdminProfile = profile => Boolean(profile && (
  profile.id === 'admin-profile-uuid-00000000000000000' || profile.nome?.trim() === 'Administrador'
));

export function canGrantPermissions(actor, permissions = {}) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return false;
  if (Object.values(permissions).some(value => typeof value !== 'boolean')) return false;
  return actor.role === 'admin' || Object.entries(permissions).every(
    ([key, enabled]) => !enabled || actor.perfil?.permissoes?.[key] === true
  );
}

export function canManageProfile(actor, profile) {
  return actor.role === 'admin' || (!isAdminProfile(profile) && canGrantPermissions(actor, profile?.permissoes || {}));
}

export function canManageUser(actor, user, profile) {
  if (actor.role === 'admin') return true;
  return user.role !== 'admin' && canManageProfile(actor, profile) &&
    ['pode_alterar_concluido', 'pode_excluir_agendamento', 'pode_excluir_pagamento']
      .every(flag => !user[flag] || Boolean(actor[flag]));
}

export async function validateUserGrant(actor, changes, current, findProfile) {
  const desired = { ...current, ...changes };
  const profile = desired.perfil_acesso_id ? await findProfile(desired.perfil_acesso_id) : null;
  if (desired.perfil_acesso_id && (!profile || profile.deletado === 'S' || profile.ativo === false)) return false;
  if (desired.role && !['admin', 'funcionario'].includes(desired.role)) return false;
  return canManageUser(actor, desired, profile);
}
