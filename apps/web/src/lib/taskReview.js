// Mirrors apps/api/src/services/taskReviewRules.js so buttons match what the API accepts. The API stays the authority.
//   TICKET mirror record | NONE self-managed or subtask | CLIENT client approves | TEAM requesting team | PEER a teammate
export const canApproveTask = ({ canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [] } = {}) => Boolean(canUpdateAny || reviewerTeamIds.some((id) => actorTeamIds.includes(id)));

export function canFinishTask({ authority, actorId, canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [], workTeamIds = [], creatorId = null, assigneeIds = [] } = {}) {
  if (authority === "TICKET") return false;
  if (authority === "NONE") return true;
  if (canUpdateAny) return true;
  if (authority === "CLIENT") return false;
  if (authority === "TEAM") return canApproveTask({ actorTeamIds, reviewerTeamIds });
  if (assigneeIds.includes(actorId)) return false;
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

/** Which statuses may this person pick, and why not. Returns [{ value, label, disabled, why }]. */
export function statusChoices({ me, task, pendingSubtasks = 0, columns }) {
  const { authority, mayFinish } = taskFacts(me, task);
  const locked = authority === "TICKET";
  return columns.map(([value, label]) => {
    let why = "";
    if (task.status !== value) {
      if (locked) why = "set by the ticket";
      else if (["REVIEW", "DONE"].includes(value) && pendingSubtasks > 0) why = `${pendingSubtasks} subtask${pendingSubtasks === 1 ? "" : "s"} open`;
      else if (value === "DONE" && authority !== "NONE" && task.status !== "REVIEW") why = "submit for review first";
      else if (value === "DONE" && !mayFinish) why = authority === "CLIENT" ? "client approves" : authority === "TEAM" ? "requesting team approves" : "a teammate approves";
    }
    if (task.status === "DONE" && value !== "DONE" && !mayFinish) why = "only the reviewer can reopen";
    return { value, label, disabled: !!why, why };
  });
}
