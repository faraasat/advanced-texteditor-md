import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/config";
import { DOC_PAGES, type Toc } from "@/lib/docs";
import { TocSpy } from "./toc-spy";

/** The docs frame: page list on the left, the rendered page, and (on wide screens) the outline on the right. */
export function DocsShell({ current, toc, source, children }: { current?: string; toc?: Toc; source?: string; children: ReactNode }) {
  return (
    <div className="wrap docs">
      <aside className="docs__nav" aria-label="Documentation">
        <h2 className="docs__title">Docs</h2>
        <ul>
          {DOC_PAGES.map((p) => (
            <li key={p.slug}>
              <Link prefetch={false} href={`/docs/${p.slug}/`} aria-current={p.slug === current ? "page" : undefined}>
                {p.nav}
              </Link>
            </li>
          ))}
        </ul>
        <p>
          <Link prefetch={false} href="/#playground">Back to the playground</Link>
        </p>
      </aside>
      <article className="prose atm-surface" id="doc">
        {children}
      </article>
      {toc ? (
        <aside className="docs__toc" aria-label="On this page">
          <h2 className="docs__title">On this page</h2>
          <ul>
            {toc.map((t) => (
              <li key={t.id} className={`h${t.level}`}>
                <a href={`#${t.id}`}>{t.text}</a>
              </li>
            ))}
          </ul>
          {source ? (
            <p className="docs__edit">
              <a href={`https://github.com/${SITE.repo}/edit/main/${source}`}>Edit this page on GitHub</a>
            </p>
          ) : null}
          <TocSpy />
        </aside>
      ) : null}
    </div>
  );
}
