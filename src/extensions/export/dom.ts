import { sanitizeFilename } from "./filename";

/** Downloading and printing. Server-safe at import; every function takes the document it works in. */

export type DownloadOptions = {
  /** Extension with its dot. */
  ext: string;
  mime: string;
  /** How long the object URL stays valid, ms. Default 1000. */
  revokeAfterMs?: number;
};

/** Offer `content` as a file. The name is sanitised; the object URL is revoked afterwards. Returns the final name. */
export function downloadText(doc: Document, content: string, filename: string, o: DownloadOptions): string {
  const win = doc.defaultView!;
  const name = sanitizeFilename(filename, { ext: o.ext });
  const url = win.URL.createObjectURL(new Blob([content], { type: o.mime }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.hidden = true;
  (doc.body ?? doc.documentElement).appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), o.revokeAfterMs ?? 1000);
  }
  return name;
}

export type PrintOptions = {
  /** "iframe" (default): print a standalone copy in a hidden iframe. "window": `window.print()` with the `atm-printing` class. */
  mode?: "iframe" | "window";
  /** Replace the print call (tests, hosts with their own print dialog). Gets the window to print. */
  print?: (win: Window) => void;
  /** After print() returns, the frame is removed on `afterprint` or after this many ms. Default 2000. */
  cleanupMs?: number;
  title?: string;
};

/**
 * Print `html` (a standalone document) through a hidden iframe, then remove the frame. Falls back to
 * `window.print()` of the page, with `atm-printing` on <html> and `atm-print-root` on `root`, when
 * a frame cannot be made.
 */
export function printDocument(doc: Document, html: string, root: HTMLElement, o: PrintOptions = {}): "iframe" | "window" {
  const win = doc.defaultView!;
  if (o.mode !== "window") {
    const frame = doc.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("title", o.title ?? "Print");
    // Same origin so the page can call print(); no scripts, no forms, no popups.
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.className = "atm-print-frame";
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.srcdoc = html;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      frame.remove();
    };
    const onLoad = () => {
      const fw = frame.contentWindow;
      if (!fw) return cleanup();
      // Some engines fire a load for the empty initial document first: wait for ours.
      if (!fw.document.querySelector("main.atm-export, body > *")) return;
      frame.removeEventListener("load", onLoad);
      try {
        fw.addEventListener("afterprint", cleanup);
        (o.print ?? ((w: Window) => (w.focus(), w.print())))(fw);
      } catch {
        /* the print dialog is the host's to refuse */
      }
      win.setTimeout(cleanup, o.cleanupMs ?? 2000);
    };
    frame.addEventListener("load", onLoad);
    (doc.body ?? doc.documentElement).appendChild(frame);
    if (frame.contentWindow) return "iframe";
    frame.remove();
  }
  const html0 = doc.documentElement;
  html0.classList.add("atm-printing");
  root.classList.add("atm-print-root");
  const off = () => {
    html0.classList.remove("atm-printing");
    root.classList.remove("atm-print-root");
    win.removeEventListener("afterprint", off);
  };
  win.addEventListener("afterprint", off);
  try {
    (o.print ?? ((w: Window) => w.print()))(win);
  } finally {
    // print() blocks in most engines, so the page is back by now; others fire afterprint later.
    win.setTimeout(off, o.cleanupMs ?? 2000);
  }
  return "window";
}
