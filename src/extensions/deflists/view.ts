/**
 * Read-only views: the render carries `div[role=term]` / `div[role=definition]` (the renderer's tag
 * allow-list has no `dl`); `upgradeDefinitionLists` rebuilds each list as a real `<dl>` with `<dt>`
 * and `<dd>`. DOM only: nodes are moved, no markup is parsed. Idempotent. Never used by the editor
 * surface, where `DT` / `DD` are leaf blocks and a definition may hold several blocks.
 */

const moveInto = (to: Element, from: Element, unwrapParagraph: boolean): void => {
  const only = unwrapParagraph && from.children.length === 1 && from.firstElementChild!.tagName === "P" ? from.firstElementChild! : from;
  while (only.firstChild) to.appendChild(only.firstChild);
};

/** Replace every `.atm-custom-deflist` under `root` with a `dl`. Returns how many it rebuilt. */
export function upgradeDefinitionLists(root: ParentNode, classPrefix = "atm"): number {
  const lists = Array.from(root.querySelectorAll<HTMLElement>(`div.${classPrefix}-custom-deflist`)).reverse(); // inner lists first
  for (const el of lists) {
    const doc = el.ownerDocument;
    const dl = doc.createElement("dl");
    dl.className = el.className;
    for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-")) dl.setAttribute(a.name, a.value);
    let dd: HTMLElement | null = null;
    for (const c of Array.from(el.children)) {
      if (c.classList.contains(`${classPrefix}-custom-dt`)) {
        const dt = doc.createElement("dt");
        dt.className = c.className;
        moveInto(dt, c, true);
        dl.appendChild(dt);
        dd = null;
      } else {
        // A definition, or anything else a hand-built tree put here: it must sit in a `dd` to be valid.
        if (!dd || c.classList.contains(`${classPrefix}-custom-dd`)) {
          dd = doc.createElement("dd");
          dd.className = c.classList.contains(`${classPrefix}-custom-dd`) ? c.className : `${classPrefix}-custom ${classPrefix}-custom-dd`;
          dl.appendChild(dd);
        }
        if (c.classList.contains(`${classPrefix}-custom-dd`)) moveInto(dd, c, false);
        else dd.appendChild(c);
      }
    }
    el.replaceWith(dl);
  }
  return lists.length;
}
