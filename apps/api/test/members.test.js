import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptInvitesForEmail, canSignIn, assertTeamsFor, grantMembership, isInviteUsable, normalizeEmail } from '../src/services/invitationsCore.js';
import { checkGrant, clientStatusChangeAllowed, canPostProjectUpdate, ticketEditScope, TICKET_FIELDS } from '../src/rbac/policies.js';
import { permissionsFor } from '../src/rbac/permissions.js';
import { memberInvite, invitationCreate, memberTeamsSet, chatMessageCreate, projectUpdateCreate } from '../src/validators/schemas.js';

// Tiny in-memory stand-in for Prisma: just the calls the invitation rules make.
function fakeDb({ orgs, teams = [], invitations = [] }) {
  const users = [], memberships = [], teamMembers = []; let n = 0;
  const db = {
    users, memberships, teamMembers, invitations,
    invitation: {
      findMany: async ({ where }) => invitations.filter((i) => i.email === where.email && i.status === 'PENDING' && i.expiresAt > new Date()).map((i) => ({ ...i, organization: orgs.find((o) => o.id === i.organizationId) })),
      findFirst: async ({ where }) => invitations.find((i) => i.email === where.email && i.status === 'PENDING' && i.expiresAt > new Date()) || null,
      update: async ({ where, data }) => Object.assign(invitations.find((i) => i.id === where.id), data),
    },
    team: {
      findMany: async ({ where }) => teams.filter((t) => where.id.in.includes(t.id) && orgs.find((o) => o.id === t.organizationId).type === 'INTERNAL'),
      count: async ({ where }) => teams.filter((t) => where.id.in.includes(t.id) && orgs.find((o) => o.id === t.organizationId).type === 'INTERNAL').length,
    },
    user: { upsert: async ({ where, create }) => users.find((u) => u.email === where.email) || (users.push({ id: `u${++n}`, ...create }), users.at(-1)) },
    membership: {
      upsert: async ({ where, update, create }) => {
        const k = where.userId_organizationId; const hit = memberships.find((m) => m.userId === k.userId && m.organizationId === k.organizationId);
        if (hit) return Object.assign(hit, update);
        memberships.push({ id: `m${++n}`, isActive: true, ...create }); return memberships.at(-1);
      },
      findFirst: async ({ where }) => memberships.find((m) => m.isActive && users.find((u) => u.id === m.userId)?.email === where.user.email) || null,
    },
    teamMember: { createMany: async ({ data }) => { for (const d of data) if (!teamMembers.some((t) => t.teamId === d.teamId && t.membershipId === d.membershipId)) teamMembers.push(d); } },
    $transaction: async (fn) => fn(db),
  };
  return db;
}
const orgs = [{ id: 'int', type: 'INTERNAL', isActive: true }, { id: 'cli', type: 'CLIENT', isActive: true }];
const soon = new Date(Date.now() + 86400000), past = new Date(Date.now() - 1000);

test('invitation: accepted on sign-in with the invited email, many teams, any email domain', async () => {
  const db = fakeDb({ orgs, teams: [{ id: 't1', organizationId: 'int' }, { id: 't2', organizationId: 'int' }], invitations: [{ id: 'i1', email: 'new.person@gmail.com', organizationId: 'int', role: 'EMPLOYEE', teamIds: ['t1', 't2'], status: 'PENDING', expiresAt: soon }] });
  assert.equal(await canSignIn(db, 'New.Person@Gmail.com'), true, 'invited address (any domain, any case) may sign in');
  assert.equal(await canSignIn(db, 'stranger@gmail.com'), false, 'uninvited address is refused');
  assert.equal(await acceptInvitesForEmail(db, 'New.Person@Gmail.com', 'New Person'), 1);
  assert.deepEqual(db.teamMembers.map((t) => t.teamId).sort(), ['t1', 't2'], 'multiple teams applied');
  assert.equal(db.invitations[0].status, 'ACCEPTED');
  assert.equal(await acceptInvitesForEmail(db, 'new.person@gmail.com'), 0, 'single use');
});

test('invitation: expired / revoked / mismatched role never grant access', async () => {
  const mk = (over) => fakeDb({ orgs, invitations: [{ id: 'i', email: 'a@x.io', organizationId: 'cli', role: 'CLIENT_ADMIN', teamIds: [], status: 'PENDING', expiresAt: soon, ...over }] });
  assert.equal(await acceptInvitesForEmail(mk({ expiresAt: past }), 'a@x.io'), 0);
  assert.equal(await acceptInvitesForEmail(mk({ status: 'REVOKED' }), 'a@x.io'), 0);
  const bad = mk({ role: 'MANAGER' }); // staff role in a client workspace
  assert.equal(await acceptInvitesForEmail(bad, 'a@x.io'), 0);
  assert.equal(bad.memberships.length, 0);
  assert.ok(isInviteUsable({ status: 'PENDING', expiresAt: soon }) && !isInviteUsable({ status: 'PENDING', expiresAt: past }));
});

test('client invitations never receive teams; teams must be internal', async () => {
  const db = fakeDb({ orgs, teams: [{ id: 't1', organizationId: 'int' }] });
  await assert.rejects(assertTeamsFor(db, 'CLIENT', ['t1']), /internal/i);
  await assert.rejects(assertTeamsFor(db, 'INTERNAL', ['nope']), /not found/i);
  assert.deepEqual(await assertTeamsFor(db, 'INTERNAL', ['t1', 't1']), ['t1']);
  const { membership } = await grantMembership(db, { email: 'p@q.io', organizationId: 'int', role: 'EMPLOYEE', teamIds: ['t1'] });
  assert.equal(db.teamMembers[0].membershipId, membership.id);
  assert.equal(normalizeEmail('  A@B.IO '), 'a@b.io');
});

test('grant rules: role fits workspace, only Platform admin grants admin', () => {
  const can = (list) => (p) => list.includes(p);
  assert.match(checkGrant({ actorCan: can([]), role: 'CLIENT_ADMIN', orgType: 'INTERNAL' }), /not a valid role/);
  assert.match(checkGrant({ actorCan: can([]), role: 'EMPLOYEE', orgType: 'CLIENT' }), /not a valid role/);
  assert.match(checkGrant({ actorCan: can([]), role: 'PLATFORM_ADMIN', orgType: 'INTERNAL' }), /Only a Platform admin/);
  assert.equal(checkGrant({ actorCan: can(['member.grant_admin']), role: 'PLATFORM_ADMIN', orgType: 'INTERNAL' }), null);
  assert.equal(checkGrant({ actorCan: can([]), role: 'CLIENT_MEMBER', orgType: 'CLIENT' }), null);
});

test('client ticket flow: can only approve or send back from CLIENT_REVIEW', () => {
  assert.ok(clientStatusChangeAllowed('CLIENT_REVIEW', 'CLOSED') && clientStatusChangeAllowed('CLIENT_REVIEW', 'IN_PROGRESS'));
  assert.ok(!clientStatusChangeAllowed('OPEN', 'CLOSED') && !clientStatusChangeAllowed('IN_PROGRESS', 'RESOLVED') && !clientStatusChangeAllowed('CLIENT_REVIEW', 'OPEN'));
  const ctx = (role) => { const memberships = [{ role, organizationId: 'o', organization: { type: role.startsWith('CLIENT') ? 'CLIENT' : 'INTERNAL' } }]; const p = permissionsFor(memberships); return { currentUser: { id: 'u' }, memberships, isInternal: !role.startsWith('CLIENT'), can: (x) => p.has(x) }; };
  const t = { organizationId: 'o', requesterId: 'u', assigneeId: 'e' };
  assert.equal(ticketEditScope(ctx('CLIENT_MEMBER'), t), 'client');
  assert.ok(TICKET_FIELDS.client.includes('status') && !TICKET_FIELDS.client.includes('assigneeId') && !TICKET_FIELDS.client.includes('visibility'));
});

test('project updates: members, leads and managers post; clients never do', () => {
  const ctx = (role, id = 'u') => { const memberships = [{ role, organizationId: 'o', organization: { type: role.startsWith('CLIENT') ? 'CLIENT' : 'INTERNAL' } }]; const p = permissionsFor(memberships); return { currentUser: { id }, memberships, isInternal: !role.startsWith('CLIENT'), can: (x) => p.has(x) }; };
  const project = { members: [{ userId: 'dev' }] };
  assert.ok(canPostProjectUpdate(ctx('EMPLOYEE', 'dev'), project));
  assert.ok(!canPostProjectUpdate(ctx('EMPLOYEE', 'other'), project));
  assert.ok(canPostProjectUpdate(ctx('TEAM_LEAD', 'other'), project) && canPostProjectUpdate(ctx('MANAGER'), project));
  assert.ok(!canPostProjectUpdate(ctx('CLIENT_ADMIN', 'dev'), project));
});

test('schemas: invite bodies, teams, mentions, project updates', () => {
  assert.equal(invitationCreate.parse({ email: ' A@B.IO ', organizationId: 'o', role: 'EMPLOYEE', teamIds: ['t1', 't2'] }).email, 'a@b.io');
  assert.equal(memberInvite.parse({ email: 'a@b.io', organizationId: 'o', role: 'CLIENT_ADMIN' }).notify, true);
  assert.ok(!invitationCreate.safeParse({ email: 'nope', organizationId: 'o', role: 'EMPLOYEE' }).success);
  assert.ok(!invitationCreate.safeParse({ email: 'a@b.io', organizationId: 'o', role: 'GOD' }).success);
  assert.deepEqual(memberTeamsSet.parse({ teamIds: [] }).teamIds, []);
  assert.deepEqual(chatMessageCreate.parse({ body: 'hi @dev', mentionIds: ['u1'] }).mentionIds, ['u1']);
  assert.ok(!chatMessageCreate.safeParse({ body: '   ' }).success);
  assert.ok(!projectUpdateCreate.safeParse({ title: 'x', body: 'ok' }).success);
});
