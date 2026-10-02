import type { LinkKind } from "./scan";
import type { LinkStatus } from "./status";

export type LinkManagerLabels = {
  /** Palette and slash-menu entry, and the toolbar button's name. */
  manage: string;
  title: string;
  close: string;
  list: string;
  none: string;
  readOnly: string;
  summary: (s: { total: number; broken: number; insecure: number; refused: number }) => string;
  onlyProblems: string;
  check: string;
  checking: string;
  checked: (n: number, broken: number) => string;
  upgrade: (n: number) => string;
  upgradeAsk: (n: number) => string;
  upgradeConfirm: string;
  upgraded: (n: number) => string;
  cancel: string;
  goTo: string;
  edit: string;
  remove: string;
  removed: (name: string) => string;
  updated: (name: string) => string;
  apply: string;
  fieldText: string;
  fieldAddress: string;
  editing: (name: string) => string;
  errEmpty: string;
  errRefused: string;
  errAuto: string;
  errBare: string;
  notFound: string;
  noAddress: string;
  refused: string;
  insecure: string;
  more: (shown: number, total: number) => string;
  kind: Record<Exclude<LinkKind, "chip">, string>;
  status: Record<LinkStatus, string>;
};

export const DEFAULT_LINK_LABELS: LinkManagerLabels = {
  manage: "Manage links...",
  title: "Links",
  close: "Close",
  list: "Links in this document",
  none: "No links in this document.",
  readOnly: "This document is read-only: links can be inspected, not changed.",
  summary: ({ total, broken, insecure, refused }) => {
    const parts = [`${total} ${total === 1 ? "link" : "links"}`];
    if (broken) parts.push(`${broken} broken`);
    if (insecure) parts.push(`${insecure} insecure`);
    if (refused) parts.push(`${refused} refused`);
    return parts.join(", ");
  },
  onlyProblems: "Show only problems",
  check: "Check links",
  checking: "Checking...",
  checked: (n, b) => `Checked ${n} ${n === 1 ? "address" : "addresses"}: ${b} broken.`,
  upgrade: (n) => `Upgrade ${n} http ${n === 1 ? "link" : "links"} to https`,
  upgradeAsk: (n) => `Rewrite ${n} http ${n === 1 ? "address" : "addresses"} as https? The new addresses are not tested.`,
  upgradeConfirm: "Upgrade",
  upgraded: (n) => `Upgraded ${n} ${n === 1 ? "link" : "links"} to https.`,
  cancel: "Cancel",
  goTo: "Go to",
  edit: "Edit",
  remove: "Remove link",
  removed: (n) => `Removed the link ${n}. The text stays.`,
  updated: (n) => `Updated the link ${n}.`,
  apply: "Apply",
  fieldText: "Text",
  fieldAddress: "Address",
  editing: (n) => `Editing ${n}`,
  errEmpty: "Enter an address.",
  errRefused: "The link policy does not allow this address.",
  errAuto: "An address in angle brackets needs a scheme such as https:// and no spaces.",
  errBare: "An address without brackets must start with http://, https:// or www. and have no spaces.",
  notFound: "Page not found",
  noAddress: "No address",
  refused: "Not allowed by the link policy",
  insecure: "http, not https",
  more: (s, t) => `Showing the first ${s} of ${t} links.`,
  kind: { link: "Link", image: "Image", autolink: "Address", reference: "Definition", wiki: "Page" },
  status: { ok: "OK", broken: "Broken", insecure: "Insecure", refused: "Refused", checking: "Checking" },
};
