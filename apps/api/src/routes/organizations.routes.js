import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { logActivity } from '../services/index.js';
import { parseBody } from '../validators/validate.js';
import { organizationCreate } from '../validators/schemas.js';

// GET /organizations lives in workspace.routes.js. This file was previously never
// mounted, so "New client" returned 404.
const router = Router();
router.post('/organizations', requirePermission('org.create'), async (req, res) => {
  const data = parseBody(organizationCreate, req.body);
  const org = await prisma.organization.create({ data: { ...data, type: 'CLIENT' } });
  await logActivity({
    actorId: req.currentUser.id, organizationId: org.id, entityType: 'organization', entityId: org.id,
    action: 'created', summary: `Created organization ${org.name}`,
  });
  res.status(201).json(org);
});
export default router;
