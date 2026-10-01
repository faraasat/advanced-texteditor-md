import { test } from "@playwright/test";

// Needs the editor integration: standalone-URL paragraphs must carry
// `data-atm-standalone-link` (see the HYDRATION CONTRACT in src/features/link-preview.ts).
test.describe("link previews and embeds", () => {
  test.fixme("a URL alone on a line becomes a card; hover shows a popover; Escape closes it", async () => {});
  test.fixme("a YouTube URL alone on a line becomes a sandboxed iframe with an Open original link", async () => {});
});
