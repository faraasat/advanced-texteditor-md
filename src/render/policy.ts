import type { LinkPolicy } from "../types";

const NEVER = new Set(["javascript", "data", "vbscript"]);
const DEFAULT = ["http", "https", "mailto", "tel"];

const hostOf = (u: string) => {
  const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^/?#@]*@)?([^/?#:]*)/i.exec(u);
  return m ? m[1].toLowerCase() : "";
};

function check(url: string, p: LinkPolicy | undefined, hosts: boolean): boolean {
  // Browsers ignore control characters, spaces and zero-width marks inside the scheme.
  const n = url.replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200d\u2060\ufeff]/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(n);
  if (m) {
    const s = m[1].toLowerCase();
    if (NEVER.has(s) || !(p?.allowedSchemes ?? DEFAULT).some((a) => a.toLowerCase() === s)) return false;
    if (hosts && p?.allowedHosts && (s === "http" || s === "https")) return hostOk(n, p!.allowedHosts!);
    return true;
  }
  if (n.startsWith("//")) return !(hosts && p?.allowedHosts) || hostOk(n, p!.allowedHosts!);
  return p?.allowRelative !== false;
}

function hostOk(u: string, hosts: string[]): boolean {
  const h = hostOf(u);
  return hosts.some((x) => {
    x = x.toLowerCase();
    return x === h || (x.startsWith("*.") && h.endsWith(x.slice(1)));
  });
}

/** The URL to put in href/src, or null when the policy refuses it. */
export function safeUrl(url: string, p: LinkPolicy | undefined, kind: "link" | "image"): string | null {
  if (!check(url, p, true)) return null;
  if (!p?.resolve) return url;
  let r: string;
  try {
    r = p.resolve(url, kind);
  } catch {
    return null;
  }
  return typeof r === "string" && check(r, p, false) ? r : null;
}

export const isExternal = (u: string) => /^(?:https?:)?\/\//i.test(u);
