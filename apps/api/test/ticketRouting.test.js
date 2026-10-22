import test from 'node:test';
import assert from 'node:assert/strict';
import { accessTeamIdsFor, isMemberOfAnyTeam, planAssignee } from '../src/services/ticketRouting.js';
import { permissionsFor } from '../src/rbac/permissions.js';
import { canViewTicket } from '../src/rbac/policies.js';
import { teamPeople, assigneeGroups, isInTeams, ticketTeamLabel } from '../../web/src/lib/teams.js';

const members = new Map([
  ['dev', new Set(['rahul', 'sneha', 'aditya'])],
  ['qa', new Set(['vikram', 'pooja', 'aditya'])],
  ['seo', new Set(['kavya', 'meera'])],
]);

test('access ids: owner first, de-duplicated', () => {
  assert.deepEqual(accessTeamIdsFor('dev', ['qa', 'dev']), ['dev', 'qa']);
  assert.deepEqual(accessTeamIdsFor(null, ['qa']), ['qa']);
  assert.deepEqual(accessTeamIdsFor(null, []), []);
});

test('membership lookup works for Map<Set> and plain objects', () => {
  assert.ok(isMemberOfAnyTeam('sneha', ['dev'], members));
  assert.ok(!isMemberOfAnyTeam('sneha', ['qa', 'seo'], members));
  assert.ok(isMemberOfAnyTeam('pooja', ['dev', 'qa'], { dev: ['x'], qa: ['pooja'] }));
});

test('assignee must come from the ticket team', () => {
  const ok = planAssignee({ old: { assigneeId: null }, data: { assigneeId: 'sneha' }, accessIds: ['dev'], membersByTeam: members, routingTouched: false });
  assert.equal(ok.error, null);
  assert.equal(ok.assigneeId, 'sneha');
  const bad = planAssignee({ old: { assigneeId: null }, data: { assigneeId: 'meera' }, accessIds: ['dev'], membersByTeam: members, routingTouched: false });
  assert.equal(bad.error.code, 'ASSIGNEE_NOT_IN_TEAM');
  assert.equal(bad.error.status, 400);
});

test('cannot assign before a team is chosen', () => {
  const r = planAssignee({ old: { assigneeId: null }, data: { assigneeId: 'sneha' }, accessIds: [], membersByTeam: members, routingTouched: false });
  assert.equal(r.error.code, 'TICKET_NOT_ROUTED');
  assert.equal(r.error.status, 409);
});

test('participating team members are valid assignees too', () => {
  const r = planAssignee({ old: { assigneeId: null }, data: { assigneeId: 'pooja' }, accessIds: ['dev', 'qa'], membersByTeam: members, routingTouched: false });
  assert.equal(r.error, null);
});

test('changing team clears an assignee who is not in the new team', () => {
  const r = planAssignee({ old: { assigneeId: 'sneha' }, data: { teamId: 'qa' }, accessIds: ['qa'], membersByTeam: members, routingTouched: true });
  assert.equal(r.error, null);
  assert.equal(r.assigneeId, null);
  assert.equal(r.autoUnassigned, true);
});

test('changing team keeps an assignee who is in both teams', () => {
  const r = planAssignee({ old: { assigneeId: 'aditya' }, data: { teamId: 'qa' }, accessIds: ['qa'], membersByTeam: members, routingTouched: true });
  assert.equal(r.error, null);
  assert.equal(r.assigneeId, undefined, 'left untouched');
  assert.equal(r.autoUnassigned, false);
});

test('a ticket that still has an assignee cannot be un-routed (no orphan assignee)', () => {
  const r = planAssignee({ old: { assigneeId: 'sneha' }, data: { teamId: null }, accessIds: [], membersByTeam: members, routingTouched: true });
  assert.equal(r.error?.code, 'TICKET_NOT_ROUTED');
});

test('explicit unassign always works', () => {
  const r = planAssignee({ old: { assigneeId: 'sneha' }, data: { assigneeId: null }, accessIds: ['dev'], membersByTeam: members, routingTouched: false });
  assert.equal(r.error, null);
  assert.equal(r.assigneeId, null);
});

test('status-only edit on legacy data is never blocked', () => {
  const r = planAssignee({ old: { assigneeId: 'ghost' }, data: { status: 'IN_PROGRESS' }, accessIds: ['dev'], membersByTeam: members, routingTouched: false });
  assert.equal(r.error, null);
  assert.equal(r.assigneeId, undefined);
});

// ---- visibility: a ticket must not "disappear" from the people who routed it or hold it ----
const staffCtx = (role, id, teamIds = []) => {
  const memberships = [{ role, organizationId: 'internal', organization: { type: 'INTERNAL' }, teamMemberships: teamIds.map((teamId) => ({ teamId })) }];
  const permissions = permissionsFor(memberships);
  return { currentUser: { id }, memberships, isInternal: true, permissions, can: (p) => permissions.has(p) };
};

test('manager keeps seeing a ticket they routed to another team', () => {
  const t = { id: 't', organizationId: 'c', visibility: 'CLIENT', teamId: 'qa', teamAccesses: [{ teamId: 'qa', accessRole: 'OWNER', addedById: 'rahul' }] };
  assert.equal(canViewTicket(staffCtx('MANAGER', 'rahul', ['dev']), t), true, 'router keeps visibility');
  assert.equal(canViewTicket(staffCtx('MANAGER', 'other', ['dev']), t), false, 'other managers of an unrelated team do not');
  assert.equal(canViewTicket(staffCtx('EMPLOYEE', 'rahul', ['dev']), t), true, 'every employee now keeps what they routed');
});

test('the assignee can always open their ticket', () => {
  const t = { id: 't', organizationId: 'c', visibility: 'CLIENT', teamId: 'qa', assigneeId: 'sneha', teamAccesses: [{ teamId: 'qa', accessRole: 'OWNER' }] };
  assert.equal(canViewTicket(staffCtx('EMPLOYEE', 'sneha', ['dev']), t), true);
  assert.equal(canViewTicket(staffCtx('EMPLOYEE', 'karan', ['gfx']), t), false);
});

test('a team member sees tickets of their team; unrelated team does not', () => {
  const t = { id: 't', organizationId: 'c', visibility: 'CLIENT', teamId: 'dev', teamAccesses: [{ teamId: 'dev', accessRole: 'OWNER' }] };
  assert.equal(canViewTicket(staffCtx('EMPLOYEE', 'sneha', ['dev']), t), true);
  assert.equal(canViewTicket(staffCtx('EMPLOYEE', 'meera', ['seo']), t), false);
  assert.equal(canViewTicket(staffCtx('PLATFORM_ADMIN', 'arjun', []), t), true);
});

test('unrouted client ticket is visible to managers/admin only', () => {
  const t = { id: 't', organizationId: 'c', visibility: 'CLIENT', teamId: null, teamAccesses: [] };
  assert.equal(canViewTicket(staffCtx('MANAGER', 'rahul', ['dev']), t), true);
  assert.equal(canViewTicket(staffCtx('EMPLOYEE', 'sneha', ['dev']), t), true, 'employees triage unrouted tickets too');
});

// ---- UI helpers (assignee dropdown = members of the chosen team, with role labels) ----
const teams = [
  { id: 'dev', name: 'Development', members: [
    { membership: { role: 'MANAGER', user: { id: 'rahul', name: 'Rahul Verma', email: 'r@x' } } },
    { membership: { role: 'EMPLOYEE', user: { id: 'sneha', name: 'Sneha Kulkarni', email: 's@x' } } },
  ] },
  { id: 'qa', name: 'QA', members: [{ membership: { role: 'EMPLOYEE', user: { id: 'pooja', name: 'Pooja Desai', email: 'p@x' } } }] },
];

test('assignee dropdown lists only the chosen team, with role labels', () => {
  const people = teamPeople(teams, 'dev');
  assert.deepEqual(people.map((p) => p.id), ['rahul', 'sneha']);
  assert.equal(people[0].label, 'Rahul Verma — Employee');
  assert.equal(people[1].label, 'Sneha Kulkarni — Employee');
  assert.deepEqual(teamPeople(teams, ''), [], 'no team => no options');
  assert.ok(!teamPeople(teams, 'dev').some((p) => p.id === 'pooja'));
});

test('groups put the owner team first and include participants', () => {
  const g = assigneeGroups(teams, 'dev', ['qa']);
  assert.deepEqual(g.map((x) => [x.team.id, x.owner]), [['dev', true], ['qa', false]]);
  assert.ok(isInTeams(teams, ['dev', 'qa'], 'pooja'));
  assert.ok(!isInTeams(teams, ['dev'], 'pooja'));
});

test('ticket team label for the table', () => {
  assert.equal(ticketTeamLabel({ teamId: 'dev', teamAccesses: [{ teamId: 'dev', team: { name: 'Development' } }, { teamId: 'qa', team: { name: 'QA' } }] }), 'Development +1');
  assert.equal(ticketTeamLabel({ teamId: null, teamAccesses: [] }), null);
});

// ---- tasks use the same team-first rule; multi-team pickers ----
import { assigneesOutsideTeams } from '../src/services/ticketRouting.js';
import { peopleOfTeams, sameIds } from '../../web/src/lib/teams.js';

test('task assignees outside the chosen teams are detected', () => {
  assert.deepEqual(assigneesOutsideTeams(['sneha', 'meera'], ['dev'], members), ['meera']);
  assert.deepEqual(assigneesOutsideTeams(['sneha', 'pooja'], ['dev', 'qa'], members), []);
  assert.deepEqual(assigneesOutsideTeams(['aditya'], ['seo'], members), ['aditya']);
});

test('people of several teams: owner + shared, de-duplicated, with roles', () => {
  const ppl = peopleOfTeams([
    { id: 'dev', name: 'Development', members: [{ membership: { role: 'EMPLOYEE', user: { id: 'aditya', name: 'Aditya Joshi', email: 'a@x' } } }, { membership: { role: 'MANAGER', user: { id: 'rahul', name: 'Rahul Verma', email: 'r@x' } } }] },
    { id: 'qa', name: 'QA', members: [{ membership: { role: 'EMPLOYEE', user: { id: 'aditya', name: 'Aditya Joshi', email: 'a@x' } } }, { membership: { role: 'EMPLOYEE', user: { id: 'pooja', name: 'Pooja Desai', email: 'p@x' } } }] },
  ], ['dev', 'qa']);
  assert.deepEqual(ppl.map((p) => p.id), ['aditya', 'pooja', 'rahul'], 'Aditya (Dev + QA) appears once');
  assert.equal(ppl.find((p) => p.id === 'rahul').label, 'Rahul Verma — Employee');
  assert.deepEqual(peopleOfTeams([], ['dev']), []);
  assert.deepEqual(peopleOfTeams([{ id: 'dev', members: [] }], []), [], 'no team picked => nobody to pick');
});

test('team selection "dirty" check ignores order', () => {
  assert.ok(sameIds(['a', 'b'], ['b', 'a']));
  assert.ok(!sameIds(['a'], ['a', 'b']));
  assert.ok(sameIds([], []));
});
