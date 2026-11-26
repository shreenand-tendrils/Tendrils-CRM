import { AppError } from '../errors/AppError.js';

/** Pure product-review rules: no DB, no network (unit-tested in test/reviews.test.js). */

export const REVIEW_STATUSES = ['IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED'];

/** Overall status from every reviewer's current decision. A withdrawn review stays withdrawn. */
export function computeStatus(decisions = [], current = 'IN_REVIEW') {
  if (current === 'CANCELLED') return 'CANCELLED';
  if (!decisions.length) return 'IN_REVIEW';
  if (decisions.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  if (decisions.every((d) => d === 'APPROVED')) return 'APPROVED';
  return 'IN_REVIEW';
}

/** Accept only http(s) links; add https:// when a bare domain is pasted. Returns [{ url, title }] (max 20, de-duplicated). */
export function normalizeLinks(input) {
  let list = input;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = list.split(/\s+/).filter(Boolean).map((url) => ({ url })); } }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const row = typeof raw === 'string' ? { url: raw } : raw || {};
    let url = String(row.url || '').trim();
    if (!url) continue;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    let u;
    try { u = new URL(url); } catch { throw new AppError(`"${String(row.url).slice(0, 60)}" is not a valid link.`, 400, 'REVIEW_BAD_LINK'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new AppError('Only http and https links can be added.', 400, 'REVIEW_BAD_LINK');
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ url: u.href, title: String(row.title || '').trim().slice(0, 140) || u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.slice(0, 40) : '') });
    if (out.length >= 20) break;
  }
  return out;
}

/** 'YYYY-MM-DD' (or ISO) to a UTC-midnight Date; null for empty. */
export function parseDue(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s);
  if (Number.isNaN(d.getTime())) throw new AppError('That due date is not valid.', 400, 'REVIEW_BAD_DUE');
  return d;
}
export const todayUtc = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };

export const jsonList = (v) => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || !v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch { return v.split(',').map((x) => x.trim()).filter(Boolean); }
};

export const canSeeReview = (r, userId, isAdmin) => isAdmin || r.requesterId === userId || (r.reviewers || []).some((x) => x.userId === userId);
