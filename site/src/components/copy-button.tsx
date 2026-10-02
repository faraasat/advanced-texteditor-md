"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { Icon } from "./icons";

/** Copies `text` (or whatever `getText` returns, for text that changes). Announces the result politely. */
export function CopyButton({ text, getText, label = "Copy", target }: { text?: string; getText?: () => string; label?: string; target?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const value = getText ? getText() : (text ?? "");
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      track("copy_snippet", { target: (target ?? "snippet").slice(0, 40) });
    } catch {
      setState("failed"); // clipboard blocked: the text is still selectable
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };

  return (
    <button type="button" className="copy" data-copied={state === "copied"} onClick={copy} aria-label={state === "copied" ? "Copied" : `${label} to clipboard`}>
      <Icon name={state === "copied" ? "check" : "copy"} size={13} strokeWidth={2} />
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : label}</span>
    </button>
  );
}
