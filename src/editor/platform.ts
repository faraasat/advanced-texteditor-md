/**
 * The ONE place that decides which OS the page runs on. The keymap (`Mod` = Cmd or Ctrl), the
 * toolbar tooltips and the emoji hint all read it, so a shortcut hint and the key it describes
 * can never disagree. Server-safe: `navigator` is read only when a function is called.
 */
export type Platform = "mac" | "windows" | "linux" | "other";

export type NavLike = { platform?: string; userAgent?: string; userAgentData?: { platform?: string } };

export function detectPlatform(nav?: NavLike): Platform {
  const n = nav ?? (typeof navigator !== "undefined" ? (navigator as NavLike) : undefined);
  if (!n) return "other";
  // navigator.platform first: it reflects the OS even when the user agent string is overridden
  // (test runners, privacy tools); the rest are fallbacks.
  const s = (n.platform || n.userAgentData?.platform || n.userAgent || "").toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(s)) return "mac";
  if (/win/.test(s)) return "windows";
  if (/linux|x11|cros|android/.test(s)) return "linux";
  return "other";
}

/** True on macOS and iOS: `Mod` is Cmd there. */
export const isApple = (nav?: NavLike): boolean => detectPlatform(nav) === "mac";
