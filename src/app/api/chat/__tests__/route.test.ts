// /api/chat 엔드포인트 — generateContent mock 기반 2-pass function-calling 테스트
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolResult } from "@/lib/chat/types";
import type { Place } from "@/lib/types";

// 부분 Place는 render 통과(pass-through)만 검증하므로 의도적으로 최소 필드만 둔다.
const fakeResult: ToolResult = {
  summary: "장소 1건",
  render: { type: "places", places: [{ name: "길동 카페" } as Partial<Place> as Place] },
};

const generateContent = vi.fn();
vi.mock("@/lib/gemini/client", () => ({
  GEMINI_MODEL: "gemini-3.5-flash",
  getGeminiClient: vi.fn(() => ({ models: { generateContent } })),
}));
vi.mock("@/lib/chat/declarations", () => ({
  availableDeclarations: () => [{ name: "search_places" }],
}));
vi.mock("@/lib/chat/router", () => ({
  executeFunction: vi.fn(),
}));

import { POST } from "../route";
import { getGeminiClient } from "@/lib/gemini/client";
import { executeFunction } from "@/lib/chat/router";

function req(body: unknown) {
  return new Request("http://x/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  generateContent.mockReset();
  vi.mocked(getGeminiClient).mockReturnValue({
    models: { generateContent },
  } as unknown as ReturnType<typeof getGeminiClient>);
  vi.mocked(executeFunction).mockResolvedValue(fakeResult);
});

describe("POST /api/chat", () => {
  it("function call → execute → 산문 + render 반환", async () => {
    // 1차: functionCall 포함 응답
    generateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { functionCall: { name: "search_places", args: { query: "카페" } } },
            ],
          },
        },
      ],
      text: "",
    });
    // 2차: 산문 응답
    generateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "길동 카페를 찾았어요." }],
          },
        },
      ],
      text: "길동 카페를 찾았어요.",
    });

    const res = await POST(
      req({ messages: [{ role: "user", text: "길동 카페" }], locale: "ko" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.text).toContain("길동 카페");
    expect(json.render).toEqual({
      type: "places",
      places: [{ name: "길동 카페" }],
    });
    expect(executeFunction).toHaveBeenCalledWith(
      "search_places",
      { query: "카페" },
      expect.objectContaining({ locale: "ko" })
    );
  });

  it("키 없으면 502", async () => {
    vi.mocked(getGeminiClient).mockReturnValueOnce(null);
    const res = await POST(
      req({ messages: [{ role: "user", text: "x" }], locale: "ko" })
    );
    expect(res.status).toBe(502);
  });

  it("잘못된 body → 400", async () => {
    const badReq = new Request("http://x/api/chat", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });
});
