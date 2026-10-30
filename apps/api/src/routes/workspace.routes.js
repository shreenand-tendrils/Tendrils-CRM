import { Router } from 'express';
import { listOrganizations, listRecentActivity } from '../controllers/workspace.controller.js';

const router = Router();
router.get('/organizations', listOrganizations);
// Named 'timeline' (not 'activity'): ad-blocker filter lists (EasyPrivacy & friends) block
// requests whose URL contains /activity, breaking the whole first-load workspace fetch.
router.get('/timeline', listRecentActivity);
export default router;
