import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Dropdown with checkboxes: pick several teams. Works inside a <form> (checkboxes carry `name`) and as a controlled input.
// `lockedId` = the owner team (shown but not selectable here).
export default function TeamMultiSelect({ teams = [], value, defaultValue = [], onChange, name, lockedId = "", label = "Share with other teams", disabled = false, id }) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const sel = (controlled ? value : inner).filter((x) => x !== lockedId);
  const ref = useRef(null);
  const options = teams.filter((t) => t.id !== lockedId);

  useEffect(() => {
    const close = (e) => { if (ref.current?.open && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (tid) => {
    const next = sel.includes(tid) ? sel.filter((x) => x !== tid) : [...sel, tid];
    if (!controlled) setInner(next);
    onChange?.(next);
  };
  const names = options.filter((t) => sel.includes(t.id)).map((t) => t.name);
  const summary = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : "No other teams";

  return (
    <details className="team-multi" ref={ref} aria-disabled={disabled}>
      <summary id={id} aria-label={label} onClick={(e) => disabled && e.preventDefault()}>
        <span>{summary}</span><ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="team-multi-menu" role="group" aria-label={label}>
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
