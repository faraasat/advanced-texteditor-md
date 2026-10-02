"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabDef = { id: string; label: ReactNode; mono?: boolean };

/**
 * A WAI-ARIA tablist. Controlled: the parent owns `value` and renders the panels (so a panel can stay mounted, hidden,
 * which keeps a live editor alive while its Code tab is open). `panelId(id)` gives the id to put on each panel.
 */
export function Tabs({ tabs, value, onChange, label, prefix, className }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; prefix: string; className?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % n;
    else if (e.key === "ArrowLeft") to = (i - 1 + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div className={`tabs ${className ?? ""}`} role="tablist" aria-label={label} ref={list}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${prefix}-tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${prefix}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className={`tab${t.mono ? " tab--mono" : ""}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A stable id prefix for one tab group. */
export function useTabPrefix(name: string) {
  return `${name}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}
