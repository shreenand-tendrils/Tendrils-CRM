// Full Tendrils company structure for testing: Boss -> team Managers -> team Employees.
// Idempotent (safe to re-run). DEV ONLY. Run:  npm run seed:company
// Every email is "name.demo@tendrils.io" so the DEV LOGIN dropdown lists them.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TEAMS = ['Product', 'Graphics / Creative', 'IT / Infrastructure', 'Development', 'SEO / Marketing', 'QA', 'Management / Operations'];

// role: PLATFORM_ADMIN = Boss, MANAGER = team manager, EMPLOYEE = team member. teams use slugs from slugify().
const COMPANY = [
  // --- Boss
  { email: 'arjun.demo@tendrils.io', name: 'Arjun Mehta (Boss)', role: 'PLATFORM_ADMIN', teams: ['management-operations'] },

  // --- Managers (one per team; Priya runs two teams)
  { email: 'rahul.demo@tendrils.io', name: 'Rahul Verma (Dev Manager)', role: 'MANAGER', teams: ['development'] },
  { email: 'nisha.demo@tendrils.io', name: 'Nisha Rao (Creative Manager)', role: 'MANAGER', teams: ['graphics-creative'] },
  { email: 'kavya.demo@tendrils.io', name: 'Kavya Nair (SEO Manager)', role: 'MANAGER', teams: ['seo-marketing'] },
  { email: 'vikram.demo@tendrils.io', name: 'Vikram Singh (QA Manager)', role: 'MANAGER', teams: ['qa'] },
  { email: 'anil.demo@tendrils.io', name: 'Anil Kumar (IT Manager)', role: 'MANAGER', teams: ['it-infrastructure'] },
  { email: 'priya.demo@tendrils.io', name: 'Priya Shah (Product + Ops Manager)', role: 'MANAGER', teams: ['product', 'management-operations'] },

  // --- Employees
  { email: 'sneha.demo@tendrils.io', name: 'Sneha Kulkarni', role: 'EMPLOYEE', teams: ['development'] },
  { email: 'aditya.demo@tendrils.io', name: 'Aditya Joshi (Dev + QA)', role: 'EMPLOYEE', teams: ['development', 'qa'] },
  { email: 'karan.demo@tendrils.io', name: 'Karan Patil', role: 'EMPLOYEE', teams: ['graphics-creative'] },
  { email: 'meera.demo@tendrils.io', name: 'Meera Iyer', role: 'EMPLOYEE', teams: ['seo-marketing'] },
  { email: 'pooja.demo@tendrils.io', name: 'Pooja Desai', role: 'EMPLOYEE', teams: ['qa'] },
  { email: 'nikhil.demo@tendrils.io', name: 'Nikhil Gupta', role: 'EMPLOYEE', teams: ['it-infrastructure'] },
  { email: 'ritu.demo@tendrils.io', name: 'Ritu Sen', role: 'EMPLOYEE', teams: ['product'] },
];

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'tendrils' }, update: { name: 'Tendrils', type: 'INTERNAL' }, create: { name: 'Tendrils', slug: 'tendrils', type: 'INTERNAL' },
  });
  const teamBySlug = {};
  for (const name of TEAMS) {
    const slug = slugify(name);
    teamBySlug[slug] = await prisma.team.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug } }, update: { name },
      create: { name, slug, organizationId: org.id, description: `${name} team` },
    });
  }

  for (const p of COMPANY) {
    const user = await prisma.user.upsert({
      where: { email: p.email }, update: { name: p.name }, create: { email: p.email, name: p.name, emailVerified: new Date() },
    });
    const membership = await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { role: p.role, isActive: true },
      create: { userId: user.id, organizationId: org.id, role: p.role },
    });
    for (const slug of p.teams) {
      const team = teamBySlug[slug];
      if (!team) throw new Error(`Unknown team slug "${slug}" for ${p.email}`);
      await prisma.teamMember.upsert({
        where: { teamId_membershipId: { teamId: team.id, membershipId: membership.id } },
        update: {}, create: { teamId: team.id, membershipId: membership.id },
      });
    }
  }

  console.log('Company structure ready (DEV LOGIN users):');
  for (const p of COMPANY) console.log(`  ${p.role.padEnd(15)} ${p.email.padEnd(26)} ${p.teams.join(', ')}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
