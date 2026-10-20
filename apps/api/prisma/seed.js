// Clean, realistic dev data for every role. ONE seed (replaces the old seed.js / seed-demo.js / seed-company.js).
//   npm run db:seed     add/refresh the data (safe to re-run)
//   npm run db:fresh    wipe the database, re-apply migrations, then seed (a truly clean start)
// DEV ONLY. Every email is "<name>.demo@<domain>" so the DEV LOGIN switcher lists them.
//
// Structure:  Boss (Platform admin) -> team Managers -> team Employees;  4 client companies, each with a client boss
// (Client admin) and, for two of them, a client member. Tickets are already routed to teams, assigned from those teams,
// and carry a history, so every screen has something sensible to show.
import { PrismaClient } from '@prisma/client';
import { TICKET_TO_TASK, taskTitleFor } from '../src/services/ticketTaskMaps.js';

const prisma = new PrismaClient();
const DAY = 86400000, HOUR = 3600000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * HOUR);
const ahead = (days) => new Date(Date.now() + days * DAY);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TEAMS = ['Product', 'Graphics / Creative', 'IT / Infrastructure', 'Development', 'SEO / Marketing', 'QA', 'Management / Operations'];

// role: PLATFORM_ADMIN = Boss / root admin, MANAGER = team manager, EMPLOYEE = team member
const STAFF = [
  { key: 'arjun', email: 'arjun.demo@tendrils.io', name: 'Arjun Mehta', role: 'PLATFORM_ADMIN', teams: ['management-operations'] },
  { key: 'rahul', email: 'rahul.demo@tendrils.io', name: 'Rahul Verma', role: 'MANAGER', teams: ['development'] },
  { key: 'nisha', email: 'nisha.demo@tendrils.io', name: 'Nisha Rao', role: 'MANAGER', teams: ['graphics-creative'] },
  { key: 'kavya', email: 'kavya.demo@tendrils.io', name: 'Kavya Nair', role: 'MANAGER', teams: ['seo-marketing'] },
  { key: 'vikram', email: 'vikram.demo@tendrils.io', name: 'Vikram Singh', role: 'MANAGER', teams: ['qa'] },
  { key: 'anil', email: 'anil.demo@tendrils.io', name: 'Anil Kumar', role: 'MANAGER', teams: ['it-infrastructure'] },
  { key: 'priya', email: 'priya.demo@tendrils.io', name: 'Priya Shah', role: 'MANAGER', teams: ['product', 'management-operations'] },
  { key: 'sneha', email: 'sneha.demo@tendrils.io', name: 'Sneha Kulkarni', role: 'EMPLOYEE', teams: ['development'] },
  { key: 'aditya', email: 'aditya.demo@tendrils.io', name: 'Aditya Joshi', role: 'EMPLOYEE', teams: ['development', 'qa'] },
  { key: 'karan', email: 'karan.demo@tendrils.io', name: 'Karan Patil', role: 'EMPLOYEE', teams: ['graphics-creative'] },
  { key: 'meera', email: 'meera.demo@tendrils.io', name: 'Meera Iyer', role: 'EMPLOYEE', teams: ['seo-marketing'] },
  { key: 'pooja', email: 'pooja.demo@tendrils.io', name: 'Pooja Desai', role: 'EMPLOYEE', teams: ['qa'] },
  { key: 'nikhil', email: 'nikhil.demo@tendrils.io', name: 'Nikhil Gupta', role: 'EMPLOYEE', teams: ['it-infrastructure'] },
  { key: 'ritu', email: 'ritu.demo@tendrils.io', name: 'Ritu Sen', role: 'EMPLOYEE', teams: ['product'] },
];

const CLIENTS = [
  { name: 'Sofabed', slug: 'sofabed', users: [
    { key: 'rohan', email: 'boss.demo@sofabed.test', name: 'Rohan Malhotra', role: 'CLIENT_ADMIN' },
    { key: 'neha', email: 'sofabed.demo@sofabed.test', name: 'Neha Arora', role: 'CLIENT_MEMBER' }] },
  { name: 'JenniHome', slug: 'jennihome', users: [
    { key: 'sanjay', email: 'boss.demo@jennihome.test', name: 'Sanjay Bhatia', role: 'CLIENT_ADMIN' },
    { key: 'tanvi', email: 'jennihome.demo@jennihome.test', name: 'Tanvi Kapoor', role: 'CLIENT_MEMBER' }] },
  { name: 'Jennifer Furniture', slug: 'jennifer-furniture', users: [
    { key: 'divya', email: 'boss.demo@jennifer-furniture.test', name: 'Divya Menon', role: 'CLIENT_ADMIN' }] },
  { name: 'Comfort Furniture', slug: 'comfort-furniture', users: [
    { key: 'imran', email: 'boss.demo@comfort-furniture.test', name: 'Imran Qureshi', role: 'CLIENT_ADMIN' }] },
];

// Old demo accounts from earlier versions: switched off so they never show up in the DEV LOGIN switcher.
const RETIRED = ['maya', 'tara', 'dev', 'isha', 'root'].map((n) => `${n}.demo@tendrils.io`);

async function main() {
  // ---- organizations, teams -------------------------------------------------
  const internal = await prisma.organization.upsert({ where: { slug: 'tendrils' }, update: { name: 'Tendrils', type: 'INTERNAL' }, create: { name: 'Tendrils', slug: 'tendrils', type: 'INTERNAL' } });
  const org = {};
  for (const c of CLIENTS) org[c.slug] = await prisma.organization.upsert({ where: { slug: c.slug }, update: { name: c.name }, create: { name: c.name, slug: c.slug, type: 'CLIENT' } });
  const team = {};
  for (const name of TEAMS) {
    const slug = slugify(name);
    team[slug] = await prisma.team.upsert({ where: { organizationId_slug: { organizationId: internal.id, slug } }, update: { name }, create: { name, slug, organizationId: internal.id, description: `${name} team` } });
  }

  // ---- people ---------------------------------------------------------------
  const u = {};
  const person = async (p, organizationId) => {
    const user = await prisma.user.upsert({ where: { email: p.email }, update: { name: p.name }, create: { email: p.email, name: p.name, emailVerified: new Date() } });
    const membership = await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId } },
      update: { role: p.role, isActive: true }, create: { userId: user.id, organizationId, role: p.role },
    });
    u[p.key] = user;
    return membership;
  };
  for (const p of STAFF) {
    const membership = await person(p, internal.id);
    for (const slug of p.teams) {
      await prisma.teamMember.upsert({ where: { teamId_membershipId: { teamId: team[slug].id, membershipId: membership.id } }, update: {}, create: { teamId: team[slug].id, membershipId: membership.id } });
    }
  }
  for (const c of CLIENTS) for (const p of c.users) await person(p, org[c.slug].id);

  const retired = await prisma.user.findMany({ where: { email: { in: RETIRED } }, select: { id: true } });
  if (retired.length) await prisma.membership.updateMany({ where: { userId: { in: retired.map((r) => r.id) } }, data: { isActive: false } });

  // ---- projects (with their chat rooms) ---------------------------------------
  const project = async (name, slug, leadKey, memberKeys, description, dueDays) => {
    const found = await prisma.project.findFirst({ where: { name, organizationId: org[slug].id } });
    if (found) return found;
    return prisma.project.create({
      data: {
        name, description, organizationId: org[slug].id, status: 'ACTIVE', ownerId: u[leadKey].id, startDate: ago(20), dueDate: ahead(dueDays),
        members: { create: [...new Set([leadKey, ...memberKeys])].map((k) => ({ userId: u[k].id, role: k === leadKey ? 'LEAD' : 'MEMBER' })) },
        chatRoom: { create: { name, type: 'PROJECT' } },
      },
    });
  };
  const web = await project('Website Revamp', 'sofabed', 'rahul', ['sneha', 'aditya', 'karan', 'pooja'], 'New storefront, homepage and checkout for Sofabed.', 30);
  const seo = await project('JenniHome SEO', 'jennihome', 'kavya', ['meera'], 'Keyword strategy, on-page fixes and monthly reporting for JenniHome.', 45);
  const catalog = await project('Catalog Migration', 'jennifer-furniture', 'anil', ['nikhil', 'ritu'], 'Move the product catalogue to the new platform.', 40);
  const brand = await project('Brand Refresh', 'comfort-furniture', 'nisha', ['karan'], 'Logo, colours and social templates for Comfort Furniture.', 25);

  // ---- standalone tasks: every task has a team and its assignees come from that team ------
  const task = async ({ title, slug, projectId, teamSlug, creator, assignees, status, priority = 'MEDIUM', due }) => {
    if (await prisma.task.findFirst({ where: { title, organizationId: org[slug].id } })) return;
    await prisma.task.create({
      data: {
        title, organizationId: org[slug].id, projectId, teamId: team[teamSlug].id, status, priority, creatorId: u[creator].id,
        dueDate: ahead(due), assigneeId: u[assignees[0]].id,
        assignees: { create: assignees.map((k) => ({ userId: u[k].id })) },
        teamAccesses: { create: [{ teamId: team[teamSlug].id, accessRole: 'OWNER', addedById: u[creator].id }] },
      },
    });
  };
  await task({ title: 'Build new homepage hero', slug: 'sofabed', projectId: web.id, teamSlug: 'development', creator: 'rahul', assignees: ['sneha', 'aditya'], status: 'IN_PROGRESS', priority: 'HIGH', due: 3 });
  await task({ title: 'Fix checkout bug (overdue)', slug: 'sofabed', projectId: web.id, teamSlug: 'development', creator: 'rahul', assignees: ['sneha'], status: 'TODO', priority: 'URGENT', due: -2 });
  await task({ title: 'Regression test: checkout flow', slug: 'sofabed', projectId: web.id, teamSlug: 'qa', creator: 'vikram', assignees: ['pooja'], status: 'BACKLOG', priority: 'MEDIUM', due: 5 });
  await task({ title: 'Design hero banner artwork', slug: 'sofabed', projectId: web.id, teamSlug: 'graphics-creative', creator: 'nisha', assignees: ['karan'], status: 'IN_PROGRESS', priority: 'HIGH', due: 2 });
  await task({ title: 'Keyword research', slug: 'jennihome', projectId: seo.id, teamSlug: 'seo-marketing', creator: 'kavya', assignees: ['meera'], status: 'BACKLOG', priority: 'MEDIUM', due: 7 });
  await task({ title: 'Rewrite product meta titles', slug: 'jennihome', projectId: seo.id, teamSlug: 'seo-marketing', creator: 'kavya', assignees: ['meera', 'kavya'], status: 'TODO', priority: 'MEDIUM', due: 4 });
  await task({ title: 'Set up staging server', slug: 'jennifer-furniture', projectId: catalog.id, teamSlug: 'it-infrastructure', creator: 'anil', assignees: ['nikhil'], status: 'IN_PROGRESS', priority: 'HIGH', due: 1 });
  await task({ title: 'Write migration plan', slug: 'jennifer-furniture', projectId: catalog.id, teamSlug: 'product', creator: 'priya', assignees: ['ritu'], status: 'TODO', priority: 'MEDIUM', due: 6 });
  await task({ title: 'Moodboard and colour options', slug: 'comfort-furniture', projectId: brand.id, teamSlug: 'graphics-creative', creator: 'nisha', assignees: ['karan'], status: 'TODO', priority: 'LOW', due: 5 });

  // ---- tickets: routed to a team, assigned from it, with history + their auto-created task ----
  // events: [daysAgo, actorKey, type, extra]. STATUS events carry fromValue/toValue.
  const ticket = async (t) => {
    if (await prisma.ticket.findUnique({ where: { key: t.key } })) return;
    const requester = u[t.requester];
    const owner = t.team ? team[t.team] : null;
    const created = await prisma.ticket.create({
      data: {
        key: t.key, title: t.title, description: t.description, organizationId: org[t.org].id, projectId: t.project?.id ?? null,
        visibility: t.visibility || 'CLIENT', requesterId: requester.id, status: t.status, priority: t.priority || 'MEDIUM',
        teamId: owner?.id ?? null, assigneeId: t.assignee ? u[t.assignee].id : null, dueDate: t.due != null ? ahead(t.due) : null, createdAt: ago(t.age),
      },
    });
    if (owner) {
      await prisma.ticketTeamAccess.create({ data: { ticketId: created.id, teamId: owner.id, accessRole: 'OWNER', addedById: u[t.routedBy].id, createdAt: ago(t.age - 0.1) } });
      for (const slug of t.shared || []) await prisma.ticketTeamAccess.create({ data: { ticketId: created.id, teamId: team[slug].id, accessRole: 'PARTICIPANT', addedById: u[t.routedBy].id } });
    }
    const name = (k) => u[k].name;
    const events = [{ at: t.age, actor: t.requester, type: 'CREATED', note: t.key, clientVisible: t.visibility !== 'INTERNAL' }];
    if (owner) events.push({ at: t.age - 0.1, actor: t.routedBy, type: 'TEAM', toValue: owner.id, toLabel: owner.name });
    for (const slug of t.shared || []) events.push({ at: t.age - 0.1, actor: t.routedBy, type: 'TEAM_ACCESS', toValue: team[slug].id, toLabel: team[slug].name });
    if (t.assignee) events.push({ at: t.age - 0.2, actor: t.assignedBy, type: 'ASSIGNEE', toValue: u[t.assignee].id, toLabel: name(t.assignee) });
    let prev = 'OPEN';
    for (const [at, actor, status] of t.statuses || []) { events.push({ at, actor, type: 'STATUS', fromValue: prev, toValue: status, clientVisible: t.visibility !== 'INTERNAL' }); prev = status; }
    for (const [at, actor, body, visibility] of t.comments || []) {
      const c = await prisma.comment.create({ data: { body, visibility, authorId: u[actor].id, ticketId: created.id, createdAt: ago(at) } });
      events.push({ at, actor, type: 'COMMENT', toValue: c.id, note: body.slice(0, 140), clientVisible: visibility === 'CLIENT' });
    }
    for (const e of events.sort((a, b) => b.at - a.at)) {
      const { at, actor, ...rest } = e;
      await prisma.ticketEvent.create({ data: { ticketId: created.id, actorId: u[actor].id, clientVisible: false, ...rest, createdAt: ago(at) } });
    }
    await prisma.activityLog.create({ data: { actorId: requester.id, organizationId: org[t.org].id, entityType: 'ticket', entityId: created.id, action: 'created', summary: `Created ticket ${t.key}: ${t.title}`, metadata: { visibility: t.visibility || 'CLIENT', requesterId: requester.id }, createdAt: ago(t.age) } });
    if (t.assignee) {
      await prisma.task.create({
        data: {
          title: taskTitleFor({ key: t.key, title: t.title }), organizationId: org[t.org].id, projectId: t.project?.id ?? null, ticketId: created.id, teamId: owner.id,
          autoCreated: true, status: TICKET_TO_TASK[t.status], priority: t.priority || 'MEDIUM', creatorId: u[t.assignedBy].id, dueDate: t.due != null ? ahead(t.due) : null,
          assigneeId: u[t.assignee].id, assignees: { create: [{ userId: u[t.assignee].id }] },
        },
      });
    }
  };

  await ticket({ key: 'SOF-100001', org: 'sofabed', project: web, requester: 'neha', title: 'Banner image looks blurry', description: 'The homepage banner is pixelated on large screens.',
    team: 'graphics-creative', routedBy: 'priya', assignee: 'karan', assignedBy: 'nisha', status: 'IN_PROGRESS', priority: 'MEDIUM', due: 4, age: 3,
    statuses: [[2.6, 'nisha', 'TRIAGED'], [2, 'karan', 'IN_PROGRESS']],
    comments: [[2.5, 'nisha', 'Looks like the source file is 800px wide. Karan will recreate it at 2400px.', 'CLIENT'], [2.4, 'nisha', 'Check if the old banner is used on the landing pages too.', 'INTERNAL']] });
  await ticket({ key: 'SOF-100002', org: 'sofabed', project: web, requester: 'rahul', visibility: 'INTERNAL', title: 'Refactor product schema', description: 'Internal clean-up before the new catalogue goes live.',
    team: 'development', shared: ['qa'], routedBy: 'rahul', assignee: 'aditya', assignedBy: 'rahul', status: 'IN_PROGRESS', priority: 'MEDIUM', due: 10, age: 5,
    statuses: [[4, 'aditya', 'IN_PROGRESS']] });
  await ticket({ key: 'SOF-100003', org: 'sofabed', project: web, requester: 'rohan', title: 'Need invoice export', description: 'Can we export all invoices as CSV from the admin?', status: 'OPEN', priority: 'MEDIUM', age: 0.3 });
  await ticket({ key: 'SOF-100004', org: 'sofabed', project: web, requester: 'neha', title: 'Footer links broken on mobile', description: 'Privacy and Terms links do nothing on phones.',
    team: 'development', routedBy: 'rahul', assignee: 'sneha', assignedBy: 'rahul', status: 'CLIENT_REVIEW', priority: 'HIGH', due: 1, age: 6,
    statuses: [[5.5, 'rahul', 'TRIAGED'], [5, 'sneha', 'IN_PROGRESS'], [1, 'sneha', 'REVIEW'], [0.5, 'rahul', 'CLIENT_REVIEW']],
    comments: [[0.5, 'rahul', 'Fixed and deployed to staging. Please check on your phone.', 'CLIENT']] });
  await ticket({ key: 'JEN-100001', org: 'jennihome', project: seo, requester: 'tanvi', title: 'Add size chart to product pages', description: 'Customers keep asking for sizes before buying.',
    team: 'seo-marketing', shared: ['development'], routedBy: 'priya', assignee: 'meera', assignedBy: 'kavya', status: 'TRIAGED', priority: 'MEDIUM', due: 8, age: 2,
    statuses: [[1.5, 'kavya', 'TRIAGED']] });
  await ticket({ key: 'JFN-100001', org: 'jennifer-furniture', project: catalog, requester: 'divya', title: 'Product feed is missing prices', description: 'About 40 products have no price after the import.',
    team: 'it-infrastructure', routedBy: 'priya', assignee: 'nikhil', assignedBy: 'anil', status: 'IN_PROGRESS', priority: 'HIGH', due: 2, age: 4,
    statuses: [[3.5, 'anil', 'TRIAGED'], [3, 'nikhil', 'IN_PROGRESS']] });
  await ticket({ key: 'COM-100001', org: 'comfort-furniture', project: brand, requester: 'imran', title: 'Logo colours look different on mobile', description: 'The orange looks more red on Android phones.', status: 'OPEN', priority: 'LOW', age: 0.6 });

  const yesterday = new Date(`${new Date(Date.now() - DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);
  await prisma.dailyUpdate.upsert({
    where: { userId_date: { userId: u.sneha.id, date: yesterday } }, update: {},
    create: { userId: u.sneha.id, date: yesterday, yesterday: 'Started the footer link fix', today: 'Finish the fix and start the checkout bug', blockers: 'Waiting for staging credentials' },
  });

  console.log('Seed ready. DEV LOGIN accounts (role: team):');
  for (const p of STAFF) console.log(`  ${p.role.padEnd(15)} ${p.email.padEnd(28)} ${p.teams.join(', ')}`);
  for (const c of CLIENTS) for (const p of c.users) console.log(`  ${p.role.padEnd(15)} ${p.email.padEnd(40)} ${c.name}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
