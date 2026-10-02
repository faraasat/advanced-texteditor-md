import { Highlight, type PrismTheme } from "prism-react-renderer";
import { CopyButton } from "./copy-button";

/**
 * Highlighted with prism-react-renderer at BUILD time: the page ships the coloured markup and no highlighter code.
 * The colours are CSS variables, so the one rendered page follows the light / dark toggle with no JavaScript.
 */
const theme: PrismTheme = {
  plain: { color: "var(--fg)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "cdata", "doctype"], style: { color: "var(--tok-comment)", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "var(--tok-punct)" } },
    { types: ["tag", "operator", "keyword", "selector", "atrule"], style: { color: "var(--tok-keyword)" } },
    { types: ["function", "class-name", "function-variable"], style: { color: "var(--tok-function)" } },
    { types: ["string", "char", "attr-value", "template-string"], style: { color: "var(--tok-string)" } },
    { types: ["number", "boolean", "constant", "symbol"], style: { color: "var(--tok-number)" } },
    { types: ["attr-name", "property", "variable"], style: { color: "var(--tok-attr)" } },
    { types: ["builtin", "regex", "maybe-class-name"], style: { color: "var(--tok-builtin)" } },
    { types: ["deleted"], style: { color: "var(--tok-del)" } },
    { types: ["inserted"], style: { color: "var(--tok-ins)" } },
  ],
};

export type Language = "tsx" | "ts" | "jsx" | "js" | "bash" | "css" | "json" | "html" | "markdown";

export function Code({ children, language = "tsx", label, copyTarget }: { children: string; language?: Language; label?: string; copyTarget?: string }) {
  const code = children.trim();
  return (
    <figure className="code">
      <figcaption className="code__bar">
        <span className="code__lang">{label ?? language}</span>
        <CopyButton text={code} target={copyTarget ?? label ?? language} />
      </figcaption>
      <Highlight theme={theme} code={code} language={language}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          // tabIndex keeps the horizontally scrollable region reachable by keyboard (axe: scrollable-region-focusable).
          <pre className="code__pre" style={style} role="region" tabIndex={0} aria-label={label ? `Code: ${label}` : "Code"}>
            <code>
              {tokens.map((line, i) => (
                <span key={i} {...getLineProps({ line })} className="code__line">
                  {line.map((token, k) => (
                    <span key={k} {...getTokenProps({ token })} />
                  ))}
                </span>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </figure>
  );
}
