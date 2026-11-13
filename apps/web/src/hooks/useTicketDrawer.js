import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/**
 * Owns the state of the ticket/task drawers and the "new entity" modal plus
 * deep-linking (?ticket= / ?task=). Returns everything the shell and pages need;
 * pages never touch this state directly.
 */
export function useDrawers({ data, navigate, location }) {
  const [modal, setModal] = useState("");
  const [modalInit, setModalInit] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [comments, setComments] = useState([]);

  const selectedId = selected?.id;
  const loadComments = useCallback(() => {
    if (!selectedId) return Promise.resolve();
    return api.get(`/tickets/${selectedId}/comments`).then((r) => setComments(r.data)).catch(() => setComments([]));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setComments([]); return; }
    loadComments();
  }, [selectedId, loadComments]);

  // Notification links (/?ticket=ID or /?task=ID) open the matching drawer.
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const tk = sp.get("ticket"), ts = sp.get("task");
    if (!tk && !ts) return;
    const t = tk && (data.tickets || []).find((x) => x.id === tk);
    const k = ts && (data.tasks || []).find((x) => x.id === ts);
    if (t) { setSelectedTaskId(null); setSelected(t); }
    if (k) { setSelected(null); setSelectedTaskId(k.id); }
    if (t || k) navigate(location.pathname, { replace: true });
  }, [location.search, location.pathname, data.tickets, data.tasks, navigate]);

  const openTask = useCallback((t) => { setSelected(null); setSelectedTaskId(t.id); }, []);
  const showTicket = useCallback((t) => { setSelectedTaskId(null); setSelected(t); }, []);
  const openModal = useCallback((kind, init = null) => { setModalInit(init); setModal(kind); }, []);
  const closeModal = useCallback(() => { setModal(""); setModalInit(null); }, []);
  const closeAll = useCallback(() => { setSelected(null); setSelectedTaskId(null); setModal(""); setModalInit(null); }, []);

  // Always show the freshest copy of the open ticket (assignee, linked task, status).
  const openTicket = selected ? (data.tickets || []).find((t) => t.id === selected.id) || selected : null;
  const openTaskRecord = (data.tasks || []).find((t) => t.id === selectedTaskId) || null;

  return {
    modal, modalInit, openModal, closeModal,
    selected, setSelected, selectedTaskId, setSelectedTaskId,
    openTask, showTicket, closeAll,
    comments, loadComments, openTicket, openTaskRecord,
  };
}
