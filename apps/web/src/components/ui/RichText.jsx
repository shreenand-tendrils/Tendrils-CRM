import { useEffect, useState } from "react";
import { api } from "../../api";
import "../../styles/rich.css";

const MARK = /\[\[img:([a-z0-9-]+)\]\]/gi;

function InlineImage({ id, canDelete }) {
  const [src, setSrc] = useState(null);
  const [gone, setGone] = useState(id.startsWith("pending")); // never uploaded: show nothing
  useEffect(() => {
    if (id.startsWith("pending")) return undefined;
    let live = true, url = null;
    api.get(`/files/${id}/download`, { responseType: "blob" }).then((r) => { if (live) { url = URL.createObjectURL(r.data); setSrc(url); } }).catch(() => live && setGone(true));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (gone) return null; // deleted: nothing is left behind in the text
  const remove = async () => {
    if (!window.confirm("Delete this pasted image? The ticket and its history stay exactly as they are.")) return;
    try { await api.delete(`/files/${id}`); setGone(true); } catch (e) { window.alert(e.response?.data?.error || "Could not delete the image"); }
  };
  return (
    <span className="inline-img">
      {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="Pasted" /></a> : <small className="hint">Loading image…</small>}
      {canDelete && <button type="button" className="inline-img-x" onClick={remove} aria-label="Delete image" title="Delete image">✕</button>}
    </span>
  );
}

// Text with pasted images shown in place. Markers look like [[img:ID]]; deleting an image only removes the file.
export default function RichText({ text = "", canDelete = false, style }) {
  const parts = String(text).split(MARK);
  return (
    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}>
      {parts.map((p, i) => (i % 2 ? <InlineImage key={`${p}-${i}`} id={p} canDelete={canDelete} /> : p ? <span key={i}>{p}</span> : null))}
    </div>
  );
}
