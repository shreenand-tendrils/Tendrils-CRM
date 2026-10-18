export const pretty = (value = "") => String(value).toLowerCase().replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
export const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"}) : "—";
export const initials = value => (value || "U").split(/[ @._-]/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
export const isOverdue = task => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "DONE";
