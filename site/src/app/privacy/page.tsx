import type { Metadata } from "next";
import Link from "next/link";
import { ConsentControls } from "@/components/analytics";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Privacy", description: "How the demo site measures visits, and how to opt out.", alternates: { canonical: `${SITE.url}privacy/` } };

export default function Privacy() {
  return (
      <div className="wrap page page--narrow">
        <h1 id="privacy">Privacy</h1>
        <p className="lead">
          The demo site uses privacy-respecting analytics: <a href="https://aptabase.com">Aptabase</a> (cookieless) and, only with your consent, Google Analytics. The npm package itself collects
          nothing.
        </p>
        <h2>What is measured</h2>
        <ul>
          <li>
            <strong>Aptabase</strong> receives a coarse event with no cookie and nothing stored on your device: page views, playground mode, layout and theme switches, clicks on the copy buttons, and
            clicks on links to GitHub or npm (the host only). It starts when the page loads.
          </li>
          <li>
            <strong>Google Analytics</strong> loads only after you press Accept, with consent mode denied until then. Google states that GA4 does not log or store IP addresses.
          </li>
          <li>Nothing you type into an editor is ever sent. The editors run entirely in your browser.</li>
        </ul>
        <h2>Do Not Track</h2>
        <p>If your browser sends Do Not Track or Global Privacy Control, no analytics run at all and no banner is shown.</p>
        <h2>Your choice</h2>
        <ConsentControls />
        <p className="note">
          The choice is kept in this browser&apos;s local storage. <Link prefetch={false} href="/">Back to the playground</Link>.
        </p>
      </div>
  );
}
