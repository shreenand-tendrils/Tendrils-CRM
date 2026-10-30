// Mirrors apps/api/src/services/review.js so buttons match what the API accepts. The API stays the authority.
//   TICKET mirror record | NONE self-managed or subtask | CLIENT client approves | TEAM requesting team | PEER a teammate
export const canApproveTask = ({ canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [] } = {}) => Boolean(canUpdateAny || reviewerTeamIds.some((id) => actorTeamIds.includes(id)));

export function canFinishTask({ authority, actorId, canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [], workTeamIds = [], creatorId = null, assigneeIds = [] } = {}) {
  if (authority === "TICKET") return false;
  if (authority === "NONE") return true;
  if (canUpdateAny) return true;
  if (authority === "CLIENT") return false;
  if (assigneeIds.includes(actorId)) return false;
  if (authority === "TEAM") return canApproveTask({ actorTeamIds, reviewerTeamIds });
  return actorId === creatorId || workTeamIds.some((id) => actorTeamIds.includes(id));
}

export const REVIEW_LABEL = { CLIENT: "Client reviews", TEAM: "Requesting team reviews", PEER: "Teammate reviews", NONE: "No review needed", TICKET: "Ticket record" };
export const REVIEW_HINT = {
  CLIENT: "When you finish, submit it for review. The client sees it on their ticket and approves it or asks for changes.",
  TEAM: "When you finish, submit it for review. The team that requested it approves it.",
  PEER: "When you finish, submit it for review. A teammate (not the assignee) approves it.",
  NONE: "No review needed. Mark it Done when you finish.",
  TICKET: "This record only mirrors its ticket. Work on the ticket's tasks instead.",
};

/** The same facts the API uses, computed from a task row that the API returned. */
export function taskFacts(me, task) {
  const teamAccesses = task.teamAccesses || [];
  const reviewerTeamIds = teamAccesses.filter((a) => a.accessRole === "REVIEWER").map((a) => a.teamId);
  const workTeamIds = [...new Set([...teamAccesses.filter((a) => a.accessRole !== "REVIEWER").map((a) => a.teamId), task.teamId].filter(Boolean))];
  const assigneeIds = [...new Set([task.assigneeId, ...(task.assignees || []).map((a) => a.user?.id || a.userId)].filter(Boolean))];
  const authority = task.reviewBy || "NONE";
  const mayFinish = canFinishTask({
    authority, actorId: me?.user?.id, canUpdateAny: !!me?.permissions?.includes("task.update_any"),
    actorTeamIds: me?.teamIds || [], reviewerTeamIds, workTeamIds, creatorId: task.creatorId, assigneeIds,
  });
  return { authority, mayFinish, reviewerTeamIds };
}

/** Who may move this task? Doer = the people it was given to (+ admins, + a subtask's parent assignee, + a teammate when nobody owns it).
 *  Reviewer = approves or sends back what is in Review. Everyone else can read it but not change its status. */
export function statusRights(me, task, parentAssigneeIds = []) {
  const { authority, mayFinish } = taskFacts(me, task);
  const id = me?.user?.id;
  const assigneeIds = [...new Set([task.assigneeId, ...(task.assignees || []).map((a) => a.user?.id || a.userId)].filter(Boolean))];
  const isAdmin = !!me?.permissions?.includes("task.update_any");
  const isAssignee = assigneeIds.includes(id);
  const unassignedMate = assigneeIds.length === 0 && (me?.teamIds || []).some((t) => [...(task.teamAccesses || []).filter((a) => a.accessRole !== "REVIEWER").map((a) => a.teamId), task.teamId].includes(t));
  const asDoer = authority !== "TICKET" && (isAdmin || isAssignee || parentAssigneeIds.includes(id) || unassignedMate);
  const asReviewer = authority !== "TICKET" && mayFinish && !isAssignee && ["PEER", "TEAM"].includes(authority);
  const canApproveNow = authority !== "TICKET" && mayFinish && (isAdmin || !isAssignee);
  return { authority, mayFinish, isAssignee, isAdmin, asDoer, asReviewer, canApproveNow, any: asDoer || (asReviewer && ["REVIEW", "DONE"].includes(task.status)), assigneeIds };
}

/** Which statuses may this person pick, and why not. Returns [{ value, label, disabled, why }]. */
export function statusChoices({ me, task, pendingSubtasks = 0, columns, parentAssigneeIds = [] }) {
  const r = statusRights(me, task, parentAssigneeIds);
  const { authority, mayFinish } = r;
  return columns.map(([value, label]) => {
    let why = "";
    if (task.status !== value) {
      const reviewerOk = r.asReviewer && ((task.status === "REVIEW" && ["DONE", "IN_PROGRESS"].includes(value)) || (task.status === "DONE" && value === "IN_PROGRESS"));
      if (authority === "TICKET") why = "set by the ticket";
      else if (!r.asDoer && !reviewerOk) why = "only the assignee";
      else if (["REVIEW", "DONE"].includes(value) && pendingSubtasks > 0) why = `${pendingSubtasks} subtask${pendingSubtasks === 1 ? "" : "s"} open`;
      else if (value === "DONE" && authority !== "NONE" && task.status !== "REVIEW") why = "submit for review first";
      else if (value === "DONE" && !mayFinish) why = authority === "CLIENT" ? "client approves" : authority === "TEAM" ? "requesting team approves" : "a teammate approves";
      else if (task.status === "DONE" && !mayFinish) why = "only the reviewer can reopen";
    }
    return { value, label, disabled: !!why, why };
  });
}
