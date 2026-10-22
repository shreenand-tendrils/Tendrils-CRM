// Clean, realistic dev data for every role. ONE seed.
//   npm run db:seed     ONE-TIME: seeds the demo data once. A second run does nothing (your edits are never overwritten).
//   npm run db:fresh    wipe the database, re-apply migrations, then seed (a truly clean start)
//   SEED_FORCE=true npm run db:seed   re-run on purpose (only ADDS missing rows, never overwrites existing people)
// DEV ONLY. Every email is "<name>.demo@<domain>" so the DEV LOGIN switcher lists them.
//
// Structure: Boss (Platform admin) and Employees in 7 teams (IT, SEO, Graphics, Products, Marketing, Facebook Ads, Google Ads);
// there is no Manager role: every employee works with the former manager permissions inside their teams.
// 4 client companies, each with a client boss (Client admin) and, for two of them, a client member.
import { PrismaClient } from '@prisma/client';
import { ticketToTaskStatus, statusKey, taskTitleFor } from '../src/services/ticketTaskMaps.js';
import { STAFF, CLIENTS, CANONICAL_EMAILS, CANONICAL_NAMES } from '../src/services/demoPeople.js';

const prisma = new PrismaClient();
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY);
const ahead = (days) => new Date(Date.now() + days * DAY);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TEAMS = ['IT', 'SEO', 'Graphics', 'Products', 'Marketing', 'Advertising'];
const RETIRED = ['maya', 'tara', 'dev', 'isha', 'root'].map((n) => `${n}.demo@tendrils.io`);
const SEED_KEY = 'demo-data-v3';

async function main() {
  const already = await prisma.seedMarker.findUnique({ where: { key: SEED_KEY } });
  if (already && process.env.SEED_FORCE !== 'true') {
    console.log(`Seed skipped: demo data was already seeded on ${already.ranAt.toISOString()}. Nothing was changed.`);
    console.log('For a clean start run "npm run db:fresh". To top up missing rows only: SEED_FORCE=true npm run db:seed');
    return;
  }
  // ---- organizations, teams -------------------------------------------------
  const internal = await prisma.organization.upsert({ where: { slug: 'tendrils' }, update: {}, create: { name: 'Tendrils', slug: 'tendrils', type: 'INTERNAL' } });
  const org = {};
  for (const c of CLIENTS) org[c.slug] = await prisma.organization.upsert({ where: { slug: c.slug }, update: {}, create: { name: c.name, slug: c.slug, type: 'CLIENT' } });
  const team = {};
  for (const name of TEAMS) {
    const slug = slugify(name);
    team[slug] = await prisma.team.upsert({ where: { organizationId_slug: { organizationId: internal.id, slug } }, update: {}, create: { name, slug, organizationId: internal.id } });
  }

  // ---- people ---------------------------------------------------------------
  const u = {};
  const person = async (p, organizationId) => {
    const user = await prisma.user.upsert({ where: { email: p.email }, update: {}, create: { email: p.email, name: p.name, emailVerified: new Date() } });
    const membership = await prisma.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId } }, update: { role: p.role, isActive: true }, create: { userId: user.id, organizationId, role: p.role } });
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

  // Merge legacy Facebook Ads and Google Ads teams into the common Advertising team.
  // Preserve existing membership, project, ticket and task access while migrating old records.
  const advertising = team.advertising;
  const legacyAdTeams = await prisma.team.findMany({
    where: { organizationId: internal.id, slug: { in: ['facebook-ads', 'google-ads'] } },
    select: { id: true },
  });
  for (const old of legacyAdTeams) {
    const memberships = await prisma.teamMember.findMany({ where: { teamId: old.id } });
    for (const m of memberships) await prisma.teamMember.upsert({
      where: { teamId_membershipId: { teamId: advertising.id, membershipId: m.membershipId } },
      update: {}, create: { teamId: advertising.id, membershipId: m.membershipId },
    });
    const projects = await prisma.projectTeam.findMany({ where: { teamId: old.id }, select: { projectId: true } });
    for (const row of projects) await prisma.projectTeam.upsert({
      where: { projectId_teamId: { projectId: row.projectId, teamId: advertising.id } },
      update: {}, create: { projectId: row.projectId, teamId: advertising.id },
    });
    const ticketAccess = await prisma.ticketTeamAccess.findMany({ where: { teamId: old.id } });
    for (const row of ticketAccess) await prisma.ticketTeamAccess.upsert({
      where: { ticketId_teamId: { ticketId: row.ticketId, teamId: advertising.id } },
      update: {}, create: { ticketId: row.ticketId, teamId: advertising.id, accessRole: row.accessRole, addedById: row.addedById },
    });
    const taskAccess = await prisma.taskTeamAccess.findMany({ where: { teamId: old.id } });
    for (const row of taskAccess) await prisma.taskTeamAccess.upsert({
      where: { taskId_teamId: { taskId: row.taskId, teamId: advertising.id } },
      update: {}, create: { taskId: row.taskId, teamId: advertising.id, accessRole: row.accessRole, addedById: row.addedById },
    });
    await prisma.ticket.updateMany({ where: { teamId: old.id }, data: { teamId: advertising.id } });
    await prisma.task.updateMany({ where: { teamId: old.id }, data: { teamId: advertising.id } });
    await prisma.teamMember.deleteMany({ where: { teamId: old.id } });
    await prisma.projectTeam.deleteMany({ where: { teamId: old.id } });
    await prisma.ticketTeamAccess.deleteMany({ where: { teamId: old.id } });
    await prisma.taskTeamAccess.deleteMany({ where: { teamId: old.id } });
    await prisma.team.update({ where: { id: old.id }, data: { isActive: false } });
  }

  // Switch off old demo accounts from earlier versions so nobody shows up twice.
  const retired = await prisma.user.findMany({ where: { email: { in: RETIRED } }, select: { id: true } });
  if (retired.length) await prisma.membership.updateMany({ where: { userId: { in: retired.map((r) => r.id) } }, data: { isActive: false } });
  const stale = (await prisma.user.findMany({ where: { email: { contains: '.demo@' } }, select: { id: true, email: true, name: true } }))
    .filter((x) => !CANONICAL_EMAILS.has(x.email.toLowerCase()) && CANONICAL_NAMES.has(String(x.name || '').trim().toLowerCase()));
  if (stale.length) await prisma.membership.updateMany({ where: { userId: { in: stale.map((x) => x.id) } }, data: { isActive: false } });

  // ---- projects (with chat rooms and the teams working on them) ----------------
  const project = async (name, slug, leadKey, memberKeys, description, dueDays, teamSlugs, extra = {}) => {
    const found = await prisma.project.findFirst({ where: { name, organizationId: org[slug].id } });
    if (found) return found;
    return prisma.project.create({
      data: {
        name, description, organizationId: org[slug].id, status: 'ACTIVE', ownerId: u[leadKey].id, startDate: ago(20), dueDate: ahead(dueDays), ...extra,
        teams: { create: teamSlugs.map((s) => ({ teamId: team[s].id })) },
        members: { create: [...new Set([leadKey, ...memberKeys])].map((k) => ({ userId: u[k].id, role: k === leadKey ? 'LEAD' : 'MEMBER' })) },
        chatRoom: { create: { name, type: 'PROJECT' } },
      },
    });
  };
  const web = await project('Website Revamp', 'sofabed', 'rahul', ['anil', 'nikhil', 'karan', 'sneha', 'vikram', 'omkar'], 'New storefront, homepage and checkout for Sofabed, plus launch campaigns.', 30, ['it', 'graphics', 'marketing', 'advertising']);
  const seo = await project('JenniHome SEO', 'jennihome', 'kavya', ['meera'], 'Keyword strategy, on-page fixes and monthly reporting for JenniHome.', 45, ['seo', 'marketing']);
  const catalog = await project('Catalog Migration', 'jennifer-furniture', 'anil', ['nikhil', 'ritu', 'priya'], 'Move the product catalogue to the new platform.', 40, ['it', 'products']);
  const brand = await project('Brand Refresh', 'comfort-furniture', 'nisha', ['karan'], 'Logo, colours and social templates for Comfort Furniture.', 25, ['graphics']);

  // ---- tasks: every task has a team and its assignees come from that team ----------
  const task = async ({ title, slug, projectId, ticketId = null, parentId = null, teamSlug, shared = [], creator, assignees, status, priority = 'MEDIUM', due, age = 3 }) => {
    const found = await prisma.task.findFirst({ where: { title, organizationId: org[slug].id } });
    if (found) return found;
    return prisma.task.create({
      data: {
        title, organizationId: org[slug].id, projectId, ticketId, parentId, teamId: team[teamSlug].id, status, priority, creatorId: u[creator].id,
        dueDate: ahead(due), createdAt: ago(age), completedAt: status === 'DONE' ? ago(Math.max(0, age - 2)) : null, assigneeId: u[assignees[0]].id,
        assignees: { create: assignees.map((k) => ({ userId: u[k].id })) },
        teamAccesses: { create: [{ teamId: team[teamSlug].id, accessRole: 'OWNER', addedById: u[creator].id }, ...shared.map((s) => ({ teamId: team[s].id, accessRole: 'PARTICIPANT', addedById: u[creator].id }))] },
      },
    });
  };
  await task({ title: 'Build new homepage hero', slug: 'sofabed', projectId: web.id, teamSlug: 'it', creator: 'rahul', assignees: ['anil', 'nikhil'], status: 'IN_PROGRESS', priority: 'HIGH', due: 5, age: 8 });
  await task({ title: 'Fix checkout bug (overdue)', slug: 'sofabed', projectId: web.id, teamSlug: 'it', creator: 'rahul', assignees: ['nikhil'], status: 'TODO', priority: 'URGENT', due: -2, age: 9 });
  await task({ title: 'Design hero banner artwork', slug: 'sofabed', projectId: web.id, teamSlug: 'graphics', creator: 'nisha', assignees: ['karan'], status: 'IN_PROGRESS', due: 4, age: 6 });
  await task({ title: 'Facebook ad creatives', slug: 'sofabed', projectId: web.id, teamSlug: 'advertising', shared: ['graphics'], creator: 'vikram', assignees: ['vikram', 'pooja'], status: 'IN_PROGRESS', due: 6, age: 5 });
  await task({ title: 'Google Ads search campaign', slug: 'sofabed', projectId: web.id, teamSlug: 'advertising', creator: 'omkar', assignees: ['zoya'], status: 'TODO', due: 8, age: 4 });
  await task({ title: 'Launch email campaign', slug: 'sofabed', projectId: web.id, teamSlug: 'marketing', creator: 'sneha', assignees: ['sneha', 'aditya'], status: 'BACKLOG', due: 14, age: 2 });
  await task({ title: 'Keyword research', slug: 'jennihome', projectId: seo.id, teamSlug: 'seo', creator: 'kavya', assignees: ['meera'], status: 'BACKLOG', due: 12, age: 7 });
  await task({ title: 'Rewrite product meta titles', slug: 'jennihome', projectId: seo.id, teamSlug: 'seo', creator: 'kavya', assignees: ['meera', 'kavya'], status: 'IN_PROGRESS', due: 9, age: 6 });
  await task({ title: 'Set up staging server', slug: 'jennifer-furniture', projectId: catalog.id, teamSlug: 'it', creator: 'anil', assignees: ['anil'], status: 'DONE', due: -1, age: 12 });
  await task({ title: 'Write migration plan', slug: 'jennifer-furniture', projectId: catalog.id, teamSlug: 'products', creator: 'priya', assignees: ['ritu'], status: 'TODO', due: 7, age: 5 });
  await task({ title: 'Moodboard and colour options', slug: 'comfort-furniture', projectId: brand.id, teamSlug: 'graphics', creator: 'nisha', assignees: ['karan'], status: 'REVIEW', due: 3, age: 6 });

  // ---- tickets: client chose / staff routed a team, assigned from it, with history + their auto task ----
  // Status: OPEN | REVIEW_TEST | REVIEW_HELP | CLOSED. Progress: OPEN -> IN_PROGRESS | QA ; REVIEW_HELP -> NEED_MORE_INFO ; REVIEW_TEST -> RESOLVED.
  // statuses: [daysAgo, actorKey, "STATUS" or "STATUS:PROGRESS"].
  const ticket = async (t) => {
    if (await prisma.ticket.findUnique({ where: { key: t.key } })) return;
    const requester = u[t.requester];
    const owner = t.team ? team[t.team] : null;
    const created = await prisma.ticket.create({
      data: {
        key: t.key, title: t.title, description: t.description, organizationId: org[t.org].id, projectId: t.project?.id ?? null,
        visibility: t.visibility || 'CLIENT', requesterId: requester.id, status: t.status, progress: t.progress ?? null, priority: t.priority || 'MEDIUM',
        teamId: owner?.id ?? null, assigneeId: t.assignee ? u[t.assignee].id : null, dueDate: t.due != null ? ahead(t.due) : null,
        createdAt: ago(t.age), closedAt: t.closedAgo != null ? ago(t.closedAgo) : null,
      },
    });
    const router = t.routedBy || t.requester;
    if (owner) {
      await prisma.ticketTeamAccess.create({ data: { ticketId: created.id, teamId: owner.id, accessRole: 'OWNER', addedById: u[router].id, createdAt: ago(t.age - 0.1) } });
      for (const slug of t.shared || []) await prisma.ticketTeamAccess.create({ data: { ticketId: created.id, teamId: team[slug].id, accessRole: 'PARTICIPANT', addedById: u[router].id, createdAt: ago(t.age - 0.1) } });
    }
    const events = [{ at: t.age, actor: t.requester, type: 'CREATED', note: t.key, clientVisible: t.visibility !== 'INTERNAL' }];
    if (owner) events.push({ at: t.age - 0.1, actor: router, type: 'TEAM', toValue: owner.id, toLabel: owner.name });
    for (const slug of t.shared || []) events.push({ at: t.age - 0.1, actor: router, type: 'TEAM_ACCESS', toValue: team[slug].id, toLabel: team[slug].name });
    if (t.assignee) events.push({ at: t.age - 0.2, actor: t.assignedBy, type: 'ASSIGNEE', toValue: u[t.assignee].id, toLabel: u[t.assignee].name });
    let prev = 'OPEN';
    for (const [at, actor, key] of t.statuses || []) { events.push({ at, actor, type: 'STATUS', fromValue: prev, toValue: key, clientVisible: t.visibility !== 'INTERNAL' }); prev = key; }
    for (const [at, actor, body, visibility] of t.comments || []) {
      const c = await prisma.comment.create({ data: { body, visibility, authorId: u[actor].id, ticketId: created.id, createdAt: ago(at) } });
      events.push({ at, actor, type: 'COMMENT', toValue: c.id, note: body.slice(0, 140), clientVisible: visibility === 'CLIENT' });
    }
    for (const e of events.sort((a, b) => b.at - a.at)) {
      const { at, actor, ...rest } = e;
      await prisma.ticketEvent.create({ data: { ticketId: created.id, actorId: u[actor].id, clientVisible: false, ...rest, createdAt: ago(at) } });
    }
    await prisma.activityLog.create({ data: { actorId: requester.id, organizationId: org[t.org].id, entityType: 'ticket', entityId: created.id, action: 'created', summary: `Created ticket ${t.key}`, metadata: { visibility: t.visibility || 'CLIENT', requesterId: requester.id }, createdAt: ago(t.age) } });
    if (t.assignee) {
      const taskStatus = ticketToTaskStatus(t.status, t.progress);
      await prisma.task.create({
        data: {
          title: taskTitleFor({ key: t.key, title: t.title }), organizationId: org[t.org].id, projectId: t.project?.id ?? null, ticketId: created.id, teamId: owner.id,
          autoCreated: true, status: taskStatus, priority: t.priority || 'MEDIUM', creatorId: u[t.assignedBy].id, dueDate: t.due != null ? ahead(t.due) : null,
          createdAt: ago(t.age - 0.2), completedAt: taskStatus === 'DONE' ? ago(t.closedAgo ?? 0.5) : null,
          assigneeId: u[t.assignee].id, assignees: { create: [{ userId: u[t.assignee].id }] },
          teamAccesses: { create: [{ teamId: owner.id, accessRole: 'OWNER', addedById: u[router].id }, ...(t.shared || []).map((s) => ({ teamId: team[s].id, accessRole: 'PARTICIPANT', addedById: u[router].id }))] },
        },
      });
    }
  };

  await ticket({ key: 'SOF-100001', org: 'sofabed', project: web, requester: 'neha', title: 'Banner image looks blurry', description: 'The homepage banner is pixelated on large screens.',
    team: 'graphics', routedBy: 'neha', assignee: 'karan', assignedBy: 'nisha', status: 'OPEN', progress: 'IN_PROGRESS', priority: 'MEDIUM', due: 4, age: 3,
    statuses: [[2, 'karan', 'OPEN:IN_PROGRESS']],
    comments: [[2.5, 'nisha', 'The source file is only 800px wide. Karan will recreate it at 2400px.', 'CLIENT'], [2.4, 'nisha', 'Check whether the old banner is used on the landing pages too.', 'INTERNAL']] });
  await ticket({ key: 'SOF-100002', org: 'sofabed', project: web, requester: 'rahul', visibility: 'INTERNAL', title: 'Refactor product schema', description: 'Internal clean-up before the catalogue import.',
    team: 'it', shared: ['products'], routedBy: 'rahul', assignee: 'anil', assignedBy: 'rahul', status: 'OPEN', progress: 'QA', priority: 'MEDIUM', due: 10, age: 5,
    statuses: [[4, 'anil', 'OPEN:IN_PROGRESS'], [1, 'anil', 'OPEN:QA']] });
  await ticket({ key: 'SOF-100003', org: 'sofabed', project: web, requester: 'rohan', title: 'Need invoice export', description: 'Can we export all invoices as CSV from the admin?', status: 'OPEN', priority: 'LOW', due: 15, age: 1 });
  await ticket({ key: 'SOF-100004', org: 'sofabed', project: web, requester: 'neha', title: 'Footer links broken on mobile', description: 'Privacy and Terms links do nothing on phones.',
    team: 'it', shared: ['advertising'], routedBy: 'neha', assignee: 'nikhil', assignedBy: 'rahul', status: 'REVIEW_TEST', progress: 'RESOLVED', priority: 'HIGH', due: 1, age: 6,
    statuses: [[5, 'nikhil', 'OPEN:IN_PROGRESS'], [1, 'nikhil', 'OPEN:QA'], [0.5, 'nikhil', 'REVIEW_TEST:RESOLVED']],
    comments: [[0.5, 'nikhil', 'Fixed and deployed to staging. Please check on your phone.', 'CLIENT']] });
  await ticket({ key: 'JEN-100001', org: 'jennihome', project: seo, requester: 'tanvi', title: 'Add size chart to product pages', description: 'Customers keep asking for sizes.',
    team: 'seo', shared: ['marketing'], routedBy: 'tanvi', assignee: 'meera', assignedBy: 'kavya', status: 'OPEN', progress: 'IN_PROGRESS', priority: 'MEDIUM', due: 8, age: 2,
    statuses: [[1.5, 'meera', 'OPEN:IN_PROGRESS']] });
  await ticket({ key: 'JFN-100001', org: 'jennifer-furniture', project: catalog, requester: 'divya', title: 'Product feed is missing prices', description: 'About 40 products have no price in the feed.',
    team: 'it', routedBy: 'divya', assignee: 'nikhil', assignedBy: 'anil', status: 'REVIEW_HELP', progress: 'NEED_MORE_INFO', priority: 'HIGH', due: 2, age: 4,
    statuses: [[3, 'nikhil', 'OPEN:IN_PROGRESS'], [0.8, 'nikhil', 'REVIEW_HELP:NEED_MORE_INFO']],
    comments: [[0.8, 'nikhil', 'Which price list should we use for the missing products: wholesale or retail?', 'CLIENT']] });
  await ticket({ key: 'COM-100001', org: 'comfort-furniture', project: brand, requester: 'imran', title: 'Logo colours look different on mobile', description: 'The orange looks red on phones.',
    team: 'graphics', routedBy: 'imran', assignee: 'karan', assignedBy: 'nisha', status: 'CLOSED', priority: 'LOW', age: 9, closedAgo: 2,
    statuses: [[8, 'karan', 'OPEN:IN_PROGRESS'], [3, 'karan', 'REVIEW_TEST:RESOLVED'], [2, 'imran', 'CLOSED']] });
  // Older closed tickets so the monthly analytics have something to show.
  const old = [['SOF-100005', 'sofabed', 'neha', 'Update shipping policy page', 'it', 'rahul', 38, 33], ['SOF-100006', 'sofabed', 'rohan', 'New festive banner set', 'graphics', 'karan', 67, 60],
    ['JEN-100002', 'jennihome', 'sanjay', 'Fix duplicate meta descriptions', 'seo', 'meera', 96, 88], ['JFN-100002', 'jennifer-furniture', 'divya', 'Redirect old catalogue URLs', 'it', 'anil', 127, 119],
    ['SOF-100007', 'sofabed', 'neha', 'Sale campaign tracking', 'advertising', 'zoya', 22, 15]];
  for (const [key, slug, requester, title, teamSlug, assignee, age, closedAgo] of old) {
    await ticket({ key, org: slug, requester, title, description: 'Completed earlier.', team: teamSlug, routedBy: requester, assignee, assignedBy: assignee, status: 'CLOSED', priority: 'MEDIUM', age, closedAgo,
      statuses: [[age - 1, assignee, 'OPEN:IN_PROGRESS'], [closedAgo + 1, assignee, 'REVIEW_TEST:RESOLVED'], [closedAgo, requester, 'CLOSED']] });
  }

  // Team-to-team work: Nikhil (IT) raised a linked task for the Facebook Ads team on SOF-100004, with a subtask under it.
  const sof4 = await prisma.ticket.findUnique({ where: { key: 'SOF-100004' } });
  if (sof4) {
    const fbTask = await task({ title: 'Verify purchase tracking after the footer fix', slug: 'sofabed', projectId: web.id, ticketId: sof4.id, teamSlug: 'advertising', shared: ['it'], creator: 'nikhil', assignees: ['pooja'], status: 'IN_PROGRESS', priority: 'HIGH', due: 1, age: 0.4 });
    await task({ title: 'Test purchase event on Android and iOS', slug: 'sofabed', projectId: web.id, parentId: fbTask.id, teamSlug: 'advertising', creator: 'pooja', assignees: ['pooja'], status: 'TODO', due: 1, age: 0.3 });
    if (!(await prisma.comment.count({ where: { taskId: fbTask.id } }))) {
      await prisma.comment.createMany({ data: [
        { body: 'Footer fix is on staging. Please confirm the purchase pixel still fires.', visibility: 'INTERNAL', authorId: u.nikhil.id, taskId: fbTask.id, createdAt: ago(0.3) },
        { body: 'On it. Android looks fine, testing iOS now.', visibility: 'INTERNAL', authorId: u.pooja.id, taskId: fbTask.id, createdAt: ago(0.1) },
      ] });
    }
    await prisma.ticketEvent.create({ data: { ticketId: sof4.id, actorId: u.nikhil.id, type: 'TASK', toValue: fbTask.id, toLabel: fbTask.title, clientVisible: false, createdAt: ago(0.4) } });
  }

  // A client-requested project that goes to two teams.
  await project('Sofabed mobile app (requested)', 'sofabed', 'sneha', ['aditya', 'zoya'], 'Requested by the client: a simple mobile app for browsing the catalogue.', 60, ['marketing', 'advertising'], { requestedByClient: true, status: 'PLANNING', ownerId: null });

  await prisma.seedMarker.upsert({ where: { key: SEED_KEY }, update: {}, create: { key: SEED_KEY } });
  console.log('Seed ready. DEV LOGIN accounts (role: team):');
  for (const p of STAFF) console.log(`  ${p.role.padEnd(15)} ${p.email.padEnd(28)} ${p.teams.join(', ')}`);
  for (const c of CLIENTS) for (const p of c.users) console.log(`  ${p.role.padEnd(15)} ${p.email.padEnd(40)} ${c.name}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
