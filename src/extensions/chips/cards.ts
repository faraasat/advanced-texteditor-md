/**
 * Hover cards for mentions and chips.
 *
 *  - Mouse: hovering a chip opens its card after `delayMs`; the card stays while the pointer
 *    moves into it (a `graceMs` grace period) and closes when it leaves both.
 *  - Keyboard in the editor: chips are atoms, so the caret cannot be "on" one. When the caret sits
 *    right next to a chip, or the chip is selected, its card opens (as the link-preview card does
 *    for a link holding the caret). A card with links is a non-modal dialog: Alt+ArrowDown moves
 *    focus into it, Escape returns focus to the editor at the same caret.
 *  - Read-only views (`postRender` with mode "view": the split preview, `renderDom`,
 *    `hydrateAll`): chips of the configured schemes become focusable buttons. Focus opens the card;
 *    Enter or Space moves focus into a card that has links. Escape closes and focus returns.
 *  - A card without anything to reach is `role="tooltip"`; the chip points at it with
 *    `aria-describedby`, so a screen reader reads it with the chip.
 *
 * Data returned by `getCard` is drawn with `textContent` only. `avatarUrl` and `links[].href` must
 * pass `urlAllowed` with http/https; anything else is dropped. An HTMLElement returned by
 * `getCard` is the host's own markup and inserted as it is.
 *
 * Results are cached per chip (`scheme:kind:id`). The `signal` given to `getCard` aborts when the
 * card closes before it arrived and when the plugin is torn down.
 */
import type { EditorInstance, Plugin, PostRenderContext } from "../../types";
import { surfaceOf } from "../_shared";
import { chipKey, type Chip } from "./wire";
import type { Controller } from "./cards-ui";
import { lazy } from "./lazy";

export type ChipCardData = {
  title: string;
  subtitle?: string;
  avatarUrl?: string;
  fields?: { label: string; value: string }[];
  /** A titled list of plain strings (the members of a group). */
  list?: { label?: string; items: string[] };
  links?: { label: string; href: string }[];
};

export type ChipCardResult = HTMLElement | ChipCardData | null | undefined;

export type ChipCardsLabels = {
  /** Accessible name of a card dialog without a title. Default "Details". */
  card: string;
  /** Shown in a card with links, in the editor. Default "Alt+Down to reach the links". */
  editorHint: string;
  /** Shown in a card with links, in a read-only view. Default "Enter to reach the links". */
  viewHint: string;
  /** "and N more" under a long list. */
  more: (n: number) => string;
};

export type ChipCardsOptions = {
  getCard: (chip: Chip, ctx: { signal: AbortSignal }) => ChipCardResult | Promise<ChipCardResult>;
  /** Hover delay. Default 350 ms. */
  delayMs?: number;
  /** How long the card waits for the pointer to arrive in it. Default 200 ms. */
  graceMs?: number;
  /** Only chips of these schemes get cards. Default: all. */
  schemes?: string[];
  /** Cards kept per plugin. Default 100. */
  cacheSize?: number;
  /** Class prefix of the rendered chips. Default "atm". */
  classPrefix?: string;
  labels?: Partial<ChipCardsLabels>;
};

export function createChipCardsPlugin(options: ChipCardsOptions): Plugin {
  const labels: ChipCardsLabels = {
    card: "Details",
    editorHint: "Alt+Down to reach the links",
    viewHint: "Enter to reach the links",
    more: (n) => `and ${n} more`,
    ...options.labels,
  };
  const p = options.classPrefix ?? "atm";
  const delay = Math.max(0, options.delayMs ?? 350);
  const grace = Math.max(0, options.graceMs ?? 200);
  const schemes = options.schemes?.map((s) => s.toLowerCase());
  const cacheSize = Math.max(1, options.cacheSize ?? 100);
  const cache = new Map<string, ChipCardResult>();
  const pending = new Set<AbortController>();
  const editors = new WeakMap<EditorInstance, { ctl: Controller | null; keydown(ev: KeyboardEvent): boolean }>();
  const views = new WeakMap<Document, Controller>();
  const bound = new WeakSet<HTMLElement>();

  const wants = (el: Element | null): el is HTMLElement =>
    !!el && el.classList.contains(`${p}-chip`) && (!schemes || schemes.includes((el.getAttribute("data-scheme") ?? "").toLowerCase()));

  const remember = (k: string, v: ChipCardResult) => {
    cache.delete(k);
    cache.set(k, v);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };

  async function load(chip: Chip, signal: AbortSignal): Promise<ChipCardResult> {
    const k = chipKey(chip);
    if (cache.has(k)) return cache.get(k);
    let r: ChipCardResult;
    try {
      r = await options.getCard(chip, { signal });
    } catch {
      r = null;
    }
    if (!signal.aborted) remember(k, r ?? null);
    return r ?? null;
  }

  const UI = lazy(() => import("./cards-ui"));
  const withUI = UI.use;
  const env = () => ({ p, labels, delay, grace, wants, load, pending });

  /** Read-only roots: chips become focusable buttons (only there; never inside the surface). */
  function viewRoot(root: HTMLElement) {
    const d = root.ownerDocument;
    const chips = Array.from(root.querySelectorAll<HTMLElement>(`.${p}-chip`)).filter(
      (c) => wants(c) && !bound.has(c) && !c.closest("[contenteditable='true'], [contenteditable='']"),
    );
    if (!chips.length) return;
    for (const c of chips) {
      bound.add(c);
      if (!c.hasAttribute("tabindex")) c.setAttribute("tabindex", "0");
      if (!c.hasAttribute("role")) c.setAttribute("role", "button");
    }
    withUI((m) => {
      let ctl = views.get(d);
      if (!ctl) views.set(d, (ctl = m.controller(env(), d.documentElement, "view")));
      for (const c of chips) ctl.bind(c);
    });
  }

  return {
    name: "chip-cards",
    postRender(root: HTMLElement, ctx: PostRenderContext) {
      if (ctx.mode === "view") viewRoot(root);
    },
    keydown(ev, ed) {
      return editors.get(ed)?.keydown(ev) ?? false;
    },
    setup(ed) {
      const state: {
        ctl: Controller | null;
        keydown(ev: KeyboardEvent): boolean;
      } = {
        ctl: null,
        keydown(ev) {
          const c = state.ctl;
          if (!c || ev.isComposing || !c.isOpen()) return false;
          if (ev.key === "Escape" && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
            c.dismiss();
            return true;
          }
          if (ev.key === "ArrowDown" && ev.altKey && !ev.ctrlKey && !ev.metaKey) return c.enter();
          return false;
        },
      };
      editors.set(ed, state);
      let root: HTMLElement | null = null;
      const attach = () => {
        const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
        if (s === root) return;
        state.ctl?.destroy();
        state.ctl = null;
        root = s;
        if (s)
          withUI((m) => {
            if (root === s && editors.get(ed) === state && !state.ctl) state.ctl = m.controller(env(), s, "editor", ed);
          });
      };
      attach();
      const off = ed.on("pane", attach);
      return () => {
        off();
        state.ctl?.destroy();
        state.ctl = null;
        editors.delete(ed);
        for (const c of pending) c.abort();
        pending.clear();
      };
    },
  };
}
