import { Router } from 'express';
import { listOrganizations, listRecentActivity } from '../controllers/workspace.controller.js';

const router = Router();
router.get('/organizations', listOrganizations);
router.get('/activity', listRecentActivity);
export default router;
