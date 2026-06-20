import { describe, it, expect } from "vitest";
import { parseModeFromUrl, modeToUrl } from "../mode-state";

describe("parseModeFromUrl", () => {
  it("?mode=chat → chat", () => {
    expect(parseModeFromUrl("?mode=chat")).toBe("chat");
  });

  it("?mode=search → search", () => {
    expect(parseModeFromUrl("?mode=search")).toBe("search");
  });

  it("없으면 null", () => {
    expect(parseModeFromUrl("?q=cafe")).toBeNull();
  });
});

describe("modeToUrl", () => {
  it("chat 모드는 ?mode=chat 추가, q 보존", () => {
    const result = modeToUrl("?q=cafe", "chat");
    expect(result).toContain("mode=chat");
    expect(result).toContain("q=cafe");
  });

  it("search 모드는 mode 파라미터 제거, q 보존", () => {
    const result = modeToUrl("?q=cafe&mode=chat", "search");
    expect(result).not.toContain("mode=");
    expect(result).toContain("q=cafe");
  });
});
