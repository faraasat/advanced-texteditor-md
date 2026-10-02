/**
 * advanced-texteditor-md/links: wiki links and the link manager.
 *
 *  - createWikiLinks    type `[[`, pick a page, get a chip `[Title](wiki:id)`; broken-page marking
 *                       through the host's `resolve`; `onOpen` on click or Enter
 *  - createLinkManager  a dialog listing every link with its state; edit, remove, go to, and
 *                       upgrade http to https in one undo step ("Manage links..." in the palette)
 *  - findLinks, findWikiIds, findBacklinks   pure, server-safe, linear; take Markdown or a Doc
 *  - createResolver     the batched, cached, abortable page lookup behind `resolve`
 *  - applyEdits, editLink, removeLink, upgradeEdits   pure Markdown edits the manager uses
 *
 * The stored Markdown is a plain link, `[Title](wiki:id)`; nothing here changes the wire format.
 * The library never fetches: pages come from your `search` and `resolve`, addresses from your `check`.
 * Server-safe at import.
 */
export { createWikiLinks, DEFAULT_WIKI_LABELS } from "./wiki";
export type { WikiLinks, WikiLinksOptions, WikiLabels } from "./wiki";
export { createLinkManager, DEFAULT_LINK_LABELS } from "./manager";
export type { LinkManager, LinkManagerOptions, LinkManagerLabels } from "./manager";
export { findLinks, findWikiIds, findBacklinks, chipIdOf, schemeOf } from "./scan";
export type { FoundLink, LinkKind, FindLinksOptions, BacklinkSource, Backlinks } from "./scan";
export { createResolver } from "./resolver";
export type { PageStatus, ResolvePages, Resolver, ResolverOptions } from "./resolver";
export { applyEdits, editLink, removeLink, upgradeEdits, upgradable, canUpgrade, isInsecure, hostAllowed, hostOf, upgradeUrl } from "./edit";
export type { Edit } from "./edit";
export { statusOf } from "./status";
export type { LinkStatus, LinkCheckResult, StatusContext } from "./status";
