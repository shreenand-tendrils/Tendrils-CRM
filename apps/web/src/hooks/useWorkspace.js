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
      const results = await Promise.all(wanted.map((k) => api.get(`/${k}`)));
      const next = { me, tasks: [], teams: [], users: [] };
      wanted.forEach((k, i) => { next[k] = results[i].data; });
      setData(next);
      setError("");
    } catch (e) {
      setData({});
      setError(e.response?.status === 401 ? "" : e.response?.data?.error || "Could not load your workspace. Check API, database and sign-in settings.");
    } finally {
      first.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, error, refresh, setData };
}
