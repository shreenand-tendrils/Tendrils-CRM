import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import { api } from "../../api";

const Check = ({ ok, label, hint }) => <div className="setting-row"><span><b>{ok ? "✅" : "⚠️"} {label}</b>{!ok && hint && <small>{hint}</small>}</span></div>;

export default function WhatsAppAdminPanel({ can }) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => setD((await api.get("/admin/whatsapp")).data), []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  if (!d) return null;
  const sum = (dir, st) => d.last7days.filter((x) => x.direction === dir && (!st || x.status === st)).reduce((a, x) => a + x.count, 0);
  return (
    <Panel title="WhatsApp (admin)" sub="Connection health and who has linked a number.">
      <Check ok={d.configured} label="Cloud API keys present" hint="Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the API." />
      <Check ok={d.signatureSecretSet} label="Webhook signature secret set" hint="Set WHATSAPP_APP_SECRET, otherwise inbound messages are rejected." />
      <Check ok={d.templateConfigured} label="Notification template configured" hint="Without WHATSAPP_TEMPLATE_NOTIFY, alerts only reach people who messaged the bot in the last 24h." />
      <div className="setting-row"><span><b>Webhook URL</b><small><code>{d.webhookUrl}</code></small></span></div>
      <div className="setting-row"><span><b>Last 7 days</b><small>{sum("IN")} received · {sum("OUT")} sent · {sum("OUT", "failed")} failed</small></span></div>
      {d.links.map((l) => (
        <div className="setting-row" key={l.userId}>
          <span><b>{l.name || l.email}</b><small>{l.phone} · notifications {l.notifyEnabled ? "on" : "paused"}</small></span>
          {can("member.manage") && <button className="ghost" style={{ marginLeft: "auto" }} onClick={() => window.confirm(`Unlink ${l.name || l.email}?`) && api.delete(`/admin/whatsapp/${l.userId}`).then(load)}>Unlink</button>}
        </div>
      ))}
      {!d.links.length && <small className="muted">Nobody has linked WhatsApp yet.</small>}
    </Panel>
  );
}
