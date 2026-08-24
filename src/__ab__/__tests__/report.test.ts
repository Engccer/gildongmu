/**
 * 리포트 계약 6항(스킬 llm-model-eval `references/report-format.md`): ①뒤집힌 케이스가 집계 위
 * ②safety pass^k ③regression/capability 분리 ④measuredAt 기준 단가 ⑤"총지연" 라벨+각주 ⑥unstubbed.
 */
import { describe, expect, it } from "vitest";
import { buildReport, caseVerdict, pricesAt, type ResultFile, type RunResult } from "../report";

const A = "gemini-3.6-flash";
const B = "gemini-3.7-flash";

function r(over: Partial<RunResult> & { model: string; caseId: string; rep: number }): RunResult {
  return {
    ok: true,
    latencyMs: 1000,
    rounds: 2,
    toolCalls: [],
    toolArgs: [],
    unstubbed: [],
    promptTokens: 1000,
    outputTokens: 100,
    thoughtTokens: 50,
    checks: {},
    text: "x",
    ...over,
  };
}

const FILE: ResultFile = {
  run: { models: [A, B], repeats: 2, measuredAt: "2026-08-25T00:00:00.000Z", interleaved: true, gitSha: "abc1234" },
  cases: [
    { id: "01-절제", turns: ["a"], expectAny: ["search_places"] },
    { id: "09-날조", turns: ["b"], safety: true, grounding: { fromTools: ["t"], fields: ["*"], kinds: ["name"] } },
    { id: "10-진단", turns: ["c"], diagnostic: true },
    { id: "11-새능력", turns: ["d"], expectAny: ["search_web"] },
  ],
  results: [
    // 01: 둘 다 통과
    r({ model: A, caseId: "01-절제", rep: 1, checks: { expect: true } }),
    r({ model: A, caseId: "01-절제", rep: 2, checks: { expect: true } }),
    r({ model: B, caseId: "01-절제", rep: 1, checks: { expect: true } }),
    r({ model: B, caseId: "01-절제", rep: 2, checks: { expect: true } }),
    // 09: A 2/2, B 0/2 (뒤집힘 + safety pass^k 실패)
    r({ model: A, caseId: "09-날조", rep: 1, checks: { grounding: { pass: true, leaked: [] } } }),
    r({ model: A, caseId: "09-날조", rep: 2, checks: { grounding: { pass: true, leaked: [] } } }),
    r({ model: B, caseId: "09-날조", rep: 1, checks: { grounding: { pass: false, leaked: ["어휘:화장실"] } } }),
    r({ model: B, caseId: "09-날조", rep: 2, checks: { grounding: { pass: false, leaked: ["number:2층"] } } }),
    // 10: 진단 케이스 — 비용 집계 제외, unstubbed 보유
    r({ model: A, caseId: "10-진단", rep: 1, promptTokens: 100000, unstubbed: ["get_bus_route"] }),
    r({ model: B, caseId: "10-진단", rep: 1, promptTokens: 100000, unstubbed: ["get_bus_route"] }),
    // 11: A 실패, B 통과 (capability)
    r({ model: A, caseId: "11-새능력", rep: 1, checks: { expect: false } }),
    r({ model: A, caseId: "11-새능력", rep: 2, checks: { expect: false } }),
    r({ model: B, caseId: "11-새능력", rep: 1, checks: { expect: true } }),
    r({ model: B, caseId: "11-새능력", rep: 2, checks: { expect: true } }),
  ],
};

describe("pricesAt — 단가는 날짜의 함수", () => {
  it("2026-12-31까지 프로모 단가", () => {
    expect(pricesAt("2026-08-25T00:00:00Z")).toMatchObject({ inPerToken: 0.75 / 1e6, outPerToken: 3.75 / 1e6 });
    expect(pricesAt("2026-08-25T00:00:00Z").label).toContain("2026-12-31");
  });
  it("2027-01-01부터 정가", () => {
    expect(pricesAt("2027-01-01T00:00:00Z")).toMatchObject({ inPerToken: 1.5 / 1e6, outPerToken: 7.5 / 1e6 });
  });
  it("단가는 모델별이고 미등록 모델은 라벨에 가정을 밝힌다(침묵 금지)", () => {
    expect(pricesAt("2026-08-25T00:00:00Z", "gemini-3.7-flash").label).not.toContain("미등록");
    expect(pricesAt("2026-08-25T00:00:00Z", "gemini-4.0-pro").label).toContain("gemini-4.0-pro 단가 미등록");
  });
});

describe("caseVerdict", () => {
  it("모든 축이 통과여야 통과, 하나라도 false면 실패", () => {
    expect(caseVerdict(r({ model: A, caseId: "x", rep: 1, checks: { expect: true, forbid: true } }))).toBe(true);
    expect(caseVerdict(r({ model: A, caseId: "x", rep: 1, checks: { expect: true, grounding: { pass: false, leaked: ["a"] } } }))).toBe(false);
  });
  it("실행 실패(ok:false)는 실패", () => {
    expect(caseVerdict(r({ model: A, caseId: "x", rep: 1, ok: false, error: "boom" }))).toBe(false);
  });
});

describe("buildReport", () => {
  const out = buildReport(FILE);
  it("뒤집힌 케이스 목록이 집계보다 위에 온다", () => {
    expect(out.indexOf("## 뒤집힌 케이스")).toBeLessThan(out.indexOf("## regression"));
    expect(out).toMatch(/09-날조.*grounding.*2\/2.*0\/2.*어휘:화장실/);
    expect(out).toMatch(/11-새능력.*expect.*0\/2.*2\/2/);
  });
  it("safety pass^k — B는 0/1, 실패 케이스 id를 적는다", () => {
    expect(out).toMatch(new RegExp(`pass\\^2[^\\n]*${A}[^\\n]*1/1`));
    expect(out).toMatch(new RegExp(`pass\\^2[^\\n]*${B}[^\\n]*0/1[^\\n]*09-날조`));
  });
  it("regression과 capability를 따로 낸다", () => {
    expect(out).toMatch(/regression[^\n]*1\/2/); // A 통과 2건(01·09) 중 B 유지 1건
    expect(out).toMatch(/capability[^\n]*1건[^\n]*11-새능력/);
  });
  it("비용은 measuredAt 단가 라벨과 함께, diagnostic 제외 합계가 본 값", () => {
    expect(out).toContain("2026-12-31");
    // A: diagnostic 제외 6건 × (1000 in × 0.75 + 150 out × 3.75)/1e6 = $0.007875
    expect(out).toMatch(/gemini-3\.6-flash[^\n]*\$0\.0079/);
  });
  it('지연 라벨은 "총지연"이고 판정 근거 아님 각주가 있다', () => {
    expect(out).toContain("총지연");
    expect(out).toContain("판정 근거 아님");
    expect(out).not.toMatch(/tok\/s/);
  });
  it("unstubbed 세션 수와 도구 이름", () => {
    expect(out).toMatch(/unstubbed[^\n]*2[^\n]*get_bus_route/);
  });
  it("한쪽 모델에 결과가 없는 케이스는 뒤집힘이 아니라 미실행이다", () => {
    const partial: ResultFile = { ...FILE, results: FILE.results.filter((x) => !(x.model === B && x.caseId === "01-절제")) };
    expect(buildReport(partial)).not.toMatch(/01-절제.*0\/0/);
  });
  it("gitSha·measuredAt 을 머리에 적는다", () => {
    expect(out).toContain("abc1234");
    expect(out).toContain("2026-08-25");
  });
});
