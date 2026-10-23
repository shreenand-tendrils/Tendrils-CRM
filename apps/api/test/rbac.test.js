import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionsFor, ROLE_PERMISSIONS, PERMISSIONS } from '../src/rbac/permissions.js';
import { canEditTask, canViewTicket, ticketEditScope, checkMemberChange, roleFitsOrgType } from '../src/rbac/policies.js';
import { ticketToTaskStatus, TASK_TO_TICKET, deriveProgress, progressValid, shouldSubmitClientTicketForReview } from '../src/services/ticketTaskMaps.js';

const internal = { type: 'INTERNAL' }, client = { type: 'CLIENT' };
const ctx = (role, id = 'u1', org = role.startsWith('CLIENT') ? client : internal, orgId = 'o1') => {
  const memberships = [{ role, organizationId: orgId, organization: org }];
  const permissions = permissionsFor(memberships);
  return { currentUser: { id }, memberships, isInternal: !role.startsWith('CLIENT'), permissions, can: (p) => permissions.has(p) };
};

test('every role only holds known permissions', () => {
  for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) assert.ok(p in PERMISSIONS, p);
});

test('role model: platform admin > employee > client', () => {
  const n = (r) => ctx(r).permissions.size;
  assert.ok(n('PLATFORM_ADMIN') > n('EMPLOYEE') && n('EMPLOYEE') > n('CLIENT_ADMIN'));
  assert.ok(ctx('PLATFORM_ADMIN').can('member.grant_admin') && !ctx('EMPLOYEE').can('member.grant_admin'));
  assert.ok(ctx('PLATFORM_ADMIN').can('task.assign') && ctx('PLATFORM_ADMIN').can('ticket.triage'));
  assert.ok(ctx('EMPLOYEE').can('task.assign') && !ctx('EMPLOYEE').can('ticket.triage'));
  assert.ok(!ctx('CLIENT_ADMIN').can('chat.use') && !ctx('CLIENT_ADMIN').can('task.create'));
});

test('a role only counts inside the matching organization type', () => {
  assert.equal(ctx('PLATFORM_ADMIN', 'u1', client).permissions.size, 0, 'staff role in a client org grants nothing');
  assert.equal(ctx('CLIENT_ADMIN', 'u1', internal).permissions.size, 0, 'client role in internal org grants nothing');
});

test('task policy', () => {
  const emp = ctx('EMPLOYEE', 'me');
  assert.ok(canEditTask(emp, { creatorId: 'me' }) && canEditTask(emp, { assigneeId: 'me' }) && canEditTask(emp, { assignees: [{ userId: 'me' }] }));
  assert.ok(!canEditTask(emp, { creatorId: 'x', assigneeId: 'y', assignees: [] }), 'employees can only edit tasks they own or are assigned to');
  assert.ok(canEditTask(ctx('PLATFORM_ADMIN', 'me'), { creatorId: 'x', assigneeId: 'y', assignees: [] }));
  assert.ok(!canEditTask(ctx('CLIENT_ADMIN', 'me'), { creatorId: 'me' }));
  assert.ok(canEditTask(ctx('PLATFORM_ADMIN', 'me'), { creatorId: 'x' }));
  const reviewerMemberships = [{ role: 'EMPLOYEE', organizationId: 'internal', organization: internal, teamMemberships: [{ teamId: 'requesting-team' }] }];
  const reviewerPermissions = permissionsFor(reviewerMemberships);
  const reviewerCtx = { currentUser: { id: 'reviewer' }, memberships: reviewerMemberships, permissions: reviewerPermissions, can: (p) => reviewerPermissions.has(p) };
  assert.ok(canEditTask(reviewerCtx, { creatorId: 'other', assigneeId: 'receiver', teamAccesses: [{ teamId: 'requesting-team', accessRole: 'REVIEWER' }] }), 'requesting team can open and review cross-team work');
});

test('ticket policy: view + edit scope', () => {
  const t = { organizationId: 'o1', visibility: 'CLIENT', requesterId: 'a', assigneeId: 'e' };
  assert.ok(canViewTicket(ctx('CLIENT_ADMIN', 'boss'), t), 'client admin sees org tickets');
  assert.ok(canViewTicket(ctx('CLIENT_MEMBER', 'a'), t) && !canViewTicket(ctx('CLIENT_MEMBER', 'b'), t));
  assert.ok(!canViewTicket(ctx('CLIENT_ADMIN', 'boss', client, 'other-org'), t), 'other org');
  assert.ok(!canViewTicket(ctx('CLIENT_ADMIN', 'boss'), { ...t, visibility: 'INTERNAL' }));
  assert.equal(ticketEditScope(ctx('PLATFORM_ADMIN'), t), 'full');
  assert.equal(ticketEditScope(ctx('EMPLOYEE', 'e'), t), 'status');
  assert.equal(ticketEditScope(ctx('EMPLOYEE', 'a'), t), 'own');
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
  const admin = { id: 'root', can: ctx('PLATFORM_ADMIN').can }, employee = { id: 'e', can: ctx('EMPLOYEE').can };
  assert.match(checkMemberChange({ actor: admin, target: { userId: 'root', role: 'PLATFORM_ADMIN' }, change: { isActive: false }, otherActiveAdmins: 5 }), /own access/);
  assert.match(checkMemberChange({ actor: employee, target: { userId: 'x', role: 'PLATFORM_ADMIN' }, change: { role: 'EMPLOYEE' }, otherActiveAdmins: 5 }), /Platform admin/);
  assert.match(checkMemberChange({ actor: employee, target: { userId: 'x', role: 'EMPLOYEE' }, change: { role: 'PLATFORM_ADMIN' }, otherActiveAdmins: 5 }), /Platform admin/);
  assert.match(checkMemberChange({ actor: admin, target: { userId: 'x', role: 'PLATFORM_ADMIN' }, change: { role: 'EMPLOYEE' }, otherActiveAdmins: 0 }), /at least one/);
  assert.equal(checkMemberChange({ actor: admin, target: { userId: 'x', role: 'PLATFORM_ADMIN' }, change: { role: 'EMPLOYEE' }, otherActiveAdmins: 1 }), null);
  assert.equal(checkMemberChange({ actor: employee, target: { userId: 'x', role: 'EMPLOYEE' }, change: { role: 'EMPLOYEE' }, otherActiveAdmins: 0 }), null);
  assert.ok(roleFitsOrgType('EMPLOYEE', 'INTERNAL') && !roleFitsOrgType('EMPLOYEE', 'CLIENT') && roleFitsOrgType('CLIENT_ADMIN', 'CLIENT'));
});

test('ticket status/progress <-> task status never ping-pong', () => {
  for (const [taskStatus, next] of Object.entries(TASK_TO_TICKET)) {
    const back = ticketToTaskStatus(next.status, next.progress);
    assert.ok(taskStatus === 'BACKLOG' ? back === 'TODO' : back === taskStatus, `${taskStatus} -> ${next.status}/${next.progress} -> ${back}`);
  }
  assert.equal(ticketToTaskStatus('CLOSED', null), 'DONE');
  assert.equal(ticketToTaskStatus('REVIEW_TEST', 'RESOLVED'), 'REVIEW');
  assert.equal(ticketToTaskStatus('OPEN', 'QA'), 'IN_PROGRESS');
  assert.equal(ticketToTaskStatus('REVIEW_HELP', 'NEED_MORE_INFO'), 'BLOCKED');
  assert.equal(TASK_TO_TICKET.REVIEW.status, 'REVIEW_TEST');
  assert.equal(TASK_TO_TICKET.DONE.status, 'CLOSED');
});

test('progress follows status', () => {
  assert.equal(deriveProgress({ oldStatus: 'REVIEW_TEST', oldProgress: 'RESOLVED', status: 'OPEN' }), 'IN_PROGRESS');
  assert.equal(deriveProgress({ oldStatus: 'OPEN', oldProgress: 'QA', status: 'OPEN' }), 'QA');
  assert.equal(deriveProgress({ oldStatus: 'OPEN', status: 'REVIEW_TEST' }), 'RESOLVED');
  assert.equal(deriveProgress({ oldStatus: 'OPEN', status: 'CLOSED' }), null);
  assert.ok(progressValid('OPEN', 'QA') && progressValid('REVIEW_HELP', 'NEED_MORE_INFO') && !progressValid('CLOSED', 'QA') && !progressValid('OPEN', 'RESOLVED'));
});

test('employees can route tickets across teams while remaining team-scoped; only admins have global triage', () => {
  assert.ok(ctx('EMPLOYEE').can('ticket.route'));
  assert.ok(!ctx('EMPLOYEE').can('ticket.triage'));
  assert.ok(ctx('PLATFORM_ADMIN').can('ticket.triage') && ctx('PLATFORM_ADMIN').can('work.cross_team'));
  assert.ok(!ctx('CLIENT_ADMIN').can('ticket.route') && !ctx('CLIENT_ADMIN').can('work.cross_team'));
});


test('employees can route tickets in their own team, but not edit unrelated teams', () => {
  const memberships = [{ role: 'EMPLOYEE', organizationId: 'internal', organization: { type: 'INTERNAL' }, teamMemberships: [{ teamId: 'team-a' }] }];
  const permissions = permissionsFor(memberships);
  const ctxFor = { currentUser: { id: 'employee' }, memberships, isInternal: true, permissions, can: (p) => permissions.has(p) };
  assert.equal(ticketEditScope(ctxFor, { teamAccesses: [{ teamId: 'team-a' }] }), 'full');
  assert.equal(ticketEditScope(ctxFor, { teamAccesses: [{ teamId: 'team-b' }] }), 'none');
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

import { normalizeTeamPicks } from '../src/services/ticketRouting.js';
test('only the root admin manages teams; clients can request projects, staff cannot', () => {
  assert.ok(ctx('PLATFORM_ADMIN').can('team.manage'));
  assert.ok(!ctx('EMPLOYEE').can('team.manage') && !ctx('CLIENT_ADMIN').can('team.manage'));
  assert.ok(ctx('CLIENT_ADMIN').can('project.request') && ctx('CLIENT_MEMBER').can('project.request'));
  assert.ok(!ctx('PLATFORM_ADMIN').can('project.request'));
});
test('client team picks: first owns, the rest are shared, duplicates dropped', () => {
  assert.deepEqual(normalizeTeamPicks(undefined, ['a', 'b', 'a']), { teamId: 'a', teamIds: ['b'] });
  assert.deepEqual(normalizeTeamPicks(undefined, []), { teamId: null, teamIds: [] });
});

import { finishBlocked } from '../src/services/ticketReviewRules.js';
test('admin review: employees cannot finish client-origin tickets; platform admins and employee-origin tickets are fine', () => {
  const base = { internal: true, canTriage: false, requesterIsEmployee: false };
  for (const status of ['RESOLVED', 'CLOSED', 'CLIENT_REVIEW']) assert.equal(finishBlocked({ ...base, status }), true, status);
  for (const status of ['IN_PROGRESS', 'REVIEW', 'BLOCKED']) assert.equal(finishBlocked({ ...base, status }), false, status);
  assert.equal(finishBlocked({ ...base, status: 'CLOSED', canTriage: true }), false, 'manager can close');
  assert.equal(finishBlocked({ ...base, status: 'CLOSED', requesterIsEmployee: true }), false, 'employee-origin ticket can be closed by employees');
  assert.equal(finishBlocked({ ...base, status: 'CLOSED', internal: false }), false, 'clients use their own approve/send-back rule');
});

import { canDeleteTicket } from '../src/services/ticketReviewRules.js';
test('ticket delete: admins any, requester only while untouched', () => {
  const t = { canDeleteAny: false, isRequester: true, status: 'OPEN', assigneeId: null, othersCommented: false };
  assert.equal(canDeleteTicket(t), true);
  assert.equal(canDeleteTicket({ ...t, assigneeId: 'x' }), false);
  assert.equal(canDeleteTicket({ ...t, status: 'IN_PROGRESS' }), false);
  assert.equal(canDeleteTicket({ ...t, othersCommented: true }), false);
  assert.equal(canDeleteTicket({ ...t, isRequester: false }), false);
  assert.equal(canDeleteTicket({ ...t, isRequester: false, canDeleteAny: true, status: 'CLOSED' }), true);
  assert.ok(ctx('PLATFORM_ADMIN').can('ticket.delete') && ctx('PLATFORM_ADMIN').can('ticket.delete'));
  assert.ok(!ctx('EMPLOYEE').can('ticket.delete') && !ctx('CLIENT_ADMIN').can('ticket.delete'));
});


import { incompleteWorkTasks } from '../src/services/ticketWorkRules.js';
test('ticket review is blocked by unfinished linked tasks/subtasks, but not the ticket mirror task', () => {
  const tasks = [
    { id: 'mirror', title: 'Ticket mirror', autoCreated: true, status: 'DONE' },
    { id: 'done', title: 'Finished work', autoCreated: false, status: 'DONE' },
    { id: 'todo', title: 'Open work', autoCreated: false, status: 'IN_PROGRESS' },
  ];
  assert.deepEqual(incompleteWorkTasks(tasks).map((task) => task.id), ['todo']);
  assert.deepEqual(incompleteWorkTasks(tasks.filter((task) => task.id !== 'todo')), []);
});

test('client tickets enter review only after all real linked tasks are Done', () => {
  const base = { taskStatus: 'DONE', ticketStatus: 'OPEN', organizationType: 'CLIENT', visibility: 'CLIENT', incompleteWorkCount: 0 };
  assert.equal(shouldSubmitClientTicketForReview(base), true);
  assert.equal(shouldSubmitClientTicketForReview({ ...base, incompleteWorkCount: 1 }), false);
  assert.equal(shouldSubmitClientTicketForReview({ ...base, organizationType: 'INTERNAL' }), false);
  assert.equal(shouldSubmitClientTicketForReview({ ...base, ticketStatus: 'REVIEW_HELP' }), false);
  assert.equal(shouldSubmitClientTicketForReview({ ...base, ticketStatus: 'CLOSED' }), false);
  assert.equal(shouldSubmitClientTicketForReview({ ...base, taskStatus: 'REVIEW' }), false);
});

test('a teammate who is not on a task cannot edit it (only the people it was given to, its creator, the reviewing team, admins)', () => {
  const mate = { currentUser: { id: 'm' }, memberships: [{ teamMemberships: [{ teamId: 'eng' }] }], can: (p) => ['task.update_own'].includes(p) };
  assert.ok(!canEditTask(mate, { creatorId: 'x', assigneeId: 'y', assignees: [], teamId: 'eng', teamAccesses: [{ teamId: 'eng', accessRole: 'OWNER' }] }));
  assert.ok(canEditTask(mate, { creatorId: 'x', assigneeId: 'm', assignees: [], teamId: 'eng', teamAccesses: [] }));
});
