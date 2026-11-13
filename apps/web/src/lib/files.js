import { api } from "../api";

export const fmtSize = (n = 0) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const canPreview = (mime = "") => /^(image\/|application\/pdf)/.test(mime);
// What the server accepts (see files.routes ALLOWED): images, PDF, Office, text/CSV, zip.
export const ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip";

const fetchBlob = (id) => api.get(`/files/${id}/download`, { responseType: "blob" }).then((r) => r.data);

/** Open an image/PDF in a new tab through the authenticated API. */
export async function openFile(f) {
  const blob = await fetchBlob(f.id);
  window.open(URL.createObjectURL(new Blob([blob], { type: f.mimeType })), "_blank", "noopener");
}
/** Save any file to the device. */
export async function saveFile(f) {
  const url = URL.createObjectURL(await fetchBlob(f.id));
  const a = document.createElement("a"); a.href = url; a.download = f.originalName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Upload a file. `target` is { ticketId } or { taskId }; `draft` files are held for a comment (hidden from the record's own Files list). */
export async function uploadFile(file, target, { draft = false } = {}) {
  const fd = new FormData();
  fd.append("file", file);
  if (draft) fd.append("inline", "1");
  Object.entries(target).forEach(([k, v]) => fd.append(k, v));
  return (await api.post("/files", fd)).data;
}
