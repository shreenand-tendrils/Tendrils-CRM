import { useRef, useState } from "react";
import { api } from "../../api";
import { clipboardFiles, uploadInline, isImage, IMG_MARK } from "../../lib/paste";
import { InlineImage } from "./RichText";
import "../../styles/rich.css";

// A textarea that takes pasted screenshots. The text you edit is clean: the [[img:ID]] markers live after the text
// and are shown as thumbnails with a ✕ (removes it from the text and deletes the file).
const MARK = /\[\[img:([a-z0-9-]+)\]\]/gi;
export const imageIds = (v = "") => [...String(v).matchAll(MARK)].map((m) => m[1]);
const tailOf = (ids) => (ids.length ? `\n${ids.map(IMG_MARK).join("\n")}` : "");
export const textOnly = (v = "") => { const t = tailOf(imageIds(v)); return t && String(v).endsWith(t) ? String(v).slice(0, -t.length) : String(v).replace(MARK, ""); };
export const withImages = (text, ids) => `${text}${tailOf(ids)}`;

export default function PasteTextarea({ value = "", onChange, target = {}, onOtherFile, onError, ...rest }) {
  const [busy, setBusy] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const ids = imageIds(value);
  const put = (text, nextIds) => onChange(withImages(text, nextIds));

  const paste = async (e) => {
    const files = clipboardFiles(e);
    if (!files.length) return;
    e.preventDefault();
    setBusy(true);
    try {
      const added = [];
      for (const f of files) { if (isImage(f)) added.push((await uploadInline(f, target)).id); else await onOtherFile?.(f); }
      if (added.length) put(textOnly(latest.current), [...imageIds(latest.current), ...added]);
    } catch (err) { onError?.(err.response?.data?.error || "Could not paste the image"); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!id.startsWith("pending")) {
      try { await api.delete(`/files/${id}`); } catch (err) { if (err.response?.status !== 404) { onError?.(err.response?.data?.error || "Could not delete the image"); return; } }
    }
    put(textOnly(latest.current), imageIds(latest.current).filter((x) => x !== id));
  };

  return (
    <>
      <textarea {...rest} value={textOnly(value)} onChange={(e) => put(e.target.value, imageIds(latest.current))} onPaste={paste} />
      {(ids.length > 0 || busy) && (
        <div className="paste-strip">
          {ids.map((id) => <InlineImage key={id} id={id} onRemove={remove} />)}
          {busy && <small className="hint">Uploading…</small>}
        </div>
      )}
    </>
  );
}
