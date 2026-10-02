// Privacy-respecting analytics for THIS DEMO SITE ONLY. The library never loads or imports this file.
//
//  - Do Not Track or Global Privacy Control: nothing runs, no banner.
//  - Aptabase (cookieless, nothing stored) is sent with one fetch to its documented HTTP endpoint: no third-party script.
//  - Google Analytics loads ONLY after the visitor presses Accept (consent mode defaults to denied first).
//  - Only coarse events are sent. Never editor content. See docs/.research/site-analytics-2026-10-02.md.
import { ANALYTICS } from "./config";

export type Consent = "granted" | "denied" | null;

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** True when the browser asks not to be tracked (Do Not Track or Global Privacy Control). */
export function trackingBlocked(): boolean {
  return safe(() => {
    const n = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean };
    return n.doNotTrack === "1" || (window as Window & { doNotTrack?: string }).doNotTrack === "1" || n.msDoNotTrack === "1" || n.globalPrivacyControl === true;
  }, false);
}

export function getConsent(): Consent {
  const v = safe(() => localStorage.getItem(ANALYTICS.consentKey), null);
  return v === "granted" || v === "denied" ? v : null;
}

// A tiny external store, so the banner and the Privacy page re-render when the choice changes.
const listeners = new Set<() => void>();
let choice: Consent | undefined;
export const subscribeConsent = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
export function consentSnapshot(): Consent {
  if (choice === undefined) choice = getConsent();
  return choice;
}

let session: string | null = null;
let last = 0;
/** In memory only, renewed after an hour of inactivity: the same scheme as the Aptabase SDK. Nothing is stored. */
function sessionId() {
  const now = Date.now();
  if (!session || now - last > 3600_000) session = String(Math.floor(now / 1000)) + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  last = now;
  return session;
}

/** Sends one coarse event. `props` must be short strings or numbers, never editor content. */
export function track(name: string, props?: Record<string, string | number>) {
  if (typeof window === "undefined" || trackingBlocked()) return;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  safe(
    () =>
      fetch(ANALYTICS.aptabaseUrl, {
        method: "POST",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "application/json", "App-Key": ANALYTICS.aptabaseKey },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId: sessionId(),
          eventName: name,
          systemProps: { locale: navigator.language, isDebug: local, appVersion: "", sdkVersion: "inline-http@1" },
          props,
        }),
      }).catch(() => undefined),
    undefined,
  );
}

let gaLoaded = false;
function loadGoogle() {
  if (gaLoaded || trackingBlocked()) return;
  gaLoaded = true;
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  // Consent mode: denied by default, set before any config command; then granted, because we only get here after Accept.
  w.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
  w.gtag("js", new Date());
  w.gtag("config", ANALYTICS.gaId, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
  w.gtag("consent", "update", { analytics_storage: "granted" });
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ANALYTICS.gaId);
  document.head.append(s);
}

/** Records the visitor's choice. Granting loads Google Analytics; declining never does. */
export function choose(value: "granted" | "denied") {
  safe(() => localStorage.setItem(ANALYTICS.consentKey, value), undefined);
  choice = value;
  if (value === "granted") loadGoogle();
  listeners.forEach((l) => l());
}

let started = false;
/** Call once per page load (the layout's <Analytics /> does). Returns whether the consent banner should be offered. */
export function startAnalytics(path: string): boolean {
  if (started) return false;
  started = true;
  if (trackingBlocked()) return false;
  track("page_view", { path });
  const c = getConsent();
  if (c === "granted") loadGoogle();
  return c === null;
}

/** Delegated clicks: copy buttons and links out to GitHub or npm (the host only). */
export function onDocumentClick(e: MouseEvent) {
  const t = e.target instanceof Element ? e.target : null;
  const a = t?.closest("a[href]");
  if (a instanceof HTMLAnchorElement && a.host !== location.host && /(^|\.)(github\.com|npmjs\.com)$/.test(a.hostname)) track("outbound_click", { host: a.hostname });
}
