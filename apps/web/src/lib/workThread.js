// Pure helpers for the "route" thread (like a git graph): ticket -> teams -> assignee -> tasks -> subtasks.

/** Every task that belongs on one thread: the ticket's tasks, the focused task with its parents, and all their subtasks. */
export function collectThread(all = [], { ticketId, focusId } = {}) {
  const byId = new Map(all.map((t) => [t.id, t]));
  const keep = new Map();
  if (ticketId) all.filter((t) => t.ticketId === ticketId).forEach((t) => keep.set(t.id, t));
  if (focusId) {
    const seen = new Set();
    for (let c = byId.get(focusId); c && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : null) { seen.add(c.id); keep.set(c.id, c); }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const t of all) if (t.parentId && keep.has(t.parentId) && !keep.has(t.id)) { keep.set(t.id, t); grew = true; }
  }
  return [...keep.values()];
}

const byCreated = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);

/** Nested [{ task, children }]; a task whose parent is not in the list becomes a root. */
export function buildTree(tasks = []) {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(t);
  }
  const node = (t) => ({ task: t, children: (kids.get(t.id) || []).sort(byCreated).map(node) });
  return (kids.get(null) || []).sort(byCreated).map(node);
}

export const ROUTE_EVENT_TYPES = ["CREATED", "TEAM", "TEAM_ACCESS", "ASSIGNEE", "STATUS", "TASK_REVIEW"];

/** Route events (oldest first) with the root tasks placed by the time they were created. */
export function mergeTimeline(events = [], roots = []) {
  const ev = events.filter((e) => ROUTE_EVENT_TYPES.includes(e.type)).map((e) => ({ kind: "event", at: new Date(e.createdAt).getTime(), event: e }));
  const tk = roots.map((n) => ({ kind: "task", at: new Date(n.task.createdAt).getTime(), node: n }));
  return [...ev, ...tk].sort((a, b) => a.at - b.at);
}

export const personName = (u) => u?.name || u?.email || "";
export const taskPeople = (t) => (t.assignees?.length ? t.assignees.map((a) => personName(a.user)) : t.assignee ? [personName(t.assignee)] : []).filter(Boolean);
export const taskTeams = (t) => {
  const owner = t.team?.name || (t.teamAccesses || []).find((a) => a.teamId === t.teamId)?.team?.name || null;
  const shared = (t.teamAccesses || []).filter((a) => a.teamId !== t.teamId && a.accessRole !== 'REVIEWER').map((a) => a.team?.name).filter(Boolean);
  const reviewers = (t.teamAccesses || []).filter((a) => a.accessRole === 'REVIEWER').map((a) => a.team?.name).filter(Boolean);
  return { owner, shared, reviewers };
};

/** Count unfinished descendants so a task cannot be submitted for review before its subtasks. */
export const incompleteSubtaskCount = (taskId, tasks = []) => {
  const children = new Map();
  for (const task of tasks) {
    if (!task.parentId) continue;
    if (!children.has(task.parentId)) children.set(task.parentId, []);
    children.get(task.parentId).push(task);
  }
  const seen = new Set();
  const walk = (id) => {
    let count = 0;
    for (const child of children.get(id) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (child.status !== "DONE") count += 1;
      count += walk(child.id);
    }
    return count;
  };
  return walk(taskId);
};

/** Direct children of a task, oldest first. */
export const subtasksOf = (taskId, tasks = []) => tasks.filter((t) => t.parentId === taskId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

/** { done, total } over every nested subtask, for the "2/5 subtasks" chip. */
export function subtaskStats(taskId, tasks = []) {
  const children = new Map();
  for (const t of tasks) if (t.parentId) { if (!children.has(t.parentId)) children.set(t.parentId, []); children.get(t.parentId).push(t); }
  let done = 0, total = 0; const seen = new Set();
  const walk = (id) => { for (const c of children.get(id) || []) { if (seen.has(c.id)) continue; seen.add(c.id); total += 1; if (c.status === "DONE") done += 1; walk(c.id); } };
  walk(taskId);
  return { done, total };
}
