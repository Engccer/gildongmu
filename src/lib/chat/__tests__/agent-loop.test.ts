import { describe, it, expect, vi } from "vitest";
import type { AgentLoopOptions } from "../agent-loop";

// executeFunction을 mock — 도구 시나리오 주입
vi.mock("../router", () => ({
  executeFunction: vi.fn(async (name: string) => {
    if (name === "fail_tool") throw new Error("provider 폭발");
    return {
      data: { ok: true, name },
      render: { type: "air-quality", lat: 1, lng: 2 },
      source: [{ label: "source.airkorea" }],
    };
  }),
}));

import { runAgentLoop } from "../agent-loop";

/** generateContent가 순차적으로 돌려줄 응답 스크립트를 만든다. */
type MockResponse = { candidates: { content: { role: string; parts: Record<string, unknown>[] } }[]; text: string };

function makeAi(responses: MockResponse[]): AgentLoopOptions["ai"] {
  let i = 0;
  return {
    models: {
      generateContent: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
    },
  } as unknown as AgentLoopOptions["ai"];
}
const fcResponse = (name: string): MockResponse => ({
  candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args: {} } }] } }],
  text: "",
});
const textResponse = (text: string): MockResponse => ({
  candidates: [{ content: { role: "model", parts: [{ text }] } }],
  text,
});
const baseOpts = (ai: AgentLoopOptions["ai"]): AgentLoopOptions => ({
  ai, model: "m", systemInstruction: "s",
  tools: [{ functionDeclarations: [] }],
  history: [{ role: "user", parts: [{ text: "q" }] }],
  ctx: { locale: "ko", dataLocale: "ko" as const, userLocation: { lat: 1, lng: 2 } },
});

describe("runAgentLoop", () => {
  it("도구 호출 후 최종 산문 반환 + renders/sources 수집", async () => {
    const ai = makeAi([fcResponse("get_air_quality"), textResponse("공기질은 나쁨입니다.")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toBe("공기질은 나쁨입니다.");
    expect(r.renders).toEqual([{ type: "air-quality", lat: 1, lng: 2 }]);
    expect(r.sources).toEqual([{ label: "source.airkorea" }]);
    expect(ai.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("연쇄 2회 도구 호출 후 종합", async () => {
    const ai = makeAi([fcResponse("get_air_quality"), fcResponse("get_subway_arrivals"), textResponse("종합")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toBe("종합");
    expect(ai.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it("도구 실패는 루프를 죽이지 않고 LLM에 error 전달(I-1)", async () => {
    const ai = makeAi([fcResponse("fail_tool"), textResponse("조회에 실패했어요. 다시 시도해 주세요.")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toContain("실패");
    expect(r.renders).toEqual([]); // 실패 도구는 render 미수집
  });

  it("빈 text는 tools 없이 1회 강제 폴백(I-2)", async () => {
    const ai = makeAi([fcResponse("get_air_quality"), textResponse(""), textResponse("폴백 답변")]);
    const r = await runAgentLoop(baseOpts(ai));
    expect(r.text).toBe("폴백 답변");
    // I-2 핵심: 마지막 폴백 호출은 tools를 빼야 한다(빈 버블 차단을 위한 강제 산문)
    expect(ai.models.generateContent).toHaveBeenCalledTimes(3);
    const lastCall = vi.mocked(ai.models.generateContent).mock.calls.at(-1)![0];
    expect(lastCall.config?.tools).toBeUndefined();
  });

  it("onStatus 콜백이 도구 카테고리를 통지", async () => {
    const onStatus = vi.fn();
    const ai = makeAi([fcResponse("get_air_quality"), textResponse("끝")]);
    await runAgentLoop({ ...baseOpts(ai), onStatus });
    expect(onStatus).toHaveBeenCalledWith(["get_air_quality"]);
  });
});
