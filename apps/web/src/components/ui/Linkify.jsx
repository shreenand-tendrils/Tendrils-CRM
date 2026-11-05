// Turns any http(s):// or www. address inside plain text into a clickable link (opens in a new tab).
// Used wherever user text is shown (descriptions, comments, titles, chat, notes), so old and new text behave the same.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;

function split(raw) {
  let url = raw, tail = "";
  for (;;) {
    const last = url.slice(-1);
    const unbalanced = last === ")" ? (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length : /[.,;:!?\]}]/.test(last);
    if (!unbalanced) break;
    tail = last + tail; url = url.slice(0, -1);
  }
  return [url, tail];
}

export default function Linkify({ text = "" }) {
  const parts = String(text).split(URL_RE);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p ? <span key={i}>{p}</span> : null;
        const [url, tail] = split(p);
        if (url.length < 5) return <span key={i}>{p}</span>;
        const href = /^www\./i.test(url) ? `https://${url}` : url;
        return (
          <span key={i}>
            <a className="auto-link" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{url}</a>{tail}
          </span>
        );
      })}
    </>
  );
}
