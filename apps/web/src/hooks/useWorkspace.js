import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

// Loads everything the signed-in person is allowed to see. Role-gated resources are only requested
// when the role includes them, so clients don't trigger 403s. Only the FIRST load shows the full-screen
// loader: later refreshes update data in place (pages, modals and chat keep their state).
export function useWorkspace() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const first = useRef(true);

  const refresh = useCallback(async () => {
    if (first.current) setLoading(true);
    try {
      const me = (await api.get("/me")).data;
      const has = (p) => me.permissions?.includes(p);
      const wanted = [
        ["dashboard"], ["organizations"], ["projects"], ["tickets"], ["notifications"], ["activity"],
        ["tasks", me.isInternal], ["teams", has("team.view")], ["users", has("user.list")],
      ].filter(([, ok = true]) => ok).map(([k]) => k);
      const [results, req] = await Promise.all([Promise.all(wanted.map((k) => api.get(`/${k}`))), api.get("/teams/requestable").catch(() => ({ data: [] }))]);
      const next = { me, tasks: [], teams: [], users: [], requestableTeams: req.data };
      wanted.forEach((k, i) => { next[k] = results[i].data; });
      setData(next);
      setError("");
    } catch (e) {
      if (!first.current && e.response?.status !== 401) return; // a background refresh failed: keep what is on screen instead of blanking the app
      setData({});
      setError(e.response?.status === 401 ? "" : e.response?.data?.error || "Could not load your workspace. Check API, database and sign-in settings.");
    } finally {
      first.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Stay in sync: when a teammate or the client changes a ticket/task, this screen catches up by itself
  // (every 20 s while the tab is visible, and the moment you come back to it).
  useEffect(() => {
    const quiet = () => { if (document.visibilityState === "visible" && !first.current) refresh(); };
    const timer = setInterval(quiet, 20000);
    document.addEventListener("visibilitychange", quiet);
    window.addEventListener("focus", quiet);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", quiet); window.removeEventListener("focus", quiet); };
  }, [refresh]);
  return { data, loading, error, refresh, setData };
}
