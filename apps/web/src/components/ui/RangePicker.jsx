import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import "../../styles/analytics.css";

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
export const RANGE_PRESETS = [
  { id: "month", label: "This month", get: (n) => [utc(n.getUTCFullYear(), n.getUTCMonth(), 1), n] },
  { id: "30d", label: "Last 30 days", get: (n) => [utc(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - 29), n] },
  { id: "3m", label: "Last 3 months", get: (n) => [utc(n.getUTCFullYear(), n.getUTCMonth() - 2, 1), n] },
  { id: "6m", label: "Last 6 months", get: (n) => [utc(n.getUTCFullYear(), n.getUTCMonth() - 5, 1), n] },
  { id: "year", label: "This year", get: (n) => [utc(n.getUTCFullYear(), 0, 1), n] },
];
export const presetRange = (id, now = new Date()) => { const [a, b] = RANGE_PRESETS.find((p) => p.id === id).get(now); return { from: iso(a), to: iso(b) }; };
const short = (s) => new Date(`${s}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** One small pill that opens a compact menu: quick ranges, or pick exact dates. */
export default function RangePicker({ from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ from, to });
  const box = useRef(null);
  const match = RANGE_PRESETS.find((p) => { const r = presetRange(p.id); return r.from === from && r.to === to; });

  useEffect(() => {
    if (!open) return undefined;
    setCustom({ from, to });
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id) => { onChange(presetRange(id)); setOpen(false); };
  const apply = () => { if (custom.from && custom.to && custom.from <= custom.to) { onChange(custom); setOpen(false); } };
  return (
    <div className="range" ref={box}>
      <button type="button" className="range-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CalendarDays size={15} /><span>{match ? match.label : `${short(from)} – ${short(to)}`}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div className="range-menu" role="dialog" aria-label="Choose date range">
          <ul>{RANGE_PRESETS.map((p) => <li key={p.id}><button type="button" className={match?.id === p.id ? "on" : ""} onClick={() => pick(p.id)}>{p.label}</button></li>)}</ul>
          <div className="range-custom">
            <label>From<input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
            <label>To<input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
            <button type="button" className="primary" onClick={apply} disabled={!custom.from || !custom.to || custom.from > custom.to}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
