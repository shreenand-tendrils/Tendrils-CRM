import { api } from "../api";

export const fmtSize = (n = 0) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const canPreview = (mime = "") => /^(image\/|application\/pdf)/.test(mime);
// What the server accepts (see files.routes ALLOWED): images, PDF, Office, text/CSV, zip.
export const ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.heic,.heif";

/** Plain-language reason an upload failed. Hosting proxies answer with HTML/plain text (not our JSON), so status codes matter. */
export function uploadErrorText(err, file) {
  const name = file?.name ? `"${file.name}"` : "The file";
  const st = err?.response?.status;
  const msg = err?.response?.data?.error;
  if (msg && typeof msg === "string") return `${name}: ${msg}`;
  if (st === 413) return `${name}${file?.size ? ` (${fmtSize(file.size)})` : ""} was rejected by the web server as too large, before it reached the app. Ask your admin to raise the upload limit (nginx client_max_body_size), or try a smaller file.`;
  if (st === 401) return "Your session expired. Sign in again, then retry the upload.";
  if (st === 403) return `You don't have permission to attach files here.`;
  if (st === 415) return `${name} is a file type that is not allowed.`;
  if (st === 502 || st === 503 || st === 504) return "The server is waking up or busy. Wait about 30 seconds and try again.";
  if (!err?.response) return `${name} did not reach the server (network problem or the upload was interrupted). Check your connection and try again.`;
  return `${name} could not be uploaded (error ${st || "unknown"}).`;
}
/** Quick check before sending: null if fine, otherwise a message. */
export const MAX_UPLOAD_MB = 15;
export const checkUploadSize = (file) => (file && file.size > MAX_UPLOAD_MB * 1048576 ? `"${file.name}" is ${fmtSize(file.size)}. The limit is ${MAX_UPLOAD_MB} MB per file.` : null);

const fetchBlob = (id) => api.get(`/files/${id}/download`, { responseType: "blob" }).then((r) => r.data);

/** Open an image/PDF in a new tab through the authenticated API. */
export async function openFile(f) {
  // Open the tab first, inside the click: browsers (especially phones) block a window opened after an await.
  const w = window.open("", "_blank");
  try {
    const blob = await fetchBlob(f.id);
    const url = URL.createObjectURL(new Blob([blob], { type: f.mimeType }));
    if (w) { w.opener = null; w.location.href = url; } else window.location.assign(url);
  } catch (e) { if (w) w.close(); throw e; }
}
/** Plain-language reason a file could not be opened/downloaded (error bodies are Blobs here, so go by status). */
export const openErrorText = (err) => (err?.response?.status === 404 ? "This file is no longer on the server. Please upload it again." : err?.response?.status === 403 ? "You don't have access to this file." : "Could not open this file.");
/** Save any file to the device. */
export async function saveFile(f) {
  const url = URL.createObjectURL(await fetchBlob(f.id));
  const a = document.createElement("a"); a.href = url; a.download = f.originalName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Upload a file. `target` is { ticketId } or { taskId }; `draft` files are held for a comment (hidden from the record's own Files list). */
export async function uploadFile(file, target, { draft = false } = {}) {
  const tooBig = checkUploadSize(file);
  if (tooBig) { const e = new Error(tooBig); e.response = { data: { error: tooBig.replace(/^"[^"]*": ?/, "") }, status: 413 }; throw e; }
  const fd = new FormData();
  fd.append("file", file);
  if (draft) fd.append("inline", "1");
  Object.entries(target).forEach(([k, v]) => fd.append(k, v));
  return (await api.post("/files", fd)).data;
}
