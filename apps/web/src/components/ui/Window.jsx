import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import "../../styles/window.css";
import "../../styles/ticket-window.css";

// Floating window (same look as the "Create" forms): centered, dimmed backdrop, main area + side panel.
export default function Window({ label, head, headRight, side, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="win-overlay">
      <section className="win" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <header className="win-head">
          {head}
          <div className="win-head-actions">{headRight}<button type="button" className="win-close" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        </header>
        <div className={"win-grid" + (side ? "" : " no-side")}>
          <div className="win-main">{children}</div>
          {side && <aside className="win-side">{side}</aside>}
        </div>
      </section>
    </div>
  );
}
