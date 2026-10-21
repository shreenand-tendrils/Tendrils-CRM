// Single source of truth for role-based access control.
// Roles come from the MemberRole enum. Staff roles only count inside the INTERNAL organization,
// client roles only inside CLIENT organizations. A user's permissions are the union of their active memberships.

export const PERMISSIONS = {
  'org.create': 'Create client workspaces',
  'project.create': 'Create projects',
  'project.manage_team': 'Edit any project team',
  'task.create': 'Create tasks',
  'task.update_any': 'Edit any task',
  'task.update_own': 'Edit tasks they own or are assigned to',
  'task.assign': 'Assign tasks to other people',
  'ticket.create': 'Raise tickets',
  'ticket.view_internal': 'See internal-only tickets and comments',
  'ticket.triage': 'Assign, re-prioritise and change status of any ticket',
  'ticket.update_own': 'Update status of tickets assigned to them',
  'ticket.comment_internal': 'Write internal comments',
  'file.upload': 'Upload attachments',
  'team.view': 'View teams',
  'ticket.delete': 'Delete any ticket (for example one raised by mistake)',
  'team.manage': 'Create, edit and remove teams and manage their members (Platform admin)',
  'project.request': 'Request a project from chosen teams (clients)',
  'user.list': 'See the staff directory',
  'chat.use': 'Use team chat',
  'update.post': 'Post daily updates',
  'admin.view': 'Open the admin console',
  'member.manage': 'Invite people and change roles',
  'member.grant_admin': 'Grant or remove Platform Admin',
  'project.post_update': 'Post client-visible project updates (any project)',
  'work.cross_team': 'Raise tickets and create tasks for other teams',
};
const ALL = Object.keys(PERMISSIONS);

const EMPLOYEE = ALL.filter((p) => !['member.grant_admin', 'team.manage', 'project.request'].includes(p));

export const ROLE_PERMISSIONS = {
  PLATFORM_ADMIN: ALL.filter((p) => p !== 'project.request'),
  EMPLOYEE,
  CLIENT_ADMIN: ['ticket.create', 'file.upload', 'project.request'],
  CLIENT_MEMBER: ['ticket.create', 'file.upload', 'project.request'],
};
export const ROLE_LABELS = {
  PLATFORM_ADMIN: 'Platform admin', EMPLOYEE: 'Employee',
  CLIENT_ADMIN: 'Client admin', CLIENT_MEMBER: 'Client member',
};
export const STAFF_ROLES = ['PLATFORM_ADMIN', 'EMPLOYEE'];
export const CLIENT_ROLES = ['CLIENT_ADMIN', 'CLIENT_MEMBER'];
export const MANAGER_ROLES = ['PLATFORM_ADMIN', 'EMPLOYEE'];

/** Permissions for a list of memberships [{ role, organization: { type } }]. */
export function permissionsFor(memberships) {
  const set = new Set();
  for (const m of memberships) {
    const roleFitsOrg = (m.organization.type === 'INTERNAL' ? STAFF_ROLES : CLIENT_ROLES).includes(m.role);
    if (roleFitsOrg) for (const p of ROLE_PERMISSIONS[m.role] || []) set.add(p);
  }
  return set;
}
