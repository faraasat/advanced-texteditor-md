/**
 * Lint hooks: a host function checks the document's text and returns issues; they are drawn as
 * squiggles, explained in a popover with fix buttons, and reachable from the keyboard.
 *
 * The text and its offsets are defined in ./lint-model.ts (one run per block, joined by "\n").
 * Squiggles use the CSS Custom Highlight API (one registry name per editor and severity,
 * `atm-lint-<n>-error|warning|info`, with `::highlight()` rules injected per editor), or, where it
 * is missing, boxes in an overlay that is a child of `editor.element` and never inside the surface.
 *
 * Keys (none clash with the built-in keymap): Alt+F8 next issue, Shift+Alt+F8 previous issue
 * (the caret moves to it, the popover opens and the issue is announced), Alt+Enter moves focus to
 * the popover's fix buttons, Escape there returns to the text. The popover also opens when the
 * caret enters an issue and on hover. A fix replaces exactly that range (one undo step) and the
 * document is checked again. Edits made before the next check carry the issues along (or drop the
 * ones they touched); a check still running when the text changes, or the editor is destroyed, is
 * aborted and its answer ignored.
 *
 * The Markdown pane cannot show highlights and its offsets are source offsets, so checks run in
 * the Write (WYSIWYG) view only; in Markdown and split mode the status item says so.
 */
import type { EditorInstance, Plugin } from "../../types";
import { h, surfaceOf } from "../_shared";
import { collectText, offsetOf, rangeFor, remapIssues, sanitizeIssues, type CleanIssue, type LintIssue, type LintSeverity, type TextModel } from "./lint-model";
import { byElement, highlightApi, listen, liveRegion, nextId, rangeIn, select } from "./util";

export type LintInput = { text: string; markdown: string; blocks: { text: string; offset: number }[] };

export type LintLabels = {
  /** The status item and the editor's description. */
  status: (count: number) => string;
  issue: (index: number, count: number, message: string, fixes: number) => string;
  none: string;
  popover: string;
  severity: Record<LintSeverity, string>;
  markdownLimit: string;
};

export type LintOptions = {
  lint: (input: LintInput, ctx: { signal: AbortSignal }) => LintIssue[] | Promise<LintIssue[]>;
  /** Pause after an edit before checking, ms. Default 500. */
  debounceMs?: number;
  /** Check code blocks and inline code too. Default false. */
  includeCode?: boolean;
  /** "auto" (default): the Highlight API when present. false: always the overlay. */
  highlightApi?: "auto" | boolean;
  /** Keep at most this many issues. Default 1000. */
  maxIssues?: number;
  /** Show the issue count in the status bar. Default true. */
  statusItem?: boolean;
  labels?: Partial<LintLabels>;
};

export type { LintIssue, LintSeverity, CleanIssue };

export const LINT_EVENT = "plugin:writing:lint";

const DEFAULTS: LintLabels = {
  status: (n) => (n === 0 ? "No issues" : `${n} issue${n === 1 ? "" : "s"}; Alt+F8 next`),
  issue: (i, n, m, f) => `Issue ${i} of ${n}: ${m}${f ? `. ${f} fix${f === 1 ? "" : "es"}, Alt+Enter to choose` : ""}`,
  none: "No issues",
  popover: "Issue",
  severity: { error: "Error", warning: "Warning", info: "Note" },
  markdownLimit: "Checks are shown in the Write view",
};

const SEVS: LintSeverity[] = ["error", "warning", "info"];
const COLORS: Record<LintSeverity, string> = { error: "var(--atm-writing-lint-error, #cf222e)", warning: "var(--atm-writing-lint-warning, #bf8700)", info: "var(--atm-writing-lint-info, var(--atm-accent, #0969da))" };

type S = { next(delta: number): boolean; focusFixes(): boolean };

export function createLintPlugin(options: LintOptions): Plugin {
  const labels: LintLabels = { ...DEFAULTS, ...options.labels, severity: { ...DEFAULTS.severity, ...options.labels?.severity } };
  const debounce = Math.max(0, options.debounceMs ?? 500);
  const includeCode = !!options.includeCode;
  const states = new WeakMap<EditorInstance, S>();
  const rerender = new WeakMap<HTMLElement, () => void>();

  return {
    name: "writing-lint",
    commands: {
      "lint:next": (ed) => !!states.get(ed)?.next(1),
      "lint:previous": (ed) => !!states.get(ed)?.next(-1),
      "lint:fixes": (ed) => !!states.get(ed)?.focusFixes(),
    },
    keymap: { "Alt-F8": "lint:next", "Shift-Alt-F8": "lint:previous", "Alt-Enter": "lint:fixes" },
    postRender: (root, ctx) => ctx.mode === "editor" && byElement(root, rerender)?.(),
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView;
      const id = nextId();
      const names = Object.fromEntries(SEVS.map((s) => [s, `atm-lint-${id}-${s}`])) as Record<LintSeverity, string>;
      const live = liveRegion(ed, "lint");
      let issues: CleanIssue[] = [];
      let model: TextModel | null = null;
      let version = 0;
      let ctl: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;
      let composing = false;
      let style: HTMLStyleElement | null = null;
      let overlay: HTMLElement | null = null;
      let pop: HTMLElement | null = null;
      let popIssue: CleanIssue | null = null;
      let popBy: "caret" | "hover" | "key" = "caret";
      let hoverTimer: ReturnType<typeof setTimeout> | null = null;

      const wysiwyg = () => ed.getMode() === "wysiwyg" && !!surfaceOf(ed);
      const api = () => (options.highlightApi === false ? null : highlightApi(win));

      /* ── status: a status-bar item, and the editor's description for screen readers ── */
      const bar = options.statusItem === false ? null : el.querySelector<HTMLElement>(".atm-statusbar");
      const statusEl = bar ? h(doc, "span", { class: "atm-writing-lint-status", "aria-live": "off" }) : null;
      if (statusEl) bar!.appendChild(statusEl);
      const descId = `atm-lint-desc-${id}`;
      const desc = h(doc, "span", { id: descId, class: "atm-writing-sr" });
      el.appendChild(desc);
      let described: HTMLElement | null = null;
      const describe = () => {
        const s = surfaceOf(ed);
        if (!s || s === described) return;
        described = s;
        const cur = (s.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        if (!cur.includes(descId)) s.setAttribute("aria-describedby", [...cur, descId].join(" "));
      };
      const undescribe = () => {
        if (!described) return;
        const rest = (described.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((t) => t && t !== descId);
        if (rest.length) described.setAttribute("aria-describedby", rest.join(" "));
        else described.removeAttribute("aria-describedby");
        described = null;
      };
      const status = () => {
        const t = wysiwyg() ? labels.status(issues.length) : labels.markdownLimit;
        if (statusEl) {
          statusEl.textContent = t;
          statusEl.setAttribute("data-count", String(issues.length));
        }
        desc.textContent = t;
        describe();
      };

      /* ── painting ── */
      const clearPaint = () => {
        const a = api();
        if (a) for (const s of SEVS) a.highlights.delete(names[s]);
        overlay?.replaceChildren();
      };
      const ranges = (): { r: Range; i: CleanIssue }[] => {
        const out: { r: Range; i: CleanIssue }[] = [];
        if (!model) return out;
        for (const i of issues) {
          const r = rangeFor(model, i.from, i.to, doc);
          if (r) out.push({ r, i });
        }
        return out;
      };
      const paint = () => {
        clearPaint();
        if (!wysiwyg() || !issues.length || destroyed) return;
        const list = ranges();
        const a = api();
        if (a) {
          for (const s of SEVS) {
            const rs = list.filter((x) => x.i.severity === s).map((x) => x.r);
            if (rs.length) a.highlights.set(names[s], new a.H(...rs));
          }
          if (!style) {
            style = h(doc, "style", { "data-atm-lint-highlight": String(id) });
            style.textContent = SEVS.map((s) => `::highlight(${names[s]}){text-decoration:underline wavy ${COLORS[s]};text-decoration-skip-ink:none;text-underline-offset:3px}`).join("\n") + `\n@media print{${SEVS.map((s) => `::highlight(${names[s]}){text-decoration:none}`).join("")}}`;
            (doc.head ?? doc.documentElement).appendChild(style);
          }
          return;
        }
        overlay ??= el.appendChild(h(doc, "div", { class: "atm-lint-overlay", "aria-hidden": "true" }));
        const base = el.getBoundingClientRect();
        const frag = doc.createDocumentFragment();
        for (const { r, i } of list.slice(0, 1500)) {
          for (const rc of typeof r.getClientRects === "function" ? Array.from(r.getClientRects()) : []) {
            const d = h(doc, "div", { class: `atm-lint-mark atm-lint-${i.severity}` });
            d.style.cssText = `left:${rc.left - base.left}px;top:${rc.top - base.top}px;width:${rc.width}px;height:${rc.height}px`;
            frag.appendChild(d);
          }
        }
        overlay.appendChild(frag);
      };

      /* ── checking ── */
      const abort = () => {
        ctl?.abort();
        ctl = null;
      };
      const reset = () => {
        abort();
        if (timer) clearTimeout(timer);
        timer = null;
        issues = [];
        model = null;
        clearPaint();
        closePop();
        status();
      };
      const run = () => {
        timer = null;
        if (destroyed || composing) return;
        if (!wysiwyg()) return reset();
        abort();
        model = collectText(surfaceOf(ed)!, includeCode);
        const m = model;
        const v = ++version;
        const c = new AbortController();
        ctl = c;
        const input: LintInput = { text: m.text, markdown: ed.getValue(), blocks: m.blocks.map((b) => ({ ...b })) };
        Promise.resolve()
          .then(() => options.lint(input, { signal: c.signal }))
          .then(
            (res) => {
              if (c.signal.aborted || v !== version || destroyed) return;
              ctl = null;
              issues = sanitizeIssues(res, m.text.length, options.maxIssues ?? 1000);
              paint();
              status();
              syncPop();
              ed.emit(LINT_EVENT, { count: issues.length, issues: issues.map((i) => ({ ...i, fixes: i.fixes.map((f) => ({ ...f })) })) });
            },
            (e) => {
              if (!c.signal.aborted && typeof console !== "undefined") console.error(e);
            },
          );
      };
      const schedule = (ms = debounce) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, ms);
      };
      /** The text changed: carry the issues along, abort a running check, check again soon. */
      const onEdit = () => {
        if (destroyed || composing) return;
        if (!wysiwyg()) return reset();
        version++;
        abort();
        const next = collectText(surfaceOf(ed)!, includeCode);
        if (model) issues = remapIssues(issues, model.text, next.text);
        model = next;
        paint();
        status();
        syncPop();
        schedule();
      };

      /* ── the popover ── */
      const closePop = () => {
        pop?.remove();
        pop = null;
        popIssue = null;
      };
      const issueRect = (i: CleanIssue): DOMRect | null => {
        const r = model && rangeFor(model, i.from, i.to, doc);
        const rects = r && typeof r.getClientRects === "function" ? r.getClientRects() : null;
        return rects && rects.length ? rects[rects.length - 1] : (r?.getBoundingClientRect?.() ?? null);
      };
      const applyFix = (i: CleanIssue, replacement: string) => {
        if (ed.isReadOnly() || !model || !wysiwyg()) return;
        const r = rangeFor(model, i.from, i.to, doc);
        // A stale issue (its text is no longer what was checked) is not applied: check again instead.
        if (!r || r.toString().replace(/\u200b/g, "") !== model.text.slice(i.from, i.to)) return schedule(0);
        closePop();
        surfaceOf(ed)!.focus({ preventScroll: true });
        select(r);
        ed.transact(() => ed.insertText(replacement));
        schedule(0);
      };
      const openPop = (i: CleanIssue, by: "caret" | "hover" | "key") => {
        if (popIssue === i && pop) return;
        closePop();
        // jsdom and a detached range have no boxes: fall back to the surface's.
        const rect = issueRect(i) ?? surfaceOf(ed)?.getBoundingClientRect();
        if (!rect) return;
        popIssue = i;
        popBy = by;
        const fixes = h(doc, "div", { class: "atm-lint-fixes" });
        for (const f of i.fixes) {
          const b = h(doc, "button", { type: "button", class: "atm-writing-btn", "data-fix": "" }, f.label);
          b.addEventListener("click", () => applyFix(i, f.replacement));
          fixes.appendChild(b);
        }
        pop = h(
          doc,
          "div",
          { class: `atm-lint-popover atm-lint-${i.severity}`, role: "dialog", "aria-label": labels.popover },
          h(doc, "p", { class: "atm-lint-msg" }, h(doc, "strong", {}, labels.severity[i.severity]), " ", i.message),
          i.fixes.length ? fixes : null,
        );
        pop.addEventListener("mousedown", (e) => {
          if ((e.target as Element).closest("button")) e.preventDefault(); // keep the caret where it is
        });
        pop.addEventListener("mouseenter", () => hoverTimer && (clearTimeout(hoverTimer), (hoverTimer = null)));
        pop.addEventListener("mouseleave", () => popBy === "hover" && hoverClose());
        pop.addEventListener("keydown", (e) => {
          const btns = Array.from(pop!.querySelectorAll("button"));
          const k = btns.indexOf(doc.activeElement as HTMLButtonElement);
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            const r = model && rangeFor(model, i.from, i.to, doc);
            closePop();
            surfaceOf(ed)?.focus({ preventScroll: true });
            if (r) {
              r.collapse(true);
              select(r);
            }
          } else if (/^Arrow(Right|Down|Left|Up)$/.test(e.key) && k >= 0) {
            e.preventDefault();
            btns[(k + (/Right|Down/.test(e.key) ? 1 : btns.length - 1)) % btns.length].focus();
          }
        });
        el.appendChild(pop);
        const base = el.getBoundingClientRect();
        pop.style.top = `${rect.bottom - base.top + 4}px`;
        pop.style.left = `${Math.max(0, Math.min(rect.left - base.left, base.width - (pop.offsetWidth || 240)))}px`;
      };
      const issueAtCaret = (): CleanIssue | null => {
        const s = surfaceOf(ed);
        const r = s && rangeIn(s);
        if (!r || !model) return null;
        const off = offsetOf(model, r.startContainer, r.startOffset);
        if (off === null) return null;
        return issues.find((i) => i.from <= off && off <= i.to) ?? null;
      };
      const syncPop = () => {
        if (!wysiwyg()) return closePop();
        if (pop && pop.contains(doc.activeElement)) return;
        const i = issueAtCaret();
        if (i) openPop(i, popBy === "key" && popIssue === i ? "key" : "caret");
        else if (pop && popBy !== "hover") closePop();
      };
      const hoverClose = () => {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          if (pop && popBy === "hover" && !pop.contains(doc.activeElement) && !pop.matches(":hover")) closePop();
        }, 250);
      };
      let moveRaf: ReturnType<typeof setTimeout> | null = null;
      const onMove = (e: Event) => {
        const { clientX: x, clientY: y } = e as MouseEvent;
        if (moveRaf || !issues.length || !wysiwyg()) return;
        moveRaf = setTimeout(() => {
          moveRaf = null;
          for (const { r, i } of ranges().slice(0, 500)) {
            for (const rc of typeof r.getClientRects === "function" ? Array.from(r.getClientRects()) : []) {
              if (x >= rc.left && x <= rc.right && y >= rc.top - 2 && y <= rc.bottom + 4) {
                if (hoverTimer) clearTimeout(hoverTimer);
                hoverTimer = null;
                return openPop(i, "hover");
              }
            }
          }
          if (pop && popBy === "hover") hoverClose();
        }, 60);
      };

      /* ── keyboard ── */
      const next = (delta: number): boolean => {
        if (!wysiwyg()) return live.say(labels.markdownLimit), true;
        if (!issues.length || !model) return live.say(labels.none), true;
        const s = surfaceOf(ed)!;
        const r0 = rangeIn(s);
        const off = r0 && model ? (offsetOf(model, r0.startContainer, r0.startOffset) ?? -1) : -1;
        let k: number;
        if (delta > 0) {
          k = issues.findIndex((i) => i.from > off);
          if (k < 0) k = 0;
        } else {
          k = -1;
          for (let j = issues.length - 1; j >= 0; j--) if (issues[j].from < off) (k = j), (j = -1);
          if (k < 0) k = issues.length - 1;
        }
        const i = issues[k];
        const r = rangeFor(model, i.from, i.to, doc);
        if (!r) return true;
        s.focus({ preventScroll: true });
        popBy = "key";
        popIssue = null;
        select(r);
        r.startContainer.parentElement?.scrollIntoView?.({ block: "nearest" });
        openPop(i, "key");
        live.say(labels.issue(k + 1, issues.length, i.message, i.fixes.length));
        return true;
      };
      const focusFixes = (): boolean => {
        if (!pop) {
          const i = issueAtCaret();
          if (i) openPop(i, "key");
        }
        const b = pop?.querySelector<HTMLButtonElement>("button");
        if (!b) return false;
        b.focus();
        return true;
      };
      states.set(ed, { next, focusFixes });

      /* ── wiring ── */
      const surfaceEvents: (() => void)[] = [];
      const bindSurface = () => {
        surfaceEvents.splice(0).forEach((o) => o());
        const s = surfaceOf(ed);
        if (!s) return;
        surfaceEvents.push(
          listen(s, "mousemove", onMove),
          listen(s, "mouseleave", () => pop && popBy === "hover" && hoverClose()),
        );
      };
      const onPane = () => {
        bindSurface();
        if (wysiwyg()) schedule(0);
        else reset();
      };
      rerender.set(el, () => {
        if (!wysiwyg()) return;
        model = collectText(surfaceOf(ed)!, includeCode);
        paint();
        schedule(0);
      });
      let repaintT: ReturnType<typeof setTimeout> | null = null;
      const repaint = () => {
        if (api() || repaintT) return;
        repaintT = setTimeout(() => {
          repaintT = null;
          paint();
        }, 16);
      };
      const offs = [
        ed.on("change", onEdit),
        ed.on("selection", syncPop),
        ed.on("pane", onPane),
        ed.on("mode", onPane),
        ed.on("blur", () =>
          setTimeout(() => {
            if (pop && !pop.contains(doc.activeElement) && popBy !== "hover") closePop();
          }, 0),
        ),
        listen(el, "compositionstart", () => (composing = true), true),
        listen(el, "compositionend", () => {
          composing = false;
          schedule();
        }, true),
        listen(el, "scroll", repaint, true),
        ...(win ? [listen(win, "resize", repaint)] : []),
      ];
      bindSurface();
      status();
      schedule(0);

      return () => {
        destroyed = true;
        abort();
        if (timer) clearTimeout(timer);
        if (hoverTimer) clearTimeout(hoverTimer);
        if (moveRaf) clearTimeout(moveRaf);
        if (repaintT) clearTimeout(repaintT);
        offs.forEach((o) => o());
        surfaceEvents.forEach((o) => o());
        clearPaint();
        style?.remove();
        overlay?.remove();
        closePop();
        statusEl?.remove();
        undescribe();
        desc.remove();
        live.remove();
        rerender.delete(el);
        states.delete(ed);
      };
    },
  };
}
