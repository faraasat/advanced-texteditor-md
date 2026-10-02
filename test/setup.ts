// Every lazy chunk is fetched once per test file, so the editor tests can use the editor
// synchronously (a chunk that has already been downloaded is used at once). The cold path, where
// a chunk arrives later, has its own tests (test/editor/lazy-chunks.test.ts) and resets the modules.
import { preloadChunks } from "../src/editor/lazy-chunks";

await preloadChunks();
