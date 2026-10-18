import {pretty} from "../../lib/formatters";
export function StatusBadge({value}){return <span className={'status s-'+(value||'').toLowerCase().replaceAll('_','-')}>● {pretty(value)}</span>}
export function PriorityBadge({value}){return <span className={'priority p-'+(value||'medium').toLowerCase()}>{pretty(value||'MEDIUM')}</span>}
