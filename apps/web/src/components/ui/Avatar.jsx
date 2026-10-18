import { initials } from "../../lib/formatters";

const palette = [["#e9e6ff", "#4636d2"], ["#e2f0ff", "#1f5fb0"], ["#ffe9ee", "#b32a47"], ["#dff5ea", "#13794f"], ["#fff1d6", "#98600a"]];
export default function Avatar({ name }) {
  const n = (name || "U").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return <span className="avatar" style={{ background: palette[n][0], color: palette[n][1] }} aria-hidden="true">{initials(name)}</span>;
}
