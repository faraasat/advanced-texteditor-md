"use client";

// The twelve live demos. Each one imports the library the way an application does, and each `code` snippet shown next
// to it (see lib/features.ts) is what it does. The editors are built lazily: see lib/use-editor.ts.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DemoHost } from "@/components/demo-host";
import { loadCore, loadHighlighter, loadPlugins, currentSiteTheme } from "@/lib/atm";
import { CHIPS, MENTIONS, fakeResolve, fakeUpload } from "@/lib/people";
import { SITE } from "@/lib/config";
import { useEditorMount } from "@/lib/use-editor";
import type { EditorOptions } from "@/lib/atm";

const mini = { minHeight: 96, maxHeight: 240, layout: "minimal" } as const;
const LINKS = { allowedSchemes: ["http", "https", "mailto", "tel", "blob"] };

/** The options every demo editor shares. */
async function base(extra: EditorOptions = {}): Promise<EditorOptions> {
  return { ...mini, theme: currentSiteTheme(), highlight: await loadHighlighter(), ...extra };
}

function useLog(n = 6) {
  const [lines, setLines] = useState<string[]>([]);
  const push = useCallback((t: string) => setLines((l) => [t, ...l].slice(0, n)), [n]);
  return [lines, push] as const;
}

function Log({ lines, label }: { lines: string[]; label: string }) {
  return (
    <ul className="log" aria-label={label} aria-live="polite">
      {lines.map((l, i) => (
        <li key={`${i}-${l}`}>{l}</li>
      ))}
    </ul>
  );
}

/* ───────────────────────────────────────── mentions ───────────────────────────────────────── */

export function MentionsDemo() {
  const [out, setOut] = useState("[]");
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    const show = (ed: { getMentions(): { id: string; label: string; kind: string; attrs?: Record<string, string> }[] }) =>
      setOut(JSON.stringify(ed.getMentions().map((c) => ({ id: c.id, label: c.label, kind: c.kind, refs: c.attrs ?? {} })), null, 2));
    const ed = createEditor(
      host,
      await base({
        value: "Ping [@Ada Lovelace](mention:team-a/p01?teamA=a01) and [@Grace Hopper](mention:both/p03?teamA=a03&teamB=b03). Type @ to add more.",
        chips: CHIPS,
        mentions: MENTIONS,
        onMentionsChange: () => show(ed),
      }),
    );
    show(ed);
    return ed;
  });
  return (
    <>
      <DemoHost {...m} minHeight={150} label="Live demo: mentions" />
      <pre className="out" role="region" tabIndex={0} aria-label="Mentions in the document" data-testid="mentions-out">
        {out}
      </pre>
    </>
  );
}

/* ───────────────────────────────────────── uploads ───────────────────────────────────────── */

function samplePng(): Promise<File> {
  return new Promise((res) => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const g = c.getContext("2d")!;
    g.fillStyle = "#2563eb";
    g.fillRect(0, 0, 160, 90);
    g.fillStyle = "#bfdbfe";
    g.fillRect(20, 20, 120, 12);
    g.fillRect(20, 44, 80, 12);
    c.toBlob((b) => res(new File([b!], "photo.png", { type: "image/png" })));
  });
}

export function UploadsDemo() {
  const [log, push] = useLog();
  const [allow, setAllow] = useState("png, jpg, pdf");
  const [deny, setDeny] = useState("exe, svg");
  const list = (s: string) => s.split(/[\s,]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);
  const m = useEditorMount(
    async (host) => {
      const { createEditor } = await loadCore();
      return createEditor(
        host,
        await base({
          value: "Drop a file here, or use the buttons below.\n",
          upload: {
            handler: fakeUpload,
            allowExtensions: list(allow),
            denyExtensions: list(deny),
            maxFileSizeBytes: 1024 * 1024,
            urls: { allowedSchemes: ["http", "https", "blob"] },
          },
          onUpload: (e) => push(`${e.type}: ${e.file.name}${"reason" in e && e.reason ? ` (${e.reason})` : ""}`),
        }),
      );
    },
    [allow, deny],
  );
  return (
    <>
      <div className="controls">
        <div className="field">
          <label htmlFor="up-allow">Allow extensions</label>
          <input id="up-allow" type="text" value={allow} onChange={(e) => setAllow(e.target.value)} size={14} spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="up-deny">Deny extensions</label>
          <input id="up-deny" type="text" value={deny} onChange={(e) => setDeny(e.target.value)} size={12} spellCheck={false} />
        </div>
      </div>
      <DemoHost {...m} minHeight={120} label="Live demo: uploads" />
      <div className="controls">
        <button type="button" className="btn btn--sm" onClick={async () => m.editor.current?.uploadFiles([await samplePng()])}>
          Upload photo.png
        </button>
        <button type="button" className="btn btn--sm" onClick={() => m.editor.current?.uploadFiles([new File(["MZ"], "setup.exe", { type: "application/x-msdownload" })])}>
          Upload setup.exe
        </button>
        <button type="button" className="btn btn--sm" onClick={() => m.editor.current?.uploadFiles([new File([new Uint8Array(3 * 1024 * 1024)], "scan.pdf", { type: "application/pdf" })])}>
          Upload scan.pdf (3 MB)
        </button>
      </div>
      <Log lines={log} label="Upload events" />
    </>
  );
}

/* ───────────────────────────────────────── math, highlighting, embeds ───────────────────────────────────────── */

export function MathDemo() {
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    return createEditor(host, await base({ value: "Euler: $e^{i\\pi} + 1 = 0$, and a sum:\n\n$$\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\n$$\n" }));
  });
  return <DemoHost {...m} minHeight={170} label="Live demo: math" />;
}

export function HighlightDemo() {
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    return createEditor(
      host,
      await base({
        value:
          "```js\nconst total = items.reduce((sum, it) => sum + it.price, 0);\n```\n\n```python\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n```\n\n```sql\nSELECT team, count(*) FROM people GROUP BY team;\n```\n",
      }),
    );
  });
  return <DemoHost {...m} minHeight={260} label="Live demo: code highlighting" />;
}

export function EmbedsDemo() {
  const m = useEditorMount(async (host) => {
    const [{ createEditor }, { BUILTIN_EMBEDS }] = await Promise.all([loadCore(), import("advanced-texteditor-md/embeds")]);
    return createEditor(
      host,
      await base({
        minHeight: 190,
        maxHeight: 340,
        value: "A link in text shows a hover card: [the docs](https://example.com/docs/getting-started).\n\nhttps://example.com/articles/live-previews\n\nType below, or paste a YouTube link on its own line.\n",
        linkPreview: { resolve: fakeResolve, hoverDelayMs: 150 },
        embeds: BUILTIN_EMBEDS,
      }),
    );
  });
  return <DemoHost {...m} minHeight={260} label="Live demo: link previews and embeds" />;
}

/* ───────────────────────────────────────── plugins ───────────────────────────────────────── */

const CAL_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6h16v14H4z"/><path d="M4 10h16"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>';

export async function loadPluginSet() {
  const [{ definePlugin }, { highlightMark, callout, kbd, subSup }] = await Promise.all([loadCore(), loadPlugins()]);
  const insertToday = (ed: { insertText(t: string): void }) => ed.insertText(new Date().toISOString().slice(0, 10));
  const today = definePlugin({
    name: "today",
    toolbar: [{ id: "today", label: "Insert today's date", icon: CAL_ICON, command: insertToday }],
    slash: [{ id: "today", label: "Today's date", keywords: ["date", "calendar"], run: insertToday }],
  });
  return [highlightMark, callout, kbd, subSup, today];
}

export function PluginsDemo() {
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    return createEditor(
      host,
      await base({
        value: "==Highlighted== text, H~2~O and x^2^, press [[Ctrl]] [[K]].\n\n::: tip\nA callout is a block syntax.\n:::\n",
        plugins: await loadPluginSet(),
      }),
    );
  });
  return <DemoHost {...m} minHeight={190} label="Live demo: plugins" />;
}

/* ───────────────────────────────────────── custom syntax builder ───────────────────────────────────────── */

const TAGS = ["span", "mark", "u", "kbd", "small", "sub", "sup"];

export function SyntaxDemo() {
  const [cfg, setCfg] = useState({ open: "||", tag: "span", cls: "spoiler", color: "#fde68a" });
  const [draft, setDraft] = useState(cfg);
  const [error, setError] = useState("");
  const [md, setMd] = useState("");
  const lastOpen = useRef<string | null>(null);
  const keep = useRef<string | null>(null);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const open = draft.open.trim();
    const cls = draft.cls.trim();
    if (!/^[^\s\w*_`~[\]()\\<>!$]{1,4}$/.test(open)) return setError("Use one to four punctuation characters, not * _ ` ~ [ ] ( ) \\ < > ! $.");
    if (!/^[a-z][\w-]{0,30}$/i.test(cls)) return setError("The class must be letters, digits, - or _, starting with a letter.");
    setError("");
    setCfg({ ...draft, open, cls });
  };

  const m = useEditorMount(
    async (host) => {
      const { createEditor, defineInlineSyntax } = await loadCore();
      // Keep what the visitor typed unless the delimiter changed: the old text would not contain the new marker.
      const value = lastOpen.current === cfg.open && keep.current !== null ? keep.current : `Wrap text in ${cfg.open}your own marker${cfg.open} to apply it. ${cfg.open}Another one${cfg.open}.`;
      lastOpen.current = cfg.open;
      const syntax = defineInlineSyntax({ name: "custom", open: cfg.open, tag: cfg.tag as never, className: cfg.cls });
      const ed = createEditor(host, await base({ value, syntax: { inline: [syntax] }, onChange: (v: string) => ((keep.current = v), setMd(v)) }));
      keep.current = ed.getValue();
      setMd(ed.getValue());
      return ed;
    },
    [cfg],
  );

  return (
    <>
      <style>{`.${cfg.cls}{background:${/^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color : "#fde68a"};color:#0b0f17;border-radius:4px;padding:0 .25em}`}</style>
      <form className="controls" aria-label="Define a syntax" autoComplete="off" onSubmit={apply}>
        <div className="field">
          <label htmlFor="syn-open">Delimiter</label>
          <input id="syn-open" name="open" type="text" value={draft.open} size={4} maxLength={4} onChange={(e) => setDraft({ ...draft, open: e.target.value })} spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="syn-tag">Tag</label>
          <select id="syn-tag" name="tag" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })}>
            {TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="syn-cls">Class</label>
          <input id="syn-cls" name="cls" type="text" value={draft.cls} size={10} onChange={(e) => setDraft({ ...draft, cls: e.target.value })} spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="syn-color">Colour</label>
          <input id="syn-color" name="color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        </div>
        <button type="submit" className="btn btn--primary btn--sm">
          Apply
        </button>
      </form>
      <p className="err" role="alert" data-testid="syntax-error">
        {error}
      </p>
      <DemoHost {...m} minHeight={130} label="Live demo: your own syntax" />
      <p className="fcard__hint">
        <code data-testid="syntax-generated">{`defineInlineSyntax({ name: "custom", open: ${JSON.stringify(cfg.open)}, tag: ${JSON.stringify(cfg.tag)}, className: ${JSON.stringify(cfg.cls)} })`}</code>
      </p>
      <pre className="out" role="region" tabIndex={0} aria-label="Markdown stored" data-testid="syntax-out">
        {md}
      </pre>
    </>
  );
}

/* ───────────────────────────────────────── drafts, find, images, handles, collapsible ───────────────────────────────────────── */

export function DraftsDemo() {
  const m = useEditorMount(async (host) => {
    const [{ createEditor }, { createDraftsPlugin }] = await Promise.all([loadCore(), loadPlugins()]);
    return createEditor(
      host,
      await base({
        value: "",
        placeholder: "Type something, wait a second, then reload the page…",
        plugins: [createDraftsPlugin({ key: "atm-site-demo-draft", restorePrompt: "ask" })],
        features: { statusBar: true },
      }),
    );
  });
  return <DemoHost {...m} minHeight={150} label="Live demo: drafts" />;
}

export function FindDemo() {
  const m = useEditorMount(async (host) => {
    const [{ createEditor }, { createFindReplacePlugin }] = await Promise.all([loadCore(), loadPlugins()]);
    return createEditor(
      host,
      await base({
        value: 'The quick brown fox jumps over the lazy dog. The dog did not mind, and the fox was gone before the third *the*.\n\nSearch for "the", try match case or a regular expression such as `\\bthe\\b`.\n',
        plugins: [createFindReplacePlugin()],
      }),
    );
  });
  return (
    <>
      <DemoHost {...m} minHeight={170} label="Live demo: find and replace" />
      <div className="controls">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            m.editor.current?.focus();
            m.editor.current?.exec("find");
          }}
        >
          Open find bar
        </button>
      </div>
    </>
  );
}

export function ImagesDemo() {
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    return createEditor(
      host,
      await base({
        minHeight: 220,
        maxHeight: 420,
        value: `![Quarterly results|center|300](${SITE.basePath}/sample.svg "Q1 to Q3")\n\nClick the picture.\n`,
        links: LINKS,
        images: { zoom: true },
      }),
    );
  });
  return <DemoHost {...m} minHeight={300} label="Live demo: images" />;
}

export function HandlesDemo() {
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    return createEditor(
      host,
      await base({
        minHeight: 180,
        value: "## Hover a block\n\nEach top-level block, and each list item, gets a handle. Drag it, or press Alt+Shift+H and then Alt+ArrowUp / Alt+ArrowDown.\n\n- First item\n- Second item\n- Third item\n\nThe Markdown never changes shape because of a handle.\n",
      }),
    );
  });
  return <DemoHost {...m} minHeight={290} label="Live demo: block handles" />;
}

export function CollapsibleDemo() {
  const m = useEditorMount(async (host) => {
    const { createEditor } = await loadCore();
    return createEditor(
      host,
      await base({ value: "::: details Release notes\nHidden until opened. The summary is editable.\n:::\n\n::: details open Shown by default\nAdd `open` before the title.\n:::\n" }),
    );
  });
  return <DemoHost {...m} minHeight={190} label="Live demo: collapsible sections" />;
}

/* ───────────────────────────────────────── themes, tokens, Tailwind ───────────────────────────────────────── */

const PRESETS = ["light", "dark", "sepia", "slate", "contrast"] as const;

export function ThemesDemo() {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("sepia");
  const [custom, setCustom] = useState(false);
  const [accent, setAccent] = useState("#0e7490");
  const [radius, setRadius] = useState(14);
  const m = useEditorMount(
    async (host) => {
      const { createEditor } = await loadCore();
      return createEditor(
        host,
        await base({
          theme: preset as never,
          value: "## Themes and tokens\n\nPick a preset, or turn on **custom tokens** and change the accent and the corner radius. Mention [@Ada](mention:team-a/p01) too.",
          chips: CHIPS,
        }),
      );
    },
    [],
    { followTheme: false },
  );
  // Both change in place: the editor is not rebuilt, so the caret and the undo history survive.
  const tokens = { accent, radius: `${radius}px`, palette: ["#e11d48", "#0d9488", accent] };
  const apply = custom ? tokens : preset;
  const key = custom ? JSON.stringify(tokens) : preset;
  useEffect(() => {
    if (m.ready) m.editor.current?.setTheme(apply as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.ready, key]);
  return (
    <>
      <div className="controls">
        <fieldset className="pg__group">
          <legend>Preset</legend>
          <div className="seg">
            {PRESETS.map((p) => (
              <label key={p}>
                <input type="radio" name="theme-demo-preset" value={p} checked={preset === p} onChange={() => (setPreset(p), setCustom(false))} />
                <span>{p}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="controls">
        <label className="check">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Custom tokens
        </label>
        <div className="field">
          <label htmlFor="tk-accent">Accent</label>
          <input id="tk-accent" type="color" value={accent} onChange={(e) => (setAccent(e.target.value), setCustom(true))} />
        </div>
        <div className="field">
          <label htmlFor="tk-radius">Radius {radius}px</label>
          <input id="tk-radius" type="range" min={0} max={28} value={radius} onChange={(e) => (setRadius(Number(e.target.value)), setCustom(true))} />
        </div>
      </div>
      <DemoHost {...m} minHeight={190} label="Live demo: themes and tokens" />
    </>
  );
}
