"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { choose, consentSnapshot, onDocumentClick, startAnalytics, subscribeConsent, trackingBlocked } from "@/lib/analytics";

/**
 * Starts the privacy-respecting analytics once and offers the consent banner when a choice is still open.
 * Nothing here ships inside the npm package. Do Not Track or Global Privacy Control: nothing runs, no banner.
 */
export function Analytics() {
  const consent = useSyncExternalStore(subscribeConsent, consentSnapshot, () => null);
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    setOffer(startAnalytics(location.pathname.replace(process.env.NEXT_PUBLIC_BASE_PATH ?? "", "") || "/"));
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);
  if (!offer || consent !== null) return null;
  return (
    <div className="consent" role="region" aria-label="Analytics consent">
      <p id="consent-text">
        This demo site counts visits with Aptabase, which is cookieless. May it also use Google Analytics, which sets cookies? The npm package itself
        collects nothing. <Link prefetch={false} href="/privacy/">Privacy</Link>
      </p>
      <div className="consent__actions">
        <button type="button" className="btn btn--primary" onClick={() => choose("granted")}>
          Accept
        </button>
        <button type="button" className="btn" onClick={() => choose("denied")}>
          Decline
        </button>
      </div>
    </div>
  );
}

/** The Privacy page's controls: the current state in words, and the two buttons to change it. */
export function ConsentControls() {
  const consent = useSyncExternalStore(subscribeConsent, consentSnapshot, () => null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => setBlocked(trackingBlocked()), []);
  const status = blocked
    ? "Your browser sends Do Not Track or Global Privacy Control, so no analytics run at all."
    : consent === "granted"
      ? "Google Analytics is on (you accepted)."
      : consent === "denied"
        ? "Google Analytics is off (you declined)."
        : "Google Analytics is off until you choose.";
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <p id="consent-status" role="status" className="sub" style={{ marginBottom: 14 }}>
        {status}
      </p>
      <div className="pg__tools">
        <button type="button" className="btn btn--primary" aria-pressed={consent === "granted"} onClick={() => choose("granted")}>
          Accept Google Analytics
        </button>
        <button type="button" className="btn" aria-pressed={consent === "denied"} onClick={() => choose("denied")}>
          Decline
        </button>
      </div>
    </div>
  );
}
