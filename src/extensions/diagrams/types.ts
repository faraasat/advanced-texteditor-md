/** What a host renderer may return. An element is the host's own DOM; a string is untrusted markup. */
export type DiagramOutput = HTMLElement | SVGElement | string;

export type DiagramContext = {
  /** The (lower-cased) language of the fenced block. */
  lang: string;
  /** The info string after the language, parsed as `key="value"` pairs (see `parseDiagramMeta`). */
  meta: Record<string, string>;
  /** Aborted when the code changes before this render finished, and on destroy. */
  signal: AbortSignal;
  /** From the nearest `data-atm-theme`, else `prefers-color-scheme`. */
  theme: "light" | "dark";
  /** Unique and stable for the life of the block. */
  id: string;
};

export type DiagramRenderer = (code: string, ctx: DiagramContext) => DiagramOutput | Promise<DiagramOutput>;

export type DiagramsLabels = {
  /** Accessible name of the diagram region when the block has no `title=`. `{lang}` is the capitalised language. Default "{lang} diagram". */
  diagram: string;
  /** Shown while a render runs. Default "Rendering diagram…". */
  loading: string;
  /** Prefix of a renderer error. Default "Could not render the diagram". */
  error: string;
  /** Marks a kept-over previous render after a failure. Default "Showing the last good render". */
  stale: string;
  /** Read-only views, `mode: "replace"`. Default "Show source" / "Hide source". */
  showSource: string;
  hideSource: string;
  /** Read-only views, `mode: "below"`. Default "Show code" / "Hide code". */
  showCode: string;
  hideCode: string;
  /** Toolbar and slash item. Default "Diagram". */
  insert: string;
};

export type DiagramsOptions = {
  /**
   * `{ mermaid: (code, ctx) => element | svg | string | Promise<...> }`. Keys are fence languages,
   * compared lower-case and as plain keys (nothing is inherited from `Object.prototype`).
   */
  renderers: Record<string, DiagramRenderer>;
  /**
   * `true`, or `{ lang: true }`: strings from that renderer are parsed as markup (sanitised, see
   * `sanitizeMarkup`) instead of being shown inside a sandboxed iframe. Default false.
   */
  trust?: boolean | Record<string, boolean>;
  /** Wait after the last edit in a block before re-rendering, ms. Default 300. */
  debounceMs?: number;
  /**
   * Read-only views: "replace" (default) shows the diagram instead of the code, with a "Show
   * source" toggle; "below" shows the diagram and keeps the code behind a "Show code" toggle under it.
   * The editor surface always shows the code with the preview under it.
   */
  mode?: "replace" | "below";
  /** Results kept by (language, theme, meta, code). Default 50. */
  cacheSize?: number;
  /** Size of the sandboxed iframe a string output goes into (its content cannot be measured). */
  frame?: { height?: number; aspectRatio?: string };
  /** Render blocks only once they are on screen (IntersectionObserver when present). Default true. */
  lazy?: boolean;
  labels?: Partial<DiagramsLabels>;
  /** Called when a renderer throws or rejects (not for an aborted render). */
  onError?: (error: unknown, ctx: DiagramContext) => void;
};
