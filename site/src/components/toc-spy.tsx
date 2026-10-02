"use client";

import { useEffect } from "react";

/** Marks the table-of-contents entry of the heading that is in view (aria-current), as you read. */
export function TocSpy() {
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".docs__toc a")];
    const map = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    if (!map.size || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          links.forEach((a) => a.removeAttribute("aria-current"));
          map.get(en.target.id)?.setAttribute("aria-current", "true");
        }
      },
      { rootMargin: "-70px 0px -70% 0px" },
    );
    for (const id of map.keys()) {
      const h = document.getElementById(id);
      if (h) io.observe(h);
    }
    return () => io.disconnect();
  }, []);
  return null;
}
