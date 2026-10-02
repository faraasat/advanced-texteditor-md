// A consumer's view of the package: every subpath imported by NAME (self-reference through the
// package "exports"), the way an application would, type-checked by `npm run check:package`
// against the built d.ts files. Not part of the unit test run (it needs `dist/`).
import { createEditor, preloadChunks, parse, stringify, renderHtml, definePlugin, DEFAULT_LABELS, VERSION } from "advanced-texteditor-md";
import type { EditorOptions, EditorInstance, Plugin, MentionItem, LinkPreview, EmbedProvider, RenderOptions } from "advanced-texteditor-md";
import { parse as parse2 } from "advanced-texteditor-md/parser";
import { renderHtml as renderHtml2, renderDom, renderMarkdown } from "advanced-texteditor-md/render";
import { createMathRenderer, texToMathML } from "advanced-texteditor-md/math";
import { createHighlighter, defineLanguage } from "advanced-texteditor-md/highlight";
import javascript from "advanced-texteditor-md/highlight/javascript";
import python from "advanced-texteditor-md/highlight/python";
import { createPutUploader, createFormUploader, createPresignedUploader, createDataUrlUploader, validateFile, urlAllowed } from "advanced-texteditor-md/uploaders";
import { highlightMark, callout, kbd, subSup } from "advanced-texteditor-md/plugins";
import { createMentionController, mentionHref, parseMentionHref } from "advanced-texteditor-md/mentions";
import { htmlToMarkdown, looksLikeMarkdown } from "advanced-texteditor-md/paste";
import { createLinkPreviewController, checkPreviewUrl } from "advanced-texteditor-md/link-preview";
import { BUILTIN_EMBEDS, matchEmbed, createEmbedElement, defineEmbed } from "advanced-texteditor-md/embeds";
import "advanced-texteditor-md/style.css";
import "advanced-texteditor-md/style.min.css";
import "advanced-texteditor-md/tailwind.css";

const people: MentionItem[] = [{ id: "1", label: "Ada", kind: "person", badge: "Team", color: 3, refs: { crm: "9" } }];
const embeds: EmbedProvider[] = [...BUILTIN_EMBEDS, defineEmbed({ name: "Mine", match: /^https:\/\/example\.com\/v\/(\d+)$/, embedUrl: (m) => `https://player.example.com/${m[1]}`, embedHosts: ["player.example.com"] })];
const preview: LinkPreview = { url: "https://example.com", title: "t" };

const options: EditorOptions = {
  value: "# hi",
  layout: "classic",
  theme: "auto",
  plugins: [highlightMark, callout, kbd, subSup, definePlugin({ name: "mine" }) satisfies Plugin],
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
void preloadChunks();
const ropts: RenderOptions = { embeds, linkPreview: { resolve: async () => null }, labels: { code: "Code" } };
export const all = [
  VERSION, DEFAULT_LABELS, parse, parse2, stringify, renderHtml, renderHtml2, renderDom, renderMarkdown, texToMathML, createFormUploader,
  createPresignedUploader, createDataUrlUploader, validateFile, urlAllowed, createMentionController, mentionHref, parseMentionHref,
  htmlToMarkdown, looksLikeMarkdown, createLinkPreviewController, checkPreviewUrl, matchEmbed, createEmbedElement, ed, ropts,
];
