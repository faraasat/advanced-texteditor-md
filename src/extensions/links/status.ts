/**
 * What state is a link in? Pure: the manager feeds it the policy check, the wiki lookup and the
 * host's `check` result and shows what comes back.
 *
 *   refused    the link policy would not render it (a `javascript:` URL, a host not on the list)
 *   broken     the page does not exist, or the host's `check` said the address does not work
 *   insecure   an absolute http: address
 *   checking   waiting for `resolve` or `check`
 *   ok         nothing found wrong (or nothing could be checked)
 */
import type { LinkPolicy } from "../../types";
import type { FoundLink } from "./scan";
import type { PageStatus } from "./resolver";
import { isInsecure } from "./edit";

export type LinkStatus = "ok" | "broken" | "insecure" | "refused" | "checking";

export type LinkCheckResult = { ok: boolean; /** Shown beside the status. */ message?: string; status?: number };

export type StatusContext = {
  /** `urlAllowed` from the library; passed in so this module stays tiny. */
  allowed: (url: string, policy: LinkPolicy | undefined, kind: "link" | "image") => boolean;
  policy?: LinkPolicy;
  /** The wiki lookup: the page status when known, and whether a lookup exists at all. */
  page?: (id: string) => PageStatus | undefined;
  hasResolve?: boolean;
  /** The host's check of an http(s) address: a result, "pending", or undefined (not checked). */
  checked?: (url: string) => LinkCheckResult | "pending" | undefined;
  labels: { notFound: string; noAddress: string; refused: string; insecure: string };
};

export function statusOf(link: FoundLink, c: StatusContext): { status: LinkStatus; note?: string } {
  if (link.kind === "wiki") {
    if (!c.hasResolve) return { status: "ok" };
    const s = c.page?.(link.id ?? "");
    if (!s) return { status: "checking" };
    return s.exists ? { status: "ok", note: s.title && s.title !== link.text ? s.title : undefined } : { status: "broken", note: c.labels.notFound };
  }
  if (!link.href) return { status: "broken", note: c.labels.noAddress };
  if (!c.allowed(link.href, c.policy, link.kind === "image" ? "image" : "link")) return { status: "refused", note: c.labels.refused };
  const r = c.checked?.(link.href);
  if (r && r !== "pending" && !r.ok) return { status: "broken", note: r.message };
  if (isInsecure(link.href)) return { status: "insecure", note: c.labels.insecure };
  if (r === "pending") return { status: "checking" };
  return { status: "ok", note: r ? r.message : undefined };
}
