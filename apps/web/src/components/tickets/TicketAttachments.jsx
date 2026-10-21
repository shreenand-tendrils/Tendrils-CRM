import { useCallback, useEffect, useState } from "react";
import { Paperclip, Download, Eye } from "lucide-react";
import { api } from "../../api";

const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Lists the files on a ticket and downloads them through the authenticated API.
export default function TicketAttachments({ ticketId, endpoint, refreshKey }) {
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => api.get(endpoint || `/tickets/${ticketId}/attachments`).then((r) => setFiles(r.data)).catch(() => setFiles([])), [ticketId, endpoint]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const download = async (f) => {
    setErr("");
    try {
      const r = await api.get(`/files/${f.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = f.originalName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setErr("Could not download this file."); }
  };
  const view = async (f) => {
    setErr("");
    try {
      const r = await api.get(`/files/${f.id}/download`, { responseType: "blob" });
      window.open(URL.createObjectURL(new Blob([r.data], { type: f.mimeType })), "_blank", "noopener");
    } catch { setErr("Could not open this file."); }
  };
  if (!files.length) return <small className="hint">No attachments yet.</small>;
  return (
    <div className="attachment-list">
      {files.map((f) => (
        <div className="comment" key={f.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Paperclip size={14} />
          <span style={{ flex: 1 }}><b>{f.originalName}</b><small style={{ display: "block" }}>{size(f.size)} · {new Date(f.createdAt).toLocaleString()}</small></span>
          {/^(image\/|application\/pdf)/.test(f.mimeType || "") && <button className="secondary" onClick={() => view(f)} aria-label={`View ${f.originalName}`}><Eye size={14} /></button>}
          <button className="secondary" onClick={() => download(f)} aria-label={`Download ${f.originalName}`}><Download size={14} /></button>
        </div>
      ))}
      {err && <small className="hint">{err}</small>}
    </div>
  );
}
