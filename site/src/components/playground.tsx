"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { currentSiteTheme, loadCore, loadHighlighter, type EditorInstance } from "@/lib/atm";
import { SITE } from "@/lib/config";
import { CHIPS, MENTIONS, fakeUpload } from "@/lib/people";
import { loadPluginSet } from "@/demos/demos";
import { CopyButton } from "./copy-button";
import { Segmented } from "./segmented";
import { Tabs, useTabPrefix } from "./tabs";

const LAYOUTS = ["classic", "minimal", "bubble", "bottom-bar", "split", "document"] as const;
const THEMES = ["light", "dark", "sepia", "slate", "contrast"] as const;
const MODES = [
  { id: "wysiwyg", label: "Write" },
  { id: "markdown", label: "Markdown" },
  { id: "split", label: "Split" },
] as const;
type Layout = (typeof LAYOUTS)[number];
type Mode = (typeof MODES)[number]["id"];
type Theme = (typeof THEMES)[number];

const SAMPLE = (base: string) => `# Advanced text editor

Write **rich text**, *store* Markdown. Mention [@Ada Lovelace](mention:team-a/p01?teamA=a01) from Team A,
[@Alan Turing](mention:team-b/p02?teamB=b02) from Team B, or [@Grace Hopper](mention:both/p03?teamA=a03&teamB=b03) who is in both.

==Highlighted text== comes from a plugin, H~2~O and x^2^ from another, press [[Ctrl]] [[K]] for a link.

::: tip
Callouts are a block syntax: \`::: tip\` ... \`:::\`.
:::

![Quarterly results|center|360](${base}/sample.svg "Q1 to Q3")

Inline math $E = mc^2$ and a block:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`ts
const greet = (name) => \`Hello, \${name}!\`;
console.log(greet("world")); // highlighted
\`\`\`

::: details Collapsible section
Hidden until opened.
:::

| Feature | Status |
| :------ | -----: |
| Tables | yes |
| Task lists | yes |

- [x] Mentions
- [ ] Your idea
`;

/** The centrepiece: the real editor with every layout, theme and mode, and what it stores, live. */
export function Playground() {
  const [layout, setLayout] = useState<Layout>("classic");
  const [theme, setTheme] = useState<Theme>("dark");
  const [mode, setMode] = useState<Mode>("wysiwyg");
  const [readOnly, setReadOnly] = useState(false);
  const [ready, setReady] = useState(false);
  const [out, setOut] = useState({ md: "", html: "", words: 0, chars: 0 });
  const [tab, setTab] = useState("markdown");
  const prefix = useTabPrefix("pgout");

  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const editor = useRef<EditorInstance | null>(null);
  const value = useRef<string | null>(null);
  const now = useRef({ theme, mode, readOnly });
  now.current = { theme, mode, readOnly };

  const refresh = useCallback(() => {
    const ed = editor.current;
    if (!ed) return;
    const md = ed.getValue();
    const st = (ed as { getStats?: () => { words?: number; characters?: number } }).getStats?.();
    setOut({ md, html: ed.getHtml(), words: st?.words ?? 0, chars: st?.characters ?? md.length });
  }, []);

  // The site's own light / dark toggle drives the editor's theme until the visitor picks a different one here.
  useEffect(() => {
    setTheme(currentSiteTheme());
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("site-theme", on);
    return () => window.removeEventListener("site-theme", on);
  }, []);

  // The editor is the heaviest thing on the page, so it is not built during the first paint: it starts when the stage is near
  // the viewport, or once the browser is idle after load, whichever comes first. The skeleton holds its place until then.
  useEffect(() => {
    const arm = () => setArmed(true);
    const io = "IntersectionObserver" in window && stage.current ? new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && arm(), { rootMargin: "300px 0px" }) : null;
    if (io && stage.current) io.observe(stage.current);
    else arm();
    let idle: number | undefined;
    const later = () => {
      const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      idle = ric ? ric(arm, { timeout: 2500 }) : window.setTimeout(arm, 1500);
    };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      io?.disconnect();
      window.removeEventListener("load", later);
      if (idle !== undefined) (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(idle);
    };
  }, []);

  // (Re)build the editor when the layout changes; the text is carried over.
  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    let made: EditorInstance | null = null;
    const el = host.current!;
    (async () => {
      const [{ createEditor }, plugins, highlight] = await Promise.all([loadCore(), loadPluginSet(), loadHighlighter()]);
      if (cancelled) return;
      const startMode = layout === "split" ? "split" : now.current.mode === "split" ? "wysiwyg" : now.current.mode;
      made = createEditor(el, {
        value: value.current ?? SAMPLE(SITE.basePath),
        mode: startMode,
        layout,
        theme: now.current.theme as never,
        readOnly: now.current.readOnly,
        placeholder: "Write something, or type @ to mention and / for blocks…",
        minHeight: 260,
        maxHeight: layout === "document" ? undefined : 560,
        highlight,
        plugins,
        chips: CHIPS,
        mentions: MENTIONS,
        links: { allowedSchemes: ["http", "https", "mailto", "tel", "blob"] },
        upload: { handler: fakeUpload, allowExtensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt"], maxFileSizeBytes: 2 * 1024 * 1024, urls: { allowedSchemes: ["http", "https", "blob"] } },
        onChange: () => refresh(),
        onModeChange: (m: string) => setMode(m as Mode),
      });
      editor.current = made;
      (window as unknown as { __editor?: EditorInstance }).__editor = made;
      setMode(made.getMode() as Mode);
      refresh();
      setReady(true);
    })().catch((e) => !cancelled && console.error(e));
    return () => {
      cancelled = true;
      if (made) value.current = made.getValue();
      made?.destroy();
      editor.current = null;
      el.replaceChildren();
      setReady(false);
    };
  }, [layout, refresh, armed]);

  useEffect(() => editor.current?.setTheme(theme as never), [theme, ready]);
  useEffect(() => editor.current?.setReadOnly(readOnly), [readOnly, ready]);

  // What the playground is doing, as the code you would write.
  const code = [
    'import { createEditor } from "advanced-texteditor-md";',
    'import "advanced-texteditor-md/style.css";',
    "",
    "const editor = createEditor(el, {",
    `  layout: "${layout}",`,
    `  theme: "${theme}",`,
    mode !== "wysiwyg" ? `  mode: "${mode}",` : null,
    readOnly ? "  readOnly: true," : null,
    "  onChange: (markdown) => save(markdown),",
    "});",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const shown = tab === "html" ? out.html : tab === "code" ? code : out.md;

  return (
    <div className="pg">
      <div className="pg__controls" role="group" aria-label="Playground options">
        <Segmented legend="Layout" name="pg-layout" value={layout} options={LAYOUTS.map((l) => ({ id: l, label: l }))} onChange={(v) => (setLayout(v), track("playground_change", { kind: "layout", value: v }))} />
        <Segmented legend="Editor theme" name="pg-theme" value={theme} options={THEMES.map((t) => ({ id: t, label: t }))} onChange={(v) => (setTheme(v), track("playground_change", { kind: "theme", value: v }))} />
        <Segmented
          legend="Mode"
          name="pg-mode"
          value={mode}
          options={MODES}
          onChange={(v) => {
            setMode(v);
            editor.current?.setMode(v);
            track("playground_change", { kind: "mode", value: v });
          }}
        />
        <div className="pg__group">
          <div className="pg__tools" style={{ paddingBottom: 4 }}>
            <label className="check">
              <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only
            </label>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                value.current = SAMPLE(SITE.basePath);
                editor.current?.setValue(value.current);
                refresh();
              }}
            >
              Reset sample
            </button>
          </div>
        </div>
      </div>

      <div className="pg__stage" ref={stage} aria-busy={!ready}>
        <div className="skel" hidden={ready} aria-hidden="true">
          <div className="skel__bar">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <i style={{ width: "46%", height: 22 }} />
          <i style={{ width: "92%" }} />
          <i style={{ width: "84%" }} />
          <i style={{ width: "60%" }} />
          <i style={{ width: "90%", marginTop: 14 }} />
          <i style={{ width: "40%" }} />
        </div>
        <div data-editor-host data-testid="editor-host" id="editor-host" ref={host} />
      </div>

      <div className="out-card">
        <div className="out-card__head">
          <Tabs
            tabs={[
              { id: "markdown", label: "Markdown" },
              { id: "html", label: "HTML" },
              { id: "preview", label: "Rendered" },
              { id: "code", label: "Code" },
            ]}
            value={tab}
            onChange={setTab}
            label="Output format"
            prefix={prefix}
          />
          <div className="out-card__meta">
            <span aria-live="off" data-testid="stats">
              {out.words} words, {out.chars} characters
            </span>
            {tab !== "preview" ? <CopyButton getText={() => shown} target={`playground-${tab}`} /> : null}
          </div>
        </div>
        <div role="tabpanel" id={`${prefix}-panel-${tab}`} aria-labelledby={`${prefix}-tab-${tab}`}>
          {tab === "preview" ? (
            // The library's own sanitised HTML (getHtml), shown with the editor's content styles.
            <div className="out-card__render atm-surface" data-testid="output-render" role="region" tabIndex={0} aria-label="Rendered HTML" dangerouslySetInnerHTML={{ __html: out.html }} />
          ) : (
            <pre className="out" id="output" data-testid="output" role="region" tabIndex={0} aria-label={tab === "html" ? "HTML (getHtml)" : tab === "code" ? "The editor, as configured" : "Markdown (getValue, what is stored)"}>
              {shown}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
