import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import Avatar from "../ui/Avatar";
import EmptyState from "../ui/EmptyState";
import ShowMore from "../ui/ShowMore";

/** Compact feed: repeated identical events (same person + same summary) are merged into one row with a count,
 *  and only the latest `limit` rows show until "Show more" is pressed. */
export default function ActivityFeed({ items = [], limit = 8 }) {
  const [shown, setShown] = useState(limit);
  const rows = useMemo(() => {
    const out = [];
    for (const a of items) {
      const prev = out[out.length - 1];
      if (prev && prev.actor?.id === a.actor?.id && prev.summary === a.summary) prev.count += 1;
      else out.push({ ...a, count: 1 });
    }
    return out;
  }, [items]);
  return (
    <div className="feed">
      {rows.slice(0, shown).map((a) => (
        <div className="feed-row" key={a.id}>
          <Avatar name={a.actor?.name || "System"} />
          <span><b>{a.actor?.name || "A team member"}</b> {a.summary}{a.count > 1 ? ` (x${a.count})` : ""}<small>{new Date(a.createdAt).toLocaleString()}</small></span>
        </div>
      ))}
      {rows.length > shown && <ShowMore count={Math.min(limit, rows.length - shown)} onClick={() => setShown(shown + limit)} />}
      {!rows.length && <EmptyState icon={<Activity />} title="No activity yet" text="New changes will show up here." />}
    </div>
  );
}
