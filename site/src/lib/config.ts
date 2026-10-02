/** Everything that differs between this site and its sibling lives here; the shell components read it. */
export const SITE = {
  name: "advanced-texteditor-md",
  repo: "faraasat/advanced-texteditor-md",
  url: "https://faraasat.github.io/advanced-texteditor-md/",
  tagline: "A dependency-free WYSIWYG editor that stores Markdown.",
  description:
    "A dependency-free WYSIWYG editor that stores Markdown. Mentions, uploads, math, code highlighting, embeds, plugins and your own syntax. Six layouts, five themes, accessible.",
  themeKey: "atm-site-theme",
  /** The in-page links in the top bar, before Docs. */
  nav: [
    { href: "/#playground", label: "Playground" },
    { href: "/#features", label: "Features" },
  ],
  /** The GitHub Pages base path ("" in local development). Set by next.config.ts. */
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
} as const;

/** The one place the analytics identifiers live. They are public client-side identifiers, not secrets. */
export const ANALYTICS = {
  aptabaseKey: "A-EU-1115968085",
  aptabaseUrl: "https://eu.aptabase.com/api/v0/event", // the EU region of the App Key
  gaId: "G-YRHCN30NWG",
  consentKey: "atm-site-consent",
} as const;
