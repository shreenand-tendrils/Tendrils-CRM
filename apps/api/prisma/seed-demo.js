// Demo data for testing every role. Safe to re-run (idempotent). DEV ONLY.
//   npm run seed:demo
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DAY = 86400000;

const PEOPLE = [
  { email: 'maya.demo@tendrils.io', name: 'Maya Manager', org: 'tendrils', role: 'MANAGER' },
  { email: 'dev.demo@tendrils.io', name: 'Dev Rao', org: 'tendrils', role: 'EMPLOYEE' },
  { email: 'isha.demo@tendrils.io', name: 'Isha Designer', org: 'tendrils', role: 'EMPLOYEE' },
  { email: 'root.demo@tendrils.io', name: 'Root Admin', org: 'tendrils', role: 'PLATFORM_ADMIN' },
  { email: 'sofabed.demo@sofabed.test', name: 'Sofabed Client', org: 'sofabed', role: 'CLIENT_MEMBER' },
  { email: 'boss.demo@sofabed.test', name: 'Sofabed Boss', org: 'sofabed', role: 'CLIENT_ADMIN' },
  { email: 'jennihome.demo@jennihome.test', name: 'JenniHome Client', org: 'jennihome', role: 'CLIENT_MEMBER' },
];
const ORGS = [
  ['Tendrils', 'tendrils', 'INTERNAL'],
  ['Sofabed', 'sofabed', 'CLIENT'],
  ['JenniHome', 'jennihome', 'CLIENT'],
];

async function main() {
  const org = {};
  for (const [name, slug, type] of ORGS) org[slug] = await prisma.organization.upsert({ where: { slug }, update: {}, create: { name, slug, type } });

  const u = {};
  for (const p of PEOPLE) {
    const user = await prisma.user.upsert({ where: { email: p.email }, update: { name: p.name }, create: { email: p.email, name: p.name, emailVerified: new Date() } });
    await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org[p.org].id } },
      update: { role: p.role, isActive: true },
      create: { userId: user.id, organizationId: org[p.org].id, role: p.role },
    });
    u[p.email.split('.')[0]] = user;
  }

  const project = async (name, slug, memberIds, leadId) => {
    const found = await prisma.project.findFirst({ where: { name, organizationId: org[slug].id } });
    if (found) return found;
    return prisma.project.create({
      data: {
        name, organizationId: org[slug].id, status: 'ACTIVE', ownerId: leadId, description: `${name} — demo project`,
        dueDate: new Date(Date.now() + 14 * DAY),
        members: { create: memberIds.map((id) => ({ userId: id, role: id === leadId ? 'LEAD' : 'MEMBER' })) },
        chatRoom: { create: { name, type: 'PROJECT' } },
      },
    });
  };
  const web = await project('Website Revamp', 'sofabed', [u.maya.id, u.dev.id, u.isha.id], u.maya.id);
  const seo = await project('JenniHome SEO', 'jennihome', [u.maya.id, u.tara.id], u.maya.id);

  const task = async (title, organizationId, projectId, status, dueOffset, assignees) => {
    if (await prisma.task.findFirst({ where: { title, organizationId } })) return;
    await prisma.task.create({
      data: {
        title, organizationId, projectId, status, creatorId: u.maya.id, priority: 'HIGH',
        dueDate: new Date(Date.now() + dueOffset * DAY), assigneeId: assignees[0].id,
        assignees: { create: assignees.map((a) => ({ userId: a.id })) },
      },
    });
  };
  await task('Design new homepage hero', org.sofabed.id, web.id, 'IN_PROGRESS', 3, [u.dev, u.isha]); // multi-assignee
  await task('Fix checkout bug (overdue)', org.sofabed.id, web.id, 'TODO', -2, [u.dev]);
  await task('Keyword research', org.jennihome.id, seo.id, 'BACKLOG', 7, [u.tara]);

  const ticket = async (key, title, organizationId, visibility, requesterId) => {
    if (await prisma.ticket.findUnique({ where: { key } })) return;
    const t = await prisma.ticket.create({ data: { key, title, organizationId, visibility, requesterId, priority: 'MEDIUM', projectId: organizationId === org.sofabed.id ? web.id : seo.id } });
    await prisma.activityLog.create({ data: { actorId: requesterId, organizationId, entityType: 'ticket', entityId: t.id, action: 'created', summary: `Created ticket ${key}: ${title}`, metadata: { visibility, requesterId } } });
  };
  await ticket('SOF-100001', 'Banner image looks blurry', org.sofabed.id, 'CLIENT', u.sofabed.id);
  await ticket('SOF-100002', 'INTERNAL: refactor product schema', org.sofabed.id, 'INTERNAL', u.maya.id);
  await ticket('SOF-100003', 'Need invoice export (raised by client admin)', org.sofabed.id, 'CLIENT', u.boss.id);
  await ticket('JEN-100001', 'Add size chart to product pages', org.jennihome.id, 'CLIENT', u.jennihome.id);

  const yesterday = new Date(`${new Date(Date.now() - DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);
  await prisma.dailyUpdate.upsert({
    where: { userId_date: { userId: u.dev.id, date: yesterday } }, update: {},
    create: { userId: u.dev.id, date: yesterday, yesterday: 'Started the checkout fix', today: 'Finish checkout fix and review hero designs', blockers: 'Waiting for staging credentials' },
  });

  console.log('Demo data ready. Demo logins (dev login only):');
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(14)} ${p.email}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
