/** Shareable link to a ticket: opens the Tickets page with that ticket's drawer (handled by useDrawers via ?ticket=). */
export function ticketUrl(ticket) {
  return `${window.location.origin}/tickets?ticket=${encodeURIComponent(ticket.id)}`;
}

/** Copies text; falls back to a hidden textarea where the async clipboard API is unavailable (http, older webviews). */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
