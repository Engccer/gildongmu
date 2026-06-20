import { describe, it, expect, vi } from "vitest";
import type { AgentLoopOptions } from "@/lib/chat/agent-loop";
import type { ChatStreamEvent } from "@/lib/chat/types";

vi.mock("@/lib/gemini/client", () => ({
  getGeminiClient: vi.fn(() => ({})),
  GEMINI_MODEL: "m",
}));
vi.mock("@/lib/chat/declarations", () => ({ availableDeclarations: () => [] }));
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
});
