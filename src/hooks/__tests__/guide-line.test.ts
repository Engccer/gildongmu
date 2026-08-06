import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import type { GuideRoute } from "@/lib/route-guide";
import { nextLine, progressFollowingLine } from "../useRouteGuide";

/**
 * 다음 안내 통지문의 어순·분기 계약(위원장 실사용 피드백 2026-08-07).
 *
 * 축 둘을 잠근다.
 * ① **거리가 먼저**: 운전 중 필요한 순서는 "얼마 뒤에 → 무엇을"이다. 종전
 *    "{step}까지 {distance}"는 완결 서술문 뒤에 잔여 거리를 붙여, 스텝 문장에
 *    내장된 주행 거리("…밤고개로를 따라 300m 이동")와 잔여 거리("약 129m")가
 *    역할 표지 없이 인접했다 — 어느 쪽이 남은 거리인지 낭독으로 구분 불가.
 * ② **타입에 맞는 틀**: 같은 자리에 들어오는 값이 두 종류다. 다음 스텝이 있으면
 *    완결 서술문, 마지막 스텝이면 목적지 이름(명사)이다. 명사에만 맞는 "…까지"를
 *    서술문에도 쓴 것이 결함의 뿌리이고, 도보 문장은 그 자체가 "…까지"로 끝나
 *    이중 조사까지 만든다.
 *
 * fixture 문장은 전부 실호출 원문이다(Tmap 자동차·카카오 도보 2026-08-07).
 */

/** 조립 함수가 받는 translator 타입(훅 내부 별칭이라 시그니처에서 끌어온다). */
type GuideT = Parameters<typeof nextLine>[4];

const t = createTranslator({
  locale: "ko",
  messages: ko,
  namespace: "guide",
}) as unknown as GuideT;

/** 조립 함수는 steps[i].description만 읽는다 — 기하 필드는 계약 밖. */
function routeOf(...descriptions: string[]): GuideRoute {
  return {
    steps: descriptions.map((description, index) => ({ index, description })),
  } as unknown as GuideRoute;
}

/** Tmap 자동차 실측 원문(위원장이 수서역 주행 중 들은 그 문장). */
const CAR_STEP =
  "수서역에서 세곡동 사거리 방면으로 8시 방향 좌회전 후 밤고개로를 따라 300m 이동";
/** 카카오 도보 실측 원문 — 문장 자체가 "…까지"로 끝난다. */
const WALK_STEP = "수서역 2번 출구까지 역사 내 이동";

describe("다음 안내 통지문", () => {
  it("다음 스텝이 있으면 잔여 거리를 문장 맨 앞에 두고 스텝 원문을 잇는다", () => {
    const line = nextLine(routeOf("출발", CAR_STEP), 0, "수서역", "약 129m", t);

    expect(line).toBe(`약 129m 앞 ${CAR_STEP}`);
    // 거리 우선 계약: 스텝 문장보다 잔여 거리가 먼저 낭독된다.
    expect(line.indexOf("약 129m")).toBeLessThan(line.indexOf(CAR_STEP));
  });

  it("스텝 원문을 재조합하지 않는다(provider 문장이 낭독 정본)", () => {
    expect(nextLine(routeOf("출발", CAR_STEP), 0, "수서역", "129m", t)).toContain(
      CAR_STEP,
    );
  });

  it("도보 스텝처럼 '…까지'로 끝나는 원문에 조사를 덧붙이지 않는다", () => {
    const line = nextLine(routeOf("출발", WALK_STEP), 0, "목적지", "약 30m", t);

    expect(line).toBe(`약 30m 앞 ${WALK_STEP}`);
    // 이중 조사 금지: "까지"는 provider 원문의 것 하나뿐이어야 한다.
    expect(line.match(/까지/g)).toHaveLength(1);
  });

  it("마지막 스텝이면 목적지 이름에 맞는 틀로 갈아탄다", () => {
    const line = nextLine(routeOf(CAR_STEP), 0, "수서역", "약 129m", t);

    // 목적지는 명사라 "…까지 거리"가 자연스럽다(서술문 틀을 강요하지 않는다).
    expect(line).toBe("수서역까지 약 129m");
  });
});

describe("진행 상황 통지문", () => {
  it("총 잔여 뒤에도 같은 어순을 유지한다", () => {
    expect(
      progressFollowingLine(routeOf("출발", CAR_STEP), 0, "수서역", "5.2km", "약 129m", t),
    ).toBe(`남은 거리 5.2km. 약 129m 앞 ${CAR_STEP}`);
  });

  it("마지막 스텝이면 목적지 틀로 갈아탄다", () => {
    expect(
      progressFollowingLine(routeOf(CAR_STEP), 0, "수서역", "5.2km", "약 129m", t),
    ).toBe("남은 거리 5.2km. 수서역까지 약 129m");
  });
});
