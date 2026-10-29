import { useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, Trash2, Plug } from "lucide-react";
import Panel from "../ui/Panel";
import { api } from "../../api";

const errText = (e) => e?.response?.data?.error || e?.message || "Something went wrong";
const when = (d) => (d ? new Date(d).toLocaleDateString() : "never");

export default function McpPanel() {
  const [data, setData] = useState({ tokens: [], mcpUrl: "" });
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => setData((await api.get("/me/tokens")).data), []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const create = async () => {
    setMsg("");
    try { const { data: t } = await api.post("/me/tokens", { name, readOnly, expiresInDays: Number(days) }); setFresh(t); setName(""); await load(); }
    catch (e) { setMsg(errText(e)); }
  };
  const revoke = async (id) => { if (window.confirm("Revoke this token? Apps using it stop working.")) { await api.delete(`/me/tokens/${id}`).catch(() => {}); await load(); } };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => setMsg("Copied."), () => setMsg("Copy failed: select the text manually."));
  const url = fresh?.mcpUrl || data.mcpUrl;
  const tok = fresh?.token || "<YOUR_TOKEN>";
  const claudeCode = `claude mcp add --transport http tendrils ${url} --header "Authorization: Bearer ${tok}"`;
  const desktop = JSON.stringify({ mcpServers: { tendrils: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${tok}`] } } }, null, 2);

  return (
    <Panel title="AI assistants (MCP)" sub="Let Claude Desktop, Claude Code or any MCP app work with your tickets and tasks — with exactly your permissions.">
      <div className="setting-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <KeyRound />
        <label className="field" style={{ flex: 1, minWidth: 180 }}><span className="lbl">Token name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Desktop" maxLength={60} /></label>
        <label className="field"><span className="lbl">Expires</span>
          <select value={days} onChange={(e) => setDays(e.target.value)}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select>
        </label>
        <label className="field inline"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /><span>Read-only</span></label>
        <button className="primary" disabled={name.trim().length < 2} onClick={create}>Create token</button>
      </div>
      {msg && <small className="muted" role="status">{msg}</small>}

      {fresh && (
        <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <b>Copy your token now — it is shown only once</b>
          <code style={{ wordBreak: "break-all" }}>{fresh.token}</code>
          <div><button className="secondary" onClick={() => copy(fresh.token)}><Copy size={15} />Copy token</button></div>
        </div>
      )}

      <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        <span><b><Plug size={15} style={{ verticalAlign: -2 }} /> Connect</b><small>MCP URL: <code>{url}</code></small></span>
        <small className="muted">Claude Code</small>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{claudeCode}</pre>
        <div><button className="ghost" onClick={() => copy(claudeCode)}><Copy size={15} />Copy command</button></div>
        <small className="muted">Claude Desktop → Settings → Developer → Edit config</small>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{desktop}</pre>
        <div><button className="ghost" onClick={() => copy(desktop)}><Copy size={15} />Copy config</button></div>
      </div>

      {data.tokens.map((t) => (
        <div className="setting-row" key={t.id}>
          <span><b>{t.name}</b><small>{t.prefix}… · {t.scopes.includes("read") ? "read-only" : "full access"} · last used {when(t.lastUsedAt)} · expires {when(t.expiresAt)}</small></span>
          <button className="ghost" style={{ marginLeft: "auto" }} onClick={() => revoke(t.id)} aria-label={`Revoke ${t.name}`}><Trash2 size={15} />Revoke</button>
        </div>
      ))}
    </Panel>
  );
}
