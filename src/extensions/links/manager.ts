/**
 * The link manager: a dialog that lists every link in the document with its state (OK, broken,
 * insecure, refused by the link policy), and lets the author go to a link, edit its text or
 * address, remove it (the text stays) or upgrade `http:` addresses to `https:` in one undo step.
 *
 * The library never fetches anything. A wiki link is checked with the `resolve` you gave
 * `createWikiLinks`; an http(s) address only if you pass `check(url)` (the "Check links" button
 * runs it, four at a time, aborted when the dialog closes).
 *
 * This file is the small part (the plugin); the dialog arrives as a lazy chunk on first use.
 */
import type { EditorInstance, LinkPolicy, Plugin, SlashItem, ToolbarItem } from "../../types";
import type { WikiLinks } from "./wiki";
import { lazy } from "../chips/lazy";
import { DEFAULT_LINK_LABELS, type LinkManagerLabels } from "./labels";
import type { LinkCheckResult } from "./status";

export type { LinkManagerLabels } from "./labels";
export { DEFAULT_LINK_LABELS } from "./labels";

export type LinkManagerOptions = {
  /** The wiki preset whose `resolve` answers wiki links' states. Also sets the wiki scheme. */
  wiki?: WikiLinks;
  /** Check an http(s) address. Return a result or a boolean; a throw means "could not check". */
  check?: (url: string, ctx: { signal: AbortSignal }) => Promise<LinkCheckResult | boolean> | LinkCheckResult | boolean;
  /** The policy to judge addresses by. Default: the editor's `links` option. */
  linkPolicy?: LinkPolicy;
  /**
   * Which hosts "Upgrade to https" may rewrite without asking (exact, or `*.example.com`).
   * Default `"all"`: every upgradable address, after a confirmation step.
   */
  upgradeHosts?: string[] | "all";
  /** Simultaneous `check` calls. Default 4. */
  checkConcurrency?: number;
  /** Rows drawn. Default 500. */
  maxLinks?: number;
  /** Key that opens the dialog, e.g. "Mod-Alt-l". Default none (use the palette or the slash menu). */
  shortcut?: string | false;
  /** Add a toolbar button. Default false. */
  toolbar?: boolean;
  /** Add "Manage links..." to the slash menu and the command palette. Default true. */
  slash?: boolean;
  labels?: Partial<LinkManagerLabels>;
};

export type LinkManager = Plugin & {
  /** Open the dialog for `editor` (default: the first editor the plugin was set up in). */
  open(editor?: EditorInstance): void;
  close(): void;
  isOpen(): boolean;
};

const UI = /* @__PURE__ */ lazy(() => import("./manager-ui"));

const ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.8 4.3 9 3.1a3.2 3.2 0 0 1 4.5 4.5l-1.8 1.8a3.2 3.2 0 0 1-4.3.2l.9-1a1.8 1.8 0 0 0 2.4-.1l1.8-1.8a1.8 1.8 0 0 0-2.5-2.5l-.9.9a4 4 0 0 0-1.3-.1ZM8.2 11.7 7 12.9a3.2 3.2 0 0 1-4.5-4.5l1.8-1.8a3.2 3.2 0 0 1 4.3-.2l-.9 1a1.8 1.8 0 0 0-2.4.1L3.5 9.3a1.8 1.8 0 0 0 2.5 2.5l.9-.9c.4.1.9.1 1.3.8Z"/></svg>';

export function createLinkManager(options: LinkManagerOptions = {}): LinkManager {
  const labels: LinkManagerLabels = { ...DEFAULT_LINK_LABELS, ...options.labels };
  const editors = new Set<EditorInstance>();
  let handle: { close(): void; isOpen(): boolean } | null = null;
  const openFor = (ed?: EditorInstance) => {
    const target = ed ?? editors.values().next().value;
    if (!target) return;
    UI.use((m) => {
      handle?.close();
      handle = m.openLinkManager(target, options, labels, () => (handle = null));
    });
  };
  const slash: SlashItem[] = options.slash === false ? [] : [{ id: "links-manage", label: labels.manage, description: "List, check and fix every link", keywords: ["links", "urls", "broken", "https", "manage"], icon: ICON, run: (ed) => openFor(ed) }];
  const toolbar: ToolbarItem[] = options.toolbar ? [{ id: "links-manage", label: labels.manage, icon: ICON, command: "links:manage", group: "plugins" }] : [];
  const plugin: LinkManager = {
    name: "link-manager",
    commands: { "links:manage": (ed) => (openFor(ed), true) },
    slash: slash.length ? slash : undefined,
    toolbar: toolbar.length ? toolbar : undefined,
    keymap: options.shortcut ? { [options.shortcut]: (ed) => (openFor(ed), true) } : undefined,
    setup(ed) {
      editors.add(ed);
      return () => {
        editors.delete(ed);
        if (!editors.size) {
          handle?.close();
          handle = null;
        }
      };
    },
    open: openFor,
    close: () => handle?.close(),
    isOpen: () => !!handle?.isOpen(),
  };
  return plugin;
}
