import { describe, it, expect } from "vitest";
import { joinText, resolveOutputMode } from "../lib/output.js";

describe("joinText", () => {
  it("falsy 조각 제거 + 쉼표 결합", () => {
    expect(joinText("강동역", "5호선", false, undefined, "120m")).toBe("강동역, 5호선, 120m");
  });
  it("전부 falsy면 빈 문자열", () => {
    expect(joinText(false, null, undefined, "")).toBe("");
  });
});

describe("resolveOutputMode", () => {
  it("플래그가 최우선", () => {
    expect(resolveOutputMode("json", { apiUrl: "", output: "text" })).toBe("json");
  });
  it("플래그 없으면 config", () => {
    expect(resolveOutputMode(undefined, { apiUrl: "", output: "json" })).toBe("json");
  });
});
