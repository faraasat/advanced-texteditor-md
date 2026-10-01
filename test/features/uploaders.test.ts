import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UploadContext } from "../../src/types";
import {
  createPutUploader,
  createFormUploader,
  createPresignedUploader,
  createDataUrlUploader,
  probeImage,
} from "../../src/features/uploaders";

const file = (name = "a.pdf", type = "application/pdf", body = "hello") => new File([body], name, { type });
const ctx = (over: Partial<UploadContext> = {}): UploadContext & { progress: number[] } => {
  const progress: number[] = [];
  return { signal: new AbortController().signal, onProgress: (f) => progress.push(f), kind: "file", progress, ...over };
};

/* ───────── fake XMLHttpRequest ───────── */
class FakeXHR {
  static last: FakeXHR | null = null;
  method = ""; url = ""; headers: Record<string, string> = {}; body: unknown; aborted = false;
  status = 0; statusText = ""; responseText = ""; withCredentials = false;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  onabort: (() => void) | null = null; ontimeout: (() => void) | null = null;
  constructor() { FakeXHR.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: unknown) { this.body = b; }
  abort() { this.aborted = true; this.onabort?.(); }
  respond(status: number, text = "", statusText = "") { this.status = status; this.responseText = text; this.statusText = statusText; this.onload?.(); }
}

const savedUrl = { c: (URL as any).createObjectURL, r: (URL as any).revokeObjectURL };
function blobUrls(c: (b: Blob) => string, r: (u: string) => void) {
  (URL as any).createObjectURL = c;
  (URL as any).revokeObjectURL = r;
}
afterEach(() => { (URL as any).createObjectURL = savedUrl.c; (URL as any).revokeObjectURL = savedUrl.r; });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeXHR.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("createPutUploader", () => {
  it("PUTs the file and resolves with the Location header", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201, headers: { Location: "https://cdn/x/a.pdf" } }));
    const up = createPutUploader({ endpoint: "https://api/upload/a.pdf", headers: { Authorization: "Bearer t" } });
    const c = ctx();
    const r = await up(file(), c);
    expect(r.url).toBe("https://cdn/x/a.pdf");
    expect(r.name).toBe("a.pdf");
    expect(r.mime).toBe("application/pdf");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api/upload/a.pdf");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(init.headers["Content-Type"]).toBe("application/pdf");
    expect(init.signal).toBe(c.signal);
    expect(c.progress.at(-1)).toBe(1);
  });
  it("endpoint can be a function of the file; method can be POST", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ url: "https://cdn/j.pdf" }), { status: 200 }));
    const up = createPutUploader({ endpoint: (f) => `https://api/${encodeURIComponent(f.name)}`, method: "POST" });
    const r = await up(file("my file.pdf"), ctx());
    expect(fetchMock.mock.calls[0][0]).toBe("https://api/my%20file.pdf");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(r.url).toBe("https://cdn/j.pdf");
  });
  it("falls back to the endpoint without its query string", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const r = await createPutUploader({ endpoint: "https://bucket/key.pdf?sig=abc" })(file(), ctx());
    expect(r.url).toBe("https://bucket/key.pdf");
  });
  it("resolveUrl wins", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const up = createPutUploader({ endpoint: "https://api/x", resolveUrl: async (_res, f) => `https://cdn/${f.name}` });
    expect((await up(file(), ctx())).url).toBe("https://cdn/a.pdf");
  });
  it("custom Content-Type header is kept", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    await createPutUploader({ endpoint: "https://a/b", headers: { "content-type": "x/y" } })(file(), ctx());
    const h = fetchMock.mock.calls[0][1].headers;
    expect(Object.keys(h).filter((k) => k.toLowerCase() === "content-type")).toEqual(["content-type"]);
  });
  it("rejects with a readable error on HTTP failure", async () => {
    fetchMock.mockResolvedValue(new Response("too big", { status: 413, statusText: "Payload Too Large" }));
    await expect(createPutUploader({ endpoint: "https://a/b" })(file(), ctx())).rejects.toThrow(/413.*Payload Too Large/);
  });
  it("rejects with a readable error on network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(createPutUploader({ endpoint: "https://a/b" })(file(), ctx())).rejects.toThrow(/Upload failed/);
  });
  it("abort becomes an AbortError DOMException", async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation(() => new Promise((_res, rej) => ac.signal.addEventListener("abort", () => rej(new Error("x")))));
    const p = createPutUploader({ endpoint: "https://a/b" })(file(), ctx({ signal: ac.signal }));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await p.catch((e) => expect(e).toBeInstanceOf(DOMException));
  });
  it("already-aborted signal never calls fetch", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(createPutUploader({ endpoint: "https://a/b" })(file(), ctx({ signal: ac.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createFormUploader", () => {
  it("posts multipart with extra fields first and the file last", async () => {
    const up = createFormUploader({ endpoint: "https://api/up", headers: { "X-Key": "k" }, extraFields: { folder: "docs" } });
    const c = ctx();
    const p = up(file(), c);
    const x = FakeXHR.last!;
    expect(x.method).toBe("POST");
    expect(x.url).toBe("https://api/up");
    expect(x.headers["X-Key"]).toBe("k");
    expect(x.headers["Content-Type"]).toBeUndefined(); // browser sets the boundary
    const fd = x.body as FormData;
    expect([...fd.keys()]).toEqual(["folder", "file"]);
    expect((fd.get("file") as File).name).toBe("a.pdf");
    x.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    x.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    x.respond(200, JSON.stringify({ url: "https://cdn/a.pdf" }));
    const r = await p;
    expect(r.url).toBe("https://cdn/a.pdf");
    expect(c.progress).toEqual([0.25, 1]);
  });
  it("uses a custom field name", async () => {
    const p = createFormUploader({ endpoint: "/u", field: "upload" })(file(), ctx());
    expect([...(FakeXHR.last!.body as FormData).keys()]).toEqual(["upload"]);
    FakeXHR.last!.respond(200, '{"url":"/x"}');
    await p;
  });
  it("extraFields may be a function of the file", async () => {
    const p = createFormUploader({ endpoint: "/u", extraFields: (f) => ({ name: f.name }) })(file("z.pdf"), ctx());
    expect((FakeXHR.last!.body as FormData).get("name")).toBe("z.pdf");
    FakeXHR.last!.respond(200, '{"url":"/x"}');
    await p;
  });
  it("custom parse maps the response", async () => {
    const p = createFormUploader({ endpoint: "/u", parse: (j) => ({ url: (j as { data: { link: string } }).data.link, alt: "A" }) })(file(), ctx());
    FakeXHR.last!.respond(200, '{"data":{"link":"https://cdn/q"}}');
    expect(await p).toMatchObject({ url: "https://cdn/q", alt: "A" });
  });
  it("understands common response shapes without parse", async () => {
    for (const body of ['{"data":{"url":"/a"}}', '{"location":"/a"}', '{"files":[{"url":"/a"}]}', '{"url":"/a"}']) {
      const p = createFormUploader({ endpoint: "/u" })(file(), ctx());
      FakeXHR.last!.respond(200, body);
      expect((await p).url).toBe("/a");
    }
  });
  it("rejects when the response has no url", async () => {
    const p = createFormUploader({ endpoint: "/u" })(file(), ctx());
    FakeXHR.last!.respond(200, "{}");
    await expect(p).rejects.toThrow(/did not return a URL/);
  });
  it("rejects on invalid JSON", async () => {
    const p = createFormUploader({ endpoint: "/u" })(file(), ctx());
    FakeXHR.last!.respond(200, "<html>");
    await expect(p).rejects.toThrow(/Upload failed/);
  });
  it("maps HTTP errors", async () => {
    const p = createFormUploader({ endpoint: "/u" })(file(), ctx());
    FakeXHR.last!.respond(500, "", "Server Error");
    await expect(p).rejects.toThrow(/500.*Server Error/);
  });
  it("maps network errors and timeouts", async () => {
    const p = createFormUploader({ endpoint: "/u" })(file(), ctx());
    FakeXHR.last!.onerror?.();
    await expect(p).rejects.toThrow(/network/i);
    const q = createFormUploader({ endpoint: "/u" })(file(), ctx());
    FakeXHR.last!.ontimeout?.();
    await expect(q).rejects.toThrow(/timed out/i);
  });
  it("aborting the signal aborts the request and rejects with AbortError", async () => {
    const ac = new AbortController();
    const p = createFormUploader({ endpoint: "/u" })(file(), ctx({ signal: ac.signal }));
    ac.abort();
    expect(FakeXHR.last!.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
  it("pre-aborted signal does not open a request", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(createFormUploader({ endpoint: "/u" })(file(), ctx({ signal: ac.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXHR.last).toBeNull();
  });
  it("withCredentials is passed through", async () => {
    const p = createFormUploader({ endpoint: "/u", withCredentials: true })(file(), ctx());
    expect(FakeXHR.last!.withCredentials).toBe(true);
    FakeXHR.last!.respond(200, '{"url":"/x"}');
    await p;
  });
});

describe("createPresignedUploader", () => {
  it("asks for a signed url, PUTs the file there and resolves with the public url", async () => {
    const getSignedUrl = vi.fn(async () => ({ uploadUrl: "https://s3/put?sig=1", publicUrl: "https://cdn/a.pdf", headers: { "x-amz-acl": "public-read" } }));
    const c = ctx();
    const p = createPresignedUploader({ getSignedUrl })(file(), c);
    await vi.waitFor(() => expect(FakeXHR.last).not.toBeNull());
    const x = FakeXHR.last!;
    expect(getSignedUrl).toHaveBeenCalledOnce();
    expect(x.method).toBe("PUT");
    expect(x.url).toBe("https://s3/put?sig=1");
    expect(x.headers["x-amz-acl"]).toBe("public-read");
    expect(x.headers["Content-Type"]).toBe("application/pdf");
    expect((x.body as File).name).toBe("a.pdf");
    x.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    x.respond(200);
    expect((await p).url).toBe("https://cdn/a.pdf");
    expect(c.progress).toEqual([0.5]);
  });
  it("honours the method returned by getSignedUrl", async () => {
    const p = createPresignedUploader({ getSignedUrl: async () => ({ uploadUrl: "u", publicUrl: "p", method: "POST" }) })(file(), ctx());
    await vi.waitFor(() => expect(FakeXHR.last).not.toBeNull());
    expect(FakeXHR.last!.method).toBe("POST");
    FakeXHR.last!.respond(204);
    await p;
  });
  it("rejects when signing fails", async () => {
    const up = createPresignedUploader({ getSignedUrl: async () => { throw new Error("nope"); } });
    await expect(up(file(), ctx())).rejects.toThrow(/nope/);
  });
  it("rejects when the storage answers with an error", async () => {
    const p = createPresignedUploader({ getSignedUrl: async () => ({ uploadUrl: "u", publicUrl: "p" }) })(file(), ctx());
    await vi.waitFor(() => expect(FakeXHR.last).not.toBeNull());
    FakeXHR.last!.respond(403, "", "Forbidden");
    await expect(p).rejects.toThrow(/403.*Forbidden/);
  });
  it("rejects when signing returns no public url", async () => {
    const up = createPresignedUploader({ getSignedUrl: async () => ({ uploadUrl: "u" } as never) });
    await expect(up(file(), ctx())).rejects.toThrow(/publicUrl/);
  });
  it("aborts", async () => {
    const ac = new AbortController();
    const p = createPresignedUploader({ getSignedUrl: async () => ({ uploadUrl: "u", publicUrl: "p" }) })(file(), ctx({ signal: ac.signal }));
    await vi.waitFor(() => expect(FakeXHR.last).not.toBeNull());
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("createDataUrlUploader", () => {
  it("resolves with a data: url", async () => {
    const c = ctx();
    const r = await createDataUrlUploader()(file("a.txt", "text/plain", "hi"), c);
    expect(r.url).toBe("data:text/plain;base64,aGk=");
    expect(r.name).toBe("a.txt");
    expect(c.progress.at(-1)).toBe(1);
  });
  it("rejects with AbortError when already aborted", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(createDataUrlUploader()(file(), ctx({ signal: ac.signal }))).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("probeImage", () => {
  it("returns undefined where images cannot be decoded (jsdom, server)", async () => {
    expect(await probeImage(new File(["x"], "a.png", { type: "image/png" }), 20)).toBeUndefined();
  });
  it("returns undefined for non-images", async () => {
    expect(await probeImage(file())).toBeUndefined();
  });
  it("returns undefined with no DOM at all", async () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("Image", undefined);
    expect(await probeImage(new File(["x"], "a.png", { type: "image/png" }))).toBeUndefined();
  });
  it("reads natural size via an Image element when available", async () => {
    class FakeImage {
      naturalWidth = 640; naturalHeight = 480; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
    const create = vi.fn(() => "blob:x"); const revoke = vi.fn();
    blobUrls(create, revoke);
    expect(await probeImage(new File(["x"], "a.png", { type: "image/png" }))).toEqual({ width: 640, height: 480 });
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
  it("image uploads get width/height when the probe works", async () => {
    class FakeImage {
      naturalWidth = 10; naturalHeight = 20; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
    blobUrls(() => "blob:y", () => {});
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const r = await createPutUploader({ endpoint: "https://a/b.png" })(new File(["x"], "b.png", { type: "image/png" }), ctx({ kind: "image" }));
    expect(r).toMatchObject({ width: 10, height: 20 });
  });
});
