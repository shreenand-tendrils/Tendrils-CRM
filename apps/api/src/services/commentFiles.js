// Files that travel with a comment (pasted images and attached documents).
// They are linked to the comment, so they never mix with the ticket's or task's own files.
const MARK = /\[\[img:([a-z0-9-]+)\]\]/gi;
export const markerIds = (body = '') => [...String(body).matchAll(MARK)].map((m) => m[1]);

export const commentFileSelect = { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedById: true };
export const withFiles = { attachments: { select: commentFileSelect, orderBy: { createdAt: 'asc' } } };

/** Link the files a person uploaded for this comment (attachmentIds + pasted-image markers in the text). Only their own, unlinked, same-record files. */
export async function attachToComment(db, { commentId, body, attachmentIds = [], where, userId }) {
  const ids = [...new Set([...attachmentIds, ...markerIds(body)])];
  if (!ids.length) return 0;
  const r = await db.attachment.updateMany({ where: { id: { in: ids }, uploadedById: userId, commentId: null, ...where }, data: { commentId } });
  return r.count;
}
