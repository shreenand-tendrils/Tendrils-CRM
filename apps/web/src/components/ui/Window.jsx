import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import "../../styles/window.css";

// Floating window (same look as the "Create" forms): centered, dimmed backdrop, main area + side panel.
export default function Window({ label, head, side, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="win-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="win" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <header className="win-head">
          {head}
          <button type="button" className="win-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="win-grid">
          <div className="win-main">{children}</div>
          {side && <aside className="win-side">{side}</aside>}
        </div>
      </section>
    </div>
  );
}
