import { describe, expect, it } from "vitest";
import { detectPlatform as fromDom } from "../../src/editor/dom";
import { isApple as fromKeymap } from "../../src/editor/keymap";
import { detectPlatform, isApple } from "../../src/editor/platform";

describe("one platform implementation", () => {
  it("the keymap and the chrome re-export the same functions", () => {
    expect(fromKeymap).toBe(isApple);
    expect(fromDom).toBe(detectPlatform);
  });
  it.each([
    [{ platform: "MacIntel" }, "mac", true],
    [{ platform: "iPhone" }, "mac", true],
    [{ platform: "Win32" }, "windows", false],
    [{ platform: "Linux x86_64" }, "linux", false],
    [{ userAgentData: { platform: "macOS" } }, "mac", true],
    // platform wins over a spoofed user agent
    [{ platform: "Win32", userAgent: "Mac OS X" }, "windows", false],
    [{}, "other", false],
  ])("%j", (nav, platform, apple) => {
    expect(detectPlatform(nav)).toBe(platform);
    expect(isApple(nav)).toBe(apple);
  });
});
