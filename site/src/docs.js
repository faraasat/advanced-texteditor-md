import { initChrome } from "./chrome.js";

initChrome();

// Highlight the table-of-contents entry of the heading that is in view.
const links = [...document.querySelectorAll(".toc a")];
const map = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
if (map.size && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          links.forEach((a) => a.removeAttribute("aria-current"));
          map.get(en.target.id)?.setAttribute("aria-current", "true");
        }
      }
    },
    { rootMargin: "0px 0px -75% 0px" },
  );
  for (const id of map.keys()) {
    const h = document.getElementById(id);
    if (h) io.observe(h);
  }
}
