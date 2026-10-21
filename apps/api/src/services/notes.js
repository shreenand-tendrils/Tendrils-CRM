// Pure input rules for private notes (no DB, no zod: easy to unit-test).
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 10000;
const MAX_TITLE = 120;

/** Returns { value } or { error }. `partial` = PATCH (only validate what is present). */
export function normalizeNote(input = {}, { partial = false, today = new Date() } = {}) {
  const out = {};
  if (input.body !== undefined || !partial) {
    const body = String(input.body ?? '').trim();
    if (!body) return { error: 'Write something first.' };
    if (body.length > MAX_BODY) return { error: `A note can be at most ${MAX_BODY} characters.` };
    out.body = body;
  }
  if (input.title !== undefined) {
    const title = String(input.title ?? '').trim();
    if (title.length > MAX_TITLE) return { error: `The title can be at most ${MAX_TITLE} characters.` };
    out.title = title || null;
  }
  if (input.date !== undefined || !partial) {
    const raw = input.date ?? today.toISOString().slice(0, 10);
    if (!DAY_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00.000Z`))) return { error: 'Date must look like YYYY-MM-DD.' };
    const limit = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10); // tolerate timezones
    if (raw > limit) return { error: 'A note cannot be dated in the future.' };
    out.date = new Date(`${raw}T00:00:00.000Z`);
  }
  return { value: out };
}
