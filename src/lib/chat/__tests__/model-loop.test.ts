import { describe, expect, it, vi } from "vitest";
import { runChatModelLoop, type ChatModelSession, type ChatRoundResult, type ChatToolOutcome } from "../model-loop";
import type { ExecutionContext, ToolResult } from "../types";

const ctx: ExecutionContext = { locale: "ko", dataLocale: "ko" };

/** 정해 둔 회차 응답을 차례로 내는 가짜 세션. 회차마다 받은 도구 열림 여부와 붙인 결과를 기록한다. */
function fakeSession(rounds: ChatRoundResult[]) {
  const opened: boolean[] = [];
  const added: ChatToolOutcome[][] = [];
  const session: ChatModelSession = {
    async round(toolsOpen) {
      opened.push(toolsOpen);
      const r = rounds.shift();
      if (!r) throw new Error("회차 초과");
      return r;
    },
    addToolResults(o) {
      added.push(o);
    },
  };
  return { session, opened, added };
}

describe("runChatModelLoop (E89 C5)", () => {
  it("도구 왕복: 병렬 실행, 렌더·출처 누적, 실패는 { error }로 모델에 전달하고 루프를 잇는다", async () => {
    const { session, opened, added } = fakeSession([
      {
        text: "",
        calls: [
          { id: "a", name: "get_air_quality", args: { x: 1 } },
          { id: "b", name: "boom", args: {} },
        ],
      },
      { text: "답", calls: [] },
    ]);
    const execute = vi.fn(async (name: string): Promise<ToolResult> => {
      if (name === "boom") throw new Error("깨짐");
      return { data: { ok: 1 }, render: { type: "air-quality", lat: 1, lng: 2 }, source: [{ label: "source.airkorea" }] } as ToolResult;
    });
    const onStatus = vi.fn();
    const r = await runChatModelLoop({ session, ctx, onStatus, execute });
    expect(r.text).toBe("답");
    expect(r.renders).toEqual([{ type: "air-quality", lat: 1, lng: 2 }]);
    expect(r.sources).toEqual([{ label: "source.airkorea" }]);
    expect(onStatus).toHaveBeenCalledWith(["get_air_quality", "boom"]);
    expect(execute).toHaveBeenCalledWith("get_air_quality", { x: 1 }, ctx);
    expect(added).toHaveLength(1);
    expect(added[0][0]).toMatchObject({ ok: true, response: { ok: 1 } });
    expect(added[0][1]).toMatchObject({ ok: false, response: { error: "Error: 깨짐" } });
    expect(opened).toEqual([true, true]);
  });

  it("I-2: 답이 비면 도구를 닫고 1회 더", async () => {
    const { session, opened } = fakeSession([
      { text: "  ", calls: [] },
      { text: "산문", calls: [] },
    ]);
    const r = await runChatModelLoop({ session, ctx, execute: vi.fn() });
    expect(r.text).toBe("산문");
    expect(opened).toEqual([true, false]);
  });

  it("상한(maxIterations)을 지나면 멈추고, 실행되지 않은 마지막 호출은 이력에 넣지 않은 채 닫힌 회차로 끝낸다", async () => {
    const call = { text: "", calls: [{ id: "x", name: "t", args: {} }] };
    const { session, added, opened } = fakeSession([call, call, call, { text: "끝", calls: [] }]);
    const execute = vi.fn(async () => ({ data: {} }) as ToolResult);
    const r = await runChatModelLoop({ session, ctx, execute, maxIterations: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(added).toHaveLength(2);
    expect(opened).toEqual([true, true, true, false]);
    expect(r.text).toBe("끝");
  });

  it("세션 실패는 그대로 던진다(Gemini로 돌리지 않는다, C4)", async () => {
    const session: ChatModelSession = {
      round: async () => {
        throw new Error("402");
      },
      addToolResults: () => {},
    };
    await expect(runChatModelLoop({ session, ctx, execute: vi.fn() })).rejects.toThrow("402");
  });
});
