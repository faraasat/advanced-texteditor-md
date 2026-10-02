import { Code } from "@/components/code";
import { FeatureCard } from "@/components/feature-card";
import { Faq, DataTable, FeatureGrid, Roadmap, Shortcuts } from "@/components/blocks";
import { Hero } from "@/components/hero";
import { InstallTabs } from "@/components/install-tabs";
import { Playground } from "@/components/playground";
import { Section } from "@/components/section";
import { FeatureDemo } from "@/demos/feature-demo";
import { COMPARE_HEAD, COMPARE_NOTE, COMPARE_ROWS, FAQS, KEYS, ROADMAP, SUPPORT_HEAD, SUPPORT_ROWS, TILES } from "@/lib/content";
import { editorGzipKb, readPackage } from "@/lib/facts";
import { FEATURES } from "@/lib/features";

const QUICK = `import { createEditor } from "advanced-texteditor-md";
import "advanced-texteditor-md/style.css"; // or style.min.css, or tailwind.css

const editor = createEditor(document.getElementById("editor")!, {
  value: "# Hello\\n\\nSome **bold** text.",
  placeholder: "Write something...",
  onChange: (markdown) => save(markdown),
});

editor.getValue();        // Markdown, the only stored form
editor.setValue("# New"); // does not fire onChange
editor.getHtml();         // sanitised HTML of the current document
editor.destroy();`;

const SERVER = `import { renderHtml } from "advanced-texteditor-md/render";

// Pure string output, safe on a server. Raw HTML in the Markdown is never interpreted.
const html = renderHtml(markdown, { links: { allowedHosts: ["example.com"] } });`;

export default function Page() {
  const { version, dependencies } = readPackage();
  const kb = editorGzipKb();
  return (
    <>
      <Hero
        eyebrow={`v${version} · MIT`}
        title={
          <>
            You edit rich text. <em>It stores Markdown.</em>
          </>
        }
        sub="A dependency-free WYSIWYG editor with mentions, uploads, math, code highlighting, embeds, plugins and syntax of your own. Plain CSS with variables, an optional Tailwind v4 bridge, six layouts and five themes."
        install="advanced-texteditor-md"
        badges={[
          { k: "npm", v: `v${version}`, accent: true },
          { k: "gzip", v: kb ? `${kb} kB` : "small" },
          { k: "dependencies", v: String(dependencies) },
          { k: "types", v: "included" },
          { k: "license", v: "MIT" },
        ]}
        extraLink={{ label: "React bindings", href: "https://faraasat.github.io/react-advanced-texteditor-md/" }}
      />

      <Section id="playground" title="Playground" sub={<>The real library, every layout, theme and mode. Type <kbd>@</kbd> to mention someone, <kbd>/</kbd> for blocks, or drop an image. The Markdown below is exactly what <code>getValue()</code> returns.</>}>
        <Playground />
      </Section>

      <Section id="why" title="What you get" sub="One small package, no framework, and the features you would otherwise assemble by hand.">
        <FeatureGrid items={TILES} />
      </Section>

      <Section id="features" title="Features, live" sub="Each card is a small editor you can use, with the code that configures it. They load when you scroll to them.">
        <div className="feat">
          {FEATURES.map((f) => (
            <div key={f.id} className={f.wide ? "feat__wide" : undefined} style={{ minWidth: 0 }}>
              <FeatureCard id={f.id} title={f.title} text={f.text} hint={f.hint} icon={f.icon || "pen"} code={<Code language={f.lang ?? "ts"} label={`${f.id}.ts`.replace(/\.ts$/, f.lang === "markdown" ? ".md" : ".ts")} copyTarget={`feature-${f.id}`}>{f.code}</Code>}>
                <FeatureDemo id={f.id} />
              </FeatureCard>
            </div>
          ))}
        </div>
      </Section>

      <Section id="install" title="Install" sub="Pick your package manager. Plain TypeScript or JavaScript, any bundler that supports import().">
        <div className="grid grid--2">
          <div className="card">
            <h3>Add it</h3>
            <p className="sub">The main entry is the editor plus the parser and renderers. Everything else is a subpath, so you only pay for what you import.</p>
            <InstallTabs packages="advanced-texteditor-md" label="Install the editor" />
          </div>
          <div className="card">
            <h3>Render on a server</h3>
            <p className="sub">Server-only use never needs the editor.</p>
            <Code language="ts" label="render.ts">
              {SERVER}
            </Code>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <Code language="ts" label="quick-start.ts" copyTarget="quick-start">
            {QUICK}
          </Code>
        </div>
      </Section>

      <Section id="shortcuts" title="Keyboard shortcuts" sub={<><kbd>Mod</kbd> is <kbd>Cmd</kbd> on macOS and <kbd>Ctrl</kbd> elsewhere. The toolbar shows the right one for your platform, and every binding can be overridden with <code>keymap</code>.</>}>
        <Shortcuts groups={KEYS} />
      </Section>

      <Section id="compare" title="How it compares" sub="Measured, not guessed. These are toolkits with a different job: read the notes before choosing.">
        <DataTable caption="Comparison with Tiptap, Lexical and Milkdown" head={COMPARE_HEAD} rows={COMPARE_ROWS} usColumn={1} />
        <p className="note">{COMPARE_NOTE}</p>
      </Section>

      <Section id="browsers" title="Browser support" sub="contenteditable, selection and clipboard differ most across engines, so every editing spec runs on all three.">
        <DataTable caption="Browser support matrix" head={SUPPORT_HEAD} rows={SUPPORT_ROWS} />
        <p className="note">The code targets ES2020, Selection and ResizeObserver. The engine differences the editor smooths over are listed in the Decisions doc.</p>
      </Section>

      <Section id="roadmap" title="Roadmap and known gaps" sub="An honest list, taken from the architecture and decisions docs.">
        <Roadmap items={ROADMAP} />
      </Section>

      <Section id="faq" title="FAQ">
        <Faq items={FAQS} />
      </Section>
    </>
  );
}
