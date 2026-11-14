import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext, RenderPayload, ToolResult } from "@/lib/chat/types";
import { runVergiliusLoop, VERGILIUS_MAX_TOOL_ROUNDS } from "../loop";
import type {
  VergiliusModelSession,
  VergiliusRoundOptions,
  VergiliusStreamEvent,
  VergiliusToolCall,
  VergiliusToolOutcome,
} from "../types";

const ctx: ExecutionContext = {
  userLocation: { lat: 37.5704, lng: 126.9831 },
  routeStart: { manualOrigin: false },
  locale: "ko",
  dataLocale: "ko",
};

type Step = { kind: "text"; delta: string } | { kind: "call"; call: VergiliusToolCall };

/** 회차마다 정해 둔 조각을 순서대로 흘리는 가짜 세션. */
function scriptedSession(rounds: Step[][]) {
  const seen: { tools: boolean }[] = [];
  const pushed: VergiliusToolOutcome[][] = [];
  const session: VergiliusModelSession = {
    async round(opts: VergiliusRoundOptions) {
      const steps = rounds[seen.length] ?? [];
      seen.push({ tools: opts.tools });
      let text = "";
      const calls: VergiliusToolCall[] = [];
      for (const s of steps) {
        if (s.kind === "text") {
          text += s.delta;
          opts.onText(s.delta);
        } else {
          opts.onCall();
          calls.push(s.call);
        }
      }
      return { text, calls };
    },
    pushToolResults(outcomes) {
      pushed.push(outcomes);
    },
  };
  return { session, seen, pushed };
}

const call = (name: string, args: Record<string, unknown> = {}, id: string | null = null): Step => ({
  kind: "call",
  call: { id, name, args },
});
const text = (delta: string): Step => ({ kind: "text", delta });

function run(
  rounds: Step[][],
  execute = vi.fn(async (_name: string): Promise<ToolResult> => ({ data: { ok: true } })),
) {
  const events: VergiliusStreamEvent[] = [];
  const s = scriptedSession(rounds);
  const promise = runVergiliusLoop({
    session: s.session,
    execute,
    ctx,
    allowedTools: new Set(["get_bus_arrivals", "get_walk_route"]),
    proposableIds: new Set(["k101"]),
    emit: (e) => events.push(e),
  });
  return { promise, events, execute, ...s };
}

describe("runVergiliusLoop", () => {
  it("도구 없는 답: 글 조각은 전부 final이고 그 글이 결과다", async () => {
    const r = run([[text("왼쪽 12미터에 "), text("가나카페가 있습니다.")]]);
    await expect(r.promise).resolves.toEqual({ text: "왼쪽 12미터에 가나카페가 있습니다.", renders: [], proposal: null });
    expect(r.events).toEqual([
      { type: "text", delta: "왼쪽 12미터에 ", final: true },
      { type: "text", delta: "가나카페가 있습니다.", final: true },
    ]);
    expect(r.execute).not.toHaveBeenCalled();
  });

  it("도구 호출 뒤의 글만 final이다: 호출이 낀 회차의 글은 final이 아니고, 다음 회차의 글이 답이다", async () => {
    const r = run([
      [call("get_bus_arrivals"), text("잠시만요.")],
      [text("101번이 섭니다.")],
    ]);
    const result = await r.promise;
    expect(result.text).toBe("101번이 섭니다.");
    expect(r.events).toEqual([
      { type: "text", delta: "잠시만요.", final: false },
      { type: "text", delta: "101번이 섭니다.", final: true },
    ]);
  });

  it("글 뒤에 도구 호출이 따라오면 reset을 한 번 보낸다(이미 final로 나간 군말을 거둔다)", async () => {
    const r = run([
      [text("확인해 볼게요."), call("get_bus_arrivals"), call("get_walk_route", { destination: "시청" })],
      [text("101번이 섭니다.")],
    ]);
    await r.promise;
    expect(r.events).toEqual([
      { type: "text", delta: "확인해 볼게요.", final: true },
      { type: "reset" },
      { type: "text", delta: "101번이 섭니다.", final: true },
    ]);
  });

  it(`도구 왕복은 ${VERGILIUS_MAX_TOOL_ROUNDS}회까지다: 그 뒤 회차는 도구를 닫고, 그래도 온 호출은 실행하지 않는다`, async () => {
    const always = [call("get_bus_arrivals")];
    const r = run([always, always, [...always, text("조회하지 못했습니다.")], always]);
    const result = await r.promise;
    expect(r.seen).toEqual([{ tools: true }, { tools: true }, { tools: false }]);
    expect(r.execute).toHaveBeenCalledTimes(VERGILIUS_MAX_TOOL_ROUNDS);
    expect(r.pushed).toHaveLength(VERGILIUS_MAX_TOOL_ROUNDS);
    expect(result).toEqual({ text: "조회하지 못했습니다.", renders: [], proposal: null });
  });

  it("실행 컨텍스트와 인자를 그대로 실행부에 넘기고, 결과는 호출 순서대로 세션에 돌려준다", async () => {
    const execute = vi.fn(async (name: string): Promise<ToolResult> => ({ data: { tool: name } }));
    const r = run(
      [
        [call("get_walk_route", { destination: "시청" }, "c1"), call("get_bus_arrivals", {}, "c2")],
        [text("끝.")],
      ],
      execute,
    );
    await r.promise;
    expect(execute).toHaveBeenNthCalledWith(1, "get_walk_route", { destination: "시청" }, ctx);
    expect(execute).toHaveBeenNthCalledWith(2, "get_bus_arrivals", {}, ctx);
    expect(r.pushed[0].map((o) => [o.call.id, o.response])).toEqual([
      ["c1", { tool: "get_walk_route" }],
      ["c2", { tool: "get_bus_arrivals" }],
    ]);
  });

  it("도구 결과의 좌표는 모델에 가지 않고(깊이 무관), 렌더의 좌표는 앱에 그대로 간다", async () => {
    const routeStart = {
      type: "route-start", mode: "walk", dest: { lat: 37.5547, lng: 126.9707 }, destLabel: "서울역", destRoman: null,
      via: null, accessible: false, carProvider: null, transit: null,
    } satisfies RenderPayload;
    const execute = vi.fn(async (): Promise<ToolResult> => ({
      data: {
        count: 1,
        stops: [{ name: "종로1가", lat: 37.5702, lng: 126.9816, distanceMeters: 134, arrivals: [{ routeNo: "101", lat: 1, lng: 2 }] }],
      },
      render: routeStart,
    }));
    const r = run([[call("get_bus_arrivals")], [text("101번이 섭니다.")]], execute);
    const result = await r.promise;
    expect(r.pushed[0][0].response).toEqual({
      count: 1,
      stops: [{ name: "종로1가", distanceMeters: 134, arrivals: [{ routeNo: "101" }] }],
    });
    expect(JSON.stringify(r.pushed)).not.toMatch(/"lat"|"lng"|37\.57|126\.98/);
    expect(result.renders).toEqual([routeStart]);
  });

  it("route-start 렌더만 결과에 남는다", async () => {
    const routeStart = {
      type: "route-start", mode: "walk", dest: { lat: 1, lng: 2 }, destLabel: "시청", destRoman: null,
      via: null, accessible: false, carProvider: null, transit: null,
    } satisfies RenderPayload;
    const execute = vi.fn(async (name: string): Promise<ToolResult> =>
      name === "get_walk_route"
        ? { data: {}, render: routeStart }
        : { data: {}, render: { type: "bus", mode: "current" } },
    );
    const r = run([[call("get_walk_route"), call("get_bus_arrivals")], [text("13분 걸립니다.")]], execute);
    expect((await r.promise).renders).toEqual([routeStart]);
  });

  it("제안: 요청에 있던 id면 그 자리에서 끝내고 글은 비운다(같은 회차의 다른 도구는 실행하지 않는다)", async () => {
    const r = run([[call("propose_guide", { placeId: "k101" }), call("get_walk_route", { destination: "가나카페" })]]);
    await expect(r.promise).resolves.toEqual({ text: "", renders: [], proposal: { placeId: "k101" } });
    expect(r.execute).not.toHaveBeenCalled();
    expect(r.seen).toHaveLength(1);
  });

  it("제안: 없는 id는 버리고 모델에 오류로 돌려준 뒤 글로 끝낸다", async () => {
    const r = run([[call("propose_guide", { placeId: "k999" }, "c9")], [text("어느 곳인지 다시 말씀해 주세요.")]]);
    const result = await r.promise;
    expect(result.proposal).toBeNull();
    expect(result.text).toBe("어느 곳인지 다시 말씀해 주세요.");
    expect(r.execute).not.toHaveBeenCalled();
    expect(r.pushed[0][0].call.id).toBe("c9");
    expect(r.pushed[0][0].response).toHaveProperty("error");
  });

  it("열어 주지 않은 도구는 실행하지 않고 오류로 돌려준다(채팅 실행부는 다른 도구도 실행할 수 있다)", async () => {
    const r = run([[call("search_web", { query: "x" }), call("plan_journey", { destination: "y" })], [text("모르겠습니다.")]]);
    await r.promise;
    expect(r.execute).not.toHaveBeenCalled();
    expect(r.pushed[0].every((o) => "error" in o.response)).toBe(true);
  });

  it("3-state: 도구가 던지면 루프는 살고 모델은 error를 받는다(0건과 다른 값이다)", async () => {
    const execute = vi.fn(async (name: string): Promise<ToolResult> => {
      if (name === "get_bus_arrivals") throw new Error("upstream 502");
      return { data: { count: 0, stops: [] } };
    });
    const r = run([[call("get_bus_arrivals"), call("get_walk_route")], [text("버스는 조회하지 못했습니다.")]], execute);
    const result = await r.promise;
    expect(r.pushed[0][0].response).toEqual({ error: "upstream 502" });
    expect(r.pushed[0][1].response).toEqual({ count: 0, stops: [] });
    expect(result.text).toBe("버스는 조회하지 못했습니다.");
  });

  it("3-state: 모델 호출이 던지면 루프도 던진다(라우트가 error 이벤트로 바꾼다)", async () => {
    const events: VergiliusStreamEvent[] = [];
    const session: VergiliusModelSession = {
      round: async () => {
        throw new Error("openai responses 500");
      },
      pushToolResults: () => {},
    };
    await expect(
      runVergiliusLoop({
        session, execute: vi.fn(), ctx, allowedTools: new Set(), proposableIds: new Set(), emit: (e) => events.push(e),
      }),
    ).rejects.toThrow("openai responses 500");
    expect(events).toEqual([]);
  });
});
