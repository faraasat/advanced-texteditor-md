import { h } from "../_shared";
import { parseDiagramMeta } from "./meta";
import { sanitizeMarkup } from "./sanitize";
import type { DiagramContext, DiagramOutput, DiagramRenderer, DiagramsLabels, DiagramsOptions } from "./types";

export const DEFAULT_LABELS: DiagramsLabels = {
  diagram: "{lang} diagram",
  loading: "Rendering diagram…",
  error: "Could not render the diagram",
  stale: "Showing the last good render",
  showSource: "Show source",
  hideSource: "Hide source",
  showCode: "Show code",
  hideCode: "Hide code",
  insert: "Diagram",
};

export type Engine = {
  readonly renderers: ReadonlyMap<string, DiagramRenderer>;
  readonly labels: DiagramsLabels;
  readonly mode: "replace" | "below";
  readonly debounceMs: number;
  has(lang: string): boolean;
  mount(spec: MountSpec): Block;
  destroy(): void;
};

export type MountSpec = {
  lang: string;
  code: string;
  meta: string;
  /** The wrapper carrying `data-state`, `data-stale`. */
  wrap: HTMLElement;
  /** The `role="img"` element the output goes into. */
  canvas: HTMLElement;
  /** A polite live region for the error text. */
  status: HTMLElement;
  /** Debounce in ms for later updates (the first render is immediate). */
  delay: number;
  /** Called whenever the state or the content of the canvas changed (the editor re-measures). */
  onState?: () => void;
};

export type Block = {
  update(code: string, meta: string): void;
  /** Hold re-rendering (an IME composition); `resume` renders the latest code. */
  hold(): void;
  resume(): void;
  destroy(): void;
};

class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  get size(): number {
    return this.m.size;
  }
}

type Cached = { node: Node } | { html: string };

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isNode = (v: unknown): v is Element => !!v && typeof v === "object" && (v as Node).nodeType === 1 && typeof (v as Node).cloneNode === "function";
const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";
const RATIO = /^\d{1,4}(\.\d{1,3})?\s*\/\s*\d{1,4}(\.\d{1,3})?$/;
let counter = 0;

/** `light` or `dark`: the nearest `data-atm-theme`, else the OS preference. */
export function themeOf(el: Element): "light" | "dark" {
  const t = el.closest("[data-atm-theme]")?.getAttribute("data-atm-theme");
  if (t === "dark" || t === "light") return t;
  try {
    return el.ownerDocument.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function labelFor(labels: DiagramsLabels, lang: string, meta: Record<string, string>): string {
  const title = (meta.title ?? "").trim().slice(0, 200);
  return title || labels.diagram.replace("{lang}", cap(lang));
}

export function createEngine(options: DiagramsOptions): Engine {
  const renderers = new Map<string, DiagramRenderer>();
  for (const k of Object.keys(options.renderers ?? {})) {
    const f = (options.renderers as Record<string, unknown>)[k];
    if (typeof f === "function") renderers.set(k.trim().toLowerCase(), f as DiagramRenderer);
  }
  const trustAll = options.trust === true;
  const trustMap = new Map<string, boolean>();
  if (options.trust && typeof options.trust === "object") for (const k of Object.keys(options.trust)) trustMap.set(k.toLowerCase(), options.trust[k] === true);
  const labels: DiagramsLabels = { ...DEFAULT_LABELS, ...options.labels };
  const debounceMs = Math.max(0, options.debounceMs ?? 300);
  const cache = new Lru<Cached>(Math.max(1, options.cacheSize ?? 50));
  const lazy = options.lazy !== false;
  const frame = options.frame ?? {};
  const live = new Set<Block>();
  const ios = new Map<Document, { io: IntersectionObserver; cbs: Map<Element, () => void> }>();

  const trusted = (lang: string) => trustAll || trustMap.get(lang) === true;

  const watch = (el: Element, cb: () => void): (() => void) => {
    const win = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const IO = lazy ? win?.IntersectionObserver : undefined;
    if (!IO) {
      cb();
      return () => {};
    }
    let rec = ios.get(el.ownerDocument);
    if (!rec) {
      const cbs = new Map<Element, () => void>();
      const io = new IO((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const f = cbs.get(e.target);
          if (f) {
            cbs.delete(e.target);
            io.unobserve(e.target);
            f();
          }
        }
      });
      rec = { io, cbs };
      ios.set(el.ownerDocument, rec);
    }
    rec.cbs.set(el, cb);
    rec.io.observe(el);
    const r = rec;
    return () => {
      r.cbs.delete(el);
      r.io.unobserve(el);
    };
  };

  function realize(out: DiagramOutput, lang: string, doc: Document, title: string): Node {
    if (typeof out === "string") {
      if (trusted(lang)) {
        const box = h(doc, "div", { class: "atm-diagram__markup" });
        box.append(sanitizeMarkup(out, doc));
        return box;
      }
      // Untrusted markup: a sandbox with NO allowances (no scripts, no same-origin, no forms, no
      // popups), a CSP that forbids any request, and no referrer. It is inert whatever it contains.
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;
      const srcdoc = `<!doctype html><html><head><meta charset="utf-8">${csp}<style>html,body{margin:0;background:transparent}svg,img{max-width:100%;height:auto}</style></head><body>${out}</body></html>`;
      const f = h(doc, "iframe", { class: "atm-diagram__frame", sandbox: "", srcdoc, loading: "lazy", referrerpolicy: "no-referrer", title });
      const hpx = Number(frame.height);
      if (Number.isFinite(hpx) && hpx > 0 && hpx < 5000) f.style.height = `${Math.round(hpx)}px`;
      if (typeof frame.aspectRatio === "string" && RATIO.test(frame.aspectRatio.trim())) f.style.aspectRatio = frame.aspectRatio.trim();
      return f;
    }
    if (isNode(out)) {
      if (out.localName.toLowerCase() === "script") throw new TypeError("a diagram renderer returned a <script> element");
      return out;
    }
    throw new TypeError("a diagram renderer must return an element, an SVG element or a string");
  }

  function mount(spec: MountSpec): Block {
    const { lang, wrap, canvas, status } = spec;
    const doc = wrap.ownerDocument;
    const id = `atm-diagram-${++counter}`;
    canvas.id = canvas.id || id;
    let want = spec.code;
    let metaStr = spec.meta;
    let shown: string | null = null; // the code the canvas currently shows
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let visible = false;
    let dirty = true;
    let held = false;
    let destroyed = false;
    let first = true;
    let lastError = "";
    let unwatch: () => void = () => {};

    const setState = (s: string) => {
      wrap.setAttribute("data-state", s);
      canvas.setAttribute("aria-busy", s === "loading" ? "true" : "false");
      spec.onState?.();
    };
    const ctxOf = (signal: AbortSignal): DiagramContext => ({ lang, meta: parseDiagramMeta(metaStr), signal, theme: themeOf(wrap), id });

    const clearError = () => {
      if (lastError) status.textContent = "";
      lastError = "";
      wrap.removeAttribute("data-stale");
    };

    const show = (node: Node, code: string) => {
      canvas.replaceChildren(node);
      shown = code;
      clearError();
      setState("ready");
    };

    const fail = (e: unknown, ctx: DiagramContext) => {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = `${labels.error}: ${raw.slice(0, 500)}`;
      const hasOld = canvas.firstChild !== null;
      if (hasOld) wrap.setAttribute("data-stale", "true");
      // Only announce when the text really changes: typing in a broken block must not chatter.
      if (msg !== lastError) {
        status.textContent = hasOld ? `${msg} (${labels.stale})` : msg;
        lastError = msg;
      }
      setState("error");
      try {
        options.onError?.(e, ctx);
      } catch {
        /* a throwing handler must not break rendering */
      }
    };

    const run = () => {
      timer = null;
      if (destroyed) return;
      ctrl?.abort();
      const my = (ctrl = new AbortController());
      const code = want;
      const ctx = ctxOf(my.signal);
      dirty = false;
      const key = [lang, ctx.theme, metaStr, code].join("\u0000");
      const hit = cache.get(key);
      const finish = (out: DiagramOutput, store: boolean) => {
        const node = realize(out, lang, doc, canvas.getAttribute("aria-label") ?? "");
        if (store) {
          if (typeof out === "string") cache.set(key, { html: out });
          else cache.set(key, { node: out.cloneNode(true) });
        }
        show(node, code);
      };
      if (hit) {
        try {
          finish("html" in hit ? hit.html : ((hit.node.cloneNode(true) as unknown) as HTMLElement), false);
          return;
        } catch {
          /* fall through and render again */
        }
      }
      setState("loading");
      let res: DiagramOutput | PromiseLike<DiagramOutput>;
      try {
        res = renderers.get(lang)!(code, ctx);
      } catch (e) {
        fail(e, ctx);
        return;
      }
      if (!isThenable(res)) {
        try {
          finish(res, true);
        } catch (e) {
          fail(e, ctx);
        }
        return;
      }
      res.then(
        (out) => {
          if (my.signal.aborted || destroyed) return;
          try {
            finish(out, true);
          } catch (e) {
            fail(e, ctx);
          }
        },
        (e) => {
          if (my.signal.aborted || destroyed) return;
          fail(e, ctx);
        },
      );
    };

    const schedule = () => {
      if (destroyed || held) return;
      if (!visible) {
        dirty = true;
        return;
      }
      if (timer) clearTimeout(timer);
      if (first || spec.delay <= 0) {
        first = false;
        run();
      } else timer = setTimeout(run, spec.delay);
    };

    const block: Block = {
      update(code, meta) {
        if (destroyed) return;
        if (code === want && meta === metaStr) return; // already shown, pending or in flight
        want = code;
        metaStr = meta;
        if (held) {
          dirty = true;
          return;
        }
        schedule();
      },
      hold() {
        held = true;
        if (timer) clearTimeout(timer);
        timer = null;
      },
      resume() {
        held = false;
        if (want !== shown || dirty) schedule();
      },
      destroy() {
        destroyed = true;
        if (timer) clearTimeout(timer);
        ctrl?.abort();
        unwatch();
        live.delete(block);
      },
    };
    live.add(block);
    setState("idle");
    unwatch = watch(wrap, () => {
      visible = true;
      if (dirty) schedule();
    });
    // No IntersectionObserver: `watch` ran the callback already, `visible` is true and the first render ran.
    return block;
  }

  return {
    renderers,
    labels,
    mode: options.mode === "below" ? "below" : "replace",
    debounceMs,
    has: (l) => renderers.has(l),
    mount,
    destroy() {
      for (const b of Array.from(live)) b.destroy();
      for (const r of ios.values()) r.io.disconnect();
      ios.clear();
    },
  };
}

/** The language of a rendered or surface `<pre>`, lower-cased ("" when there is none). */
export function langOf(pre: Element): string {
  const code = pre.querySelector("code");
  const raw = pre.getAttribute("data-lang") ?? code?.getAttribute("data-lang") ?? /(?:^|\s)language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "";
  return raw.trim().toLowerCase();
}

/** The code of a `<pre>`: its text, with `<br>` as a line break and one trailing newline dropped. */
export function codeOf(pre: Element): string {
  const root = pre.querySelector("code") ?? pre;
  let s = "";
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) s += (c as Text).data;
      else if (c.nodeType === 1) {
        if ((c as Element).localName === "br") {
          if (c.nextSibling) s += "\n";
        } else if (!(c as Element).hasAttribute("data-atm-preview-card")) walk(c);
      }
    }
  };
  walk(root);
  return s.replace(/​/g, "").replace(/\n$/, "");
}
