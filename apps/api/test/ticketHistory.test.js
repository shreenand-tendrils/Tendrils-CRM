import test from 'node:test';
import assert from 'node:assert/strict';
import { diffTicketEvents, clientView, CLIENT_STATUS_LABEL } from '../src/services/ticketEvents.js';
import { describeEvent, actorLabel, groupByDay } from '../../web/src/lib/ticketHistory.js';

const base = { title: 'Banner blurry', description: 'old', status: 'OPEN', priority: 'MEDIUM', visibility: 'CLIENT', dueDate: null, projectId: null, teamId: null, assigneeId: null };
const names = { users: { sneha: 'Sneha Kulkarni', pooja: 'Pooja Desai' }, teams: { dev: 'Development', qa: 'QA', seo: 'SEO / Marketing' }, projects: {} };
const types = (events) => events.map((e) => e.type);

test('no change => no events', () => {
  assert.deepEqual(diffTicketEvents({ old: base, updated: { ...base }, names }), []);
});

test('routing + assigning records TEAM and ASSIGNEE with readable labels', () => {
  const ev = diffTicketEvents({ old: base, updated: { ...base, teamId: 'dev', assigneeId: 'sneha' }, oldTeamIds: [], newTeamIds: ['dev'], names });
  assert.deepEqual(types(ev), ['TEAM', 'ASSIGNEE']);
  assert.equal(ev[0].toLabel, 'Development');
  assert.equal(ev[1].toLabel, 'Sneha Kulkarni');
  assert.ok(ev.every((e) => e.clientVisible === false), 'routing and assignment are internal');
});

test('moving team records from/to, reassignment records both people', () => {
  const old = { ...base, teamId: 'dev', assigneeId: 'sneha' };
  const ev = diffTicketEvents({ old, updated: { ...old, teamId: 'qa', assigneeId: 'pooja' }, oldTeamIds: ['dev'], newTeamIds: ['qa'], names });
  const team = ev.find((e) => e.type === 'TEAM'), who = ev.find((e) => e.type === 'ASSIGNEE');
  assert.deepEqual([team.fromLabel, team.toLabel], ['Development', 'QA']);
  assert.deepEqual([who.fromLabel, who.toLabel], ['Sneha Kulkarni', 'Pooja Desai']);
  assert.ok(!ev.some((e) => e.type === 'TEAM_ACCESS'), 'owner team changes are not reported twice');
});

test('participating teams: added and removed are separate events', () => {
  const old = { ...base, teamId: 'dev' };
  const ev = diffTicketEvents({ old, updated: old, oldTeamIds: ['dev', 'qa'], newTeamIds: ['dev', 'seo'], names });
  assert.deepEqual(ev.map((e) => [e.type, e.toLabel || e.fromLabel]), [['TEAM_ACCESS', 'SEO / Marketing'], ['TEAM_ACCESS', 'QA']]);
});

test('status, priority, title, due date and visibility are tracked', () => {
  const ev = diffTicketEvents({ old: base, updated: { ...base, status: 'IN_PROGRESS', priority: 'HIGH', title: 'Banner fixed', dueDate: '2026-12-01T00:00:00.000Z', visibility: 'INTERNAL' }, names });
  assert.deepEqual(types(ev).sort(), ['DUE_DATE', 'PRIORITY', 'STATUS', 'TITLE', 'VISIBILITY']);
  assert.equal(ev.find((e) => e.type === 'DUE_DATE').toValue, '2026-12-01');
});

test('clients only see client-visible events, with status in client wording', () => {
  const events = [
    { type: 'ASSIGNEE', clientVisible: false, toLabel: 'Sneha' },
    { type: 'TEAM', clientVisible: false, toLabel: 'QA' },
    { type: 'COMMENT', clientVisible: false, note: 'internal chatter' },
    { type: 'STATUS', clientVisible: true, fromValue: 'REVIEW_HELP', toValue: 'REVIEW_HELP:NEED_MORE_INFO' },
    { type: 'STATUS', clientVisible: true, fromValue: 'OPEN:IN_PROGRESS', toValue: 'REVIEW_TEST:RESOLVED' },
    { type: 'COMMENT', clientVisible: true, note: 'hello' },
  ];
  const seen = clientView(events);
  assert.deepEqual(seen.map((e) => e.type), ['STATUS', 'COMMENT'], 'internal events and the no-op Need more info -> Need more info are hidden');
  assert.equal(seen[0].toLabel, CLIENT_STATUS_LABEL.REVIEW_TEST);
  assert.ok(!JSON.stringify(seen).includes('Sneha') && !JSON.stringify(seen).includes('QA') && !JSON.stringify(seen).includes('internal chatter'));
});

test('history sentences read like a person wrote them', () => {
  assert.equal(describeEvent({ type: 'ASSIGNEE', toLabel: 'Sneha Kulkarni' }), 'assigned the ticket to Sneha Kulkarni');
  assert.equal(describeEvent({ type: 'ASSIGNEE', fromLabel: 'Sneha Kulkarni' }), 'unassigned Sneha Kulkarni');
  assert.equal(describeEvent({ type: 'ASSIGNEE', fromLabel: 'A', toLabel: 'B' }), 'changed assignee from A to B');
  assert.equal(describeEvent({ type: 'TEAM', fromLabel: 'Development', toLabel: 'QA' }), 'moved the ticket from Development to QA');
  assert.equal(describeEvent({ type: 'TEAM', toLabel: 'QA' }), 'routed the ticket to QA');
  assert.equal(describeEvent({ type: 'TEAM_ACCESS', toLabel: 'QA' }), 'shared the ticket with QA');
  assert.equal(describeEvent({ type: 'STATUS', fromValue: 'IN_PROGRESS', toValue: 'CLIENT_REVIEW' }), 'changed status from In Progress to Client Review');
  assert.equal(describeEvent({ type: 'COMMENT', clientVisible: false }), 'added an internal note');
  assert.equal(describeEvent({ type: 'ATTACHMENT', toLabel: 'banner.png' }), 'attached banner.png');
  assert.equal(describeEvent({ type: 'CREATED' }), 'created this ticket');
});

test('actor label shows the role so you know who did it', () => {
  assert.equal(actorLabel({ actor: { name: 'Rahul Verma', role: 'EMPLOYEE' } }), 'Rahul Verma (Employee)');
  assert.equal(actorLabel({ actor: { name: 'Arjun', role: 'PLATFORM_ADMIN' } }), 'Arjun (Platform admin)');
  assert.equal(actorLabel({ actor: { name: 'Rahul Verma', role: 'EMPLOYEE' } }, false), 'Rahul Verma');
  assert.equal(actorLabel({ actor: null }), 'Someone');
});

test('events are grouped by day, newest first', () => {
  const g = groupByDay([{ id: 1, createdAt: '2026-10-20T10:00:00' }, { id: 2, createdAt: '2026-10-20T09:00:00' }, { id: 3, createdAt: '2026-10-19T09:00:00' }]);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.events.length), [2, 1]);
});

test('pasted-image markers do not count as a description change', () => {
  const base = { title: 't', status: 'OPEN', progress: null, priority: 'LOW', visibility: 'CLIENT' };
  const ev = diffTicketEvents({ old: { ...base, description: 'see below [[img:pending-0]]' }, updated: { ...base, description: 'see below [[img:ck123abc]]' } });
  assert.equal(ev.filter((e) => e.type === 'DESCRIPTION').length, 0);
  assert.equal(diffTicketEvents({ old: { ...base, description: 'a' }, updated: { ...base, description: 'b' } }).filter((e) => e.type === 'DESCRIPTION').length, 1);
});
