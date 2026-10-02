import type { PasteOptions } from "../../features/paste";

/**
 * Reading a file into Markdown. Pure apart from `File.arrayBuffer()`; server-safe at import.
 *
 * Accepted: .md .markdown (Markdown, taken as is), .txt (plain text, ESCAPED so it reads back as the
 * same text; `txt: "markdown"` takes it as Markdown instead) and .html .htm (through the library's
 * inert HTML-to-Markdown converter and the link policy). A .docx is NOT accepted: it is a zipped
 * OOXML package, and reading one needs an unzip and an OOXML parser, which is far beyond the size
 * budget of this module and would be a dependency.
 */

export type ImportKind = "markdown" | "text" | "html";

export type ImportFailure = "unsupported" | "too-large" | "binary" | "empty" | "unreadable";

export type ImportResult =
  | { ok: true; kind: ImportKind; markdown: string; name: string; size: number }
  | { ok: false; reason: ImportFailure; name: string; size: number };

export type ImportOptions = {
  /** Largest file read, in bytes. Default 2 MB (2 * 1024 * 1024). */
  maxBytes?: number;
  /** Link and image policy for HTML (`PasteOptions.links`). */
  links?: PasteOptions["links"];
  /** Take a .txt file as "text" (escaped, default) or as "markdown". */
  txt?: "text" | "markdown";
};

export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** The `accept` list of the file picker. */
export const IMPORT_ACCEPT = ".md,.markdown,.txt,.html,.htm,text/markdown,text/plain,text/html";

const EXT: Record<string, ImportKind> = { md: "markdown", markdown: "markdown", txt: "text", html: "html", htm: "html" };

/** What kind of file this is, by extension first, then MIME type. null: not importable. */
export function classifyFile(name: string, type = ""): ImportKind | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  if (m) return EXT[m[1].toLowerCase()] ?? null;
  const t = type.toLowerCase().split(";")[0].trim();
  if (t === "text/markdown" || t === "text/x-markdown") return "markdown";
  if (t === "text/plain") return "text";
  if (t === "text/html" || t === "application/xhtml+xml") return "html";
  return null;
}

/** True for the Markdown / text files a drop loads straight into the editor (not HTML). */
export function isDroppableDocument(name: string, type = ""): boolean {
  const k = classifyFile(name, type);
  return k === "markdown" || k === "text";
}

const MD_SPECIAL = /[\\`*_[\]<>~|$=^&{}!#]/g;

/**
 * Plain text as Markdown that renders as that same text: inline specials and block markers are
 * backslash-escaped, line breaks stay line breaks (a hard break), blank lines stay paragraph
 * breaks, indentation becomes non-breaking spaces. Linear.
 */
export function textToMarkdown(text: string): string {
  const out: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\s+$/, "");
    if (!line) {
      out.push("");
      continue;
    }
    const indent = /^[ \t]*/.exec(line)![0];
    line = line.slice(indent.length);
    line = line.replace(MD_SPECIAL, "\\$&");
    // Bare URLs, www. hosts, e-mail addresses and @mentions would become links or chips.
    line = line.replace(/:(?=\/\/)/g, "\\:").replace(/\bwww\./gi, (m) => m.slice(0, -1) + "\\.").replace(/@/g, "\\@");
    // Block markers that survive the escape above: bullets, ordered lists, setext rules, a table row.
    line = line.replace(/^([-+])(?=\s|$)/, "\\$1").replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2").replace(/^(:?-{3,}:?)$/, "\\$1");
    const pad = indent.replace(/\t/g, "    ").replace(/ /g, "\u00a0");
    const next = lines[i + 1];
    out.push(pad + line + (next !== undefined && next.trim() ? "\\" : ""));
  }
  return out.join("\n").replace(/^\n+|\n+$/g, "");
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** Decode bytes as UTF-8 (a BOM is dropped). null when they are not valid UTF-8 text. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  // A NUL byte means a binary file; so does a high share of other control characters.
  let ctrl = 0;
  const probe = Math.min(bytes.length, 8192);
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return null;
  for (let i = 0; i < probe; i++) {
    const b = bytes[i];
    if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12) ctrl++;
  }
  if (probe && ctrl / probe > 0.1) return null;
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // Not valid UTF-8 (a Latin-1 export, say): keep the text readable rather than refuse it.
    return stripBom(new TextDecoder("utf-8").decode(bytes));
  }
}

type FileLike = { name: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** Read an imported file as Markdown, or say why it was refused. Never throws. */
export async function readImportFile(file: FileLike, o: ImportOptions = {}): Promise<ImportResult> {
  const name = String(file.name ?? "");
  const size = Number(file.size) || 0;
  const fail = (reason: ImportFailure): ImportResult => ({ ok: false, reason, name, size });
  const kind = classifyFile(name, file.type);
  if (!kind) return fail("unsupported");
  if (size > (o.maxBytes ?? DEFAULT_MAX_BYTES)) return fail("too-large");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return fail("unreadable");
  }
  if (bytes.length > (o.maxBytes ?? DEFAULT_MAX_BYTES)) return fail("too-large");
  const text = decodeUtf8(bytes);
  if (text === null) return fail("binary");
  let markdown: string;
  if (kind === "html") {
    // The converter is a lazy chunk (the editor loads the same one when HTML is pasted).
    const { htmlToMarkdown } = await import("../../features/paste");
    markdown = htmlToMarkdown(text, { links: o.links });
  }
  else if (kind === "text" && o.txt !== "markdown") markdown = textToMarkdown(text);
  else markdown = text.replace(/\r\n?/g, "\n");
  if (!markdown.trim()) return fail("empty");
  return { ok: true, kind, markdown, name, size };
}
