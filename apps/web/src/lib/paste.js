import { api } from "../api";
// Clipboard helpers: pasting an image or PDF into a description attaches it to the item.
export const PASTE_MARK = (name) => `[Pasted image: ${name}]`;

export function clipboardFiles(e) {
  return Array.from(e.clipboardData?.items || [])
    .filter((it) => it.kind === "file" && (it.type.startsWith("image/") || it.type === "application/pdf"))
    .map((it) => it.getAsFile())
    .filter(Boolean)
    .map((f, i) => new File([f], `pasted-${Date.now()}-${i}.${f.type === "application/pdf" ? "pdf" : f.type.split("/")[1] || "png"}`, { type: f.type }));
}

/** Insert text at the caret of an uncontrolled textarea. */
export function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const pre = start > 0 && el.value[start - 1] !== "\n" ? "\n" : "";
  el.setRangeText(`${pre}${text}\n`, start, end, "end");
}

/** Append text to a controlled value on its own line. */
export const appendLine = (value = "", text) => `${value}${value && !value.endsWith("\n") ? "\n" : ""}${text}`;

/** Upload a pasted image so it shows inside the text (not in the Files list). Returns the attachment id. */
export async function uploadInline(file, target) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("inline", "1");
  Object.entries(target).forEach(([k, v]) => fd.append(k, v));
  return (await api.post("/files", fd)).data;
}
export const isImage = (f) => f.type.startsWith("image/");
export const IMG_MARK = (id) => `[[img:${id}]]`;
