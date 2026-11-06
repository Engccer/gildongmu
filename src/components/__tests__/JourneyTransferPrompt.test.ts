import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { journeyTransferPrompt, type JourneyTransferQuestion } from "../JourneyTransferDialog";

/**
 * E77 확정 문안 표(spec `2026-11-07-e77-unified-waypoint-input-design.md` §2.3, 위원장 TextEdit 왕복 2026-11-07)를 실제 ko 문자열로 조립해 글자 하나까지 대조한다.
 * 짐작이 첫 버튼, 질문은 짐작 쪽 문장이다.
 */
const ko = JSON.parse(readFileSync(join(__dirname, "../../../messages/ko.json"), "utf8")).journey as Record<string, string>;
const t = (key: string, args?: Record<string, string>) =>
  ko[key].replace(/\{(\w+)\}/g, (_, name: string) => args?.[name] ?? `{${name}}`);

const ahyeon = { label: "아현역 2호선", lat: 0, lng: 0, line: "수도권2호선" };
const q = (over: Partial<JourneyTransferQuestion>): JourneyTransferQuestion => ({
  pick: ahyeon,
  mode: "subway",
  guess: "alight",
  roman: null,
  ...over,
});

describe("확인 질문 문안(E77 확정 표)", () => {
  it("지하철역, 도착지 쪽", () => {
    const p = journeyTransferPrompt(q({}), t);
    expect(p.question).toBe("지하철을 이용하다가 아현역에서 내려 자동차로 환승하실 예정인가요?");
    expect(p.options).toEqual([
      { answer: "alight", label: "네, 아현역에서 자동차로 환승합니다" },
      { answer: "board", label: "아니요, 자동차로 이동하다가 아현역에서 지하철로 환승합니다" },
      { answer: "via", label: "아니요, 환승하지 않고 경유만 합니다" },
    ]);
  });
  it("지하철역, 출발지 쪽", () => {
    const p = journeyTransferPrompt(q({ guess: "board" }), t);
    expect(p.question).toBe("자동차로 이동하다가 아현역에서 지하철로 환승하실 예정인가요?");
    expect(p.options).toEqual([
      { answer: "board", label: "네, 아현역에서 지하철로 환승합니다" },
      { answer: "alight", label: "아니요, 지하철을 이용하다가 아현역에서 내려 자동차로 환승합니다" },
      { answer: "via", label: "아니요, 환승하지 않고 경유만 합니다" },
    ]);
  });
  it("기차역, 도착지 쪽", () => {
    const p = journeyTransferPrompt(q({ pick: { label: "용산역", lat: 0, lng: 0 }, mode: "rail" }), t);
    expect(p.question).toBe("기차를 이용하다가 용산역에서 내려 자동차로 환승하실 예정인가요?");
    expect(p.options.map((o) => o.label)).toEqual([
      "네, 용산역에서 자동차로 환승합니다",
      "아니요, 자동차로 이동하다가 용산역에서 기차로 환승합니다",
      "아니요, 환승하지 않고 경유만 합니다",
    ]);
  });
  it("버스 정류장, 도착지 쪽", () => {
    const p = journeyTransferPrompt(
      q({ pick: { label: "세종문화회관", lat: 0, lng: 0, kind: "stop" }, mode: "bus" }),
      t,
    );
    expect(p.question).toBe("버스를 이용하다가 세종문화회관 정류장에서 내려 자동차로 환승하실 예정인가요?");
    expect(p.options.map((o) => o.label)).toEqual([
      "네, 세종문화회관 정류장에서 자동차로 환승합니다",
      "아니요, 자동차로 이동하다가 세종문화회관 정류장에서 버스로 환승합니다",
      "아니요, 환승하지 않고 경유만 합니다",
    ]);
  });
  it("기차역·정류장의 출발지 쪽은 지하철 문장에서 수단 낱말만 바뀐다", () => {
    const rail = journeyTransferPrompt(q({ pick: { label: "용산역", lat: 0, lng: 0 }, mode: "rail", guess: "board" }), t);
    expect(rail.question).toBe("자동차로 이동하다가 용산역에서 기차로 환승하실 예정인가요?");
    expect(rail.options[1].label).toBe("아니요, 기차를 이용하다가 용산역에서 내려 자동차로 환승합니다");
    const bus = journeyTransferPrompt(
      q({ pick: { label: "세종문화회관", lat: 0, lng: 0, kind: "stop" }, mode: "bus", guess: "board" }),
      t,
    );
    expect(bus.question).toBe("자동차로 이동하다가 세종문화회관 정류장에서 버스로 환승하실 예정인가요?");
    expect(bus.options.map((o) => o.label)).toEqual([
      "네, 세종문화회관 정류장에서 버스로 환승합니다",
      "아니요, 버스를 이용하다가 세종문화회관 정류장에서 내려 자동차로 환승합니다",
      "아니요, 환승하지 않고 경유만 합니다",
    ]);
  });
  it("줄 이름(종류별)", () => {
    expect([ko.alightFieldStation, ko.boardFieldStation, ko.alightFieldStop, ko.boardFieldStop]).toEqual([
      "자동차를 탈 역",
      "자동차에서 내리는 역",
      "자동차를 탈 정류장",
      "자동차에서 내리는 정류장",
    ]);
  });
});
