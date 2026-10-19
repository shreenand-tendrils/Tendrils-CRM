// Full Tendrils company structure: Boss -> team Managers -> team Employees. Idempotent. DEV ONLY.
//   node prisma/seed-company.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// teams: slugs from seed.js. First person in each team with role MANAGER is that team's manager.
const COMPANY = [
  { email: 'boss@tendrils.io', name: 'Arjun Mehta (Boss)', role: 'PLATFORM_ADMIN', teams: ['management-operations'] },

  // Development
  { email: 'dev.manager@tendrils.io', name: 'Rahul Verma', role: 'MANAGER', teams: ['development'] },
  { email: 'dev.one@tendrils.io', name: 'Dev Rao', role: 'EMPLOYEE', teams: ['development'] },
  { email: 'dev.two@tendrils.io', name: 'Sneha Kulkarni', role: 'EMPLOYEE', teams: ['development'] },

  // Graphics / Creative
  { email: 'design.manager@tendrils.io', name: 'Isha Designer', role: 'MANAGER', teams: ['graphics-creative'] },
  { email: 'design.one@tendrils.io', name: 'Karan Joshi', role: 'EMPLOYEE', teams: ['graphics-creative'] },

  // SEO / Marketing
  { email: 'seo.manager@tendrils.io', name: 'Tara Nair', role: 'MANAGER', teams: ['seo-marketing'] },
  { email: 'seo.one@tendrils.io', name: 'Meera Shah', role: 'EMPLOYEE', teams: ['seo-marketing'] },

  // QA
  { email: 'qa.manager@tendrils.io', name: 'Vikram Singh', role: 'MANAGER', teams: ['qa'] },
  { email: 'qa.one@tendrils.io', name: 'Pooja Patil', role: 'EMPLOYEE', teams: ['qa'] },

  // Product + Operations (one person in two teams)
  { email: 'ops.manager@tendrils.io', name: 'Maya Manager', role: 'MANAGER', teams: ['product', 'management-operations'] },

  // IT
  { email: 'it.one@tendrils.io', name: 'Nikhil Desai', role: 'EMPLOYEE', teams: ['it-infrastructure'] },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: 'tendrils' } });
  if (!org) throw new Error('Run "npm run db:seed" first (Tendrils org + teams missing).');
  const teams = await prisma.team.findMany({ where: { organizationId: org.id } });
  const teamBySlug = Object.fromEntries(teams.map((t) => [t.slug, t]));

  for (const p of COMPANY) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { name: p.name },
      create: { email: p.email, name: p.name, emailVerified: new Date() },
    });
    const m = await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { role: p.role, isActive: true },
      create: { userId: user.id, organizationId: org.id, role: p.role },
    });
    for (const slug of p.teams) {
      const t = teamBySlug[slug];
      if (!t) { console.warn(`  ! team "${slug}" not found, skipped for ${p.email}`); continue; }
      await prisma.teamMember.upsert({
        where: { teamId_membershipId: { teamId: t.id, membershipId: m.id } },
        update: {},
        create: { teamId: t.id, membershipId: m.id },
      });
    }
  }
  console.log('Company structure ready:');
  for (const p of COMPANY) console.log(`  ${p.role.padEnd(15)} ${p.email.padEnd(28)} -> ${p.teams.join(', ')}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());