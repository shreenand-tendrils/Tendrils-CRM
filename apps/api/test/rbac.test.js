import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionsFor, ROLE_PERMISSIONS, PERMISSIONS } from '../src/rbac/permissions.js';
import { canEditTask, canViewTicket, ticketEditScope, checkMemberChange, roleFitsOrgType } from '../src/rbac/policies.js';
import { TICKET_TO_TASK, TASK_TO_TICKET } from '../src/services/ticketTaskMaps.js';

const internal = { type: 'INTERNAL' }, client = { type: 'CLIENT' };
const ctx = (role, id = 'u1', org = role.startsWith('CLIENT') ? client : internal, orgId = 'o1') => {
  const memberships = [{ role, organizationId: orgId, organization: org }];
  const permissions = permissionsFor(memberships);
  return { currentUser: { id }, memberships, isInternal: !role.startsWith('CLIENT'), permissions, can: (p) => permissions.has(p) };
};

test('every role only holds known permissions', () => {
  for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) assert.ok(p in PERMISSIONS, p);
});

test('role ladder: admin > manager > lead > employee > client', () => {
  const n = (r) => ctx(r).permissions.size;
  assert.ok(n('PLATFORM_ADMIN') > n('MANAGER') && n('MANAGER') > n('EMPLOYEE') && n('EMPLOYEE') > n('CLIENT_ADMIN'));
  assert.ok(ctx('PLATFORM_ADMIN').can('member.grant_admin') && !ctx('MANAGER').can('member.grant_admin'));
  assert.ok(!ctx('EMPLOYEE').can('task.assign') && ctx('MANAGER').can('task.assign'));
  assert.ok(!ctx('CLIENT_ADMIN').can('chat.use') && !ctx('CLIENT_ADMIN').can('task.create'));
});

test('a role only counts inside the matching organization type', () => {
  assert.equal(ctx('MANAGER', 'u1', client).permissions.size, 0, 'staff role in a client org grants nothing');
  assert.equal(ctx('CLIENT_ADMIN', 'u1', internal).permissions.size, 0, 'client role in internal org grants nothing');
});

test('task policy', () => {
  const emp = ctx('EMPLOYEE', 'me');
  assert.ok(canEditTask(emp, { creatorId: 'me' }) && canEditTask(emp, { assigneeId: 'me' }) && canEditTask(emp, { assignees: [{ userId: 'me' }] }));
  assert.ok(!canEditTask(emp, { creatorId: 'x', assigneeId: 'y', assignees: [] }));
  assert.ok(canEditTask(ctx('MANAGER', 'me'), { creatorId: 'x' }));
});

test('ticket policy: view + edit scope', () => {
  const t = { organizationId: 'o1', visibility: 'CLIENT', requesterId: 'a', assigneeId: 'e' };
  assert.ok(canViewTicket(ctx('CLIENT_ADMIN', 'boss'), t), 'client admin sees org tickets');
  assert.ok(canViewTicket(ctx('CLIENT_MEMBER', 'a'), t) && !canViewTicket(ctx('CLIENT_MEMBER', 'b'), t));
  assert.ok(!canViewTicket(ctx('CLIENT_ADMIN', 'boss', client, 'other-org'), t), 'other org');
  assert.ok(!canViewTicket(ctx('CLIENT_ADMIN', 'boss'), { ...t, visibility: 'INTERNAL' }));
  assert.equal(ticketEditScope(ctx('MANAGER'), t), 'full');
  assert.equal(ticketEditScope(ctx('EMPLOYEE', 'e'), t), 'status');
  assert.equal(ticketEditScope(ctx('EMPLOYEE', 'a'), t), 'own', 'internal ticket requester can edit their own ticket without gaining team assignment privileges');
  assert.equal(ticketEditScope(ctx('EMPLOYEE', 'z'), t), 'none');
  assert.equal(ticketEditScope(ctx('CLIENT_MEMBER', 'a'), t), 'client');
  assert.equal(ticketEditScope(ctx('CLIENT_MEMBER', 'b'), t), 'none');
});

test('team-scoped ticket visibility blocks a third team', () => {
  const teamCtx = (role, teamIds, id = 'u') => {
    const memberships = [{ role, organizationId: 'internal-org', organization: internal, teamMemberships: teamIds.map((teamId) => ({ teamId })) }];
    const permissions = permissionsFor(memberships);
    return { currentUser: { id }, memberships, isInternal: true, permissions, can: (p) => permissions.has(p) };
  };
  const shared = { id: 'ticket-1', organizationId: 'client-org', visibility: 'CLIENT', requesterId: 'client', teamId: 'team-a', teamAccesses: [{ teamId: 'team-a' }, { teamId: 'team-b' }] };
  assert.equal(canViewTicket(teamCtx('EMPLOYEE', ['team-a']), shared), true);
  assert.equal(canViewTicket(teamCtx('EMPLOYEE', ['team-b']), shared), true);
  assert.equal(canViewTicket(teamCtx('EMPLOYEE', ['team-c']), shared), false, 'third team cannot discover a two-team ticket');
  assert.equal(canViewTicket(teamCtx('PLATFORM_ADMIN', []), shared), true, 'platform admin retains explicit global oversight');
});

test('member change guards', () => {
  const admin = { id: 'root', can: ctx('PLATFORM_ADMIN').can }, mgr = { id: 'm', can: ctx('MANAGER').can };
  assert.match(checkMemberChange({ actor: admin, target: { userId: 'root', role: 'PLATFORM_ADMIN' }, change: { isActive: false }, otherActiveAdmins: 5 }), /own access/);
  assert.match(checkMemberChange({ actor: mgr, target: { userId: 'x', role: 'PLATFORM_ADMIN' }, change: { role: 'EMPLOYEE' }, otherActiveAdmins: 5 }), /Platform admin/);
  assert.match(checkMemberChange({ actor: mgr, target: { userId: 'x', role: 'EMPLOYEE' }, change: { role: 'PLATFORM_ADMIN' }, otherActiveAdmins: 5 }), /Platform admin/);
  assert.match(checkMemberChange({ actor: admin, target: { userId: 'x', role: 'PLATFORM_ADMIN' }, change: { role: 'MANAGER' }, otherActiveAdmins: 0 }), /at least one/);
  assert.equal(checkMemberChange({ actor: admin, target: { userId: 'x', role: 'PLATFORM_ADMIN' }, change: { role: 'MANAGER' }, otherActiveAdmins: 1 }), null);
  assert.equal(checkMemberChange({ actor: mgr, target: { userId: 'x', role: 'EMPLOYEE' }, change: { role: 'MANAGER' }, otherActiveAdmins: 0 }), null);
  assert.ok(roleFitsOrgType('EMPLOYEE', 'INTERNAL') && !roleFitsOrgType('EMPLOYEE', 'CLIENT') && roleFitsOrgType('CLIENT_ADMIN', 'CLIENT'));
});

test('ticket/task status maps never ping-pong', () => {
  for (const [ticketStatus, taskStatus] of Object.entries(TICKET_TO_TASK)) {
    const back = TASK_TO_TICKET[taskStatus];
    // either the task status maps to nothing, or a ticket already in sync is left alone by the guard
    assert.ok(back === undefined || TICKET_TO_TASK[back] === taskStatus, `${ticketStatus} <-> ${taskStatus}`);
  }
});

test('employees can send work to other teams; clients cannot', () => {
  assert.ok(ctx('EMPLOYEE').can('work.cross_team') && ctx('MANAGER').can('work.cross_team'));
  assert.ok(!ctx('CLIENT_ADMIN').can('work.cross_team'));
  assert.ok(!ctx('EMPLOYEE').can('ticket.triage'), 'cross-team requests do not make an employee a triager');
});

test('staff keep seeing a ticket they raised for another team', () => {
  const memberships = [{ role: 'EMPLOYEE', organizationId: 'o1', organization: internal, teamMemberships: [{ teamId: 'team-a' }] }];
  const permissions = permissionsFor(memberships);
  const me = { currentUser: { id: 'emp' }, memberships, isInternal: true, permissions, can: (p) => permissions.has(p) };
  const t = { requesterId: 'emp', teamId: 'team-b', teamAccesses: [{ teamId: 'team-b' }] };
  assert.equal(canViewTicket(me, t), true);
  assert.equal(canViewTicket(me, { ...t, requesterId: 'someone-else' }), false);
});

import { taskCommentRecipients } from '../src/services/taskComments.js';
test('task comments notify the creator and assignees, never the author, no duplicates', () => {
  const task = { creatorId: 'c', assigneeId: 'a', assignees: [{ userId: 'a' }, { userId: 'b' }] };
  assert.deepEqual(taskCommentRecipients(task, 'a').sort(), ['b', 'c']);
  assert.deepEqual(taskCommentRecipients(task, 'zzz').sort(), ['a', 'b', 'c']);
  assert.deepEqual(taskCommentRecipients({ creatorId: 'c' }, 'c'), []);
});
