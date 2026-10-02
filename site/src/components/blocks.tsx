import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** A grid of small feature tiles, each with an inline-SVG icon. */
export function FeatureGrid({ items }: { items: { icon: IconName; title: string; text: ReactNode }[] }) {
  return (
    <ul className="grid grid--3" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((f) => (
        <li key={f.title} className="fx">
          <span className="fx__icon" aria-hidden="true">
            <Icon name={f.icon} />
          </span>
          <h3>{f.title}</h3>
          <p>{f.text}</p>
        </li>
      ))}
    </ul>
  );
}

/** A responsive table in a scrollable, focusable wrapper (so a narrow screen can still reach every column by keyboard). */
export function DataTable({ caption, head, rows, usColumn }: { caption: string; head: ReactNode[]; rows: ReactNode[][]; usColumn?: number }) {
  return (
    <div className="tablewrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={i === usColumn ? "us" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={i} className={i === usColumn ? "us" : undefined}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type KeyGroup = { title: string; keys: { label: string; combo: string[] }[] };

/** The keyboard cheat sheet. `Mod` is Cmd on macOS and Ctrl elsewhere, and says so. */
export function Shortcuts({ groups }: { groups: KeyGroup[] }) {
  return (
    <div className="keys">
      {groups.map((g) => (
        <div key={g.title} className="card">
          <h3>{g.title}</h3>
          <dl>
            {g.keys.map((k) => (
              <div key={k.label}>
                <dt>{k.label}</dt>
                <dd>
                  {k.combo.map((c, i) => (
                    <kbd key={i}>{c}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

export type RoadItem = { tag: "Out of scope" | "Known gap" | "Limit" | "Pre-1.0"; title: string; text: ReactNode };

export function Roadmap({ items }: { items: RoadItem[] }) {
  return (
    <ul className="road">
      {items.map((i) => (
        <li key={i.title}>
          <span className={`pill ${i.tag === "Out of scope" ? "off" : i.tag === "Pre-1.0" ? "warn" : ""}`}>{i.tag}</span>
          <p>
            <strong>{i.title}.</strong> {i.text}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Native <details>: keyboard and screen-reader friendly, and the answers stay in the static HTML. */
export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="faq">
      {items.map((i) => (
        <details key={i.q}>
          <summary>{i.q}</summary>
          <div className="faq__a">{i.a}</div>
        </details>
      ))}
    </div>
  );
}
