import { Briefcase, Building2 } from "lucide-react";

/** Shown after sign-in when the same email is both an employee and a client: pick which side to work as. */
export default function ModeChooser({ me }) {
  const clientOrgs = (me.memberships || []).filter((m) => m.organization?.type !== "INTERNAL").map((m) => m.organization?.name).filter(Boolean);
  const pick = (mode) => { localStorage.setItem("tdl_mode", mode); window.location.assign("/"); };
  const card = { display: "flex", gap: 14, alignItems: "center", textAlign: "left", padding: "16px 18px", borderRadius: 14, border: "1px solid #dfe3f1", background: "#fff", cursor: "pointer", width: "100%" };
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20, background: "#f4f6fb" }}>
      <div style={{ width: "min(460px, 100%)", background: "#fff", borderRadius: 20, padding: 28, boxShadow: "0 12px 40px rgba(30,40,90,.12)", display: "grid", gap: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>How do you want to continue?</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7287" }}>{me.user?.email} has access as both an employee and a client. You can switch any time from the sidebar.</p>
        </div>
        <button type="button" style={card} onClick={() => pick("EMPLOYEE")}>
          <Briefcase size={26} color="#5746e8" /><span><b>Continue as Employee</b><br /><small style={{ color: "#6b7287" }}>Tendrils team workspace: tickets, tasks, teams</small></span>
        </button>
        <button type="button" style={card} onClick={() => pick("CLIENT")}>
          <Building2 size={26} color="#0f9d6b" /><span><b>Continue as Client</b><br /><small style={{ color: "#6b7287" }}>{clientOrgs.length ? clientOrgs.join(", ") : "Client portal: your projects and tickets"}</small></span>
        </button>
      </div>
    </div>
  );
}
