import { Router } from 'express';
import { requirePermission, ctxOf } from '../middleware/index.js';
import { listTickets, createTicket, patchTicket, getTicketHistory, listTicketComments, deleteTicket, listTicketTasks, reviewTicketTask, listTicketAttachments, addTicketComment } from '../services/index.js';
import { parseBody } from '../validators/validate.js';
import { ticketCreate, ticketUpdate, commentCreate, taskClientReview } from '../validators/schemas.js';

const router = Router();

router.get('/tickets', async (req, res) => res.json(await listTickets(ctxOf(req), req.query)));

router.post('/tickets', requirePermission('ticket.create'), async (req, res) => {
  const created = await createTicket(ctxOf(req), parseBody(ticketCreate, req.body));
  res.status(201).json(created);
});

router.patch('/tickets/:id', async (req, res) => {
  res.json(await patchTicket(ctxOf(req), req.params.id, parseBody(ticketUpdate, req.body)));
});

// Per-ticket history: who changed what, and when. Clients only get client-visible events (status shown in client wording).
router.get('/tickets/:id/history', async (req, res) => {
  res.json(await getTicketHistory(ctxOf(req), req.params.id));
});

router.get('/tickets/:id/comments', async (req, res) => {
  res.json(await listTicketComments(ctxOf(req), req.params.id));
});

// Delete a ticket raised by mistake. Managers/admins: any visible ticket. The requester: only while it is still untouched.
router.delete('/tickets/:id', async (req, res) => {
  const { detachedTasks } = await deleteTicket(ctxOf(req), req.params.id);
  res.json({ ok: true, detachedTasks });
});

// Everyone who can open the ticket (clients included) can see the work items behind it, read-only. Internal comments stay internal.
router.get('/tickets/:id/tasks', async (req, res) => {
  res.json(await listTicketTasks(ctxOf(req), req.params.id));
});

// Client review of one task: approve it, or send it back with what to change. The last approval closes the ticket.
router.post('/tickets/:id/tasks/:taskId/review', async (req, res) => {
  res.json(await reviewTicketTask(ctxOf(req), req.params.id, req.params.taskId, parseBody(taskClientReview, req.body)));
});

router.get('/tickets/:id/attachments', async (req, res) => {
  res.json(await listTicketAttachments(ctxOf(req), req.params.id));
});

router.post('/tickets/:id/comments', async (req, res) => {
  const c = await addTicketComment(ctxOf(req), req.params.id, parseBody(commentCreate, req.body));
  res.status(201).json(c);
});

export default router;
