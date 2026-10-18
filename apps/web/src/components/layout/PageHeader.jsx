import { Plus, RefreshCw } from "lucide-react";

export default function PageHeader({ title, subtitle, actionLabel, onAction, onRefresh }) {
  return (
    <div className="heading">
      <div>
        <div className="kicker">TENDRILS OPERATIONS <span className="green-dot" /> WORKSPACE</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">
        {actionLabel && <button className="primary" onClick={onAction}><Plus size={18} />{actionLabel}</button>}
        <button className="secondary" onClick={onRefresh} aria-label="Refresh"><RefreshCw size={16} /><span className="label">Refresh</span></button>
      </div>
    </div>
  );
}
