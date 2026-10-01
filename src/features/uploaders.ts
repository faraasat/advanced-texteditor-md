/**
 * Ready-made `UploadOptions['handler']` factories.
 *
 * Server-safe at import: `fetch`, `XMLHttpRequest`, `FileReader`, `Image` and
 * `URL.createObjectURL` are only touched inside the returned functions.
 * Every failure rejects with a readable `Error`; an abort rejects with a
 * `DOMException` named `AbortError`.
 */
import type { UploadContext, UploadOptions, UploadResult } from "../types";

export type UploadHandler = UploadOptions["handler"];

/* ───────────────────────────── helpers ───────────────────────────── */

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Upload aborted", "AbortError");
  const e = new Error("Upload aborted");
  e.name = "AbortError";
  return e;
}

const isAbort = (e: unknown) => !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";

function httpError(status: number, statusText: string): Error {
  return new Error(`Upload failed: HTTP ${status}${statusText ? " " + statusText : ""}`);
}

function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

function pickUrl(json: unknown): string | undefined {
  const j = json as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return undefined;
  const direct = j.url ?? j.location ?? j.link ?? j.src;
  if (typeof direct === "string") return direct;
  for (const k of ["data", "file", "result"]) {
    const nested = pickUrl(j[k]);
    if (nested) return nested;
  }
  const files = j.files ?? j.data;
  if (Array.isArray(files) && files.length) return pickUrl(files[0]);
  return undefined;
}

/** Name, MIME type and (for images, best effort) pixel size added to a bare URL. */
async function describe(file: File, url: string, ctx: UploadContext, base?: Partial<UploadResult>): Promise<UploadResult> {
  const result: UploadResult = { url, name: file.name, mime: file.type || undefined, ...base };
  if (ctx.kind === "image" && result.width === undefined) {
    const size = await probeImage(file);
    if (size) Object.assign(result, size);
  }
  return result;
}

type SendArgs = {
  method: string;
  url: string;
  body: Blob | FormData;
  headers?: Record<string, string>;
  ctx: UploadContext;
  withCredentials?: boolean;
};

/** XMLHttpRequest wrapper: progress, abort, readable errors. Resolves with the finished request. */
function xhrSend({ method, url, body, headers, ctx, withCredentials }: SendArgs): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    if (ctx.signal.aborted) return reject(abortError());
    if (typeof XMLHttpRequest === "undefined") return reject(new Error("Upload failed: XMLHttpRequest is not available"));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => ctx.signal.removeEventListener("abort", onAbort);
    xhr.open(method, url);
    if (withCredentials) xhr.withCredentials = true;
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) ctx.onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve({ status: xhr.status, text: xhr.responseText ?? "" });
      else reject(httpError(xhr.status, xhr.statusText));
    };
    xhr.onerror = () => { done(); reject(new Error("Upload failed: network error")); };
    xhr.ontimeout = () => { done(); reject(new Error("Upload failed: the request timed out")); };
    xhr.onabort = () => { done(); reject(abortError()); };
    ctx.signal.addEventListener("abort", onAbort);
    xhr.send(body);
  });
}

function hasHeader(h: Record<string, string>, name: string): boolean {
  const n = name.toLowerCase();
  return Object.keys(h).some((k) => k.toLowerCase() === n);
}

/* ───────────────────────────── probeImage ───────────────────────────── */

/**
 * Best-effort natural size of an image file. Returns `undefined` for
 * non-images, on the server, in environments that cannot decode images, and
 * when decoding takes longer than `timeoutMs` (default 3000).
 */
export function probeImage(file: File, timeoutMs = 3000): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    try {
      if (!file || !/^image\//i.test(file.type || "")) return resolve(undefined);
      if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        return resolve(undefined);
      }
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      let settled = false;
      const finish = (v: { width: number; height: number } | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
        resolve(v);
      };
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      img.onload = () => finish(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : undefined);
      img.onerror = () => finish(undefined);
      img.src = objectUrl;
    } catch {
      resolve(undefined);
    }
  });
}

/* ───────────────────────────── PUT / POST the raw file ───────────────────────────── */

export type PutUploaderOptions = {
  endpoint: string | ((file: File) => string);
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
  /**
   * Turn the response into the file's public URL. Default: the `Location`
   * header, else a JSON body's `url`, else the endpoint without its query.
   */
  resolveUrl?: (response: Response, file: File) => Promise<string> | string;
};

/**
 * Sends the file as the request body (`fetch`). `fetch` cannot report upload
 * progress, so `onProgress` only fires `1` on completion; use
 * `createFormUploader` or `createPresignedUploader` when you need a bar.
 */
export function createPutUploader(options: PutUploaderOptions): UploadHandler {
  return async (file, ctx) => {
    if (ctx.signal.aborted) throw abortError();
    const endpoint = typeof options.endpoint === "function" ? options.endpoint(file) : options.endpoint;
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (!hasHeader(headers, "content-type")) headers["Content-Type"] = file.type || "application/octet-stream";
    let res: Response;
    try {
      res = await fetch(endpoint, { method: options.method ?? "PUT", headers, body: file, signal: ctx.signal });
    } catch (e) {
      if (ctx.signal.aborted || isAbort(e)) throw abortError();
      throw new Error(`Upload failed: ${(e as Error)?.message || "network error"}`);
    }
    if (!res.ok) throw httpError(res.status, res.statusText);
    let url: string | undefined;
    if (options.resolveUrl) url = await options.resolveUrl(res, file);
    else {
      url = res.headers.get("Location") ?? undefined;
      if (!url) {
        try {
          url = pickUrl(JSON.parse(await res.text()));
        } catch { /* not JSON */ }
      }
      url = url || stripQuery(endpoint);
    }
    ctx.onProgress(1);
    return describe(file, url, ctx);
  };
}

/* ───────────────────────────── multipart form ───────────────────────────── */

export type FormUploaderOptions = {
  endpoint: string;
  /** Form field that carries the file. Default "file". */
  field?: string;
  headers?: Record<string, string>;
  /** Appended BEFORE the file (storage services require the file last). */
  extraFields?: Record<string, string> | ((file: File) => Record<string, string>);
  /** Map the parsed JSON response. Default looks for `url`, `location`, `link`, `data.url`, `files[0].url`. */
  parse?: (json: unknown) => UploadResult;
  withCredentials?: boolean;
};

/** Multipart `POST` through XMLHttpRequest, so `onProgress` and abort both work. */
export function createFormUploader(options: FormUploaderOptions): UploadHandler {
  return async (file, ctx) => {
    const form = new FormData();
    const extra = typeof options.extraFields === "function" ? options.extraFields(file) : options.extraFields;
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
    form.append(options.field ?? "file", file, file.name);
    const { text } = await xhrSend({
      method: "POST",
      url: options.endpoint,
      body: form,
      headers: options.headers,
      ctx,
      withCredentials: options.withCredentials,
    });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Upload failed: the server did not return JSON");
    }
    if (options.parse) {
      const r = options.parse(json);
      return describe(file, r.url, ctx, r);
    }
    const url = pickUrl(json);
    if (!url) throw new Error("Upload failed: the server did not return a URL");
    return describe(file, url, ctx);
  };
}

/* ───────────────────────────── presigned URL ───────────────────────────── */

export type PresignedUploaderOptions = {
  getSignedUrl: (file: File) => Promise<{
    uploadUrl: string;
    publicUrl: string;
    headers?: Record<string, string>;
    method?: string;
  }>;
};

/** Ask the host for a signed URL, send the file straight to storage, resolve with the public URL. */
export function createPresignedUploader(options: PresignedUploaderOptions): UploadHandler {
  return async (file, ctx) => {
    if (ctx.signal.aborted) throw abortError();
    const signed = await options.getSignedUrl(file);
    if (!signed || !signed.uploadUrl) throw new Error("Upload failed: getSignedUrl returned no uploadUrl");
    if (!signed.publicUrl) throw new Error("Upload failed: getSignedUrl returned no publicUrl");
    const headers: Record<string, string> = { ...(signed.headers ?? {}) };
    if (!hasHeader(headers, "content-type")) headers["Content-Type"] = file.type || "application/octet-stream";
    await xhrSend({ method: signed.method ?? "PUT", url: signed.uploadUrl, body: file, headers, ctx });
    return describe(file, signed.publicUrl, ctx);
  };
}

/* ───────────────────────────── data URL ───────────────────────────── */

/**
 * DEV / DEMO ONLY. Inlines the file into the document as a `data:` URL. That
 * bloats the stored markdown by about a third of the file size, is re-sent on
 * every save, and is refused by the default link policy (list `data` in
 * `upload.urls.allowedSchemes` to use it for images). Use a real uploader in
 * production.
 */
export function createDataUrlUploader(): UploadHandler {
  return (file, ctx) =>
    new Promise<UploadResult>((resolve, reject) => {
      if (ctx.signal.aborted) return reject(abortError());
      if (typeof FileReader === "undefined") return reject(new Error("Upload failed: FileReader is not available"));
      const reader = new FileReader();
      const onAbort = () => reader.abort();
      const done = () => ctx.signal.removeEventListener("abort", onAbort);
      reader.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) ctx.onProgress(Math.min(1, e.loaded / e.total));
      };
      reader.onload = () => {
        done();
        ctx.onProgress(1);
        describe(file, String(reader.result), ctx).then(resolve, reject);
      };
      reader.onerror = () => { done(); reject(new Error("Upload failed: could not read the file")); };
      reader.onabort = () => { done(); reject(abortError()); };
      ctx.signal.addEventListener("abort", onAbort);
      reader.readAsDataURL(file);
    });
}
