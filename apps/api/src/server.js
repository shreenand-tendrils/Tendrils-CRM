import 'dotenv/config';
import { createApp } from './config/app.js';
import { env } from './config/env.js';
import { prisma } from './db.js';
import { attachRealtime } from './realtime/server.js';
import { authenticateUpgrade } from './realtime/auth.js';
import { handlers } from './realtime/handlers.js';
import { startScheduler } from './services/scheduler.js';
import { markDeliveredOnConnect } from './services/chat.service.js';
import { bindServer } from './services/internalApi.js';
import { backfillTaskReviewAccessOnce } from '../prisma/backfill-task-review-access.js';

const app = createApp();
const server = app.listen(env.port, () => { bindServer(server); console.log(`Tendrils API listening on http://localhost:${env.port}`); });
attachRealtime(server, { authenticate: authenticateUpgrade, handlers, onConnect: markDeliveredOnConnect, allowedOrigins: env.webOrigins });

// One-time legacy repair (pre-REVIEWER access rows), idempotent; at start instead of inside GET /tasks.
backfillTaskReviewAccessOnce();

const stopScheduler = startScheduler();
const stop = () => { stopScheduler(); server.close(async () => { await prisma.$disconnect(); process.exit(0); }); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
