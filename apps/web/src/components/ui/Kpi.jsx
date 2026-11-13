import { Link } from "react-router-dom";
import "../../styles/analytics.css";

// The ONE stat card used across the app (Overview, Admin console, Reports). `to` makes it a link.
export default function Kpi({ icon: Icon, tone = "violet", label, value, hint, to, onClick, className = "" }) {
  const body = (
    <>
      <i className={`kpi-icon ${tone}`}>{Icon && <Icon size={17} />}</i>
      <span className="kpi-label">{label}</span>
      <b className="kpi-value">{value ?? "—"}</b>
      {hint && <small className="kpi-hint">{hint}</small>}
    </>
  );
  if (to) return <Link className={`kpi ${className}`} to={to}>{body}</Link>;
  if (onClick) return <button type="button" className={`kpi ${className}`} onClick={onClick}>{body}</button>;
  return <div className={`kpi ${className}`}>{body}</div>;
}
