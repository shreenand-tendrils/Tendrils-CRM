/** Underline tab bar used by the ticket and task windows. tabs: [{ id, label, count?, alert?, hidden? }] */
export function WinTabs({ tabs, value, onChange, label = "Sections" }) {
  return (
    <div className="tw-tabs" role="tablist" aria-label={label}>
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={"tw-tab" + (value === t.id ? " on" : "")} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <em className={"tw-count" + (t.alert ? " alert" : "")}>{t.count}</em>}
        </button>
      ))}
    </div>
  );
}

/** A titled card for the right-hand side of a window. */
export function SideCard({ title, icon: Icon, action, children, className = "" }) {
  return (
    <section className={`tw-card ${className}`}>
      <header className="tw-card-head"><h4>{Icon && <Icon size={14} />}{title}</h4>{action}</header>
      <div className="tw-card-body">{children}</div>
    </section>
  );
}

/** label on the left, value or control on the right */
export function Row({ label, children }) {
  return <div className="tw-row"><span>{label}</span><div>{children}</div></div>;
}

/** A card in the main column. */
export function Panel2({ title, sub, action, children }) {
  return (
    <section className="tw-panel">
      <header className="tw-panel-head"><div><h3>{title}</h3>{sub && <small>{sub}</small>}</div>{action}</header>
      {children}
    </section>
  );
}
