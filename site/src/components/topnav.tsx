"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/config";
import { GithubGlyph, Icon, NpmGlyph } from "./icons";
import { ThemeToggle } from "./theme-toggle";

/** Slim, mono, sticky and blurred: the brand dot and the package name, then the links and the theme toggle. */
export function TopNav() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  const docs = path.startsWith("/docs");
  return (
    <header className="topnav">
      <Link prefetch={false} className="topnav__brand" href="/" aria-label={`${SITE.name}, home`}>
        <span className="topnav__dot" aria-hidden="true" />
        <span>{SITE.name}</span>
      </Link>
      <div className="topnav__right">
        <nav className="topnav__links" id="site-nav" aria-label="Main" data-open={open} onClick={(e) => e.target instanceof Element && e.target.closest("a") && setOpen(false)}>
          {SITE.nav.map((n) => (
            <Link prefetch={false} key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
          <span className="topnav__sep" aria-hidden="true" />
          <a href={`https://www.npmjs.com/package/${SITE.name}`}>
            <NpmGlyph /> npm
          </a>
          <a href={`https://github.com/${SITE.repo}`}>
            <GithubGlyph /> GitHub
          </a>
          <Link prefetch={false} href="/docs/" aria-current={docs ? "page" : undefined}>
            Docs
          </Link>
        </nav>
        <ThemeToggle />
        <button type="button" className="topnav__btn topnav__menu" aria-expanded={open} aria-controls="site-nav" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
      </div>
    </header>
  );
}
