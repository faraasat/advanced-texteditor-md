/**
 * File attachment cards. An uploaded file is a plain link, `[report.pdf](https://x/report.pdf "2.4 MB")`:
 * the size lives in the link TITLE (other renderers show it as a tooltip).
 *
 *  - `wrapUploadHandler(handler)` returns an `UploadOptions.handler` that remembers the size of
 *    every finished upload by its URL. While the plugin is installed, the link the editor inserts
 *    for such an upload gets the size as its title in the SAME undo step as the insertion.
 *  - A link is shown as a card (editor and views) when its text looks like a file name with a
 *    non-image extension, or its title looks like a size: class `atm-file`, `data-atm-file`
 *    (icon group), `data-ext`, `data-atm-size`. Same-origin and relative links get `download`.
 *    The `href` is never changed; the link stays a link.
 */
import type { EditorInstance, Plugin, UploadContext, UploadResult } from "../../types";
import type { Surface } from "../../editor/pane-types";
import { formatBytes, perEditor, surfaceOf } from "../_shared";
import { edit } from "./util";

export type FileGroup = "pdf" | "doc" | "sheet" | "slide" | "archive" | "audio" | "video" | "code" | "text" | "generic";

const GROUPS: Record<Exclude<FileGroup, "generic">, string[]> = {
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "pages"],
  sheet: ["xls", "xlsx", "ods", "csv", "tsv", "numbers"],
  slide: ["ppt", "pptx", "odp", "key"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  audio: ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus"],
  video: ["mp4", "mov", "webm", "mkv", "avi", "m4v", "ogv"],
  code: ["js", "ts", "jsx", "tsx", "json", "html", "css", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "php", "sh", "sql", "xml", "yaml", "yml", "toml"],
  text: ["txt", "md", "log", "ini", "cfg"],
};
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico", "heic", "heif", "tif", "tiff"]);

/** The lower-cased extension of a file name (letters and digits, 1-8 long), or "". */
export function fileExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** The icon group of an extension; null for images (they are never cards). */
export function fileGroup(ext: string): FileGroup | null {
  const e = ext.toLowerCase();
  if (IMAGE.has(e)) return null;
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(e)) return g as FileGroup;
  return "generic";
}

/** Text that reads like a file name: no slash, no line break, at most 255 characters, an extension. */
export function looksLikeFileName(text: string): boolean {
  const t = text.trim();
  return t.length > 2 && t.length <= 255 && !/[\/\\\n<>]/.test(t) && /^[^.\s][^]*\.[A-Za-z0-9]{1,8}$/.test(t);
}

/** A title written by `formatBytes`: `512 B`, `2.4 MB`, `1,2 kB` (any locale's digits and separators). */
export function isSizeTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && title.length <= 24 && /^\d[\d.,   ]*\s?(?:B|kB|MB|GB|TB)$/.test(title.trim());
}

/** Relative or same-origin http(s): a `download` attribute is honoured (and harmless) only there. */
export function isSameOrigin(href: string, base: string | null | undefined): boolean {
  const t = href.trim();
  if (!t) return false;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//");
  if (!absolute) return true;
  if (!base) return false;
  try {
    const u = new URL(t, base);
    return /^https?:$/.test(u.protocol) && u.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** What a link is as a card, or null when it is an ordinary link. */
export function fileCardOf(text: string, href: string, title: string | null): { ext: string; group: FileGroup; size: string | null } | null {
  const size = isSizeTitle(title) ? title!.trim() : null;
  const byName = looksLikeFileName(text) ? fileExt(text) : "";
  let ext = byName;
  if (!ext && size) {
    const path = href.split(/[?#]/)[0];
    ext = fileExt(path.slice(path.lastIndexOf("/") + 1));
  }
  const group = ext ? fileGroup(ext) : size ? "generic" : null;
  if (!group || (!byName && !size)) return null;
  return { ext, group, size };
}

const CARD_ATTRS = ["data-atm-file", "data-ext", "data-atm-size", "download"];

/**
 * Mark every link under `root` that is a file as a card (and unmark links that stopped being one).
 * Never touches `href`, `title` or the link's children, so the stored Markdown cannot change.
 */
export function decorateFileLinks(root: ParentNode, opts: { base?: string | null; download?: boolean } = {}): void {
  const base = opts.base ?? (root as Node).ownerDocument?.defaultView?.location?.href ?? null;
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (a.closest(".atm-chip, .atm-link-card, [data-atm-preview-card]")) continue;
    const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    const card = a.children.length === 0 ? fileCardOf(a.textContent ?? "", href, a.getAttribute("title")) : null;
    if (!card) {
      if (a.classList.contains("atm-file")) {
        a.classList.remove("atm-file");
        for (const n of CARD_ATTRS) a.removeAttribute(n);
      }
      continue;
    }
    a.classList.add("atm-file");
    a.setAttribute("data-atm-file", card.group);
    if (card.ext) a.setAttribute("data-ext", card.ext);
    else a.removeAttribute("data-ext");
    if (card.size) a.setAttribute("data-atm-size", card.size);
    else a.removeAttribute("data-atm-size");
    if (opts.download !== false && isSameOrigin(a.getAttribute("href") ?? "", base)) a.setAttribute("download", looksLikeFileName(a.textContent ?? "") ? (a.textContent ?? "").trim() : "");
    else a.removeAttribute("download");
  }
}

export type FileCardsOptions = {
  /** Locale for the size text (`formatBytes`). */
  locale?: string;
  /** Set `download` on same-origin / relative card links in views. Default true. */
  download?: boolean;
};

export type FileCards = {
  plugin: Plugin;
  /** Wrap your upload handler so the size of each finished upload is remembered by its URL. */
  wrapUploadHandler(handler: (file: File, ctx: UploadContext) => Promise<UploadResult>): (file: File, ctx: UploadContext) => Promise<UploadResult>;
  /** The size text remembered for `url`, if any. */
  sizeOf(url: string): string | undefined;
  /** Mark the file links of a view rendered with `renderHtml` (the plugin's `postRender` does this for `renderDom`). */
  decorate(root: ParentNode): void;
};

/** See the file header. */
export function createFileCards(options: FileCardsOptions = {}): FileCards {
  const sizes = new Map<string, string>();
  const state = perEditor<{ s: Surface | null; orig: Surface["insertAsset"] | null; mo: MutationObserver | null; done: Set<string> }>();

  const wrapUploadHandler: FileCards["wrapUploadHandler"] = (handler) => async (file, ctx) => {
    const res = await handler(file, ctx);
    if (res && typeof res.url === "string" && Number.isFinite(file?.size) && !(res.mime ?? file.type ?? "").startsWith("image/")) {
      const s = formatBytes(file.size, options.locale);
      if (s) sizes.set(res.url, s);
      if (sizes.size > 500) sizes.delete(sizes.keys().next().value as string);
    }
    return res;
  };

  /** Give each link to a remembered upload its size title (inside the caller's step). */
  const titleLinks = (ed: EditorInstance, only?: string): boolean =>
    edit(ed, (ctx) => {
      let changed = false;
      const done = state.get(ed)?.done;
      for (const a of Array.from(ctx.root.querySelectorAll<HTMLAnchorElement>("a[data-href], a[href]"))) {
        const url = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
        if ((only !== undefined && url !== only) || a.getAttribute("title") || !sizes.has(url) || done?.has(url)) continue;
        a.setAttribute("title", sizes.get(url)!);
        done?.add(url);
        changed = true;
      }
      return changed;
    });

  const plugin: Plugin = {
    name: "file-cards",
    postRender(root, { mode }) {
      decorateFileLinks(root, { download: mode === "view" && options.download !== false });
    },
    setup(ed) {
      const st = { s: null as Surface | null, orig: null as Surface["insertAsset"] | null, mo: null as MutationObserver | null, done: new Set<string>() };
      state.set(ed, st);
      const unpatch = () => {
        if (st.s && st.orig) st.s.insertAsset = st.orig;
        st.s = null;
        st.orig = null;
      };
      const attach = () => {
        const pane = ed.getMode() === "wysiwyg" ? (ed.getPane() as Surface | null) : null;
        if (pane && pane !== st.s && typeof pane.insertAsset === "function") {
          unpatch();
          // The size title joins the insertion's undo step: insert and title inside one transaction.
          const orig = pane.insertAsset;
          st.s = pane;
          st.orig = orig;
          pane.insertAsset = (asset) => {
            if (asset.as !== "link" || !sizes.has(asset.url)) return orig.call(pane, asset);
            ed.transact(() => {
              orig.call(pane, asset);
              titleLinks(ed, asset.url);
            });
          };
        }
        st.mo?.disconnect();
        st.mo = null;
        const root = surfaceOf(ed);
        const win = ed.element.ownerDocument.defaultView;
        if (!root || !win || typeof win.MutationObserver !== "function") return;
        let queued = false;
        st.mo = new win.MutationObserver(() => {
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            if (!root.isConnected) return;
            decorateFileLinks(root, { download: false });
          });
        });
        st.mo.observe(root, { childList: true, subtree: true, characterData: true });
        decorateFileLinks(root, { download: false });
      };
      attach();
      const off = ed.on("pane", attach);
      return () => {
        off();
        unpatch();
        st.mo?.disconnect();
        state.delete(ed);
      };
    },
  };

  return {
    plugin,
    wrapUploadHandler,
    sizeOf: (url) => sizes.get(url),
    decorate: (root) => decorateFileLinks(root, { download: options.download !== false }),
  };
}
