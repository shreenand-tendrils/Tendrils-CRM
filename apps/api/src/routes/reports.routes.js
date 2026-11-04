import { Router } from 'express';
import { reportOptions, buildReport } from '../services/reports.service.js';

// Every role may call these; the service decides what that role may see (own report / own teams / admin: everything).
const router = Router();
router.get('/reports/options', async (req, res) => res.json(await reportOptions(req)));
router.get('/reports', async (req, res) => res.json(await buildReport(req, req.query)));
export default router;
