import {PrismaClient} from '@prisma/client';
// Tests may inject an in-memory double (globalThis.__PRISMA_TEST_DOUBLE__) to exercise the real routes without PostgreSQL.
export const prisma=globalThis.__PRISMA_TEST_DOUBLE__??new PrismaClient({log:process.env.NODE_ENV==='development'?['warn','error']:['error']});
