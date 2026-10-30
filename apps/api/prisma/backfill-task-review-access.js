import { prisma } from '../src/db.js';
import { taskReviewerTeamIds } from '../src/services/review.js';

/**
 * Backfill: tasks created before the REVIEWER access role existed never got a
 * TaskTeamAccess row for the creator's originating team, so that team could
 * neither see nor review work already in flight. Idempotent (upsert); safe to
 * re-run. Run manually with `node prisma/backfill-task-review-access.js`, and
 * once at API start via `backfillTaskReviewAccessOnce()` from server.js.
 */
export async function backfillTaskReviewAccess() {
  const tasks = await prisma.task.findMany({
    where: { autoCreated: false, teamId: { not: null }, creatorId: { not: null }, teamAccesses: { none: { accessRole: 'REVIEWER' } } },
    select: { id: true, teamId: true, creatorId: true },
  });
  if (!tasks.length) return 0;
  const creatorIds = [...new Set(tasks.map((t) => t.creatorId))];
  const memberships = await prisma.membership.findMany({
    where: { userId: { in: creatorIds }, isActive: true, organization: { type: 'INTERNAL' } },
    include: { teamMemberships: { select: { teamId: true } } },
  });
  const teamsByUser = new Map();
  for (const membership of memberships) {
    const ids = teamsByUser.get(membership.userId) || [];
    ids.push(...membership.teamMemberships.map((tm) => tm.teamId));
    teamsByUser.set(membership.userId, ids);
  }
  let written = 0;
  for (const task of tasks) {
    for (const teamId of taskReviewerTeamIds(teamsByUser.get(task.creatorId) || [], task.teamId)) {
      await prisma.taskTeamAccess.upsert({
        where: { taskId_teamId: { taskId: task.id, teamId } },
        create: { taskId: task.id, teamId, accessRole: 'REVIEWER', addedById: task.creatorId },
        update: { accessRole: 'REVIEWER' },
      });
      written += 1;
    }
  }
  return written;
}

// Run once per API process (was: lazily on the first GET /tasks, which made a
// data repair depend on read traffic).
let backfillPromise = null;
export function backfillTaskReviewAccessOnce() {
  if (!backfillPromise) {
    backfillPromise = backfillTaskReviewAccess().catch((err) => {
      backfillPromise = null; // let the next restart retry
      console.error('[task review access] legacy backfill failed:', err.message);
    });
  }
  return backfillPromise;
}

// Manual run: `node prisma/backfill-task-review-access.js`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  backfillTaskReviewAccess()
    .then((n) => { console.log(`[backfill] wrote ${n} reviewer access rows`); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
}
