/**
 * Writing to the clipboard, with fallbacks. Server-safe at import.
 *
 * Order: `navigator.clipboard.write([ClipboardItem])` (text/plain AND text/html), or `writeText`
 * for a text-only payload; when that is missing or refused (no permission, an insecure context, no
 * user gesture, an older browser) a `copy` event is run on a hidden, selected textarea and its
 * `clipboardData` is filled with `setData`. The page's selection and focus are restored afterwards.
 */

export type CopyPayload = { text: string; html?: string };
export type CopyMethod = "clipboard-item" | "write-text" | "copy-event";
export type CopyResult = { ok: true; method: CopyMethod } | { ok: false; method: null };

type ClipboardItemCtor = new (items: Record<string, Blob>) => unknown;

function copyEvent(doc: Document, p: CopyPayload): boolean {
  const win = doc.defaultView;
  if (!win || typeof doc.execCommand !== "function") return false;
  const body = doc.body ?? doc.documentElement;
  const sel = doc.getSelection();
  const saved: Range[] = [];
  if (sel) for (let i = 0; i < sel.rangeCount; i++) saved.push(sel.getRangeAt(i).cloneRange());
  const focused = doc.activeElement as HTMLElement | null;

  const ta = doc.createElement("textarea");
  ta.value = p.text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none";
  body.appendChild(ta);

  let wrote = false;
  const onCopy = (e: Event) => {
    const dt = (e as ClipboardEvent).clipboardData;
    if (!dt) return;
    dt.setData("text/plain", p.text);
    if (p.html !== undefined) dt.setData("text/html", p.html);
    e.preventDefault();
    wrote = true;
  };
  doc.addEventListener("copy", onCopy, true);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ok = doc.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    doc.removeEventListener("copy", onCopy, true);
    ta.remove();
    try {
      focused?.focus?.({ preventScroll: true });
    } catch {
      /* ignore */
    }
    if (sel) {
      sel.removeAllRanges();
      for (const r of saved) sel.addRange(r);
    }
  }
  return wrote || ok;
}

export async function copyToClipboard(p: CopyPayload, doc: Document = document): Promise<CopyResult> {
  const win = doc.defaultView as (Window & typeof globalThis & { ClipboardItem?: ClipboardItemCtor }) | null;
  const nav = win?.navigator;
  const clip = nav?.clipboard;
  if (clip) {
    try {
      if (p.html !== undefined && typeof win?.ClipboardItem === "function" && typeof clip.write === "function") {
        const Item = win.ClipboardItem;
        await clip.write([
          new Item({
            "text/plain": new Blob([p.text], { type: "text/plain" }),
            "text/html": new Blob([p.html], { type: "text/html" }),
          }) as ClipboardItem,
        ]);
        return { ok: true, method: "clipboard-item" };
      }
      if (p.html === undefined && typeof clip.writeText === "function") {
        await clip.writeText(p.text);
        return { ok: true, method: "write-text" };
      }
    } catch {
      /* refused: fall through to the copy event */
    }
  }
  return copyEvent(doc, p) ? { ok: true, method: "copy-event" } : { ok: false, method: null };
}
