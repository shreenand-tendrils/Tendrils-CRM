const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Convert `YYYY-MM-DD` (from <input type="date">) to an ISO datetime at UTC midnight. */
export const toIsoDate = (v) => (typeof v === 'string' && DATE_ONLY.test(v) ? `${v}T00:00:00.000Z` : v);

/** Normalize every *Date field in a form payload, for all entity kinds. */
export function normalizePayload(payload) {
  const out = { ...payload };
  for (const key of Object.keys(out)) if (/Date$/.test(key)) out[key] = toIsoDate(out[key]);
  return out;
}

// ---------------------------------------------------------------------------
// Display formats (ONE place for the whole UI): dates are dd/mm/yy, times are 24h hh:mm.
// Date-only values (due dates are stored as UTC midnight) are shown by their UTC day so
// they never slip to the previous day in other timezones; real timestamps use the viewer's local time.
// ---------------------------------------------------------------------------
const p2 = (n) => String(n).padStart(2, '0');
const toDate = (v) => { if (v == null || v === '') return null; const d = v instanceof Date ? v : new Date(DATE_ONLY.test(String(v)) ? `${v}T00:00:00.000Z` : v); return Number.isNaN(d.getTime()) ? null : d; };
const isDateOnly = (v, d) => DATE_ONLY.test(String(v)) || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
const parts = (v, forceUtc) => { const d = toDate(v); if (!d) return null; const u = forceUtc || isDateOnly(v, d); return u ? { d, day: d.getUTCDate(), mon: d.getUTCMonth() + 1, yr: d.getUTCFullYear(), hh: d.getUTCHours(), mm: d.getUTCMinutes() } : { d, day: d.getDate(), mon: d.getMonth() + 1, yr: d.getFullYear(), hh: d.getHours(), mm: d.getMinutes() }; };

/** 13/11/26 */
export const fmtDate = (v, empty = '—') => { const x = parts(v); return x ? `${p2(x.day)}/${p2(x.mon)}/${p2(x.yr % 100)}` : empty; };
/** 14:05 (viewer's local time) */
export const fmtTime = (v, empty = '') => { const d = toDate(v); return d ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : empty; };
/** 13/11/26, 14:05 */
export const fmtDateTime = (v, empty = '—') => { const d = toDate(v); return d ? `${fmtDate(d)}, ${fmtTime(d)}` : empty; };
/** Mon, 13/11/26 (day names are fine to keep on diary-style pages) */
export const fmtDateWithDay = (v, empty = '—') => { const x = parts(v); return x ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(x.yr, x.mon - 1, x.day)).getUTCDay()]}, ${fmtDate(v)}` : empty; };
/** 13/11 (short axis/label form, no year) */
export const fmtDayMonth = (v, empty = '—') => { const x = parts(v); return x ? `${p2(x.day)}/${p2(x.mon)}` : empty; };

