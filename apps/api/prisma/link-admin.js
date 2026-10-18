
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to the Google account email of the first Platform admin.');
  }

  // Create the user if needed: the first admin no longer has to sign in before being linked.
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  const organization = await prisma.organization.findUnique({
    where: { slug: 'tendrils' },
  });

  if (!organization) {
    throw new Error(
      'Tendrils organization not found. Run npm run db:seed first.'
    );
  }

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    update: {
      role: 'PLATFORM_ADMIN',
      isActive: true,
    },
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: 'PLATFORM_ADMIN',
      isActive: true,
    },
  });

  console.log(`Linked ${email} to Tendrils as PLATFORM_ADMIN.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
