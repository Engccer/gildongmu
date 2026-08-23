import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 2026-08-24 §3.1 — 칩 부재는 정상 상태: 키 없음·생성 실패·파싱 불가 전부 200 `{suggestions: []}`.
const generateContent = vi.fn();
let client: unknown = { models: { generateContent } };
vi.mock("@/lib/gemini/client", () => ({
  getGeminiClient: () => client,
  GEMINI_MODEL: "m",
}));

import { POST } from "../route";

const body = (over: Record<string, unknown> = {}) =>
  new Request("http://x/api/chat/suggestions", {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ lastUserMessage: "근처 카페", lastAssistantMessage: "길동에 카페 3곳", locale: "ko", ...over }),
  });

beforeEach(() => {
  generateContent.mockReset();
  client = { models: { generateContent } };
});

describe("POST /api/chat/suggestions", () => {
  it("정상: 3개 배열, thinking low, 프롬프트에 대화·장소명이 실린다", async () => {
    generateContent.mockResolvedValue({ text: '["A?","B?","C?"]' });
    const res = await POST(body({ placeName: "강동역" }));
    expect(await res.json()).toEqual({ suggestions: ["A?", "B?", "C?"] });
    const call = generateContent.mock.calls[0][0];
    expect(call.config.thinkingConfig.thinkingLevel).toBe("LOW");
    expect(call.contents).toContain("근처 카페");
    expect(call.contents).toContain("강동역");
    expect(call.contents).toContain("Korean");
  });

  it("키 없음·생성 실패·파싱 불가는 전부 200 빈 배열", async () => {
    client = null;
    expect(await (await POST(body())).json()).toEqual({ suggestions: [] });
    client = { models: { generateContent } };
    generateContent.mockRejectedValue(new Error("boom"));
    expect(await (await POST(body())).json()).toEqual({ suggestions: [] });
    generateContent.mockResolvedValue({ text: "죄송합니다" });
    expect(await (await POST(body())).json()).toEqual({ suggestions: [] });
  });

  it("긴 답변은 400이 아니라 절단해 처리한다", async () => {
    generateContent.mockResolvedValue({ text: '["A?","B?","C?"]' });
    const res = await POST(body({ lastAssistantMessage: "가".repeat(8001) }));
    expect(res.status).toBe(200);
    expect(generateContent.mock.calls[0][0].contents).not.toContain("가".repeat(8001));
    expect(generateContent.mock.calls[0][0].contents).toContain("가".repeat(8000));
  });

  it("본문 검증: 빈 메시지·미지 로케일은 400", async () => {
    expect((await POST(body({ lastUserMessage: "" }))).status).toBe(400);
    expect((await POST(body({ locale: "de" }))).status).toBe(400);
  });
});
