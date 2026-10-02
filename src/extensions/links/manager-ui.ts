/**
 * The link manager dialog (lazy chunk of `advanced-texteditor-md/links`).
 *
 * A modal dialog appended to `document.body` (never inside the editor surface): a focus trap,
 * Escape closes it and focus returns to where it was, a polite live region announces results.
 * Every string reaches the DOM through `textContent`; every address is shown, never followed.
 */
import type { EditorInstance, LinkPolicy } from "../../types";
import { normalizeUrl, urlAllowed } from "../../features/upload-policy";
import { h, NOT_CONTENT, surfaceOf, textareaOf } from "../_shared";
import { copyTheme, focusables, nextId } from "../chips/popup";
import { applyEdits, editLink, removeLink, upgradable, upgradeEdits } from "./edit";
import { findLinks, type FoundLink } from "./scan";
import { statusOf, type LinkCheckResult, type LinkStatus } from "./status";
import type { LinkManagerLabels } from "./labels";
import type { LinkManagerOptions } from "./manager";

/** Attribute-selector escaping for our own `data-key` values (letters, digits and dashes; defensive for the rest). */
const qs = (s: string) => s.replace(/["\\\]]/g, "\\$&");

const PROBLEMS: LinkStatus[] = ["broken", "insecure", "refused"];

/* ───────────────────────────── applying Markdown to the editor ───────────────────────────── */

/** Replace the document with `next` as ONE undo step. In the Markdown pane only the changed span is replaced. */
export function applyMarkdown(ed: EditorInstance, next: string): boolean {
  const prev = ed.getValue();
  if (next === prev || ed.isReadOnly()) return false;
  const ta = textareaOf(ed);
  if (ta) {
    const max = Math.min(prev.length, next.length);
    let a = 0;
    while (a < max && prev.charCodeAt(a) === next.charCodeAt(a)) a++;
    if (a > 0 && /[\ud800-\udbff]/.test(prev[a - 1])) a--;
    let b = 0;
    while (b < max - a && prev.charCodeAt(prev.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++;
    if (b > 0 && /[\udc00-\udfff]/.test(next[next.length - b])) b--;
    ed.transact(() => {
      ta.focus();
      ta.setSelectionRange(a, prev.length - b);
      ed.insertText(next.slice(a, next.length - b));
    });
  } else {
    const pane = ed.getPane();
    const d = ed.element.ownerDocument;
    const sel = d.getSelection();
    if (pane?.el && sel) {
      const r = d.createRange();
      r.selectNodeContents(pane.el);
      sel.removeAllRanges();
      sel.addRange(r);
      ed.transact(() => ed.replaceSelectionMarkdown(next));
    }
  }
  // `<https://x>` is stored as the bare URL once the pane has re-serialised it: not a failed edit, so keep the history.
  const bare = (t: string) => t.replace(/<(https?:\/\/[^<>\s]+)>/g, "$1");
  const got = ed.getValue();
  if (got !== next && bare(got) !== bare(next) && got.length !== next.length) ed.setValue(next); // the pane did not take it: reset history rather than lose the edit
  return true;
}

/* ───────────────────────────── going to a link ───────────────────────────── */

const unesc = (s: string) =>
  s
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(+n, 0x10ffff)));

const keyOf = (l: FoundLink) => (l.kind === "image" ? "image" : l.kind === "wiki" ? "wiki" : "a") + "\0" + (l.kind === "wiki" ? (l.id ?? "") : unesc(l.href));

function surfaceTargets(s: HTMLElement, scheme: string): { el: HTMLElement; key: string }[] {
  const out: { el: HTMLElement; key: string }[] = [];
  s.querySelectorAll<HTMLElement>(`a[href], img, .atm-chip[data-scheme="${scheme}"]`).forEach((el) => {
    if (el.closest(`[${NOT_CONTENT}]`)) return;
    if (el.tagName === "A") out.push({ el, key: "a\0" + (el.getAttribute("href") ?? "") });
    else if (el.tagName === "IMG") out.push({ el, key: "image\0" + (el.getAttribute("src") ?? "") });
    else out.push({ el, key: "wiki\0" + (el.getAttribute("data-id") ?? "") });
  });
  return out;
}

function goTo(ed: EditorInstance, link: FoundLink, all: FoundLink[], scheme: string): boolean {
  const d = ed.element.ownerDocument;
  const ta = textareaOf(ed);
  if (ta) {
    if (!link.range) return false;
    ta.focus();
    ta.setSelectionRange(link.range.start, link.range.end);
    const lh = parseFloat(d.defaultView?.getComputedStyle(ta).lineHeight ?? "") || 20;
    const line = (link.position.line ?? 1) - 1;
    if (line * lh < ta.scrollTop || line * lh > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
    return true;
  }
  const s = surfaceOf(ed);
  if (!s || link.kind === "reference") return false;
  const key = keyOf(link);
  const nth = all.filter((l) => l.kind !== "reference" && keyOf(l) === key).indexOf(link);
  const targets = surfaceTargets(s, scheme);
  let hit = targets.filter((t) => t.key === key)[Math.max(0, nth)]?.el;
  if (!hit) {
    // Same kind, same ordinal: the surface may spell an address differently than the source did.
    const kindKey = key.split("\0")[0];
    const sameKind = all.filter((l) => l.kind !== "reference" && keyOf(l).startsWith(kindKey + "\0"));
    hit = targets.filter((t) => t.key.startsWith(kindKey + "\0"))[sameKind.indexOf(link)]?.el;
  }
  if (!hit) return false;
  s.focus();
  const r = d.createRange();
  if (hit.tagName === "A") r.selectNodeContents(hit);
  else r.selectNode(hit);
  const sel = d.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  hit.scrollIntoView?.({ block: "center", inline: "nearest" });
  return true;
}

/* ───────────────────────────── the dialog ───────────────────────────── */

type Row = { link: FoundLink; status: LinkStatus; note?: string };

export function openLinkManager(ed: EditorInstance, o: LinkManagerOptions, L: LinkManagerLabels, onClosed: () => void): { close(): void; isOpen(): boolean } {
  const d = ed.element.ownerDocument;
  const win = d.defaultView!;
  const wiki = o.wiki;
  const scheme = wiki?.scheme ?? "wiki";
  const policy: LinkPolicy | undefined = o.linkPolicy ?? ed.options.links;
  const maxRows = Math.max(1, o.maxLinks ?? 500);
  const hosts = o.upgradeHosts ?? "all";
  const uid = nextId("links");
  const readOnly = () => ed.isReadOnly();
  const previous = d.activeElement as HTMLElement | null;
  const checked = sharedChecks(o);
  const checkers = new Set<AbortController>();

  let links: FoundLink[] = [];
  let rows: Row[] = [];
  let onlyProblems = false;
  let editing: { start: number } | null = null;
  let confirming = false;
  let running = false;
  let closed = false;

  /* shell */
  const title = h(d, "h2", { id: `${uid}-t`, class: "atm-links-title" }, L.title);
  const closeBtn = h(d, "button", { type: "button", class: "atm-links-close", "aria-label": L.close }, "×");
  const summary = h(d, "p", { class: "atm-links-summary" });
  const live = h(d, "div", { class: "atm-links-live", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const problems = h(d, "input", { type: "checkbox", id: `${uid}-p` }) as HTMLInputElement;
  const problemsLabel = h(d, "label", { class: "atm-links-check", for: `${uid}-p` }, problems, L.onlyProblems);
  const checkBtn = h(d, "button", { type: "button", class: "atm-links-btn" }, L.check);
  const upgradeBtn = h(d, "button", { type: "button", class: "atm-links-btn" });
  const confirmText = h(d, "p", { class: "atm-links-confirm-text" });
  const confirmYes = h(d, "button", { type: "button", class: "atm-links-btn atm-links-primary" }, L.upgradeConfirm);
  const confirmNo = h(d, "button", { type: "button", class: "atm-links-btn" }, L.cancel);
  const confirmBox = h(d, "div", { class: "atm-links-confirm", role: "group", "aria-label": L.upgradeConfirm, hidden: true }, confirmText, h(d, "div", { class: "atm-links-confirm-actions" }, confirmYes, confirmNo));
  const list = h(d, "ul", { class: "atm-links-list", "aria-label": L.list });
  const empty = h(d, "p", { class: "atm-links-empty", hidden: true }, L.none);
  const more = h(d, "p", { class: "atm-links-more", hidden: true });
  const ro = h(d, "p", { class: "atm-links-note", hidden: true }, L.readOnly);
  const bar = h(d, "div", { class: "atm-links-bar" }, problemsLabel, checkBtn, upgradeBtn);
  const dialog = h(
    d,
    "div",
    { class: "atm-links-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": title.id, tabindex: "-1" },
    h(d, "div", { class: "atm-links-head" }, title, closeBtn),
    summary,
    ro,
    bar,
    confirmBox,
    list,
    empty,
    more,
    live,
  );
  const overlay = h(d, "div", { class: "atm-links-overlay", "data-atm-links": "" }, dialog);
  copyTheme(ed.element, overlay);
  const dir = win.getComputedStyle(ed.element).direction;
  if (dir === "rtl") overlay.setAttribute("dir", "rtl");
  if (ed.element.lang || d.documentElement.lang) overlay.setAttribute("lang", ed.element.lang || d.documentElement.lang);

  const announce = (t: string) => {
    live.textContent = "";
    // A new text node each time, so a repeated message is read again.
    win.setTimeout(() => !closed && (live.textContent = t), 30);
  };

  /* data */
  function scan() {
    links = findLinks(ed.getValue(), { scheme }).filter((l) => l.kind !== "chip");
    const ctx = {
      allowed: urlAllowed,
      policy,
      page: wiki ? (id: string) => wiki.status(id) : undefined,
      hasResolve: !!wiki,
      checked: (u: string) => checked.get(u),
      labels: { notFound: wiki?.labels.notFound ?? L.notFound, noAddress: L.noAddress, refused: L.refused, insecure: L.insecure },
    };
    rows = links.map((link) => ({ link, ...statusOf(link, ctx) }));
    if (wiki && wiki.status) {
      const ids = links.filter((l) => l.kind === "wiki" && l.id && !wiki.status(l.id)).map((l) => l.id!);
      if (ids.length) wiki.lookup(ids).then(() => !closed && render());
    }
  }

  const nameOf = (l: FoundLink) => {
    const t = (l.text || l.href || "").replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 59) + "…" : t || L.noAddress;
  };

  /* rendering */
  function render() {
    if (closed) return;
    const focusKey = (d.activeElement as HTMLElement | null)?.getAttribute?.("data-key") ?? null;
    const count = (s: LinkStatus) => rows.filter((r) => r.status === s).length;
    summary.textContent = L.summary({ total: rows.length, broken: count("broken"), insecure: count("insecure"), refused: count("refused") });
    ro.hidden = !readOnly();
    const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !onlyProblems || PROBLEMS.includes(r.status));
    list.textContent = "";
    for (const { r, i } of shown.slice(0, maxRows)) list.append(row(r, i));
    more.hidden = shown.length <= maxRows;
    if (!more.hidden) more.textContent = L.more(maxRows, shown.length);
    empty.hidden = shown.length > 0;
    list.hidden = shown.length === 0;
    const up = upgradable(links, hosts);
    upgradeBtn.hidden = readOnly() || up.length === 0;
    upgradeBtn.textContent = L.upgrade(up.length);
    upgradeBtn.setAttribute("aria-expanded", String(confirming && hosts === "all"));
    if (hosts !== "all" || !up.length) confirming = false;
    confirmBox.hidden = !confirming;
    confirmText.textContent = L.upgradeAsk(up.length);
    checkBtn.hidden = !o.check || !rows.some((r) => /^https?:/i.test(r.link.href));
    checkBtn.disabled = running;
    checkBtn.textContent = running ? L.checking : L.check;
    if (focusKey) dialog.querySelector<HTMLElement>(`[data-key="${qs(focusKey)}"]`)?.focus();
  }

  function btn(label: string, key: string, name: string, fn: () => void, disabled = false): HTMLButtonElement {
    const b = h(d, "button", { type: "button", class: "atm-links-btn", "data-key": key, "aria-label": `${label}: ${name}`, disabled }, label);
    b.addEventListener("click", fn);
    return b;
  }

  function row(r: Row, i: number): HTMLElement {
    const l = r.link;
    const name = nameOf(l);
    if (editing && editing.start === l.range?.start) return editRow(r, i, name);
    const li = h(d, "li", { class: "atm-links-row", "data-status": r.status });
    const main = h(
      d,
      "div",
      { class: "atm-links-main" },
      h(d, "span", { class: "atm-links-kind" }, L.kind[l.kind as keyof typeof L.kind] ?? l.kind),
      h(d, "span", { class: "atm-links-text" }, l.kind === "reference" ? l.id || l.href : name),
      h(d, "span", { class: "atm-links-href", title: l.href }, l.href || "—"),
    );
    const st = h(d, "div", { class: "atm-links-state" }, h(d, "span", { class: "atm-links-status", "data-status": r.status }, L.status[r.status]));
    if (r.note) st.append(h(d, "span", { class: "atm-links-note-text" }, r.note));
    const actions = h(d, "div", { class: "atm-links-actions" });
    actions.append(
      btn(L.goTo, `go-${i}`, name, () => {
        const ok = goTo(ed, l, links, scheme);
        if (ok) close(false);
      }),
    );
    if (!readOnly()) {
      actions.append(
        btn(L.edit, `edit-${i}`, name, () => {
          editing = { start: l.range?.start ?? -1 };
          render();
          dialog.querySelector<HTMLElement>(`[data-key="field-${i}"]`)?.focus();
        }),
        btn(L.remove, `rm-${i}`, name, () => remove(l, name, i)),
      );
    }
    li.append(main, st, actions);
    return li;
  }

  function editRow(r: Row, i: number, name: string): HTMLElement {
    const l = r.link;
    const canText = l.kind === "link" || l.kind === "image" || l.kind === "wiki";
    const canHref = l.kind !== "wiki";
    const form = h(d, "form", { class: "atm-links-form", "aria-label": L.editing(name), novalidate: true });
    const err = h(d, "p", { class: "atm-links-error", role: "alert", hidden: true });
    const mk = (label: string, value: string, key: string, mode?: string) => {
      const id = `${uid}-${i}-${key}`;
      const input = h(d, "input", { type: "text", id, class: "atm-links-input", value, "data-key": key === "href" ? `field-${i}` : `text-${i}`, inputmode: mode, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
      input.value = value;
      return { input, node: h(d, "div", { class: "atm-links-field" }, h(d, "label", { for: id }, label), input) };
    };
    const text = canText ? mk(L.fieldText, l.text, "text") : null;
    const href = canHref ? mk(L.fieldAddress, l.href, "href", "url") : null;
    // The first field gets the focus key `field-i`.
    (text?.input ?? href!.input).setAttribute("data-key", `field-${i}`);
    if (text && href) href.input.setAttribute("data-key", `addr-${i}`);
    const apply = h(d, "button", { type: "submit", class: "atm-links-btn atm-links-primary", "data-key": `apply-${i}` }, L.apply);
    const cancel = h(d, "button", { type: "button", class: "atm-links-btn", "data-key": `cancel-${i}` }, L.cancel);
    cancel.addEventListener("click", () => cancelEdit(i));
    form.append(...[text?.node, href?.node, err, h(d, "div", { class: "atm-links-form-actions" }, apply, cancel)].filter(Boolean) as Node[]);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const fail = (m: string) => {
        err.textContent = m;
        err.hidden = false;
        (href?.input ?? text!.input).focus();
      };
      let newHref: string | undefined;
      if (href) {
        const v = href.input.value.trim();
        if (!v && l.kind !== "image") return fail(L.errEmpty);
        if (v) {
          if (l.kind === "autolink" && (/\s/.test(v) || !(l.bare ? /^(?:https?:\/\/|www\.)\S+$/i.test(v) : /^[a-z][a-z0-9+.-]*:\S*$/i.test(v)))) return fail(l.bare ? L.errBare : L.errAuto);
          if (normalizeUrl(v, policy, l.kind === "image" ? "image" : "link") === null) return fail(L.errRefused);
        }
        newHref = v;
      }
      const edits = editLink(l, { text: text?.input.value, href: newHref });
      editing = null;
      if (edits.length) {
        applyMarkdown(ed, applyEdits(ed.getValue(), edits));
        scan();
        announce(L.updated(name));
      }
      render();
      focusKey(`edit-${i}`);
    });
    return h(d, "li", { class: "atm-links-row atm-links-editing", "data-status": r.status }, form);
  }

  function focusKey(k: string) {
    (dialog.querySelector<HTMLElement>(`[data-key="${qs(k)}"]`) ?? dialog).focus();
  }
  function cancelEdit(i: number) {
    editing = null;
    render();
    focusKey(`edit-${i}`);
  }

  function remove(l: FoundLink, name: string, i: number) {
    applyMarkdown(ed, applyEdits(ed.getValue(), removeLink(ed.getValue(), l)));
    scan();
    render();
    announce(L.removed(name));
    // Focus the row that took this one's place, else the list.
    (dialog.querySelector<HTMLElement>(`[data-key="go-${Math.min(i, rows.length - 1)}"]`) ?? closeBtn).focus();
  }

  /* bulk upgrade */
  function doUpgrade() {
    const edits = upgradeEdits(links, hosts);
    const n = upgradable(links, hosts).length;
    confirming = false;
    if (edits.length) applyMarkdown(ed, applyEdits(ed.getValue(), edits));
    scan();
    render();
    announce(L.upgraded(n));
    (upgradeBtn.hidden ? closeBtn : upgradeBtn).focus();
  }
  upgradeBtn.addEventListener("click", () => {
    if (hosts === "all") {
      confirming = !confirming;
      render();
      if (confirming) confirmYes.focus();
    } else doUpgrade();
  });
  confirmYes.addEventListener("click", doUpgrade);
  confirmNo.addEventListener("click", () => {
    confirming = false;
    render();
    upgradeBtn.focus();
  });

  /* checking http(s) addresses */
  async function runChecks() {
    if (!o.check || running) return;
    const urls = [...new Set(rows.filter((r) => /^https?:/i.test(r.link.href) && r.status !== "refused").map((r) => r.link.href))].filter((u) => !checked.has(u));
    if (!urls.length) return announce(L.checked(0, 0));
    running = true;
    urls.forEach((u) => checked.set(u, "pending"));
    scan();
    render();
    let next = 0;
    let broken = 0;
    const worker = async () => {
      while (!closed && next < urls.length) {
        const u = urls[next++];
        const ac = new AbortController();
        checkers.add(ac);
        try {
          const raw = await o.check!(u, { signal: ac.signal });
          if (ac.signal.aborted) {
            checked.delete(u);
            continue;
          }
          const res: LinkCheckResult = typeof raw === "boolean" ? { ok: raw } : raw && typeof raw === "object" && typeof raw.ok === "boolean" ? { ok: raw.ok, message: typeof raw.message === "string" ? raw.message.slice(0, 200) : undefined, status: raw.status } : { ok: true };
          if (!res.ok) broken++;
          checked.set(u, res);
        } catch {
          checked.delete(u);
        } finally {
          checkers.delete(ac);
        }
        if (!closed) {
          scan();
          render();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, o.checkConcurrency ?? 4), urls.length) }, worker));
    running = false;
    if (closed) return;
    scan();
    render();
    announce(L.checked(urls.length, broken));
  }
  checkBtn.addEventListener("click", () => void runChecks());

  /* lifecycle */
  problems.addEventListener("change", () => {
    onlyProblems = problems.checked;
    render();
  });
  function close(restore = true) {
    if (closed) return;
    closed = true;
    checkers.forEach((a) => a.abort());
    offs.forEach((f) => f());
    d.removeEventListener("keydown", onKey, true);
    overlay.remove();
    onClosed();
    if (restore) {
      if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus();
      else ed.focus();
    }
  }
  closeBtn.addEventListener("click", () => close());
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  function onKey(ev: KeyboardEvent) {
    if (closed || !overlay.contains(ev.target as Node)) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (editing) cancelEdit(rows.findIndex((r) => r.link.range?.start === editing!.start));
      else if (confirming) {
        confirming = false;
        render();
        upgradeBtn.focus();
      } else close();
    } else if (ev.key === "Tab") {
      const f = focusables(dialog);
      if (!f.length) return;
      // Move focus by hand: WebKit's native Tab order skips buttons, so a trap that only wraps at the ends lets focus out.
      const at = d.activeElement as HTMLElement | null;
      const i = at ? f.indexOf(at) : -1;
      const next = i < 0 ? (ev.shiftKey ? f[f.length - 1] : f[0]) : f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length];
      ev.preventDefault();
      next.focus();
    }
  }
  d.addEventListener("keydown", onKey, true);

  // The dialog is modal, so the document only changes through it (or an undo): redraw at once, no debounce.
  const refresh = () => {
    if (closed) return;
    scan();
    if (editing && !links.some((l) => l.range?.start === editing!.start)) editing = null;
    render();
  };
  const offs: (() => void)[] = [ed.on("change", refresh), wiki ? wiki.onStatus(refresh) : () => {}];

  scan();
  render();
  d.body.append(overlay);
  (dialog.querySelector<HTMLElement>(".atm-links-row .atm-links-btn") ?? closeBtn).focus();
  announce(summary.textContent ?? "");
  return { close: () => close(), isOpen: () => !closed };
}

/** Results of `check` live as long as the plugin: the same address is not asked twice per session. */
const memo = new WeakMap<object, Map<string, LinkCheckResult | "pending">>();
function sharedChecks(o: LinkManagerOptions): Map<string, LinkCheckResult | "pending"> {
  let m = memo.get(o);
  if (!m) memo.set(o, (m = new Map()));
  if (m.size > 2000) m.clear();
  return m;
}
