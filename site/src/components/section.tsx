import type { ReactNode } from "react";

/** A landing-page section: an anchored heading (with a link to itself), an optional lead, then the content. */
export function Section({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec" id={id} aria-labelledby={`${id}-h`}>
      <div className="wrap">
        <div className="sec__head">
          <h2 id={`${id}-h`}>
            {title}
            <a className="anchor" href={`#${id}`} aria-label={`Link to ${title}`}>
              #
            </a>
          </h2>
          {sub ? <p className="sec__sub">{sub}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
