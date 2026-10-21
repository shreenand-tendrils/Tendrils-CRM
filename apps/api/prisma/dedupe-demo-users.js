// One-off, safe cleanup: removes DUPLICATE demo people from the DEV LOGIN list.
//   npm --workspace apps/api run dedupe:demo
// A duplicate = a '.demo@' account whose email is not one of the seeded ones but whose NAME matches a seeded person.
// It only switches those memberships off (isActive=false). Nothing is deleted, so tickets/tasks/chats stay intact.
import { PrismaClient } from '@prisma/client';
import { CANONICAL_EMAILS, CANONICAL_NAMES } from '../src/services/demoPeople.js';

const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ where: { email: { contains: '.demo@' } }, select: { id: true, email: true, name: true } });
  const stale = users.filter((u) => !CANONICAL_EMAILS.has(u.email.toLowerCase()) && CANONICAL_NAMES.has(String(u.name || '').trim().toLowerCase()));
  if (!stale.length) return console.log('No duplicate demo accounts found in the database.');
  const r = await prisma.membership.updateMany({ where: { userId: { in: stale.map((u) => u.id) } }, data: { isActive: false } });
  console.log(`Switched off ${r.count} membership(s) for ${stale.length} duplicate account(s):`);
  stale.forEach((u) => console.log(`  - ${u.name} <${u.email}>`));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
