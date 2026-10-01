import { describe, it, expect } from "vitest";
import type { UploadOptions } from "../../src/types";
import {
  DEFAULT_DENY_EXTENSIONS,
  validateFile,
  safeFileName,
  urlAllowed,
  normalizeUrl,
} from "../../src/features/upload-policy";

const handler = (async () => ({ url: "x" })) as UploadOptions["handler"];
const base: UploadOptions = { handler };
const f = (name: string, type = "application/octet-stream", size = 100) => ({ name, type, size });

describe("DEFAULT_DENY_EXTENSIONS", () => {
  it("lists the documented executable and script types", () => {
    for (const e of "exe bat cmd com msi scr dll jar sh ps1 vbs apk app dmg js mjs html htm svg php".split(" ")) {
      expect(DEFAULT_DENY_EXTENSIONS).toContain(e);
    }
  });
});

type Case = [string, ReturnType<typeof f>, UploadOptions | undefined, unknown, { countInBatch?: number }?];
const ok = (kind: "image" | "file", ext: string) => ({ ok: true, kind, ext });
const no = (reason: string) => ({ ok: false, reason });

const cases: Case[] = [
  // disabled
  ["no upload options", f("a.png", "image/png"), undefined, no("disabled")],
  // plain accept
  ["png image", f("a.png", "image/png"), base, ok("image", "png")],
  ["jpeg image", f("a.jpeg", "image/jpeg"), base, ok("image", "jpeg")],
  ["jpg upper case ext", f("PHOTO.JPG", "image/jpeg"), base, ok("image", "jpg")],
  ["gif", f("a.gif", "image/gif"), base, ok("image", "gif")],
  ["webp", f("a.webp", "image/webp"), base, ok("image", "webp")],
  ["pdf is a file", f("a.pdf", "application/pdf"), base, ok("file", "pdf")],
  ["docx is a file", f("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), base, ok("file", "docx")],
  ["txt", f("notes.txt", "text/plain"), base, ok("file", "txt")],
  ["csv", f("data.csv", "text/csv"), base, ok("file", "csv")],
  ["zip", f("a.zip", "application/zip"), base, ok("file", "zip")],
  ["tar.gz uses last segment", f("a.tar.gz", "application/gzip"), base, ok("file", "gz")],
  ["unknown mime image extension → image", f("a.png", ""), base, ok("image", "png")],
  ["unknown mime unknown ext → file", f("a.xyz", ""), base, ok("file", "xyz")],
  ["mime params stripped", f("a.png", "image/png; charset=binary"), base, ok("image", "png")],
  ["version-like middle segments are fine", f("report.v2.final.pdf", "application/pdf"), base, ok("file", "pdf")],
  ["spaces and unicode", f("résumé final.pdf", "application/pdf"), base, ok("file", "pdf")],
  // deny list defaults
  ["exe", f("setup.exe"), base, no("extension-denied")],
  ["bat", f("a.bat"), base, no("extension-denied")],
  ["cmd", f("a.cmd"), base, no("extension-denied")],
  ["com", f("a.com"), base, no("extension-denied")],
  ["msi", f("a.msi"), base, no("extension-denied")],
  ["scr", f("a.scr"), base, no("extension-denied")],
  ["dll", f("a.dll"), base, no("extension-denied")],
  ["jar", f("a.jar"), base, no("extension-denied")],
  ["sh", f("a.sh"), base, no("extension-denied")],
  ["ps1", f("a.ps1"), base, no("extension-denied")],
  ["vbs", f("a.vbs"), base, no("extension-denied")],
  ["apk", f("a.apk"), base, no("extension-denied")],
  ["app", f("a.app"), base, no("extension-denied")],
  ["dmg", f("a.dmg"), base, no("extension-denied")],
  ["js", f("a.js", "text/javascript"), base, no("extension-denied")],
  ["mjs", f("a.mjs"), base, no("extension-denied")],
  ["html", f("a.html", "text/html"), base, no("extension-denied")],
  ["htm", f("a.htm", "text/html"), base, no("extension-denied")],
  ["svg", f("a.svg", "image/svg+xml"), base, no("extension-denied")],
  ["php", f("a.php"), base, no("extension-denied")],
  ["upper case EXE", f("A.EXE"), base, no("extension-denied")],
  // double extensions
  ["php hidden before jpg", f("evil.php.jpg", "image/jpeg"), base, no("extension-denied")],
  ["exe hidden before pdf", f("invoice.exe.pdf", "application/pdf"), base, no("extension-denied")],
  ["html before txt", f("x.html.txt", "text/plain"), base, no("extension-denied")],
  ["deny hidden in three segments", f("a.b.sh.c.txt"), base, no("extension-denied")],
  ["stem named like an ext is only a stem", f("php.jpg", "image/jpeg"), base, ok("image", "jpg")],
  ["trailing dot trick", f("evil.php."), base, no("extension-denied")],
  ["trailing space trick", f("evil.exe "), base, no("extension-denied")],
  ["RTL override trick", f("photo\u202Egpj.exe"), base, no("extension-denied")],
  ["path prefix is ignored", f("../../etc/evil.sh"), base, no("extension-denied")],
  ["windows path prefix", f("C:\\temp\\evil.bat"), base, no("extension-denied")],
  // custom deny list
  ["deny list cleared allows exe", f("a.exe"), { ...base, denyExtensions: [] }, ok("file", "exe")],
  ["deny list replaced", f("a.pdf"), { ...base, denyExtensions: ["pdf"] }, no("extension-denied")],
  ["replaced deny list drops defaults", f("a.php"), { ...base, denyExtensions: ["pdf"] }, ok("file", "php")],
  ["deny list tolerates dot and case", f("a.pdf"), { ...base, denyExtensions: [".PDF"] }, no("extension-denied")],
  // allow list
  ["allow-listed ext", f("a.png", "image/png"), { ...base, allowExtensions: ["png"] }, ok("image", "png")],
  ["not in allow-list", f("a.pdf", "application/pdf"), { ...base, allowExtensions: ["png"] }, no("extension-not-allowed")],
  ["no extension with allow-list", f("README", "text/plain"), { ...base, allowExtensions: ["txt"] }, no("extension-not-allowed")],
  ["no extension with empty allow-list", f("README", "text/plain"), { ...base, allowExtensions: [] }, ok("file", "")],
  ["no extension without allow-list", f("Makefile", "text/plain"), base, ok("file", "")],
  ["deny beats allow", f("a.exe"), { ...base, allowExtensions: ["exe"] }, no("extension-denied")],
  ["deny beats allow (double ext)", f("a.php.png", "image/png"), { ...base, allowExtensions: ["png"] }, no("extension-denied")],
  ["allow-list entries normalised", f("a.png", "image/png"), { ...base, allowExtensions: [".PNG"] }, ok("image", "png")],
  // mime
  ["mime wildcard match", f("a.png", "image/png"), { ...base, allowMimeTypes: ["image/*"] }, ok("image", "png")],
  ["mime wildcard miss", f("a.pdf", "application/pdf"), { ...base, allowMimeTypes: ["image/*"] }, no("mime-not-allowed")],
  ["mime exact", f("a.pdf", "application/pdf"), { ...base, allowMimeTypes: ["application/pdf"] }, ok("file", "pdf")],
  ["mime case-insensitive", f("a.pdf", "Application/PDF"), { ...base, allowMimeTypes: ["application/pdf"] }, ok("file", "pdf")],
  ["mime unknown vs allow-list is rejected", f("a.bin", ""), { ...base, allowMimeTypes: ["image/*"] }, no("mime-not-allowed")],
  ["mime deny exact", f("a.pdf", "application/pdf"), { ...base, denyMimeTypes: ["application/pdf"] }, no("mime-denied")],
  ["mime deny wildcard", f("a.mp4", "video/mp4"), { ...base, denyMimeTypes: ["video/*"] }, no("mime-denied")],
  ["mime deny beats allow", f("a.png", "image/png"), { ...base, allowMimeTypes: ["image/*"], denyMimeTypes: ["image/png"] }, no("mime-denied")],
  ["star-star wildcard", f("a.pdf", "application/pdf"), { ...base, allowMimeTypes: ["*/*"] }, ok("file", "pdf")],
  // size
  ["empty file", f("a.png", "image/png", 0), base, no("empty")],
  ["empty beats extension check", f("a.exe", "", 0), base, no("empty")],
  ["exactly at default limit", f("a.zip", "application/zip", 10 * 1024 * 1024), base, ok("file", "zip")],
  ["one over default limit", f("a.zip", "application/zip", 10 * 1024 * 1024 + 1), base, no("too-large")],
  ["custom limit ok", f("a.zip", "application/zip", 500), { ...base, maxFileSizeBytes: 500 }, ok("file", "zip")],
  ["custom limit exceeded", f("a.zip", "application/zip", 501), { ...base, maxFileSizeBytes: 500 }, no("too-large")],
  ["denied ext reported before size", f("a.exe", "", 99999999), base, no("extension-denied")],
  // batch
  ["first in batch", f("a.png", "image/png"), base, ok("image", "png"), { countInBatch: 0 }],
  ["ninth in batch of default 10", f("a.png", "image/png"), base, ok("image", "png"), { countInBatch: 9 }],
  ["eleventh in batch", f("a.png", "image/png"), base, no("too-many"), { countInBatch: 10 }],
  ["custom maxFiles reached", f("a.png", "image/png"), { ...base, maxFiles: 2 }, no("too-many"), { countInBatch: 2 }],
  ["custom maxFiles within", f("a.png", "image/png"), { ...base, maxFiles: 2 }, ok("image", "png"), { countInBatch: 1 }],
];

describe("validateFile matrix", () => {
  expect(cases.length).toBeGreaterThanOrEqual(60);
  it.each(cases)("%s", (_n, file, opts, expected, ctx) => {
    expect(validateFile(file, opts as UploadOptions, ctx)).toEqual(expected);
  });
});

describe("safeFileName", () => {
  it.each([
    ["a.png", "a.png"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\x\\doc.pdf", "doc.pdf"],
    ["a\u0000b.txt", "ab.txt"],
    ["photo\u202Egpj.exe", "photogpj.exe"],
    ["a\u2066b\u2069.txt", "ab.txt"],
    ["line\nbreak.txt", "linebreak.txt"],
    ["  spaced  .txt", "spaced  .txt"],
    ["a<b>:c|d?.txt", "a_b__c_d_.txt"],
    ["..", "file"],
    ["", "file"],
    ["/", "file"],
    [".htaccess", ".htaccess"],
  ])("%j -> %j", (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
  it("caps length but keeps the extension", () => {
    const n = safeFileName("a".repeat(500) + ".pdf");
    expect(n.length).toBeLessThanOrEqual(200);
    expect(n.endsWith(".pdf")).toBe(true);
  });
});

describe("urlAllowed – accepted", () => {
  it.each([
    "http://example.com",
    "https://example.com/a?b=c#d",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@b.com",
    "tel:+15551234",
    "/path/to",
    "./rel",
    "../up",
    "#hash",
    "?q=1",
    "relative/path",
    "  https://example.com  ",
    "https://example.com/a%20b",
    "https://example.com/?next=javascript:alert(1)",
  ])("allows %j", (u) => expect(urlAllowed(u)).toBe(true));
});

describe("urlAllowed – XSS and trick vectors", () => {
  const bad = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "\n javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
    "jav\u0000ascript:alert(1)",
    "java\u200Bscript:alert(1)",
    "\u0001javascript:alert(1)",
    "\u00A0javascript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "&#0000106avascript:alert(1)",
    "&#106&#97&#118&#97&#115&#99&#114&#105&#112&#116&#58alert(1)",
    "javascript&colon;alert(1)",
    "java&Tab;script:alert(1)",
    "java&NewLine;script:alert(1)",
    "&amp;#106;avascript:alert(1)",
    "javascript&#58;alert(1)",
    "javascript&#x3A;alert(1)",
    "%6Aavascript:alert(1)",
    "java%0Ascript:alert(1)",
    "java%09script:alert(1)",
    "vbscript:msgbox(1)",
    "VBScript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "blob:https://example.com/uuid",
    "ftp://example.com/x",
    "view-source:https://example.com",
    "intent://scan/#Intent;scheme=zxing;end",
    "x-javascript:alert(1)",
    "1abc:foo",
    ":foo",
    "//evil.com/x\u0000",
    "\\\\evil.com\\x",
    "javascript://%0Aalert(1)",
    "javascript:/*--></title></style></textarea></script><svg/onload=alert(1)>",
    "",
    "   ",
  ];
  expect(bad.length).toBeGreaterThanOrEqual(40);
  it.each(bad)("refuses %j", (u) => {
    // "//evil.com/x\0" and "\\\\evil.com" are only refused when relative is off
    const policy = u.includes("evil.com") ? { allowRelative: false } : undefined;
    expect(urlAllowed(u, policy)).toBe(false);
  });
  it("refuses javascript even when listed in allowedSchemes", () => {
    expect(urlAllowed("javascript:alert(1)", { allowedSchemes: ["javascript", "https"] })).toBe(false);
    expect(urlAllowed("vbscript:x", { allowedSchemes: ["vbscript"] })).toBe(false);
  });
  it("refuses non-strings", () => {
    expect(urlAllowed(undefined as unknown as string)).toBe(false);
    expect(urlAllowed(null as unknown as string)).toBe(false);
  });
});

describe("urlAllowed – policy", () => {
  it("allowRelative false refuses relative urls and fragments", () => {
    const p = { allowRelative: false };
    expect(urlAllowed("/a", p)).toBe(false);
    expect(urlAllowed("a/b", p)).toBe(false);
    expect(urlAllowed("#x", p)).toBe(false);
    expect(urlAllowed("https://a.com", p)).toBe(true);
  });
  it("custom schemes", () => {
    expect(urlAllowed("ftp://a.com", { allowedSchemes: ["ftp"] })).toBe(true);
    expect(urlAllowed("https://a.com", { allowedSchemes: ["ftp"] })).toBe(false);
    expect(urlAllowed("task:issue/12", { allowedSchemes: ["task:"] })).toBe(true);
  });
  it("data image only when data is listed explicitly and kind is image", () => {
    const p = { allowedSchemes: ["https", "data"] };
    expect(urlAllowed("data:image/png;base64,iVBORw0KGgo=", p, "image")).toBe(true);
    expect(urlAllowed("data:image/jpeg;base64,/9j/4AAQ", p, "image")).toBe(true);
    expect(urlAllowed("data:image/gif;base64,R0lGOD", p, "image")).toBe(true);
    expect(urlAllowed("data:image/webp;base64,UklGR", p, "image")).toBe(true);
    expect(urlAllowed("data:image/svg+xml;base64,PHN2Zz4=", p, "image")).toBe(false);
    expect(urlAllowed("data:image/png,rawbytes", p, "image")).toBe(false);
    expect(urlAllowed("data:text/html;base64,PGI+", p, "image")).toBe(false);
    expect(urlAllowed("data:image/png;base64,iVBORw0KGgo=", p, "link")).toBe(false);
    expect(urlAllowed("data:image/png;base64,iVBORw0KGgo=", undefined, "image")).toBe(false);
  });
  it("images may not use mailto or tel", () => {
    expect(urlAllowed("mailto:a@b.c", undefined, "image")).toBe(false);
    expect(urlAllowed("https://a.com/x.png", undefined, "image")).toBe(true);
  });
  it("allowedHosts compares the parsed host, case-insensitively", () => {
    const p = { allowedHosts: ["Example.com"] };
    expect(urlAllowed("https://example.com/x", p)).toBe(true);
    expect(urlAllowed("https://EXAMPLE.COM:8443/x", p)).toBe(true);
    expect(urlAllowed("https://example.com./x", p)).toBe(true);
    expect(urlAllowed("https://evil-example.com", p)).toBe(false);
    expect(urlAllowed("https://example.com.evil.com", p)).toBe(false);
    expect(urlAllowed("https://notexample.com", p)).toBe(false);
    expect(urlAllowed("https://sub.example.com", p)).toBe(false);
    expect(urlAllowed("https://example.com@evil.com/", p)).toBe(false);
    expect(urlAllowed("https://evil.com/?u=example.com", p)).toBe(false);
    expect(urlAllowed("https://evil.com/#example.com", p)).toBe(false);
    expect(urlAllowed("//evil.com/x", p)).toBe(false);
    expect(urlAllowed("//example.com/x", p)).toBe(true);
    expect(urlAllowed("https:\\\\evil.com", p)).toBe(false);
  });
  it("allowedHosts does not restrict mailto/tel/relative", () => {
    const p = { allowedHosts: ["example.com"] };
    expect(urlAllowed("mailto:a@evil.com", p)).toBe(true);
    expect(urlAllowed("/local", p)).toBe(true);
  });
  it("wildcard host entries match subdomains only", () => {
    const p = { allowedHosts: ["*.example.com"] };
    expect(urlAllowed("https://a.example.com", p)).toBe(true);
    expect(urlAllowed("https://a.b.example.com", p)).toBe(true);
    expect(urlAllowed("https://example.com", p)).toBe(false);
    expect(urlAllowed("https://evilexample.com", p)).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("trims and strips control characters from accepted urls", () => {
    expect(normalizeUrl("  https://example.com/a\tb  ")).toBe("https://example.com/ab");
    expect(normalizeUrl("https://example.com/\n")).toBe("https://example.com/");
  });
  it("returns null for refused urls", () => {
    expect(normalizeUrl("java\tscript:alert(1)")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
  it("leaves entities alone (decoding is for checking only)", () => {
    expect(normalizeUrl("https://a.com/?a=1&amp;b=2")).toBe("https://a.com/?a=1&amp;b=2");
  });
});
