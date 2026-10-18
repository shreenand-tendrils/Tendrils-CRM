import { Router } from 'express';
import { requireUser } from '../middleware/index.js';
import { isDevLoginEnabled } from '../services/devAuth.js';
import dev from './dev.routes.js';
import identity from './identity.routes.js';
import dashboard from './dashboard.routes.js';
import workspace from './workspace.routes.js';
import organizations from './organizations.routes.js';
import projects from './projects.routes.js';
import tickets from './tickets.routes.js';
import tasks from './tasks.routes.js';
import teams from './teams.routes.js';
import users from './users.routes.js';
import notifications from './notifications.routes.js';
import files from './files.routes.js';
import documents from './documents.routes.js';
import chat from './chat.routes.js';
import updates from './updates.routes.js';
import admin from './admin.routes.js';
import members from './members.routes.js';
import clientPortal from './clientPortal.routes.js';

const router = Router();
if (isDevLoginEnabled()) {
  console.warn('[dev] DEV_LOGIN is ON: demo accounts can sign in without Google. Never enable in production.');
  router.use('/dev', dev);
}
router.use(requireUser);
for (const r of [identity, dashboard, workspace, organizations, projects, tickets, tasks, teams, users, notifications, files, documents, chat, updates, members, clientPortal, admin]) router.use(r);
export default router;
