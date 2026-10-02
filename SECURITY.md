# Security policy

## Supported versions

Security fixes go into the latest minor release of the latest major. While the package is `0.x`, that means the most recent
published version only.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately with a
[GitHub security advisory](https://github.com/faraasat/advanced-texteditor-md/security/advisories/new)
(Security tab, "Report a vulnerability").

Please include the version, the options you pass to `createEditor` / `renderHtml`, the Markdown, pasted HTML or file that
triggers it, the browser, and what runs or leaks. A payload that executes script in the browser is the clearest report.

You can expect an acknowledgement within a few days, a fix or a clear answer as soon as it is understood, and credit in the
release notes if you want it.

## What counts

In scope: any way for untrusted Markdown, pasted or dropped HTML, custom syntax attributes, chip fields, link-preview metadata,
embed URLs, upload results or file names to run script, load a script or an unexpected origin, escape the link policy, or
reach the DOM as something other than text; and any regular expression the library runs on untrusted input that can be made
to hang.

Out of scope: a `resolve` function, uploader or math renderer that you wrote returning unsafe output (those are trusted
extension points, and the docs say so); vulnerabilities in your server-side link-preview fetcher (SSRF protection is yours,
as the README explains); and behaviour that needs a browser extension or a compromised dependency of your own app.

## How the library defends itself

- Raw HTML in Markdown stays literal text. Links and images pass a scheme allow-list; `javascript:` is always refused,
  including control-character tricks (`java<TAB>script:`).
- Custom element attributes are validated: no `on*`, no `srcset`, `style` with `url(` is dropped, URL-valued attributes go
  through the link policy.
- Embeds are sandboxed iframes on `https` URLs whose host must be allowed by the provider. Link preview metadata is text only.
- Uploaded file names are sanitised and a default deny list blocks executables and scripts.
- **An XSS test corpus** of more than 120 vectors lives in `test/security/`. It pushes every payload through every path
  (render-only, mount, `setValue`, read-only, the split preview, paste, drop, the lightbox) and checks the whole document after
  each. `e2e/security.spec.ts` replays it in real browsers, where a payload would actually run. If you find a bypass, adding its
  payload to that corpus is the best possible regression test, and a pull request that does so alongside the fix is welcome
  once the advisory is resolved.

## The library never phones home

`advanced-texteditor-md` collects no telemetry, loads no script and makes no network request on its own. The only requests it ever makes
are the ones your own functions make (an uploader, a link-preview `resolve`). Analytics exist **only on the demo site** (`site/`,
deployed to GitHub Pages), which is not part of the published package; the README's Privacy section describes them.

See also the "Security notes" in the [README](README.md#security-notes).
