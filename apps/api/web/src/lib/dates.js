const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Convert `YYYY-MM-DD` (from <input type="date">) to an ISO datetime at UTC midnight. */
export const toIsoDate = (v) => (typeof v === 'string' && DATE_ONLY.test(v) ? `${v}T00:00:00.000Z` : v);

/** Normalize every *Date field in a form payload, for all entity kinds. */
export function normalizePayload(payload) {
  const out = { ...payload };
  for (const key of Object.keys(out)) if (/Date$/.test(key)) out[key] = toIsoDate(out[key]);
  return out;
}
