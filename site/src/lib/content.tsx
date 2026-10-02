// The landing page's static content. Facts come from the README and docs/: change them there first.
import type { ReactNode } from "react";
import type { KeyGroup, RoadItem } from "@/components/blocks";
import type { IconName } from "@/components/icons";

export const TILES: { icon: IconName; title: string; text: ReactNode }[] = [
  { icon: "pen", title: "Stores Markdown, always", text: <>You edit rendered content; <code>getValue()</code> is plain GFM plus mentions, chips, math and your own syntax. HTML is never the stored form.</> },
  { icon: "package", title: "Zero dependencies", text: "No runtime dependencies and no eval. Raw HTML in Markdown is never interpreted." },
  { icon: "layout", title: "Six layouts, five themes", text: "Classic, minimal, bubble, bottom-bar, split and document, in light, dark, sepia, slate and high contrast." },
  { icon: "at", title: "Mentions and chips", text: "A combobox menu with badges, colours and grouping. One person known to two systems is one chip that carries both ids." },
  { icon: "upload", title: "Uploads with guardrails", text: "Allow and deny lists, size and count limits, progress and abort, and a link policy for the returned URL." },
  { icon: "sigma", title: "Math and code", text: "A built-in TeX subset rendered to MathML, and ten tiny language modules for highlighting, each under 2 kB gzip." },
  { icon: "link", title: "Embeds and link previews", text: "Hover cards, link cards and sandboxed iframes for known providers. The resolver runs on your server." },
  { icon: "plug", title: "Plugins and your own syntax", text: "Add syntax, toolbar buttons, slash entries, commands and hooks. Define a delimiter, a tag and a class and it works everywhere." },
  { icon: "access", title: "Accessible by default", text: "An ARIA toolbar, a combobox mention menu, managed focus and live regions. axe-checked in CI across layouts and themes." },
  { icon: "zap", title: "Lazy by design", text: "Popovers, slash menu, uploads, math, rich links and the Markdown pane are separate chunks that load on first use." },
  { icon: "server", title: "Server-safe", text: <>Every entry imports on a server; only <code>createEditor</code> touches <code>document</code>. <code>renderHtml</code> is pure string output.</> },
  { icon: "wind", title: "Tailwind-friendly", text: <>Plain CSS driven by <code>--atm-*</code> variables, an optional Tailwind v4 bridge, and <code>classNames</code> for every slot.</> },
];

export const KEYS: KeyGroup[] = [
  {
    title: "Text",
    keys: [
      { label: "Bold", combo: ["Mod", "B"] },
      { label: "Italic", combo: ["Mod", "I"] },
      { label: "Strikethrough", combo: ["Mod", "Shift", "X"] },
      { label: "Inline code", combo: ["Mod", "E"] },
      { label: "Link", combo: ["Mod", "K"] },
      { label: "Clear formatting", combo: ["Mod", "\\"] },
    ],
  },
  {
    title: "Blocks",
    keys: [
      { label: "Heading 1 to 6", combo: ["Mod", "Alt", "1…6"] },
      { label: "Paragraph", combo: ["Mod", "Alt", "0"] },
      { label: "Bulleted list", combo: ["Mod", "Shift", "8"] },
      { label: "Numbered list", combo: ["Mod", "Shift", "7"] },
      { label: "Task list", combo: ["Mod", "Shift", "L"] },
      { label: "Quote", combo: ["Mod", "Shift", "9"] },
      { label: "Code block", combo: ["Mod", "Alt", "C"] },
      { label: "Math block", combo: ["Mod", "Shift", "M"] },
    ],
  },
  {
    title: "Everything else",
    keys: [
      { label: "Undo", combo: ["Mod", "Z"] },
      { label: "Redo", combo: ["Mod", "Shift", "Z"] },
      { label: "Mention", combo: ["@"] },
      { label: "Slash menu", combo: ["/"] },
      { label: "Find (plugin)", combo: ["Mod", "F"] },
      { label: "Block handle", combo: ["Alt", "Shift", "H"] },
      { label: "Move a block", combo: ["Alt", "↑ / ↓"] },
      { label: "Image toolbar", combo: ["Alt", "F10"] },
      { label: "Submit (bottom-bar)", combo: ["Mod", "Enter"] },
    ],
  },
];

export const COMPARE_HEAD = ["Measure", "advanced-texteditor-md", "Tiptap", "Lexical", "Milkdown"];
export const COMPARE_ROWS: ReactNode[][] = [
  ["Initial JS, gzip", <><b>62.4 kB</b> (106.6 kB with every lazy chunk, which load on first use)</>, "139.4 kB", "137.3 kB", "137.0 kB"],
  ["Transitive dependencies of that setup", <b key="d">0</b>, "44", "19", "146"],
  ["Markdown", "The stored document, always", <>A separate package, <code>@tiptap/markdown</code> (built on <code>marked</code>)</>, <>A separate package, <code>@lexical/markdown</code></>, "Built on remark and unified"],
  ["Toolbar, slash menu, mentions, uploads in that number", "Included (toolbar and slash menu eager, the rest lazy)", <><b>Not</b>: headless, you build them</>, <><b>Not</b>: headless</>, <><b>Not</b>: headless</>],
];
export const COMPARE_NOTE = (
  <>
    Measured 2026-10-02: the smallest setup of each library that creates an editor holding a Markdown document, bundled with esbuild, then gzip -9 of the initial JavaScript. The others are toolkits and their
    numbers are for a bare editor with no toolbar or UI. We have not compared speed, memory, accessibility or editing quality. <strong>Choose Tiptap, Lexical or Milkdown instead</strong> when you need real-time
    collaboration, a document model beyond Markdown, a large extension ecosystem or years of production use. <strong>Choose this package</strong> when Markdown must stay the stored form, you want zero
    dependencies and a small first download.
  </>
);

export const SUPPORT_HEAD = ["Engine", "Tested how", "Versions"];
export const SUPPORT_ROWS: ReactNode[][] = [
  ["Chromium (Chrome, Edge)", "Playwright, desktop and a Pixel 7 mobile emulation, every spec", "Playwright's bundled Chromium (current stable)"],
  ["Firefox", "Playwright, every editing spec", "Playwright's bundled Firefox (current stable)"],
  ["WebKit (Safari)", "Playwright, every editing spec", "Playwright's bundled WebKit (current stable)"],
  ["iOS Safari, Android Chrome", <><strong>Not run on real devices.</strong> Mobile emulation only</>, "Not claimed"],
];

export const ROADMAP: RoadItem[] = [
  { tag: "Out of scope", title: "Collaboration and rich document models", text: "Collaborative editing, comments and suggestions, nested block drag-and-drop, HTML passthrough, and a footnote editing UI beyond text are not planned for 0.x." },
  { tag: "Known gap", title: "No OS emoji panel", text: <>A web page cannot open it. The button explains the shortcut, and <code>emoji.open</code> lets you plug your own picker.</> },
  { tag: "Known gap", title: "Real devices", text: "iOS and Android are emulated, not run. Report what you see." },
  { tag: "Known gap", title: "Link-preview and embed fetching is yours", text: <><code>resolve</code> must run on your server: SSRF protection is not something a browser library can do.</> },
  { tag: "Known gap", title: "Plugin toolbar items on a phone", text: "A custom item with its own render (the text-colour swatch) does nothing from the narrow toolbar's More menu yet." },
  { tag: "Limit", title: "Size", text: "The editor entry is about 62 kB gzip against a 48 kB target; the last 13 kB cannot be lazy without making typing asynchronous." },
  { tag: "Pre-1.0", title: "The API can still change", text: "Between minor versions. The changelog says what moved." },
];

export const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Can the emoji button open the OS emoji panel?",
    a: (
      <>
        <p>
          No: a web page cannot open it. The button focuses the editor and shows the shortcut (macOS <kbd>Ctrl</kbd> <kbd>Cmd</kbd> <kbd>Space</kbd>, Windows <kbd>Win</kbd> <kbd>.</kbd>, Linux <kbd>Ctrl</kbd> <kbd>.</kbd>);
          the characters then arrive as normal text.
        </p>
        <p>
          To use your own picker pass <code>emoji: {"{ open: (editor) => ... }"}</code>, or <code>emoji: false</code> to remove the button. No emoji data ships in the package.
        </p>
      </>
    ),
  },
  { q: "Does the editor store HTML?", a: <p>Never. <code>getValue()</code> is Markdown and the only stored form. <code>getHtml()</code> is a sanitised view of the current document.</p> },
  { q: "Why is a pasted table or a plugin missing from getHtml() right after load?", a: <p>Some features are lazy chunks. Await <code>preloadChunks()</code> if you need them synchronously.</p> },
  { q: "Why does my formula show as source for a moment?", a: <p>The math renderer is a lazy chunk, so the first formula waits for it. Pass your own <code>math.renderer</code>, or <code>preloadChunks()</code>, to avoid the wait.</p> },
  { q: "Does the library collect any data?", a: <p>No. It makes no network request on its own, loads no script and sends no telemetry. This demo site counts visits with a cookieless service and uses Google Analytics only if you accept; see the Privacy page.</p> },
  { q: "Is there a React version?", a: <p>Yes: <a href="https://github.com/faraasat/react-advanced-texteditor-md">react-advanced-texteditor-md</a> wraps this editor in a controlled or uncontrolled component, a server-component friendly renderer and hooks.</p> },
];
