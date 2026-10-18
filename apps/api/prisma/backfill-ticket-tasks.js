// Creates the auto task for every assigned ticket that doesn't have one yet. Safe to re-run.
//   npm run backfill:tasks
import { PrismaClient } from '@prisma/client';
import { syncTaskFromTicket } from '../src/services/ticketTask.service.js';

const prisma = new PrismaClient();
const tickets = await prisma.ticket.findMany({ where: { assigneeId: { not: null }, tasks: { none: { autoCreated: true } } } });
let n = 0;
for (const t of tickets) { await syncTaskFromTicket(prisma, t, { changed: ['ALL'] }); n++; }
console.log(`Created ${n} task(s) for assigned tickets.`);
await prisma.$disconnect();
