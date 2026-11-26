import { Check, CheckCheck } from "lucide-react";
import Linkify from "../ui/Linkify";
import { nameOf } from "../../lib/chatTicks";

export const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ✓ sent · ✓✓ delivered · blue ✓✓ read (like WhatsApp). */
export function Ticks({ status }) {
  const Icon = status === "sent" ? Check : CheckCheck;
  return <span className={"ticks " + status} title={status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent"} aria-label={status}><Icon size={15} /></span>;
}

/** Message text with @mentions highlighted. */
export function Body({ text, members, meId }) {
  const names = [...members.map((u) => nameOf(u)), "everyone", "all"].sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(@(?:${names.map(esc).join("|")}))(?![\\w])`, "gi"));
  return <>{parts.map((p, i) => {
    if (!p.startsWith("@")) return <Linkify key={i} text={p} />;
    const w = p.slice(1).toLowerCase();
    const u = members.find((m) => nameOf(m).toLowerCase() === w);
    if (!u && w !== "all" && w !== "everyone") return <span key={i}>{p}</span>;
    return <mark key={i} className={"mention" + (!u || u.id === meId ? " me" : "")}>{p}</mark>;
  })}</>;
}

