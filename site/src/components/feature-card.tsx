"use client";

import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Tabs, useTabPrefix } from "./tabs";

/**
 * One feature: a heading, a "Live demo | Code" tab pair and a hint. The demo panel is only hidden, never unmounted, so
 * opening the Code tab does not throw the editor (and what was typed in it) away. `code` is rendered on the server.
 */
export function FeatureCard({ id, title, text, hint, icon, code, children }: { id: string; title: string; text: ReactNode; hint?: ReactNode; icon: IconName; code: ReactNode; children: ReactNode }) {
  const [tab, setTab] = useState("demo");
  const prefix = useTabPrefix(`f-${id}`);
  return (
    <article className="fcard" id={`feature-${id}`} aria-labelledby={`${prefix}-h`}>
      <div className="fcard__head">
        <span className="fx__icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <div>
          <h3 id={`${prefix}-h`}>{title}</h3>
          <div className="fcard__text">{text}</div>
        </div>
      </div>
      <div className="fcard__tabs">
        <Tabs
          tabs={[
            { id: "demo", label: "Live demo" },
            { id: "code", label: "Code" },
          ]}
          value={tab}
          onChange={setTab}
          label={`${title}: demo or code`}
          prefix={prefix}
        />
      </div>
      <div className="fcard__panel" role="tabpanel" id={`${prefix}-panel-demo`} aria-labelledby={`${prefix}-tab-demo`} hidden={tab !== "demo"}>
        {children}
        {hint ? <p className="fcard__hint">{hint}</p> : null}
      </div>
      <div className="fcard__panel fcard__panel--code" role="tabpanel" id={`${prefix}-panel-code`} aria-labelledby={`${prefix}-tab-code`} hidden={tab !== "code"}>
        {code}
      </div>
    </article>
  );
}
