import { pretty } from "../../lib/formatters";
const STATUS_LABELS = { OPEN: "Open", TRIAGED: "In Progress", IN_PROGRESS: "Open - QA", BLOCKED: "Need more Info", REVIEW: "Review/Test", CLIENT_REVIEW: "Review/Help", RESOLVED: "Resolved", CLOSED: "Closed" };
export function StatusBadge({value}){return <span className={'status s-'+(value||'').toLowerCase().replaceAll('_','-')}>● {STATUS_LABELS[value] || pretty(value)}</span>}
export function PriorityBadge({value}){return <span className={'priority p-'+(value||'medium').toLowerCase()}>{pretty(value||'MEDIUM')}</span>}
