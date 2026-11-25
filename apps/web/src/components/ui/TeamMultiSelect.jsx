import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Dropdown with checkboxes: pick several teams. Works inside a <form> (checkboxes carry `name`) and as a controlled input.
// `lockedId` = the owner team (shown but not selectable here).
export default function TeamMultiSelect({ teams = [], value, defaultValue = [], onChange, name, lockedId = "", label = "Share with other teams", disabled = false, id }) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const [menuStyle, setMenuStyle] = useState(null);
  const sel = (controlled ? value : inner).filter((x) => x !== lockedId);
  const ref = useRef(null);
  const options = teams.filter((t) => t.id !== lockedId);

  useEffect(() => {
    const close = (e) => { if (ref.current?.open && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // The drawer clips anything that overflows it, so the open menu is fixed to the viewport and placed above or below the field, whichever fits.
  const place = () => {
    const box = ref.current?.querySelector("summary")?.getBoundingClientRect();
    if (!box || !ref.current?.open) return;
    const below = window.innerHeight - box.bottom - 12, above = box.top - 12, up = below < 180 && above > below;
    setMenuStyle({ position: "fixed", left: box.left, width: box.width, right: "auto", zIndex: 1000, maxHeight: Math.max(120, Math.min(260, up ? above : below)), ...(up ? { bottom: window.innerHeight - box.top + 4, top: "auto" } : { top: box.bottom + 4 }) });
  };
  useEffect(() => {
    const onMove = () => place();
    window.addEventListener("resize", onMove); window.addEventListener("scroll", onMove, true);
    return () => { window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (tid) => {
    const next = sel.includes(tid) ? sel.filter((x) => x !== tid) : [...sel, tid];
    if (!controlled) setInner(next);
    onChange?.(next);
  };
  const names = options.filter((t) => sel.includes(t.id)).map((t) => t.name);
  const summary = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : "No other teams";

  return (
    <details className="team-multi" ref={ref} aria-disabled={disabled} onToggle={place}>
      <summary id={id} aria-label={label} onClick={(e) => disabled && e.preventDefault()}>
        <span>{summary}</span><ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="team-multi-menu" role="group" aria-label={label} style={menuStyle || undefined}>
        {!options.length && <small className="muted">No other teams available.</small>}
        {options.map((t) => (
          <label key={t.id} className={"person" + (sel.includes(t.id) ? " on" : "")}>
            <input type="checkbox" name={name} value={t.id} checked={sel.includes(t.id)} onChange={() => toggle(t.id)} />
            {t.name}
          </label>
        ))}
      </div>
    </details>
  );
}
