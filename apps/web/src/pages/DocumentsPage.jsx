import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Files, Upload, UploadCloud, Download, Search, FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';
import { fmtDate } from "../lib/dates";

const CATEGORIES = [['GENERAL', 'General'], ['POLICY', 'Policy'], ['REPORT', 'Report'], ['TEMPLATE', 'Template'], ['FINANCE', 'Finance'], ['PROJECT', 'Project']];
const catLabel = (c) => CATEGORIES.find(([v]) => v === c)?.[1] || String(c || '').toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());
const fmt = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function DocumentsPage({ me, notify }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('GENERAL');
  const [visibility, setVisibility] = useState(me?.isInternal ? 'INTERNAL' : 'CLIENT');
  const [org] = useState('');
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [drag, setDrag] = useState(false);

  const load = () => api.get('/documents').then((r) => setRows(r.data)).catch((e) => notify(e.response?.data?.error || 'Could not load documents', 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const present = useMemo(() => [...new Set(rows.map((x) => x.category))], [rows]);
  const visible = useMemo(() => rows.filter((x) => (filter === 'ALL' || x.category === filter) && (`${x.title} ${x.originalName} ${x.organization?.name || ''} ${x.category}`).toLowerCase().includes(query.toLowerCase())), [rows, query, filter]);

  const sendFile = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file); fd.append('title', title || file.name); fd.append('category', category); fd.append('visibility', visibility);
    if (org) fd.append('organizationId', org);
    setBusy(true);
    try { await api.post('/documents', fd); notify('Document uploaded'); setTitle(''); await load(); }
    catch (err) { notify(err.response?.data?.error || 'Upload failed', 'error'); }
    finally { setBusy(false); }
  };
  const onPick = (e) => { const f = e.target.files?.[0]; e.target.value = ''; sendFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (!busy) sendFile(e.dataTransfer.files?.[0]); };
  const download = async (d) => {
    try {
      const r = await api.get(`/documents/${d.id}/download`, { responseType: 'blob' });
      const u = URL.createObjectURL(r.data); const a = document.createElement('a');
      a.href = u; a.download = d.originalName; a.click(); URL.revokeObjectURL(u);
    } catch { notify('Download denied or unavailable', 'error'); }
  };
  const iconFor = (name) => (/\.(xls|xlsx|csv)$/i.test(name) ? <FileSpreadsheet /> : /\.(png|jpg|jpeg|webp)$/i.test(name) ? <ImageIcon /> : <FileText />);

  return (
    <div className="documents-page">
      <div className={`doc-drop${drag ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <div className="doc-drop-top">
          <span className="doc-drop-icon"><UploadCloud size={22} /></span>
          <div className="doc-drop-text"><b>Upload a document</b><small>Drag a file here, or choose one. PDF, Office, CSV, text and images.</small></div>
          <label className={`primary doc-pick${busy ? ' busy' : ''}`}><Upload size={16} />{busy ? 'Uploading…' : 'Choose file'}
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={onPick} disabled={busy} />
          </label>
        </div>
        <div className="doc-fields">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title (optional)" aria-label="Document title" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} disabled={!me?.isInternal} aria-label="Who can see it"><option value="INTERNAL">Internal only</option><option value="CLIENT">Client-visible</option></select>
        </div>
      </div>

      <div className="doc-bar">
        <label className="doc-find"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents" aria-label="Search documents" /></label>
        <div className="doc-filters" role="group" aria-label="Filter by category">
          {['ALL', ...present].map((c) => <button key={c} type="button" className={`pill${filter === c ? ' on' : ''}`} aria-pressed={filter === c} onClick={() => setFilter(c)}>{c === 'ALL' ? `All (${rows.length})` : catLabel(c)}</button>)}
        </div>
      </div>

      <div className="document-list">
        {visible.map((d) => (
          <article className="document-row" key={d.id}>
            <span className="doc-file-icon">{iconFor(d.originalName)}</span>
            <div className="doc-info">
              <b>{d.title}</b>
              <small>{d.originalName} · {fmt(d.size)} · {d.organization?.name || 'Workspace'} · {d.uploadedBy?.name || d.uploadedBy?.email || 'Member'}{d.createdAt ? ` · ${fmtDate(d.createdAt)}` : ''}</small>
              <span className="doc-tags"><i className="doc-tag">{catLabel(d.category)}</i><i className={`doc-tag ${d.visibility === 'INTERNAL' ? 'internal' : 'client'}`}>{d.visibility === 'INTERNAL' ? 'Internal' : 'Client-visible'}</i></span>
            </div>
            <button type="button" className="btn-soft sm" onClick={() => download(d)} title="Download document" aria-label={`Download ${d.title}`}><Download size={15} /> <span className="doc-dl-label">Download</span></button>
          </article>
        ))}
        {!visible.length && <div className="doc-empty"><Files size={30} /><b>{rows.length ? 'No matching documents' : 'No documents yet'}</b><small>{rows.length ? 'Try another search or category.' : 'Upload important files so the right people can find them.'}</small></div>}
      </div>
    </div>
  );
}
