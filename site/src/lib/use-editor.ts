"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { EditorInstance } from "./atm";

type Created = EditorInstance | null | undefined;

/**
 * Mounts a vanilla editor into a host element once its card is near the viewport (so a demo nobody scrolls to costs
 * nothing), rebuilds it when `deps` change, destroys it on cleanup and keeps it in step with the page's light / dark
 * toggle. `create` may be async: it is where the library's chunks are imported.
 */
export function useEditorMount(
  create: (host: HTMLElement) => Created | Promise<Created>,
  deps: readonly unknown[] = [],
  { followTheme = true }: { followTheme?: boolean } = {},
): { wrapRef: RefObject<HTMLDivElement | null>; hostRef: RefObject<HTMLDivElement | null>; editor: RefObject<EditorInstance | null>; ready: boolean } {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorInstance | null>(null);
  const latest = useRef(create);
  latest.current = create;
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) return setVisible(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;
    let made: EditorInstance | null = null;
    Promise.resolve(latest.current(host))
      .then((ed) => {
        if (cancelled) return ed?.destroy();
        made = ed ?? null;
        editor.current = made;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) console.error(e);
      });
    return () => {
      cancelled = true;
      made?.destroy();
      editor.current = null;
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ...deps]);

  useEffect(() => {
    if (!followTheme) return;
    const on = (e: Event) => editor.current?.setTheme((e as CustomEvent<"light" | "dark">).detail);
    window.addEventListener("site-theme", on);
    return () => window.removeEventListener("site-theme", on);
  }, [followTheme]);

  return { wrapRef, hostRef, editor, ready };
}
