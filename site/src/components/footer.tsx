import Link from "next/link";
import { SITE } from "@/lib/config";

export function Footer({ related }: { related?: { label: string; href: string } }) {
  return (
    <footer className="footer">
      <div className="wrap">
        <p>
          MIT © <a href="https://github.com/faraasat">Farasat Ali</a>
        </p>
        <nav aria-label="Footer">
          <a href={`https://github.com/${SITE.repo}`}>Source</a>
          <a href={`https://www.npmjs.com/package/${SITE.name}`}>npm</a>
          <a href={`https://github.com/${SITE.repo}/issues`}>Issues</a>
          {related ? <a href={related.href}>{related.label}</a> : null}
          <Link prefetch={false} href="/docs/changelog/">Changelog</Link>
          <Link prefetch={false} href="/privacy/">Privacy</Link>
        </nav>
        <p className="footer__legal">
          This demo site counts visits with Aptabase, which is cookieless, and uses Google Analytics only if you accept. The published{" "}
          <code>{SITE.name}</code> package sends no telemetry.
        </p>
      </div>
    </footer>
  );
}
