import { useCallback, useEffect, useState } from "react";
import { Paperclip, Download } from "lucide-react";
import { api } from "../../api";

const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Lists the files on a ticket and downloads them through the authenticated API.
export default function TicketAttachments({ ticketId, refreshKey }) {
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => api.get(`/tickets/${ticketId}/attachments`).then((r) => setFiles(r.data)).catch(() => setFiles([])), [ticketId]);
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
  if (!files.length) return <small className="hint">No attachments yet.</small>;
  return (
    <div className="attachment-list">
      {files.map((f) => (
        <div className="comment" key={f.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Paperclip size={14} />
          <span style={{ flex: 1 }}><b>{f.originalName}</b><small style={{ display: "block" }}>{size(f.size)} · {new Date(f.createdAt).toLocaleString()}</small></span>
          <button className="secondary" onClick={() => download(f)} aria-label={`Download ${f.originalName}`}><Download size={14} /></button>
        </div>
      ))}
      {err && <small className="hint">{err}</small>}
    </div>
  );
}
