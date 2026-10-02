import type { ReactNode } from "react";
import Link from "next/link";
import { SITE } from "@/lib/config";
import { InstallTabs } from "./install-tabs";
import { GithubGlyph, Icon, NpmGlyph } from "./icons";

export type Badge = { k: string; v: string; accent?: boolean };

/** The hero card: the SVG banner, the headline, an install block, the pill links and a badges row. */
export function Hero({ eyebrow, title, sub, install, badges, extraLink }: { eyebrow: string; title: ReactNode; sub: ReactNode; install: string; badges: Badge[]; extraLink?: { label: string; href: string } }) {
  return (
    <header className="hero" id="top">
      <div className="wrap">
        <div className="hero__card">
          {/* A plain <img>: the export is static and the SVG is already tiny, so there is nothing for an optimiser to do. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero__banner" src={`${SITE.basePath}/banner.svg`} alt="" width={1200} height={340} fetchPriority="high" />
        </div>
        <div className="hero__body">
          <div>
            <p className="hero__eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="hero__sub">{sub}</p>
            <div className="hero__row">
              <InstallTabs packages={install} />
              <nav className="links" aria-label="Project links">
                <Link prefetch={false} className="primary" href="/#playground">
                  <Icon name="play" size={14} /> Playground
                </Link>
                <Link prefetch={false} href="/docs/">
                  <Icon name="book" size={15} /> Docs
                </Link>
                <a href={`https://www.npmjs.com/package/${SITE.name}`}>
                  <NpmGlyph /> npm
                </a>
                <a href={`https://github.com/${SITE.repo}`}>
                  <GithubGlyph /> GitHub
                </a>
                {extraLink ? <a href={extraLink.href}>{extraLink.label}</a> : null}
              </nav>
            </div>
            <ul className="badges" aria-label="Facts">
              {badges.map((b) => (
                <li key={b.k} className={`badge${b.accent ? " badge--accent" : ""}`}>
                  <span className="badge__k">{b.k}</span>
                  <span className="badge__v">{b.v}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </header>
  );
}
