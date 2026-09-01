import { describe, it, expect, vi } from "vitest";
import type { AgentLoopOptions } from "@/lib/chat/agent-loop";
import type { ChatStreamEvent } from "@/lib/chat/types";

vi.mock("@/lib/gemini/client", () => ({
  getGeminiClient: vi.fn(() => ({})),
  GEMINI_MODEL: "m",
}));
vi.mock("@/lib/chat/declarations", () => ({ availableDeclarations: () => [] }));
// 레이트리밋(60초 10회)은 이 파일의 호출 수가 넘기므로 목 — 판정 대상이 아니다.
vi.mock("@/lib/rate-limit", () => ({ checkChatRateLimit: () => true, clientIpFromHeaders: () => "1.2.3.4" }));
vi.mock("@/lib/chat/agent-loop", () => ({
  runAgentLoop: vi.fn(async (opts: AgentLoopOptions) => {
    opts.onStatus?.(["get_air_quality"]);
    return { text: "최종 답변", renders: [{ type: "air-quality", lat: 1, lng: 2 }], sources: [{ label: "source.airkorea" }] };
  }),
}));

import { POST } from "../route";

async function readNdjson(res: Response): Promise<ChatStreamEvent[]> {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as ChatStreamEvent);
}

describe("POST /api/chat", () => {
  it("NDJSON status + done 이벤트 스트리밍", async () => {
    const req = new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", text: "공기질" }], locale: "ko" }),
    });
    const res = await POST(req);
    expect(res.headers.get("Content-Type")).toContain("ndjson");
    const events = await readNdjson(res);
    expect(events[0]).toEqual({ type: "status", categories: ["get_air_quality"] });
    expect(events.at(-1)).toEqual({
      type: "done", text: "최종 답변",
      renders: [{ type: "air-quality", lat: 1, lng: 2 }],
      sources: [{ label: "source.airkorea" }],
    });
  });

  it("키 없으면 502", async () => {
    const { getGeminiClient } = await import("@/lib/gemini/client");
    vi.mocked(getGeminiClient).mockReturnValueOnce(null);
    const req = new Request("http://x/api/chat", { method: "POST", body: "{}" });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  it("locale이 지원 6로케일 밖이면 400 invalid_locale(누락은 ko)", async () => {
    for (const bad of ["EN", "ko-KR", "zh", ""]) {
      const req = new Request("http://x/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", text: "q" }], locale: bad }),
      });
      const res = await POST(req);
      expect(res.status, `locale=${bad}`).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_locale" });
    }
    for (const ok of ["ko", "en", "es", "fr", "it", "ja", undefined]) {
      const req = new Request("http://x/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", text: "q" }], locale: ok }),
      });
      expect((await POST(req)).status, `locale=${ok}`).toBe(200);
    }
  });

  it("잘못된 body → 400", async () => {
    const req = new Request("http://x/api/chat", { method: "POST", body: "not-json" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
