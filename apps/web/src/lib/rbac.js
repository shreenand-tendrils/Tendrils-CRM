// Mirrors server-side RBAC so the UI only offers what the API will accept. The API remains the authority.
export const can = (me, permission) => !!me?.permissions?.includes(permission);

export const canReviewTask = (me, task) => {
  if (!me || !task) return false;
  if (can(me, 'task.update_any')) return true;
  const mine = new Set(me.teamIds || []);
  return (task.teamAccesses || []).some((a) => a.accessRole === 'REVIEWER' && mine.has(a.teamId));
};

export const canEditTask = (me, task) => {
  if (!me || !task) return false;
  if (canReviewTask(me, task)) return true;
  if (!can(me, 'task.update_own')) return false;
  const id = me.user.id;
  return task.creatorId === id || task.assigneeId === id || (task.assignees || []).some((a) => a.user?.id === id);
};

export const ROLE_LABELS = { PLATFORM_ADMIN: 'Platform admin', EMPLOYEE: 'Employee', CLIENT_ADMIN: 'Client admin', CLIENT_MEMBER: 'Client member' };
export const STAFF_ROLES = ['PLATFORM_ADMIN', 'EMPLOYEE'];
export const CLIENT_ROLES = ['CLIENT_ADMIN', 'CLIENT_MEMBER'];
export const topRole = (me) => ['PLATFORM_ADMIN', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER'].find((r) => me?.roles?.includes(r));
