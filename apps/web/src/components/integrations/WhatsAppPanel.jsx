import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, CheckCircle2, Link2, Send, Unlink } from "lucide-react";
import Panel from "../ui/Panel";
import { api } from "../../api";

const LABELS = {
  ASSIGNMENT: "Assigned to me", MENTION: "Mentions", COMMENT: "New comments", STATUS_CHANGE: "Status changes",
  APPROVAL: "Approvals", DUE_SOON: "Due soon", OVERDUE: "Overdue", SYSTEM: "Reminders & updates",
};
const errText = (e) => e?.response?.data?.error || e?.message || "Something went wrong";

export default function WhatsAppPanel() {
  const [s, setS] = useState(null);
  const [link, setLink] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    const { data } = await api.get("/me/whatsapp");
    setS(data);
    if (data.linked) { setLink(null); clearInterval(timer.current); }
    return data;
  }, []);
  useEffect(() => { load().catch(() => {}); return () => clearInterval(timer.current); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true); setMsg("");
    try { await fn(); if (ok) setMsg(ok); await load(); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const start = () => run(async () => {
    const { data } = await api.post("/me/whatsapp/link");
    setLink(data);
    clearInterval(timer.current);
    timer.current = setInterval(() => load().catch(() => {}), 4000); // wait for the user to send the code
  });
  const toggleType = (t) => {
    const next = s.notifyTypes.includes(t) ? s.notifyTypes.filter((x) => x !== t) : [...s.notifyTypes, t];
    run(() => api.patch("/me/whatsapp", { notifyTypes: next }));
  };

  if (!s) return <Panel title="WhatsApp" sub="Loading…"><div /></Panel>;
  return (
    <Panel title="WhatsApp" sub="Get alerts and manage work by chatting with the Tendrils number.">
      {!s.configured && <div className="setting-row"><MessageCircle /><span><b>Not set up on this server yet</b><small>An administrator needs to add the WhatsApp Cloud API keys (see the WhatsApp &amp; MCP guide).</small></span></div>}

      {s.configured && !s.linked && !link && (
        <div className="setting-row">
          <MessageCircle />
          <span><b>Link your WhatsApp</b><small>You will send a one-time code from your phone — that proves the number is yours.</small></span>
          <button className="primary" disabled={busy} onClick={start} style={{ marginLeft: "auto" }}><Link2 size={16} />Link WhatsApp</button>
        </div>
      )}

      {link && !s.linked && (
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <Send />
          <span>
            <b>Send this code from your phone</b>
            <small>Message <b>{link.businessNumber || "the Tendrils WhatsApp number"}</b> with the text below. Valid 15 minutes. This page updates by itself.</small>
            <code style={{ display: "inline-block", marginTop: 8, fontSize: 18, fontWeight: 700 }}>LINK {link.code}</code>
          </span>
          {link.deepLink && <a className="primary" href={link.deepLink} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>Open WhatsApp</a>}
        </div>
      )}

      {s.linked && (
        <>
          <div className="setting-row">
            <CheckCircle2 />
            <span><b>Linked to {s.phone}</b><small>Send <b>help</b> to the Tendrils number to see commands.</small></span>
            <button className="secondary" disabled={busy} onClick={() => run(() => api.post("/me/whatsapp/test"), "Test message sent.")} style={{ marginLeft: "auto" }}>Send test</button>
            <button className="ghost" disabled={busy} onClick={() => window.confirm("Unlink this WhatsApp number?") && run(() => api.delete("/me/whatsapp"), "Unlinked.")}><Unlink size={16} />Unlink</button>
          </div>
          <div className="setting-row">
            <span><b>Notifications on WhatsApp</b><small>Every Tendrils notification can also arrive here. Reply STOP to pause.</small></span>
            <label className="field inline" style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={s.notifyEnabled} disabled={busy} onChange={(e) => run(() => api.patch("/me/whatsapp", { notifyEnabled: e.target.checked }))} />
              <span>{s.notifyEnabled ? "On" : "Paused"}</span>
            </label>
          </div>
          {s.notifyEnabled && (
            <div className="people-picker" style={{ marginTop: 8 }}>
              {s.allTypes.map((t) => (
                <label key={t} className="chip-link" style={{ cursor: "pointer", opacity: s.notifyTypes.includes(t) ? 1 : 0.45 }}>
                  <input type="checkbox" checked={s.notifyTypes.includes(t)} disabled={busy} onChange={() => toggleType(t)} style={{ width: "auto", marginRight: 6 }} />{LABELS[t] || t}
                </label>
              ))}
            </div>
          )}
          {s.aiAvailable && (
            <div className="setting-row">
              <span><b>AI assistant</b><small>Ask in plain words (“what’s overdue?”). Anything that changes data asks you to confirm first.</small></span>
              <label className="field inline" style={{ marginLeft: "auto" }}>
                <input type="checkbox" checked={s.aiEnabled} disabled={busy} onChange={(e) => run(() => api.patch("/me/whatsapp", { aiEnabled: e.target.checked }))} />
                <span>{s.aiEnabled ? "On" : "Off"}</span>
              </label>
            </div>
          )}
        </>
      )}
      {msg && <small className="muted" role="status" style={{ display: "block", marginTop: 8 }}>{msg}</small>}
    </Panel>
  );
}
