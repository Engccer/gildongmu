import { describe, expect, it, vi } from "vitest";
import { busArrivalMessageEn, busArrivalMessageEnFrom, parseBusArrmsg } from "../bus-arrival-en";
import { remainingFromArrmsg } from "../providers/seoul-bus";
import { rewriteBusArrivalMessage } from "../transit-track";

/** 실호출·fixture에서 관측된 모양 전부 + 미지 변형. */
const CORPUS = [
  "6분47초후[4번째 전]",
  "15분후[9번째 전]",
  "55초후[1번째 전]",
  "3분54초후[2번째 전]",
  "2분55초후[3번째 전]",
  "곧 도착",
  "출발대기",
  "운행종료",
  "정보없음",
  "차고지대기",
];

describe("parseBusArrmsg", () => {
  it("잔여 정거장은 기존 remainingFromArrmsg에 위임한다(값 복제 금지)", () => {
    // ⚠ 이 단언 자체는 동어반복이다 — 구현이 그 함수를 직접 부르기 때문. 잡으려는 것은
    // "누군가 성능·독립성을 이유로 자체 추출로 갈아끼우는 변경"이고, 그때 이 줄이 실패한다.
    for (const m of CORPUS) {
      expect(parseBusArrmsg(m).remainingStops, m).toBe(remainingFromArrmsg(m));
    }
  });

  it("모양 판정이 ko 재작성 경로와 갈리지 않는다", () => {
    // 진짜 교차 검증(spec §3.11): ko는 "…후"를 "…남음"으로 다듬고 en은 eta로 읽는다.
    // provider 변형이 한쪽에만 반영되면 이 동치가 깨진다 — 그 순간이 잔여 수와 문장이
    // 서로 다른 해석을 하기 시작하는 지점이다.
    for (const m of CORPUS) {
      const koRewritten = rewriteBusArrivalMessage(m).endsWith("남음");
      expect(parseBusArrmsg(m).kind === "eta", m).toBe(koRewritten);
    }
  });

  it("모양을 4종 + 미지로 가른다", () => {
    expect(parseBusArrmsg("6분47초후[4번째 전]")).toEqual({
      kind: "eta", minutes: 6, seconds: 47, remainingStops: 4,
    });
    expect(parseBusArrmsg("15분후[9번째 전]").kind).toBe("eta");
    expect(parseBusArrmsg("15분후[9번째 전]").seconds).toBeNull();
    expect(parseBusArrmsg("55초후[1번째 전]").minutes).toBeNull();
    expect(parseBusArrmsg("곧 도착").kind).toBe("soon");
    expect(parseBusArrmsg("출발대기").kind).toBe("waiting");
    expect(parseBusArrmsg("운행종료").kind).toBe("ended");
    expect(parseBusArrmsg("정보없음").kind).toBe("unknown");
  });
});

describe("busArrivalMessageEn", () => {
  it("국면마다 어순이 다르고, 대기 국면만 잔여 정거장을 붙인다", () => {
    // ko 원문의 꼬리 `[N번째 전]`이 대기 목록에서 잔여 정보의 유일한 채널이다 — en에서만
    // 그것을 잃으면 "몇 번째 전 버스인가"를 en 사용자만 못 듣는다.
    expect(busArrivalMessageEn(parseBusArrmsg("6분47초후[4번째 전]"), "wait")).toBe(
      "In 6 min 47 sec, 4 stops away",
    );
    expect(busArrivalMessageEn(parseBusArrmsg("6분47초후[4번째 전]"), "ride")).toBe("6 min 47 sec left");
    expect(busArrivalMessageEn(parseBusArrmsg("15분후[9번째 전]"), "wait")).toBe(
      "In 15 min, 9 stops away",
    );
    expect(busArrivalMessageEn(parseBusArrmsg("15분후[9번째 전]"), "ride")).toBe("15 min left");
    expect(busArrivalMessageEn(parseBusArrmsg("55초후[1번째 전]"), "wait")).toBe(
      "In 55 sec, 1 stop away",
    );
    expect(busArrivalMessageEn(parseBusArrmsg("55초후[1번째 전]"), "ride")).toBe("55 sec left");
  });

  it("꼬리가 없으면 잔여를 붙이지 않는다(없는 정보를 만들지 않는다)", () => {
    expect(busArrivalMessageEn(parseBusArrmsg("3분후"), "wait")).toBe("In 3 min");
  });

  it("고정 문구 3종은 국면 불문 같다", () => {
    for (const phase of ["wait", "ride"] as const) {
      expect(busArrivalMessageEn(parseBusArrmsg("곧 도착"), phase)).toBe("Arriving soon");
      expect(busArrivalMessageEn(parseBusArrmsg("출발대기"), phase)).toBe("Waiting to depart");
      expect(busArrivalMessageEn(parseBusArrmsg("운행종료"), phase)).toBe("Service ended");
    }
  });

  it("미지 모양·범위 밖·빈 값은 부재(거짓 문장보다 부재)", () => {
    expect(busArrivalMessageEn(parseBusArrmsg("정보없음"), "wait")).toBeUndefined();
    expect(busArrivalMessageEn({ kind: "eta", minutes: 3, seconds: 99, remainingStops: null }, "wait")).toBeUndefined();
    expect(busArrivalMessageEn({ kind: "eta", minutes: -1, seconds: null, remainingStops: null }, "wait")).toBeUndefined();
    expect(busArrivalMessageEn({ kind: "eta", minutes: 0, seconds: 0, remainingStops: null }, "wait")).toBeUndefined();
  });
});

describe("busArrivalMessageEnFrom", () => {
  it("미지 모양은 숫자를 가린 모양만 계측하고 부재로 떨어진다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(busArrivalMessageEnFrom("99분짜리 알 수 없음", "wait")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("N분짜리 알 수 없음"));
    warn.mockRestore();
  });

  it("정상 모양은 계측 없이 문장을 낸다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(busArrivalMessageEnFrom("2분55초후[3번째 전]", "ride")).toBe("2 min 55 sec left");
    expect(busArrivalMessageEnFrom("2분55초후[3번째 전]", "wait")).toBe("In 2 min 55 sec, 3 stops away");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
