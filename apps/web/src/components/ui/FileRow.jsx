import { useState } from "react";
import { Download, Eye, File as FileIcon, FileText, Image as ImageIcon, Table2, Trash2, X } from "lucide-react";
import { canPreview, fmtSize, openFile, saveFile, openErrorText } from "../../lib/files";

const iconFor = (f) => {
  const m = f.mimeType || "", n = f.originalName || "";
  if (m.startsWith("image/")) return <ImageIcon size={16} />;
  if (m === "application/pdf" || /\.(docx?|txt)$/i.test(n)) return <FileText size={16} />;
  if (/\.(xlsx?|csv)$/i.test(n) || m.includes("spreadsheet") || m === "text/csv") return <Table2 size={16} />;
  return <FileIcon size={16} />;
};

/** One file: icon, name, small print, and View / Download (or a remove ✕ while it is still a draft). */
export default function FileRow({ file, sub, onRemove, onDelete, compact = false, busy = false }) {
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    if (!window.confirm(`Delete "${file.originalName}" permanently?\n\nIt is removed from the ticket and from the server and cannot be recovered.`)) return;
    setDeleting(true); setErr("");
    try { await onDelete(file); } catch (e) { setErr(e.response?.data?.error || "Could not delete this file."); setDeleting(false); }
  };
  const run = (fn) => async () => { setErr(""); try { await fn(file); } catch (e) { setErr(openErrorText(e)); } };
  return (
    <div className={`file-row${compact ? " compact" : ""}${busy ? " busy" : ""}`}>
      <span className="file-ico">{iconFor(file)}</span>
      <span className="file-meta">
        <b title={file.originalName}>{file.originalName}</b>
        <small>{busy ? "Uploading…" : sub || fmtSize(file.size)}{err && <> · <i className="file-err">{err}</i></>}</small>
      </span>
      {!busy && !onRemove && canPreview(file.mimeType) && <button type="button" className="btn-soft sm icon" onClick={run(openFile)} aria-label={`View ${file.originalName}`} title="View"><Eye size={15} /></button>}
      {!busy && !onRemove && <button type="button" className="btn-soft sm icon" onClick={run(saveFile)} aria-label={`Download ${file.originalName}`} title="Download"><Download size={15} /></button>}
      {onDelete && !busy && !onRemove && <button type="button" className="btn-soft sm icon danger" onClick={del} disabled={deleting} aria-label={`Delete ${file.originalName}`} title="Delete file"><Trash2 size={15} /></button>}
      {onRemove && !busy && <button type="button" className="btn-soft sm icon" onClick={() => onRemove(file)} aria-label={`Remove ${file.originalName}`} title="Remove"><X size={15} /></button>}
    </div>
  );
}
