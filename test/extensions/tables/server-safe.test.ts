// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("tables: server-safe", () => {
  it("imports and converts without a DOM", async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    const m = await import("../../../src/extensions/tables");
    expect(m.csvToTable("a,b\n1,2")).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
    const p = m.createTablesPlugin({ sortable: true });
    expect(p.name).toBe("tables");
    expect(m.findTable("| a |\n| - |", 0)!.grid.head).toEqual(["a"]);
  });
});
