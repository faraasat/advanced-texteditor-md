/**
 * Body-level UI (menus, popovers, tooltips, dialogs) is outside the editor's DOM, so it does not
 * inherit the editor's theme. `mirrorTheme` copies the nearest `data-atm-theme`, `data-atm-density`
 * and `dir` of `from` onto `el` and keeps them in sync (a `setTheme` call, a page toggle) until `el`
 * leaves the document.
 */
const ATTRS = ["data-atm-theme", "data-atm-density", "dir"];

export function mirrorTheme(from: Element | null, el: HTMLElement): void {
  if (!from) return;
  const sync = () => {
    for (const a of ATTRS) {
      const v = from.closest(`[${a}]`)?.getAttribute(a);
      if (v == null) el.removeAttribute(a);
      else el.setAttribute(a, v);
    }
  };
  sync();
  const Obs = from.ownerDocument.defaultView?.MutationObserver;
  if (!Obs) return;
  const mo = new Obs(() => (el.isConnected ? sync() : mo.disconnect()));
  for (let n: Element | null = from; n; n = n.parentElement) mo.observe(n, { attributes: true, attributeFilter: ATTRS });
}
