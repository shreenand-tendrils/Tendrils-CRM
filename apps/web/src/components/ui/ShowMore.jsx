import { ChevronDown } from "lucide-react";

/** Centered "Show N more" button used under lists (notifications, activity). */
export default function ShowMore({ count, onClick, label }) {
  return (
    <div className="show-more-wrap">
      <button type="button" className="show-more" onClick={onClick}><ChevronDown size={16} aria-hidden="true" />{label || `Show ${count} more`}</button>
    </div>
  );
}
