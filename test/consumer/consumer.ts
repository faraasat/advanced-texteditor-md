// A consumer's view of the package: every subpath imported by NAME (self-reference through the
// package "exports"), the way an application would, type-checked by `npm run check:package`
// against the built d.ts files. Not part of the unit test run (it needs `dist/`).
import { createEditor, preloadChunks, parse, stringify, renderHtml, definePlugin, DEFAULT_LABELS, VERSION } from "advanced-texteditor-md";
import type { EditorOptions, EditorInstance, PostRenderContext, Plugin, MentionItem, LinkPreview, EmbedProvider, RenderOptions } from "advanced-texteditor-md";
import { parse as parse2 } from "advanced-texteditor-md/parser";
import { renderHtml as renderHtml2, renderDom, renderMarkdown } from "advanced-texteditor-md/render";
import { createMathRenderer, texToMathML } from "advanced-texteditor-md/math";
import { createHighlighter, defineLanguage } from "advanced-texteditor-md/highlight";
import javascript from "advanced-texteditor-md/highlight/javascript";
import python from "advanced-texteditor-md/highlight/python";
import { createPutUploader, createFormUploader, createPresignedUploader, createDataUrlUploader, validateFile, urlAllowed } from "advanced-texteditor-md/uploaders";
import {
  highlightMark, callout, kbd, subSup, hydrateAll, createFindReplacePlugin, createDraftsPlugin, createTocPlugin, createTextStylePlugin,
  createSmartTypographyPlugin, createShortcodesPlugin, DRAFT_EDITOR_EVENT, findMatches, hydrateToc, restyleMarkdown,
} from "advanced-texteditor-md/plugins";
import type { FindReplaceOptions, DraftsOptions, TocItem, ShortcodesOptions } from "advanced-texteditor-md/plugins";
import { createMentionController, mentionHref, parseMentionHref } from "advanced-texteditor-md/mentions";
import { htmlToMarkdown, looksLikeMarkdown } from "advanced-texteditor-md/paste";
import { createLinkPreviewController, checkPreviewUrl } from "advanced-texteditor-md/link-preview";
import { BUILTIN_EMBEDS, matchEmbed, createEmbedElement, defineEmbed } from "advanced-texteditor-md/embeds";
import { attachLightbox, LIGHTBOX_LABELS } from "advanced-texteditor-md/lightbox";
import type { Lightbox, LightboxOptions } from "advanced-texteditor-md/lightbox";
import "advanced-texteditor-md/style.css";
import "advanced-texteditor-md/style.min.css";
import "advanced-texteditor-md/plugins.css";
import "advanced-texteditor-md/tailwind.css";

const people: MentionItem[] = [{ id: "1", label: "Ada", kind: "person", badge: "Team", color: 3, refs: { crm: "9" } }];
const embeds: EmbedProvider[] = [...BUILTIN_EMBEDS, defineEmbed({ name: "Mine", match: /^https:\/\/example\.com\/v\/(\d+)$/, embedUrl: (m) => `https://player.example.com/${m[1]}`, embedHosts: ["player.example.com"] })];
const preview: LinkPreview = { url: "https://example.com", title: "t" };

const options: EditorOptions = {
  value: "# hi",
  layout: "classic",
  theme: "auto",
  plugins: [
    highlightMark, callout, kbd, subSup,
    createFindReplacePlugin({ replace: true } satisfies FindReplaceOptions),
    createDraftsPlugin({ key: "x" } satisfies DraftsOptions),
    createTocPlugin(), createTextStylePlugin({ underline: true }), createSmartTypographyPlugin({ locale: "de" }),
    createShortcodesPlugin({ shortcodes: { smile: "x" } } satisfies ShortcodesOptions),
    definePlugin({
      name: "mine",
      keydown: (ev: KeyboardEvent, e: EditorInstance) => ev.key === "x" && e.isReadOnly(),
      afterInput: (e: EditorInstance, info?: { inputType: string; data: string | null }) => void (e.getValue() + (info?.data ?? "")),
      postRender: (root: HTMLElement, ctx: PostRenderContext) => void (root.id + ctx.mode + ctx.doc.children.length),
    }) satisfies Plugin,
  ],
  highlight: createHighlighter([javascript, python, defineLanguage({ name: "x", rules: [] })]),
  math: { renderer: createMathRenderer() },
  mentions: { search: async () => people },
  upload: { handler: createPutUploader({ endpoint: (f: File) => `/up/${f.name}` }) },
  linkPreview: { resolve: async () => preview },
  embeds,
  onChange: (md: string, ed: EditorInstance) => void (ed.getValue().length + md.length),
};

declare const host: HTMLElement;
const ed: EditorInstance = createEditor(host, options);
const done = ed.transact(() => 1 + (ed.getPane()?.getValue().length ?? 0));
ed.emit("plugin:mine:x", { n: done });
const offX = ed.on("plugin:mine:x", (p: unknown) => void p);
const offPane = ed.on("pane", (k: "wysiwyg" | "markdown") => void k);
ed.replaceSelectionMarkdown(ed.getSelectionMarkdown());
const outline: TocItem[] = [];
void preloadChunks();
const ropts: RenderOptions = { embeds, linkPreview: { resolve: async () => null }, labels: { code: "Code" }, postRender: [(root, ctx) => void (root.id + ctx.mode)] };
const lbOpts: LightboxOptions = { labels: { lightboxClose: LIGHTBOX_LABELS.lightboxClose } };
const lightbox: Lightbox = attachLightbox(document.body, lbOpts);
const chipMap: RenderOptions = { chips: { task: { scheme: "task", className: "task-chip" } } };
const submitted: EditorOptions = { onSubmit: (md: string, e: EditorInstance) => void (md + e.getValue()) };
export const all = [
  lightbox, chipMap, submitted,
  VERSION, DEFAULT_LABELS, parse, parse2, stringify, renderHtml, renderHtml2, renderDom, renderMarkdown, texToMathML, createFormUploader,
  createPresignedUploader, createDataUrlUploader, validateFile, urlAllowed, createMentionController, mentionHref, parseMentionHref,
  htmlToMarkdown, looksLikeMarkdown, createLinkPreviewController, checkPreviewUrl, matchEmbed, createEmbedElement, ed, ropts, hydrateAll, hydrateToc, findMatches, restyleMarkdown, DRAFT_EDITOR_EVENT, offX, offPane, outline,
];
