import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { emit } from "../lib/realtime";

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
      // [url, include?, dataKey]: the API path is 'timeline' but the UI reads data.activity —
      // /activity is on ad-blocker URL lists, so the endpoint is renamed (see workspace.routes.js).
      const wanted = [
        ["dashboard"], ["organizations"], ["projects"], ["tickets"], ["notifications"], ["timeline", true, "activity"],
        ["tasks", me.isInternal], ["teams", has("team.view")], ["users", has("user.list")],
      ].filter(([, ok = true]) => ok).map(([k, , key]) => [k, key || k]);
      const [results, req] = await Promise.all([Promise.all(wanted.map(([k]) => api.get(`/${k}`))), api.get("/teams/requestable").catch(() => ({ data: [] }))]);
      const next = { me, tasks: [], teams: [], users: [], requestableTeams: req.data };
      wanted.forEach(([, key], i) => { next[key] = results[i].data; });
      setData(next);
      setError("");
      return true;
    } catch (e) {
      if (!first.current && e.response?.status !== 401) return false; // a background refresh failed: keep what is on screen instead of blanking the app
      setData({});
      setError(e.response?.status === 401 ? "" : e.response?.data?.error || "Could not load your workspace. Check API, database and sign-in settings.");
      return false;
    } finally {
      first.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Stay in sync: when a teammate or the client changes a ticket/task, this screen catches up by itself
  // (every 20 s while the tab is visible, and the moment you come back to it).
  useEffect(() => {
    let ticks = 0;
    const quiet = () => { if (document.visibilityState === "visible" && !first.current) { refresh(); if (++ticks % 3 === 0) emit("app.refresh", { silent: true }); } }; // widgets that load their own data (analytics, client overview) catch up about once a minute
    const back = () => { if (document.visibilityState === "visible" && !first.current) { refresh(); emit("app.refresh", { silent: true }); } };
    const timer = setInterval(quiet, 20000);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [refresh]);
  return { data, loading, error, refresh, setData };
}
