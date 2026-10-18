import { useState } from "react";

// Multi-select of staff. Works inside <form> (checkbox `name`) and as a controlled input (onChange).
export default function PeoplePicker({ users = [], name, defaultValue = [], onChange }) {
  const [sel, setSel] = useState(defaultValue);
  if (!users.length) return <small className="muted">No staff available to pick.</small>;
  const toggle = (id) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    onChange?.(next);
  };
  return (
    <div className="people-picker">
      {users.map((u) => (
        <label key={u.id} className={"person" + (sel.includes(u.id) ? " on" : "")}>
          <input type="checkbox" name={name} value={u.id} checked={sel.includes(u.id)} onChange={() => toggle(u.id)} />
          {u.name || u.email}
        </label>
      ))}
    </div>
  );
}
