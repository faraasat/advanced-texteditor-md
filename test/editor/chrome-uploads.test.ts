import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, tick } from "./fakes";
import type { UploadOptions, UploadResult } from "../../src/types";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

const file = (name: string, type = "", size = 5) => new File([new Uint8Array(size)], name, { type });
const ok = (url = "https://cdn.example.com/f.bin"): UploadOptions["handler"] => async (f) => ({ url, name: f.name });
const events = (o: { type: string }[]) => o.map((e) => e.type);

function deferred() {
  let resolve!: (r: UploadResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<UploadResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("uploads: accepted files", () => {
  it("image: placeholder, then the asset as an image, then done", async () => {
    const log: { type: string }[] = [];
    const x = m({ upload: { handler: ok("https://cdn.example.com/a.png") }, onUpload: (e) => log.push(e) });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.surface.placeholders).toHaveLength(1);
    expect(x.surface.placeholders[0].removed).toBe(true);
    expect(x.surface.assets).toEqual([{ url: "https://cdn.example.com/a.png", name: "a.png", alt: undefined, as: "image" }]);
    expect(events(log)).toEqual(["start", "done"]);
  });
  it("other files become link chips", async () => {
    const x = m({ upload: { handler: ok("https://cdn.example.com/r.pdf") } });
    await x.ed.uploadFiles([file("r.pdf", "application/pdf")]);
    expect(x.surface.assets[0]).toMatchObject({ as: "link", name: "r.pdf" });
  });
  it("the handler's `as` and mime win over the file's own type", async () => {
    const x = m({ upload: { handler: async () => ({ url: "https://c.io/x", mime: "image/webp" }) } });
    await x.ed.uploadFiles([file("x.bin", "")]);
    expect(x.surface.assets[0]).toMatchObject({ as: "image" });
    const y = m({ upload: { handler: async () => ({ url: "https://c.io/x", as: "link" as const }) } });
    await y.ed.uploadFiles([file("x.png", "image/png")]);
    expect(y.surface.assets[0]).toMatchObject({ as: "link" });
  });
  it("passes a signal, the kind and a progress callback that feeds the placeholder", async () => {
    let ctx: { signal: AbortSignal; kind: string } | null = null;
    const x = m({
      upload: {
        handler: async (_f, c) => {
          ctx = c;
          c.onProgress(0.25);
          c.onProgress(2);
          c.onProgress(NaN);
          return { url: "https://c.io/a" };
        },
      },
    });
    await x.ed.uploadFiles([file("a.png", "image/png"), file("b.txt", "text/plain")]);
    expect(ctx!.signal).toBeInstanceOf(AbortSignal);
    expect(x.surface.placeholders[0].progress).toEqual([0.25, 1, 0]);
    expect(x.surface.placeholders.map((p) => p.name)).toEqual(["a.png", "b.txt"]);
  });
  it("kind is 'image' for images and 'file' otherwise", async () => {
    const kinds: string[] = [];
    const x = m({ upload: { handler: async (_f, c) => (kinds.push(c.kind), { url: "https://c.io/a" }) } });
    await x.ed.uploadFiles([file("a.png", "image/png"), file("b.txt", "text/plain")]);
    expect(kinds).toEqual(["image", "file"]);
  });
  it("uploadFiles resolves only after every upload settled", async () => {
    const d = deferred();
    const x = m({ upload: { handler: () => d.promise } });
    let done = false;
    const p = x.ed.uploadFiles([file("a.png", "image/png")]).then(() => (done = true));
    await tick(5);
    expect(done).toBe(false);
    d.resolve({ url: "https://c.io/a" });
    await p;
    expect(done).toBe(true);
  });
  it("concurrent uploads each insert their own result, in completion order", async () => {
    const d1 = deferred();
    const d2 = deferred();
    const pending = [d1, d2];
    const x = m({ upload: { handler: () => pending.shift()!.promise } });
    const p = x.ed.uploadFiles([file("one.png", "image/png"), file("two.png", "image/png")]);
    await tick(5);
    expect(x.surface.placeholders).toHaveLength(2);
    d2.resolve({ url: "https://c.io/2" });
    await tick(5);
    expect(x.surface.assets.map((a) => (a as { url: string }).url)).toEqual(["https://c.io/2"]);
    expect(x.surface.placeholders.map((q) => q.removed)).toEqual([false, true]);
    d1.resolve({ url: "https://c.io/1" });
    await p;
    expect(x.surface.assets.map((a) => (a as { url: string }).url)).toEqual(["https://c.io/2", "https://c.io/1"]);
  });
  it("the status bar counts uploads in progress", async () => {
    const d1 = deferred();
    const d2 = deferred();
    const pending = [d1, d2];
    const x = m({ upload: { handler: () => pending.shift()!.promise } });
    const p = x.ed.uploadFiles([file("a.png", "image/png"), file("b.png", "image/png")]);
    await tick(5);
    expect(x.root.querySelector(".atm-status-upload")!.textContent).toBe("Uploading 2");
    d1.resolve({ url: "https://c.io/1" });
    await tick(5);
    expect(x.root.querySelector(".atm-status-upload")!.textContent).toBe("Uploading 1");
    d2.resolve({ url: "https://c.io/2" });
    await p;
    expect(x.root.querySelector<HTMLElement>(".atm-status-upload")!.hidden).toBe(true);
  });
});

describe("uploads: rejected files", () => {
  const up = (extra: Partial<UploadOptions> = {}): UploadOptions => ({ handler: vi.fn(ok()), ...extra });

  it("a denied extension is rejected before the handler runs and reported three ways", async () => {
    const onReject = vi.fn();
    const log: { type: string; reason?: string }[] = [];
    const u = up({ onReject });
    const x = m({ upload: u, onUpload: (e) => log.push(e as never) });
    await x.ed.uploadFiles([file("evil.exe", "application/x-msdownload")]);
    expect(u.handler).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith(expect.any(File), "extension-denied");
    expect(log).toEqual([{ type: "rejected", file: expect.any(File), reason: "extension-denied" }]);
    const toast = x.root.querySelector(".atm-toast")!;
    expect(toast.textContent).toBe("evil.exe was not uploaded: this file type is blocked");
    expect(x.surface.placeholders).toHaveLength(0);
  });
  it("an extension outside the allow-list", async () => {
    const onReject = vi.fn();
    const x = m({ upload: up({ allowExtensions: ["png"], onReject }) });
    await x.ed.uploadFiles([file("a.gif", "image/gif")]);
    expect(onReject).toHaveBeenCalledWith(expect.any(File), "extension-not-allowed");
  });
  it("too large", async () => {
    const onReject = vi.fn();
    const x = m({ upload: up({ maxFileSizeBytes: 10, onReject }) });
    await x.ed.uploadFiles([file("big.png", "image/png", 11), file("ok.png", "image/png", 10)]);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ name: "big.png" }), "too-large");
    expect(x.surface.assets).toHaveLength(1);
  });
  it("too many files in one drop", async () => {
    const reasons: string[] = [];
    const x = m({ upload: up({ maxFiles: 2, onReject: (_f, r) => reasons.push(r) }) });
    await x.ed.uploadFiles([file("1.png", "image/png"), file("2.png", "image/png"), file("3.png", "image/png")]);
    expect(reasons).toEqual(["too-many"]);
    expect(x.surface.assets).toHaveLength(2);
  });
  it("rejected files do not count towards the batch limit", async () => {
    const reasons: string[] = [];
    const x = m({ upload: up({ maxFiles: 1, onReject: (_f, r) => reasons.push(r) }) });
    await x.ed.uploadFiles([file("bad.exe"), file("good.png", "image/png")]);
    expect(reasons).toEqual(["extension-denied"]);
    expect(x.surface.assets).toHaveLength(1);
  });
  it("an empty file", async () => {
    const reasons: string[] = [];
    const x = m({ upload: up({ onReject: (_f, r) => reasons.push(r) }) });
    await x.ed.uploadFiles([file("e.png", "image/png", 0)]);
    expect(reasons).toEqual(["empty"]);
  });
  it("a mime type outside the allow-list", async () => {
    const reasons: string[] = [];
    const x = m({ upload: up({ allowMimeTypes: ["image/*"], onReject: (_f, r) => reasons.push(r) }) });
    await x.ed.uploadFiles([file("a.txt", "text/plain")]);
    expect(reasons).toEqual(["mime-not-allowed"]);
  });
  it("no upload option: everything is 'disabled'", async () => {
    const log: { type: string; reason?: string }[] = [];
    const x = m({ onUpload: (e) => log.push(e as never) });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(log[0]).toMatchObject({ type: "rejected", reason: "disabled" });
  });
  it("read-only editors refuse uploads", async () => {
    const u = up();
    const x = m({ upload: u, readOnly: true });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(u.handler).not.toHaveBeenCalled();
  });
  it("the rejection is announced politely", async () => {
    const x = m({ upload: up() });
    await x.ed.uploadFiles([file("a.exe")]);
    const t = x.root.querySelector(".atm-toast")!;
    expect(t.getAttribute("role")).toBe("status");
    expect(t.getAttribute("aria-live")).toBe("polite");
    expect(t.getAttribute("data-kind")).toBe("error");
  });
  it("a file name is shown as text, never as markup", async () => {
    const x = m({ upload: up() });
    await x.ed.uploadFiles([file("<img src=x onerror=alert(1)>.exe")]);
    expect(x.root.querySelector(".atm-toast img")).toBeNull();
  });
});

describe("uploads: the returned URL is checked before it is inserted", () => {
  const cases: [string, string][] = [
    ["javascript:", "javascript:alert(1)"],
    ["encoded javascript:", "java\tscript:alert(1)"],
    ["data: html", "data:text/html;base64,PHNjcmlwdD4="],
    ["vbscript:", "vbscript:msgbox"],
  ];
  for (const [name, url] of cases) {
    it(`refuses ${name}`, async () => {
      const log: { type: string; error?: unknown }[] = [];
      const x = m({ upload: { handler: async () => ({ url }) }, onUpload: (e) => log.push(e as never) });
      await x.ed.uploadFiles([file("a.png", "image/png")]);
      expect(x.surface.assets).toHaveLength(0);
      expect(x.surface.placeholders[0].removed).toBe(true);
      expect(events(log)).toEqual(["start", "error"]);
      expect(log[1].error).toBeInstanceOf(Error);
      expect(x.root.querySelector(".atm-toast")!.textContent).toContain("could not be uploaded");
    });
  }
  it("upload.urls (host allow-list) is applied, and wins over links", async () => {
    const x = m({
      upload: { handler: async () => ({ url: "https://evil.example.org/a.png" }), urls: { allowedHosts: ["cdn.example.com"] } },
      links: { allowedHosts: ["evil.example.org"] },
    });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.surface.assets).toHaveLength(0);
  });
  it("falls back to the links policy", async () => {
    const x = m({ upload: { handler: async () => ({ url: "https://evil.example.org/a.png" }) }, links: { allowedHosts: ["cdn.example.com"] } });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.surface.assets).toHaveLength(0);
  });
  it("an allowed host passes", async () => {
    const x = m({ upload: { handler: async () => ({ url: "https://cdn.example.com/a.png" }), urls: { allowedHosts: ["cdn.example.com"] } } });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.surface.assets).toHaveLength(1);
  });
  it("relative URLs are fine by default", async () => {
    const x = m({ upload: { handler: async () => ({ url: "/uploads/a.png" }) } });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.surface.assets).toHaveLength(1);
  });
});

describe("uploads: failure and abort", () => {
  it("a rejected handler removes the placeholder and reports an error", async () => {
    const err = new Error("network down");
    const log: { type: string; error?: unknown }[] = [];
    const x = m({ upload: { handler: async () => { throw err; } }, onUpload: (e) => log.push(e as never) });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.surface.placeholders[0].removed).toBe(true);
    expect(x.surface.assets).toHaveLength(0);
    expect(log[1]).toMatchObject({ type: "error", error: err });
  });
  it("a handler that throws synchronously is handled the same way", async () => {
    const log: { type: string }[] = [];
    const x = m({ upload: { handler: () => { throw new Error("sync"); } }, onUpload: (e) => log.push(e) });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(events(log)).toEqual(["start", "error"]);
  });
  it("one failure does not stop the others", async () => {
    let n = 0;
    const x = m({ upload: { handler: async () => { if (n++ === 0) throw new Error("first"); return { url: "https://c.io/2" }; } } });
    await x.ed.uploadFiles([file("a.png", "image/png"), file("b.png", "image/png")]);
    expect(x.surface.assets).toHaveLength(1);
  });
  it("destroy aborts every in-flight upload, and a late result is ignored", async () => {
    const d = deferred();
    const signals: AbortSignal[] = [];
    const log: { type: string }[] = [];
    const x = m({ upload: { handler: (_f, c) => (signals.push(c.signal), d.promise) }, onUpload: (e) => log.push(e) });
    const p = x.ed.uploadFiles([file("a.png", "image/png"), file("b.png", "image/png")]);
    await tick(5);
    expect(signals.map((s) => s.aborted)).toEqual([false, false]);
    const surface = x.surface;
    x.ed.destroy();
    expect(signals.map((s) => s.aborted)).toEqual([true, true]);
    d.resolve({ url: "https://c.io/late" });
    await p;
    expect(surface.assets).toHaveLength(0);
    expect(events(log)).toEqual(["start", "start"]);
  });
  it("an abort rejection after destroy is swallowed", async () => {
    const d = deferred();
    const x = m({ upload: { handler: () => d.promise } });
    const p = x.ed.uploadFiles([file("a.png", "image/png")]);
    x.ed.destroy();
    d.reject(new DOMException("Upload aborted", "AbortError"));
    await expect(p).resolves.toBeUndefined();
  });
  it("uploadFiles after destroy is a no-op", async () => {
    const h = vi.fn(ok());
    const x = m({ upload: { handler: h } });
    x.ed.destroy();
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(h).not.toHaveBeenCalled();
  });
});

describe("uploads: markdown mode", () => {
  it("inserts ![name](url) for images and [name](url) for files at the caret", async () => {
    const x = m({ value: "x ", mode: "markdown", upload: { handler: async (f) => ({ url: `https://c.io/${f.name}`, name: f.name }) } });
    const ta = x.textarea()!;
    ta.setSelectionRange(2, 2);
    await x.ed.uploadFiles([file("pic.png", "image/png")]);
    expect(ta.value).toBe("x ![pic.png](https://c.io/pic.png)");
    await x.ed.uploadFiles([file("r.pdf", "application/pdf")]);
    expect(ta.value).toBe("x ![pic.png](https://c.io/pic.png)[r.pdf](https://c.io/r.pdf)");
    expect(x.ed.getValue()).toBe(ta.value);
  });
  it("escapes brackets in the label and brackets URLs with spaces", async () => {
    const x = m({ mode: "markdown", upload: { handler: async () => ({ url: "/up/my file.pdf", name: "a]b.pdf" }) } });
    await x.ed.uploadFiles([file("a.pdf", "application/pdf")]);
    expect(x.textarea()!.value).toBe("[a\\]b.pdf](</up/my file.pdf>)");
  });
  it("uses the alt text the handler returned", async () => {
    const x = m({ mode: "markdown", upload: { handler: async () => ({ url: "https://c.io/a.png", alt: "A cat" }) } });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.textarea()!.value).toBe("![A cat](https://c.io/a.png)");
  });
  it("the URL check applies here too", async () => {
    const x = m({ mode: "markdown", upload: { handler: async () => ({ url: "javascript:alert(1)" }) } });
    await x.ed.uploadFiles([file("a.png", "image/png")]);
    expect(x.textarea()!.value).toBe("");
  });
  it("an upload that started in the surface and finishes after a mode switch lands in the textarea", async () => {
    const d = deferred();
    const x = m({ upload: { handler: () => d.promise } });
    const p = x.ed.uploadFiles([file("a.png", "image/png")]);
    await tick(5);
    x.ed.setMode("markdown");
    d.resolve({ url: "https://c.io/a.png", name: "a.png" });
    await p;
    expect(x.textarea()!.value).toBe("![a.png](https://c.io/a.png)");
    expect(x.surface.placeholders[0].removed).toBe(true);
  });
});

describe("uploads: paste, drop and the picker", () => {
  it("files from the surface go through the pipeline", async () => {
    const x = m({ upload: { handler: ok("https://c.io/p.png") } });
    x.surface.options.onFiles!([file("p.png", "image/png")], "paste");
    await tick(10);
    expect(x.surface.assets).toHaveLength(1);
  });
  it("paste:false and drop:false are honoured", async () => {
    const h = vi.fn(ok());
    const x = m({ upload: { handler: h, paste: false } });
    x.surface.options.onFiles!([file("p.png", "image/png")], "paste");
    x.surface.options.onFiles!([file("d.png", "image/png")], "drop");
    await tick(10);
    expect(h).toHaveBeenCalledTimes(1);
    const y = m({ upload: { handler: h, drop: false } });
    y.surface.options.onFiles!([file("d.png", "image/png")], "drop");
    await tick(10);
    expect(h).toHaveBeenCalledTimes(1);
  });
  it("without an upload option dropped files are ignored", async () => {
    const x = m();
    x.surface.options.onFiles!([file("p.png", "image/png")], "drop");
    await tick(10);
    expect(x.surface.assets).toHaveLength(0);
  });
  it("the attach button opens a hidden multi-file picker whose accept comes from the allow lists", () => {
    const x = m({ upload: { handler: ok(), allowExtensions: ["png", "pdf"], allowMimeTypes: ["image/*"] } });
    x.root.querySelector<HTMLButtonElement>('button[data-id="attach"]')!.click();
    const input = x.root.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(".png,.pdf,image/*");
    expect(input.hidden).toBe(true);
    expect(input.getAttribute("aria-hidden")).toBe("true");
  });
  it("choosing files in the picker uploads them", async () => {
    const x = m({ upload: { handler: ok("https://c.io/a.png") } });
    x.root.querySelector<HTMLButtonElement>('button[data-id="attach"]')!.click();
    const input = x.root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file("a.png", "image/png")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await tick(10);
    expect(x.surface.assets).toHaveLength(1);
  });
  it("the image popover offers an Upload tab when uploads are on", () => {
    const x = m({ upload: { handler: ok() } });
    x.root.querySelector<HTMLButtonElement>('button[data-id="image"]')!.click();
    const tabs = Array.from(x.root.querySelectorAll('[role="dialog"] [role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(["From address", "Upload"]);
  });
  it("no Upload tab without a handler", () => {
    const x = m();
    x.root.querySelector<HTMLButtonElement>('button[data-id="image"]')!.click();
    expect(x.root.querySelectorAll('[role="dialog"] [role="tab"]')).toHaveLength(0);
  });
});
