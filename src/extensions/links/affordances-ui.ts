/**
 * The implementation behind createLinkAffordances and enhanceHeadingAnchors (a lazy chunk: it loads
 * when an editor with the plugin is created or a read-only view is enhanced). See affordances.ts.
 */
import type { EditorInstance } from "../../types";
import { urlAllowed } from "../../features/upload-policy";
import { mirrorTheme } from "../../features/theme-mirror";
import { h, surfaceOf } from "../_shared";
import type { HeadingAnchorsLabels, LinkAffordancesLabels, LinkAffordancesOptions } from "./affordances";

const OPENABLE = { allowedSchemes: ["http", "https", "mailto", "tel"] };
const isMac = (win: Window | null) => /Mac|iPhone|iPad|iPod/i.test(win?.navigator?.platform ?? "");

export function linkAffordances(ed: EditorInstance, options: LinkAffordancesOptions): () => void {
  const L: LinkAffordancesLabels = { open: (m) => `${m}+click to open`, ...options.labels };
  const delay = Math.max(0, options.delayMs ?? 450);
  const d = ed.element.ownerDocument;
  const win = d.defaultView;
  const mod = isMac(win) ? "Cmd" : "Ctrl";
  let root: HTMLElement | null = null;
  let tip: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let anchor: HTMLAnchorElement | null = null;
  const showHint = options.hint !== false && !ed.options.linkPreview;

  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    if (anchor && tip) {
      const rest = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((t) => t && t !== tip!.id);
      if (rest.length) anchor.setAttribute("aria-describedby", rest.join(" "));
      else anchor.removeAttribute("aria-describedby");
    }
    tip?.remove();
    tip = anchor = null;
  };
  const show = (a: HTMLAnchorElement) => {
    hide();
    const href = a.getAttribute("href") ?? "";
    if (!href || !a.isConnected) return;
    anchor = a;
    tip = h(d, "div", { class: "atm-link-hint", role: "tooltip", id: `atm-link-hint-${Math.random().toString(36).slice(2, 8)}` }, h(d, "div", { class: "atm-link-hint-url" }, href.length > 200 ? href.slice(0, 199) + "…" : href), h(d, "div", { class: "atm-link-hint-key" }, L.open(mod)));
    tip.style.position = "fixed";
    mirrorTheme(a, tip);
    d.body.append(tip);
    a.setAttribute("aria-describedby", [a.getAttribute("aria-describedby"), tip.id].filter(Boolean).join(" "));
    const r = a.getBoundingClientRect();
    const w = tip.offsetWidth;
    const vw = win?.innerWidth || 1024;
    tip.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
    tip.style.top = `${r.bottom + 6}px`;
  };
  const linkAt = (t: EventTarget | null): HTMLAnchorElement | null => {
    const a = (t as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    return a && root?.contains(a) ? a : null;
  };
  const onClick = (e: Event) => {
    const ev = e as MouseEvent;
    const a = linkAt(ev.target);
    if (!a || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey) return;
    const href = a.getAttribute("href") ?? "";
    ev.preventDefault();
    hide();
    if (options.onOpen?.(href, ev)) return;
    if (urlAllowed(href, OPENABLE, "link")) win?.open(a.href, "_blank", "noopener,noreferrer");
  };
  const onOver = (e: Event) => {
    const a = linkAt(e.target);
    if (!a || a === anchor || !showHint) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(a), delay);
  };
  const onOut = (e: Event) => {
    const a = linkAt(e.target);
    if (a && !a.contains((e as MouseEvent).relatedTarget as Node | null)) hide();
  };
  const onFocusIn = (e: Event) => {
    const a = linkAt(e.target);
    if (a && showHint) show(a);
  };
  const mark = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.key === "Escape") hide();
    if (k.key === "Control" || k.key === "Meta") root?.classList.toggle("atm-mod-down", e.type === "keydown");
  };
  const clear = () => root?.classList.remove("atm-mod-down");

  const attach = () => {
    const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
    if (s === root) return;
    detach();
    root = s;
    if (!s) return;
    s.addEventListener("click", onClick);
    s.addEventListener("mouseover", onOver);
    s.addEventListener("mouseout", onOut);
    s.addEventListener("focusin", onFocusIn);
    s.addEventListener("focusout", hide);
    d.addEventListener("keydown", mark, true);
    d.addEventListener("keyup", mark, true);
    win?.addEventListener("blur", clear);
  };
  const detach = () => {
    hide();
    if (!root) return;
    clear();
    root.removeEventListener("click", onClick);
    root.removeEventListener("mouseover", onOver);
    root.removeEventListener("mouseout", onOut);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", hide);
    d.removeEventListener("keydown", mark, true);
    d.removeEventListener("keyup", mark, true);
    win?.removeEventListener("blur", clear);
    root = null;
  };
  attach();
  const off = ed.on("pane", attach);
  return () => {
    off();
    detach();
  };
}

async function copy(d: Document, text: string): Promise<boolean> {
  try {
    await d.defaultView!.navigator.clipboard.writeText(text);
    return true;
  } catch {
    let ok = false;
    const on = (e: ClipboardEvent) => {
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
      ok = !!e.clipboardData;
    };
    d.addEventListener("copy", on, true);
    try {
      ok = (d as Document & { execCommand(c: string): boolean }).execCommand("copy") && ok;
    } catch {
      ok = false;
    } finally {
      d.removeEventListener("copy", on, true);
    }
    return ok;
  }
}

/** The click on a heading anchor: copy `url`, announce it in the heading's live region, report it. */
export async function copyLink(a: HTMLElement, live: HTMLElement, url: string, L: HeadingAnchorsLabels, onDone?: () => void): Promise<void> {
  const ok = await copy(a.ownerDocument, url);
  live.textContent = ok ? L.copied : L.failed;
  a.setAttribute("data-state", ok ? "copied" : "failed");
  setTimeout(() => {
    a.removeAttribute("data-state");
    live.textContent = "";
  }, 1500);
  if (ok) onDone?.();
}
