import nodemailer from 'nodemailer';

let transporter;
const configured = () => process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
const webBase = () => (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function sendMail({ to, subject, text, html }) {
  if (!configured()) {
    console.warn('[mail] SMTP not configured; in-app notification remains available.');
    return { sent: false };
  }
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}

export function sendAssignmentEmail({ to, assigneeName, itemTitle, itemType, href }) {
  return sendMail({
    to,
    subject: `Assigned to you: ${itemTitle}`,
    text: `Hi ${assigneeName || 'there'},\n\nYou have been assigned ${itemType}: ${itemTitle}.\n${webBase()}${href || ''}\n\n— Tendrils Operations`,
  });
}

export function sendDailyUpdateEmail({ to, userName, date, yesterday, today, blockers }) {
  const blk = blockers?.trim() || 'None';
  return sendMail({
    to,
    subject: `Daily update — ${userName} (${date})`,
    text: `${userName} posted a daily update for ${date}\n\nDone:\n${yesterday}\n\nPlanned:\n${today}\n\nBlockers:\n${blk}\n\n${webBase()}/admin`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><h3>${esc(userName)} — daily update (${esc(date)})</h3>
<p><b>Done</b><br>${esc(yesterday).replace(/\n/g, '<br>')}</p><p><b>Planned</b><br>${esc(today).replace(/\n/g, '<br>')}</p>
<p><b>Blockers</b><br>${esc(blk).replace(/\n/g, '<br>')}</p><p><a href="${webBase()}/admin">Open admin console</a></p></div>`,
  });
}

const btn = (href, label) => `<p><a href="${esc(href)}" style="background:#5746e8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;
const wrap = (inner) => `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.5">${inner}<p style="color:#888;font-size:12px">— Tendrils Operations</p></div>`;
const fireAndLog = (p) => p.catch((e) => console.error('Email send failed:', e.message));
export const emailEnabled = configured;

/** Invitation: nothing is granted until they sign in with Google using THIS email address. */
export function sendInviteEmail({ to, inviterName, orgName, roleLabel, isClient, expiresAt }) {
  const url = webBase();
  const what = isClient ? `follow your projects and raise requests for ${orgName}` : `join the ${orgName} team`;
  const until = new Date(expiresAt).toDateString();
  return sendMail({
    to, subject: `${inviterName || 'Tendrils'} invited you to ${orgName} on Tendrils`,
    text: `Hi,\n\n${inviterName || 'A Tendrils admin'} invited you to ${what} as ${roleLabel}.\n\nOpen ${url} and choose "Continue with Google" using this email address (${to}). Invitation valid until ${until}.\n\n— Tendrils Operations`,
    html: wrap(`<h3>You're invited to ${esc(orgName)}</h3><p>${esc(inviterName || 'A Tendrils admin')} invited you to ${esc(what)} as <b>${esc(roleLabel)}</b>.</p>${btn(url, 'Continue with Google')}<p>Sign in with <b>${esc(to)}</b> — the invitation only works for this address and is valid until ${esc(until)}.</p>`),
  });
}

export function sendAccessGrantedEmail({ to, name, orgName, roleLabel }) {
  const url = webBase();
  return sendMail({
    to, subject: `You now have access to ${orgName} on Tendrils`,
    text: `Hi ${name || 'there'},\n\nYou have been given ${roleLabel} access to ${orgName}.\nSign in with Google (${to}) at ${url}\n\n— Tendrils Operations`,
    html: wrap(`<h3>Welcome${name ? ', ' + esc(name) : ''}</h3><p>You now have <b>${esc(roleLabel)}</b> access to <b>${esc(orgName)}</b>.</p>${btn(url, 'Open Tendrils')}<p>Sign in with Google using <b>${esc(to)}</b>.</p>`),
  });
}

/** Someone was @mentioned ("pinged") in chat. */
export function sendMentionEmail({ to, name, byName, roomName, snippet, href }) {
  const url = `${webBase()}${href || '/chat'}`;
  return sendMail({
    to, subject: `${byName} mentioned you in ${roomName}`,
    text: `Hi ${name || 'there'},\n\n${byName} mentioned you in ${roomName}:\n"${snippet}"\n\n${url}\n\n— Tendrils Operations`,
    html: wrap(`<p><b>${esc(byName)}</b> mentioned you in <b>${esc(roomName)}</b></p><blockquote style="border-left:3px solid #5746e8;margin:0;padding:6px 12px;color:#444">${esc(snippet)}</blockquote>${btn(url, 'Open chat')}`),
  });
}

/** Generic one-way notification (ticket / project updates for clients and staff). */
export function sendNotificationEmail({ to, name, subject, message, href, cta = 'Open Tendrils' }) {
  const url = `${webBase()}${href || ''}`;
  return sendMail({
    to, subject,
    text: `Hi ${name || 'there'},\n\n${message}\n\n${url}\n\n— Tendrils Operations`,
    html: wrap(`<p>Hi ${esc(name || 'there')},</p><p>${esc(message).replace(/\n/g, '<br>')}</p>${btn(url, cta)}`),
  });
}

export { fireAndLog };
