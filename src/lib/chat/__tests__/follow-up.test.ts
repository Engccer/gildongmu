import { describe, expect, it } from "vitest";
import { buildFollowUpPrompt, parseFollowUps } from "../follow-up";

describe("parseFollowUps — 잡음 흡수, 실패는 []", () => {
  it("코드펜스·앞뒤 산문을 벗기고 3개로 절단, 공백 항목 제거", () => {
    expect(parseFollowUps('설명:\n```json\n["a", " b ", "", 3, "c", "d"]\n```')).toEqual(["a", "b", "c"]);
  });
  it("중복 문장은 하나만(첫 등장), 그 뒤 3개 절단", () => {
    expect(parseFollowUps('["a","a","b","a","c","d"]')).toEqual(["a", "b", "c"]);
  });
  it("배열이 아니거나 JSON이 깨지면 []", () => {
    expect(parseFollowUps('{"suggestions":"a"}')).toEqual([]);
    expect(parseFollowUps('["a", "b"')).toEqual([]);
    expect(parseFollowUps(undefined)).toEqual([]);
  });
});

describe("buildFollowUpPrompt", () => {
  it("언어·2+1 구성·앱 범위 제한·장소명", () => {
    const p = buildFollowUpPrompt({ lastUserMessage: "u", lastAssistantMessage: "a", locale: "ja", placeName: "강동역" });
    expect(p).toContain("Japanese");
    expect(p).toMatch(/ONE is deliberately unexpected/);
    expect(p).toMatch(/answerable by this app/);
    expect(p).toContain("[Place this conversation is about]\n강동역");
  });
  it("미지 로케일은 한국어, 장소명 없으면 그 절이 없다", () => {
    const p = buildFollowUpPrompt({ lastUserMessage: "u", lastAssistantMessage: "a", locale: "xx" });
    expect(p).toContain("Korean");
    expect(p).not.toContain("[Place this conversation is about]");
  });
});
