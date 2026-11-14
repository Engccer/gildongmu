import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VergiliusLoopOptions } from "@/lib/vergilius/loop";
import { VergiliusModelError, type VergiliusStreamEvent } from "@/lib/vergilius/types";
import { askFixture } from "@/lib/vergilius/__tests__/fixtures";

const gates = vi.hoisted(() => ({ openai: true, gemini: true, ip: true, daily: true }));
const spies = vi.hoisted(() => ({
  createOpenAiSession: vi.fn((..._args: unknown[]) => ({ round: vi.fn(), pushToolResults: vi.fn() })),
  createGoogleSession: vi.fn((..._args: unknown[]) => ({ round: vi.fn(), pushToolResults: vi.fn() })),
  runVergiliusLoop: vi.fn(),
  reserveDaily: vi.fn(),
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    env: { ...actual.env, OPENAI_API_KEY: "sk-test" },
    hasOpenAiKey: () => gates.openai,
    hasGeminiKey: () => gates.gemini,
  };
});
vi.mock("@/lib/gemini/client", () => ({ getGeminiClient: () => (gates.gemini ? { models: {} } : null), GEMINI_MODEL: "m" }));
vi.mock("@/lib/rate-limit", () => ({
  checkVergiliusRateLimit: () => gates.ip,
  reserveVergiliusDaily: (now: number) => {
    spies.reserveDaily(now);
    return gates.daily;
  },
  clientIpFromHeaders: () => "1.2.3.4",
}));
// connection()은 요청 범위 밖(테스트)에서 던진다. 동적 렌더 표시일 뿐이라 빈 함수로 둔다.
vi.mock("next/server", () => ({ connection: async () => {} }));
// 실행부는 이 파일의 판정 대상이 아니다(무거운 provider 그래프를 끌어오지 않는다).
vi.mock("@/lib/chat/router", () => ({ executeFunction: vi.fn() }));
vi.mock("@/lib/vergilius/openai", () => ({ createOpenAiSession: spies.createOpenAiSession }));
vi.mock("@/lib/vergilius/google", () => ({ createGoogleSession: spies.createGoogleSession }));
vi.mock("@/lib/vergilius/loop", () => ({ runVergiliusLoop: spies.runVergiliusLoop }));

import { POST } from "../ask/route";
import { GET } from "../providers/route";
import {
  VERGILIUS_GOOGLE_OPEN,
  VERGILIUS_REQUEST_TIMEOUT_MS,
  vergiliusRequestSignal,
} from "@/lib/vergilius/providers";

function ask(body: unknown, signal?: AbortSignal): Promise<Response> {
  return POST(
    new Request("http://x/api/vergilius/ask", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    }),
  );
}

async function readNdjson(res: Response): Promise<VergiliusStreamEvent[]> {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as VergiliusStreamEvent);
}

beforeEach(() => {
  Object.assign(gates, { openai: true, gemini: true, ip: true, daily: true });
  vi.clearAllMocks();
  spies.runVergiliusLoop.mockImplementation(async (opts: VergiliusLoopOptions) => {
    opts.emit({ type: "text", delta: "왼쪽 12미터에 가나카페가 있습니다.", final: true });
    return { text: "왼쪽 12미터에 가나카페가 있습니다.", renders: [], proposal: null };
  });
});

describe("GET /api/vergilius/providers", () => {
  it("E86 판정 전까지 Google은 닫혀 있다: Gemini 키가 있어도 목록은 OpenAI뿐이다", async () => {
    expect(VERGILIUS_GOOGLE_OPEN).toBe(false);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ providers: ["openai"] });
  });

  it("키 없는 회사는 목록에 없다", async () => {
    gates.openai = false;
    expect(await (await GET()).json()).toEqual({ providers: [] });
  });
});

describe("POST /api/vergilius/ask", () => {
  it("NDJSON no-store 스트림: text 뒤에 done이 온다", async () => {
    const res = await ask(askFixture());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("ndjson");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await readNdjson(res)).toEqual([
      { type: "text", delta: "왼쪽 12미터에 가나카페가 있습니다.", final: true },
      { type: "done", text: "왼쪽 12미터에 가나카페가 있습니다.", renders: [], proposal: null },
    ]);
  });

  it("실행 컨텍스트: userLocation은 요청 좌표, routeStart 켬, 장소 앵커·여정 없음", async () => {
    const req = askFixture();
    await (await ask(req)).text();
    const opts = spies.runVergiliusLoop.mock.calls[0][0] as VergiliusLoopOptions;
    expect(opts.ctx).toEqual({
      userLocation: req.location,
      routeStart: { manualOrigin: false },
      locale: "ko",
      dataLocale: "ko",
    });
    expect([...opts.proposableIds].sort()).toEqual(["k101", "k102", "k103", "k200"]);
    expect(opts.allowedTools.has("propose_guide")).toBe(false);
    expect(opts.allowedTools.has("plan_journey")).toBe(false);
  });

  it("모델에게 가는 글에 요청 좌표가 없다(회사 어댑터가 받는 지침과 재료)", async () => {
    const req = askFixture();
    await (await ask(req)).text();
    const sent = spies.createOpenAiSession.mock.calls[0][0] as { instruction: string; material: string };
    const prompt = `${sent.instruction}\n${sent.material}`;
    for (const v of [req.location.lat, req.location.lng, ...req.places.flatMap((p) => [p.lat, p.lng])]) {
      expect(prompt).not.toContain(String(v));
    }
    expect(prompt).toContain("k101 | 가나카페");
  });

  it("닫아 둔 회사: provider가 google이면 키 없는 회사와 같은 502이고 어느 세션도 만들지 않는다", async () => {
    const res = await ask(askFixture({ provider: "google" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "provider_unavailable" });
    expect(spies.createGoogleSession).not.toHaveBeenCalled();
    expect(spies.createOpenAiSession).not.toHaveBeenCalled();
    expect(spies.reserveDaily).not.toHaveBeenCalled();
  });

  it("요청 전체 시한: 세션이 받는 신호는 요청 취소와 25초 시한을 합친 것이다", async () => {
    expect(VERGILIUS_REQUEST_TIMEOUT_MS).toBe(25_000);
    const controller = new AbortController();
    await (await ask(askFixture(), controller.signal)).text();
    const sent = spies.createOpenAiSession.mock.calls[0][0] as { signal: AbortSignal };
    expect(sent.signal.aborted).toBe(false);
    controller.abort();
    expect(sent.signal.aborted).toBe(true);
    // 시한 쪽: 요청이 살아 있어도 시간이 지나면 닫힌다.
    const timed = vergiliusRequestSignal(new AbortController().signal, 5);
    await new Promise((r) => setTimeout(r, 40));
    expect(timed.aborted).toBe(true);
    expect((timed.reason as Error).name).toBe("TimeoutError");
  });

  it("실행 금지 재료: 목록의 가게 이름이 루프에 간다(경로 도구의 도착지 대조용)", async () => {
    await (await ask(askFixture())).text();
    const opts = spies.runVergiliusLoop.mock.calls[0][0] as VergiliusLoopOptions;
    expect([...opts.listedPlaceNames].sort()).toEqual(askFixture().places.map((p) => p.name).sort());
  });

  it("검증 실패는 400이고 틀린 필드 이름만 돌려준다", async () => {
    const res = await ask({ ...askFixture(), question: "가".repeat(501) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request", fields: ["question"] });
    expect((await ask("{깨진")).status).toBe(400);
    expect(spies.runVergiliusLoop).not.toHaveBeenCalled();
    expect(spies.reserveDaily).not.toHaveBeenCalled();
  });

  it("IP 상한: 429, 본문을 읽기 전에 거절한다", async () => {
    gates.ip = false;
    const res = await ask(askFixture());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(spies.runVergiliusLoop).not.toHaveBeenCalled();
  });

  it("한국 밖 좌표: 200 커버리지 마커, 모델을 부르지 않고 하루 상한도 쓰지 않는다(키 게이트보다 앞)", async () => {
    gates.openai = false;
    const res = await ask(askFixture({ location: { lat: 35.6812, lng: 139.7671 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outOfCoverage: true });
    expect(spies.createOpenAiSession).not.toHaveBeenCalled();
    expect(spies.reserveDaily).not.toHaveBeenCalled();
  });

  it("키 게이트: 그 회사 키가 없으면 502, 하루 상한을 쓰지 않는다", async () => {
    gates.openai = false;
    const res = await ask(askFixture({ provider: "openai" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "provider_unavailable" });
    expect(spies.reserveDaily).not.toHaveBeenCalled();
  });

  it("하루 상한: 503, 모델을 부르지 않는다", async () => {
    gates.daily = false;
    const res = await ask(askFixture());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "daily_budget_exhausted" });
    expect(spies.createOpenAiSession).not.toHaveBeenCalled();
  });

  it("제안이 통과한 답은 done.text가 빈 문자열이다", async () => {
    spies.runVergiliusLoop.mockResolvedValueOnce({ text: "", renders: [], proposal: { placeId: "k101" } });
    expect(await readNdjson(await ask(askFixture()))).toEqual([
      { type: "done", text: "", renders: [], proposal: { placeId: "k101" } },
    ]);
  });

  it("3-state: 글도 제안도 없으면 done이 아니라 error(empty_answer), 루프가 던지면 error(vergilius_failed)", async () => {
    spies.runVergiliusLoop.mockResolvedValueOnce({ text: "  ", renders: [], proposal: null });
    expect(await readNdjson(await ask(askFixture()))).toEqual([{ type: "error", code: "empty_answer" }]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    spies.runVergiliusLoop.mockRejectedValueOnce(new Error("openai responses 500"));
    expect(await readNdjson(await ask(askFixture()))).toEqual([{ type: "error", code: "vergilius_failed" }]);
    errorSpy.mockRestore();
  });

  it("오류 로그에는 종류와 상태 코드만 남는다(메시지 본문은 쓰지 않는다)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    spies.runVergiliusLoop.mockRejectedValueOnce(new VergiliusModelError("openai responses", 429));
    await (await ask(askFixture())).text();
    spies.runVergiliusLoop.mockRejectedValueOnce(
      Object.assign(new Error("지금 내 앞에 어떤 식당이 있어? 가나카페 37.5704"), { status: 400 }),
    );
    await (await ask(askFixture())).text();
    const logged = errorSpy.mock.calls.map((c) => c.join(" "));
    expect(logged).toEqual(["[vergilius] 답변 루프 오류: openai responses 429", "[vergilius] 답변 루프 오류: Error 400"]);
    errorSpy.mockRestore();
  });

  it("요청이 거둬졌으면 오류 로그도 error 이벤트도 내지 않고 조용히 닫는다", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    spies.runVergiliusLoop.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const res = await ask(askFixture(), controller.signal);
    expect(await res.text()).toBe("");
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("A44: 줄 구분 문자는 이스케이프되어 한 줄로 나간다", async () => {
    const breaker = String.fromCharCode(0x2028);
    spies.runVergiliusLoop.mockResolvedValueOnce({ text: `가${breaker}나`, renders: [], proposal: null });
    const raw = await (await ask(askFixture())).text();
    expect(raw.includes(breaker)).toBe(false);
    expect(raw.trim().split("\n")).toHaveLength(1);
    expect((JSON.parse(raw) as { text: string }).text).toBe(`가${breaker}나`);
  });
});
