import { Router } from 'express';
import { requirePermission, ctxOf } from '../middleware/index.js';
import { listTasks, createTask, patchTask, listTaskComments, addTaskComment, deleteTaskComment, listTaskAttachments } from '../services/index.js';
import { parseBody } from '../validators/validate.js';
import { taskCreate, taskUpdate, commentCreate } from '../validators/schemas.js';

const router = Router();

router.get('/tasks', async (req, res) => res.json(await listTasks(ctxOf(req), req.query)));

router.post('/tasks', requirePermission('task.create'), async (req, res) => {
  const task = await createTask(ctxOf(req), parseBody(taskCreate, req.body));
  res.status(201).json(task);
});

router.patch('/tasks/:id', async (req, res) => {
  res.json(await patchTask(ctxOf(req), req.params.id, parseBody(taskUpdate, req.body)));
});

// ---- Task comments: internal team talk, visible to everyone who can open the task (never to clients) ----
router.get('/tasks/:id/comments', async (req, res) => {
  res.json(await listTaskComments(ctxOf(req), req.params.id));
});

router.post('/tasks/:id/comments', requirePermission('ticket.comment_internal'), async (req, res) => {
  const c = await addTaskComment(ctxOf(req), req.params.id, parseBody(commentCreate, req.body));
  res.status(201).json(c);
});

router.delete('/tasks/:id/comments/:commentId', async (req, res) => {
  await deleteTaskComment(ctxOf(req), req.params.id, req.params.commentId);
  res.json({ ok: true });
});

router.get('/tasks/:id/attachments', async (req, res) => {
  res.json(await listTaskAttachments(ctxOf(req), req.params.id));
});

export default router;
