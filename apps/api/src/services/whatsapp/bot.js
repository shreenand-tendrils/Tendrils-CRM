import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import { env } from '../../config/env.js';
import { runTool, findTicket, toolByName } from '../../agent/tools.js';
import { recordTicketEvents } from '../ticketHistory.service.js';
import { runAgent, aiConfigured, describePending } from './agent.js';
import * as cloud from './cloud.js';

const TZ = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ() }) : '—');
const nice = (v) => String(v || '').replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const ICON = { OPEN: '🟢', REVIEW_TEST: '🔎', REVIEW_HELP: '❓', CLOSED: '✅', BACKLOG: '📥', TODO: '⚪', IN_PROGRESS: '🔵', BLOCKED: '⛔', REVIEW: '🔎', DONE: '✅' };
const PRIO = { URGENT: '🔥', HIGH: '⬆️', MEDIUM: '', LOW: '⬇️' };
const LIST_TTL = 2 * 3600e3, TICKET_TTL = 30 * 60e3, PENDING_TTL = 10 * 60e3;
const KEY_RE = /^[A-Za-z]{3}-\d{6}$/;

/** Pure text -> intent. Exported for tests. */
export function parseCommand(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  const lower = t.toLowerCase();
  let m;
  if (/^(help|menu|hi|hii|hello|hey|start|\?|namaste)$/.test(lower)) return { cmd: 'help' };
  if (/^(my )?tasks?$/.test(lower)) return { cmd: 'tasks' };
  if (/^(my )?tickets?$/.test(lower)) return { cmd: 'tickets' };
  if (/^(inbox|unread|notifications?|alerts?)$/.test(lower)) return { cmd: 'inbox' };
  if (/^(read all|clear)$/.test(lower)) return { cmd: 'readall' };
  if (/^(reviews?|ready|to review)$/.test(lower)) return { cmd: 'reviews' };
  if ((m = /^(?:ticket|t)\s+(\S+)$/i.exec(t))) return { cmd: 'ticket', ref: m[1] };
  if ((m = /^task\s+(\d{1,2})$/i.exec(t))) return { cmd: 'task', ref: m[1] };
  if ((m = /^(comment|note|reply)\s+(\S+)\s+([\s\S]+)$/i.exec(t))) return { cmd: 'comment', ref: m[2], text: m[3], clientVisible: m[1].toLowerCase() === 'reply' };
  if ((m = /^(start|todo|review|done|block|blocked)\s+(\d{1,2})$/i.exec(lower))) return { cmd: 'taskstatus', ref: m[2], status: { start: 'IN_PROGRESS', todo: 'TODO', review: 'REVIEW', done: 'DONE', block: 'BLOCKED', blocked: 'BLOCKED' }[m[1]] };
  if ((m = /^approve\s+(\d{1,2})$/i.exec(lower))) return { cmd: 'approve', ref: m[1] };
  if ((m = /^changes\s+(\d{1,2})\s+([\s\S]+)$/i.exec(t))) return { cmd: 'changes', ref: m[1], text: m[2] };
  if ((m = /^(?:new|raise|create)(?: ticket)?\s*[:\-]?\s*([\s\S]{3,})$/i.exec(t))) return { cmd: 'new', title: m[1].trim() };
  if (/^(yes|y|confirm|ok|haan|ha)$/.test(lower)) return { cmd: 'yes' };
  if (/^(no|n|cancel|nahi|nope)$/.test(lower)) return { cmd: 'no' };
  if (/^(stop|pause|unsubscribe)$/.test(lower)) return { cmd: 'stop' };
  if (/^(resume|unpause)$/.test(lower)) return { cmd: 'resume' };
  if (/^\d{1,2}$/.test(lower)) return { cmd: 'pick', n: Number(lower) };
  return null;
}

const helpText = (isStaff, name) => `Hi${name ? ` ${name.split(' ')[0]}` : ''}! I'm the Tendrils assistant.\n\n` + (isStaff
  ? `*tasks* – my open tasks\n*tickets* – my tickets\n*ticket SOF-123456* – details\n*start 2* · *review 2* · *done 2* – move task #2\n*comment SOF-123456 text* – internal note\n*reply SOF-123456 text* – visible to client\n*new <title>* – raise a ticket\n*inbox* – unread notifications\nSend a photo/file with a ticket key as caption to attach it.`
  : `*tickets* – my requests\n*ticket SOF-123456* – status & updates\n*reviews* – work waiting for your approval\n*approve 1* · *changes 1 what to fix*\n*comment SOF-123456 text* – message the team\n*new <title>* – raise a request\nSend a photo/file with the ticket key as caption to attach it.`)
  + `\n\n*stop* / *resume* – notifications on WhatsApp`;

const line = (i, bits) => `${i}. ${bits.filter(Boolean).join(' · ')}`;
const ticketLine = (t, i) => line(i, [`${ICON[t.status] || ''} *${t.key}*`, t.title.slice(0, 60), t.priority && PRIO[t.priority], t.due && `due ${fmtDay(t.due)}`]);
const taskLine = (t, i) => line(i, [`${ICON[t.status] || ''} ${t.title.slice(0, 60)}`, t.ticket && `(${t.ticket})`, t.due && `due ${fmtDay(t.due)}`]);

function ticketCard(d) {
  const open = d.tasks.filter((t) => t.status !== 'DONE').length;
  const last = d.comments.at(-1);
  return [
    `${ICON[d.status] || ''} *${d.key}* · ${nice(d.status)}${d.progress ? ` / ${nice(d.progress)}` : ''}${d.priority ? ` · ${nice(d.priority)}` : ''}`,
    d.title,
    [d.client && `Client: ${d.client}`, d.teams.length && `Team: ${d.teams.join(', ')}`, d.assignee && `Assignee: ${d.assignee}`, d.due && `Due: ${fmtDay(d.due)}`].filter(Boolean).join('\n'),
    d.tasks.length ? `Tasks: ${open} open / ${d.tasks.length - open} done` : null,
    last ? `Last comment — ${last.by}: ${last.body.slice(0, 160)}` : null,
  ].filter(Boolean).join('\n');
}

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
const ALLOWED = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/plain|application\/zip|application\/vnd\.|application\/msword)/i;

/**
 * Handle one inbound message from a LINKED user.
 * io = { say(text), buttons(text, [{id,title}]) } ; deps lets tests inject downloadMedia / agent.
 */
export async function handleLinkedMessage({ link, msg, api, io, deps = {} }) {
  const user = link.user;
  const ctx = { ...(link.context || {}) };
  let dirty = false;
  const save = (patch) => { Object.assign(ctx, patch); dirty = true; };
  const done = async () => { if (dirty) await prisma.whatsAppLink.update({ where: { id: link.id }, data: { context: ctx } }); };
  const fresh = (at, ttl) => at && Date.now() - at < ttl;
  let meMemo;
  const me = async () => (meMemo ||= await api.get('/me'));
  const fail = (r) => io.say(`⚠️ ${r.error}`);
  const staff = async () => (await me()).isInternal;

  // list item for "n" or a ticket key
  const item = (ref) => {
    if (/^\d{1,2}$/.test(ref)) return fresh(ctx.listAt, LIST_TTL) ? ctx.list?.[Number(ref) - 1] || null : null;
    return KEY_RE.test(ref) ? { t: 'ticket', key: ref.toUpperCase() } : null;
  };
  const rememberTicket = (key) => save({ lastTicket: key, lastTicketAt: Date.now() });

  // ---- media: attach to a ticket -------------------------------------------------------
  if (msg.media) {
    const key = (msg.caption || '').split(/\s+/).find((w) => KEY_RE.test(w))?.toUpperCase() || (fresh(ctx.lastTicketAt, TICKET_TTL) ? ctx.lastTicket : null);
    if (!key) { await io.say('Which ticket is this for? Send the file again with the ticket key as caption, e.g. SOF-123456.'); return done(); }
    if (!(await me()).permissions.includes('file.upload')) { await io.say('You do not have permission to upload files.'); return done(); }
    try {
      const t = await findTicket(api, key); // enforces the same visibility rules as the web app
      const { buffer, mime } = await (deps.downloadMedia || cloud.downloadMedia)(msg.media.id);
      const type = msg.media.mime || mime || 'application/octet-stream';
      if (!ALLOWED.test(type)) throw new Error('That file type is not allowed.');
      if (buffer.length > env.maxUploadBytes) throw new Error(`File is larger than ${Math.round(env.maxUploadBytes / 1048576)} MB.`);
      const name = path.basename(msg.media.filename || `whatsapp-${Date.now()}${MIME_EXT[type] || ''}`).slice(0, 255);
      const storageKey = crypto.randomUUID() + (path.extname(name).slice(0, 10) || MIME_EXT[type] || '');
      await fs.mkdir(path.resolve(env.uploadDir), { recursive: true });
      await fs.writeFile(path.join(path.resolve(env.uploadDir), storageKey), buffer);
      const a = await prisma.attachment.create({ data: { originalName: name, storageKey, mimeType: type, size: buffer.length, uploadedById: user.id, ticketId: t.id, inline: false } });
      await recordTicketEvents(prisma, t.id, user.id, [{ type: 'ATTACHMENT', toValue: a.id, toLabel: a.originalName, clientVisible: t.visibility === 'CLIENT' }]);
      rememberTicket(t.key);
      await io.say(`📎 Attached to *${t.key}*.`);
    } catch (e) { await io.say(`⚠️ ${e.message}`); }
    return done();
  }

  const text = msg.buttonId || msg.text || '';
  const cmd = parseCommand(text);

  // ---- confirmation of a parked write (AI or wizard) -------------------------------------
  if (cmd?.cmd === 'yes' || cmd?.cmd === 'no') {
    const p = ctx.pending;
    if (cmd.cmd === 'no' && !p && ctx.draft) { save({ draft: null }); await io.say('Cancelled.'); return done(); }
    if (!p || !fresh(p.at, PENDING_TTL)) { await io.say('Nothing is waiting for confirmation.'); save({ pending: null }); return done(); }
    save({ pending: null });
    if (cmd.cmd === 'no') { await io.say('Cancelled.'); return done(); }
    const r = await runTool(api, p.tool, p.args);
    await io.say(r.ok ? `✅ Done.\n${Object.entries(r.data || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}` : `⚠️ ${r.error}`);
    return done();
  }

  // ---- ticket-creation wizard (needs a pick) -----------------------------------------------
  if (cmd?.cmd === 'pick' && ctx.draft) {
    const opt = ctx.draft.options?.[cmd.n - 1];
    if (!opt) { await io.say('Reply with one of the numbers listed, or *cancel*.'); return done(); }
    const draft = { ...ctx.draft, [ctx.draft.step === 'org' ? 'client' : 'team']: opt.id };
    return createFromDraft(draft);
  }

  async function createFromDraft(draft) {
    const r = await runTool(api, 'create_ticket', { title: draft.title, client: draft.client, team: draft.team });
    if (r.ok) { save({ draft: null }); rememberTicket(r.data.created); await io.say(`🎫 Created *${r.data.created}*. Send a photo or file now to attach it.`); return done(); }
    if (r.code === 'ORG_REQUIRED' || r.code === 'TEAM_REQUIRED') {
      const isOrg = r.code === 'ORG_REQUIRED';
      const list = isOrg ? await api.get('/organizations') : (await staff()) ? await api.get('/teams') : await api.get('/teams/requestable');
      const options = list.slice(0, 10).map((x) => ({ id: x.id, name: x.name }));
      save({ draft: { ...draft, step: isOrg ? 'org' : 'team', options } });
      await io.say(`Which ${isOrg ? 'client' : 'team'}?\n${options.map((o, i) => `${i + 1}. ${o.name}`).join('\n')}\n\nReply with a number, or *cancel*.`);
      return done();
    }
    save({ draft: null });
    await io.say(`⚠️ ${r.error}`);
    return done();
  }

  switch (cmd?.cmd) {
    case 'help': await io.say(helpText(await staff(), user.name)); break;
    case 'stop': await prisma.whatsAppLink.update({ where: { id: link.id }, data: { notifyEnabled: false } }); await io.say('🔕 WhatsApp notifications paused. Send *resume* to turn them back on. You can still send commands.'); break;
    case 'resume': await prisma.whatsAppLink.update({ where: { id: link.id }, data: { notifyEnabled: true } }); await io.say('🔔 WhatsApp notifications are on.'); break;
    case 'tasks': {
      const r = await runTool(api, 'list_tasks', { mine: true, limit: 12 });
      if (!r.ok) { await fail(r); break; }
      save({ list: r.data.tasks.map((t) => ({ t: 'task', id: t.id, key: t.ticket })), listAt: Date.now() });
      await io.say(r.data.tasks.length ? `*Your open tasks* (${r.data.total})\n${r.data.tasks.map((t, i) => taskLine(t, i + 1)).join('\n')}\n\nReply e.g. *start 1*, *review 1*, *done 1*` : 'No open tasks. 🎉');
      break;
    }
    case 'tickets': {
      const isStaff = await staff();
      const r = await runTool(api, 'list_tickets', { mine: isStaff, limit: 40 });
      if (!r.ok) { await fail(r); break; }
      const rows = r.data.tickets.filter((t) => t.status !== 'CLOSED').slice(0, 12);
      save({ list: rows.map((t) => ({ t: 'ticket', id: t.id, key: t.key })), listAt: Date.now() });
      await io.say(rows.length ? `*${isStaff ? 'Your tickets' : 'Your requests'}*\n${rows.map((t, i) => ticketLine(t, i + 1)).join('\n')}\n\nReply *ticket 1* for details` : 'No open tickets.');
      break;
    }
    case 'ticket': {
      const it = item(cmd.ref);
      const key = it?.key || it?.id;
      if (!key) { await io.say('Use a ticket key (SOF-123456) or a number from your last list.'); break; }
      const r = await runTool(api, 'get_ticket', { ticket: key });
      if (!r.ok) { await fail(r); break; }
      rememberTicket(r.data.key);
      await io.say(ticketCard(r.data));
      break;
    }
    case 'task': {
      const it = item(cmd.ref);
      if (!it || it.t !== 'task') { await io.say('Send *tasks* first, then *task 1*.'); break; }
      const r = await runTool(api, 'list_tasks', { mine: true, include_done: true, limit: 50 });
      const t = r.ok && r.data.tasks.find((x) => x.id === it.id);
      await io.say(t ? `${ICON[t.status]} *${t.title}*\nStatus: ${nice(t.status)}${t.ticket ? `\nTicket: ${t.ticket}` : ''}${t.due ? `\nDue: ${fmtDay(t.due)}` : ''}` : 'Task not found.');
      if (t?.ticket) rememberTicket(t.ticket);
      break;
    }
    case 'taskstatus': {
      const it = item(cmd.ref);
      if (!it || it.t !== 'task') { await io.say('Send *tasks* first, then e.g. *done 1*.'); break; }
      const r = await runTool(api, 'update_task', { task: it.id, status: cmd.status });
      await io.say(r.ok ? `${ICON[r.data.status]} *${r.data.title}* → ${nice(r.data.status)}` : `⚠️ ${r.error}`);
      break;
    }
    case 'comment': {
      const it = item(cmd.ref);
      if (!it) { await io.say('Use a ticket key or a number from your last list.'); break; }
      const r = it.t === 'task'
        ? await runTool(api, 'comment_task', { task: it.id, body: cmd.text })
        : await runTool(api, 'comment_ticket', { ticket: it.key || it.id, body: cmd.text, client_visible: cmd.clientVisible });
      await io.say(r.ok ? '💬 Comment added.' : `⚠️ ${r.error}`);
      if (r.ok && it.key) rememberTicket(it.key);
      break;
    }
    case 'inbox': {
      const r = await runTool(api, 'list_notifications', { unread_only: true, limit: 8 });
      if (!r.ok) { await fail(r); break; }
      await io.say(r.data.length ? `*Unread*\n${r.data.map((n) => `• ${n.title}`).join('\n')}\n\nSend *read all* to clear.` : 'Inbox zero. ✨');
      break;
    }
    case 'readall': await runTool(api, 'mark_notifications_read', {}); await io.say('Marked all as read.'); break;
    case 'reviews': {
      const r = await runTool(api, 'tasks_waiting_my_review', {});
      if (!r.ok) { await fail(r); break; }
      save({ list: r.data.map((x) => ({ t: 'review', id: x.taskId, key: x.ticket })), listAt: Date.now() });
      await io.say(r.data.length ? `*Waiting for your review*\n${r.data.map((x, i) => `${i + 1}. *${x.ticket}* · ${x.task.slice(0, 70)}`).join('\n')}\n\nReply *approve 1* or *changes 1 what to fix*` : 'Nothing is waiting for your review.');
      break;
    }
    case 'approve': case 'changes': {
      const it = item(cmd.ref);
      if (!it || it.t !== 'review') { await io.say('Send *reviews* first, then *approve 1*.'); break; }
      const r = await runTool(api, 'review_task', { ticket: it.key, task_id: it.id, decision: cmd.cmd === 'approve' ? 'APPROVE' : 'CHANGES', note: cmd.text });
      await io.say(r.ok ? (cmd.cmd === 'approve' ? `✅ Approved.${r.data.ticketClosed ? ` *${r.data.ticket}* is now closed. 🎉` : ''}` : '↩️ Sent back to the team with your note.') : `⚠️ ${r.error}`);
      break;
    }
    case 'new': return createFromDraft({ title: cmd.title });
    case 'pick': await io.say('Send *help* to see what I can do.'); break;
    default: {
      // free text -> AI assistant (optional), else a gentle nudge
      if (aiConfigured() && link.aiEnabled) {
        try {
          const isStaff = await staff();
          const out = await (deps.runAgent || runAgent)({ api, userName: user.name, isStaff, text, history: fresh(ctx.chatAt, 30 * 60e3) ? ctx.chat || [] : [] });
          const history = [...(fresh(ctx.chatAt, 30 * 60e3) ? ctx.chat || [] : []), { role: 'user', content: text }, { role: 'assistant', content: out.text || '…' }].slice(-8);
          save({ chat: history, chatAt: Date.now() });
          if (out.pending) {
            save({ pending: out.pending });
            await io.buttons(`${out.text ? `${out.text}\n\n` : ''}I'll do this:\n${describePending(out.pending)}\n\nConfirm?`, [{ id: 'yes', title: 'Yes, do it' }, { id: 'no', title: 'Cancel' }]);
          } else await io.say(out.text);
        } catch (e) { console.error('[wa-ai]', e.message); await io.say('The assistant is unavailable right now. Send *help* for commands.'); }
      } else await io.say("I didn't get that. Send *help* to see what I can do.");
    }
  }
  return done();
}
export { toolByName };
