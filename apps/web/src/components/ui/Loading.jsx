import { LoaderCircle } from "lucide-react";

// One loading indicator for every page/panel (replaces the plain "Loading…" text variants).
export default function Loading({ text = "Loading…" }) {
  return <div className="loading-line" role="status"><LoaderCircle size={16} className="spin" /><span>{text}</span></div>;
}
