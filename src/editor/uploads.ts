/**
 * Upload pipeline: policy check, placeholder, the host's handler, URL check, insertion. A lazy
 * chunk (it carries the upload policy), fetched the first time files arrive by paste, drop, the
 * picker or `uploadFiles`.
 *
 * `validateFile` -> placeholder -> handler (`signal`, `onProgress`, `kind`) ->
 * `urlAllowed(url, upload.urls ?? links, kind)` BEFORE the asset is inserted -> `insertAsset`.
 * Files run concurrently.
 */
import type { EditorOptions, UploadRejectReason } from "../types";
import type { Pane, Surface } from "./pane-types";
import type { Labels } from "./i18n";
import { fmt } from "./i18n";
import { urlAllowed, validateFile } from "../features/upload-policy";
import { mdDest } from "./markdown-dest";

export type UploadsHost = {
  options: EditorOptions;
  labels: Labels;
  toast(message: string, kind?: "info" | "error"): void;
  announce(message: string): void;
  isDestroyed(): boolean;
  isReadOnly(): boolean;
  /** The WYSIWYG surface when it is the visible pane, else null. */
  visibleSurface(): Surface | null;
  /** The Markdown pane, created on demand. */
  markdownPane(): Pane;
  /** +1 when a file starts, -1 when it ends (the status bar shows the count). */
  uploading(delta: 1 | -1): void;
  /** Aborted on destroy. */
  signals: Set<AbortController>;
};

export type Uploads = { uploadFiles(files: File[]): Promise<void> };

export function createUploads(host: UploadsHost): Uploads {
  const { options, labels } = host;

  const reasonText = (r: UploadRejectReason): string =>
    labels[("reason" + r.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")) as keyof typeof labels] as string;

  function rejectFile(file: File, reason: UploadRejectReason) {
    options.upload?.onReject?.(file, reason);
    options.onUpload?.({ type: "rejected", file, reason });
    host.toast(fmt(labels.uploadRejected, { name: file.name, reason: reasonText(reason) }), "error");
  }

  async function runUpload(file: File, kind: "image" | "file"): Promise<void> {
    const up = options.upload!;
    const ac = new AbortController();
    host.signals.add(ac);
    host.uploading(1);
    options.onUpload?.({ type: "start", file });
    const holder = host.visibleSurface()?.insertUploadPlaceholder(file.name) ?? null;
    const dropHolder = () => {
      try {
        holder?.remove();
      } catch {
        /* the surface may already be gone */
      }
    };
    try {
      const res = await up.handler(file, {
        signal: ac.signal,
        kind,
        onProgress: (f) => holder?.setProgress(Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0))),
      });
      if (host.isDestroyed() || ac.signal.aborted) return dropHolder();
      const as = res.as ?? ((res.mime ?? file.type ?? "").startsWith("image/") ? "image" : "link");
      if (!urlAllowed(res.url, up.urls ?? options.links, as === "image" ? "image" : "link")) {
        dropHolder();
        options.onUpload?.({ type: "error", file, error: new Error("The uploaded file's address is not allowed") });
        host.toast(fmt(labels.uploadFailed, { name: file.name }), "error");
        return;
      }
      dropHolder();
      const name = res.name ?? file.name;
      const surface = host.visibleSurface();
      if (surface) surface.insertAsset({ url: res.url, name, alt: res.alt, as });
      else {
        const label = (as === "image" ? (res.alt ?? name) : name).replace(/([\[\]\\])/g, "\\$1");
        host.markdownPane().insertText(as === "image" ? `![${label}](${mdDest(res.url)})` : `[${label}](${mdDest(res.url)})`);
      }
      options.onUpload?.({ type: "done", file, result: res });
      host.announce(fmt(labels.uploadDone, { name }));
    } catch (error) {
      dropHolder();
      if (host.isDestroyed() || ac.signal.aborted) return;
      options.onUpload?.({ type: "error", file, error });
      host.toast(fmt(labels.uploadFailed, { name: file.name }), "error");
    } finally {
      host.signals.delete(ac);
      host.uploading(-1);
    }
  }

  return {
    uploadFiles(files) {
      if (host.isDestroyed()) return Promise.resolve();
      const up = options.upload;
      const jobs: Promise<void>[] = [];
      let accepted = 0;
      for (const file of files) {
        const v = validateFile(file, up && !host.isReadOnly() ? up : null, { countInBatch: accepted });
        if (!v.ok) {
          rejectFile(file, v.reason);
          continue;
        }
        accepted++;
        jobs.push(runUpload(file, v.kind));
      }
      return Promise.all(jobs).then(() => undefined);
    },
  };
}
