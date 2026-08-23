import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import type { GuideRoute } from "@/lib/route-guide";
import type { GuideAction } from "@/lib/walk-action";
import {
  nextLine,
  progressFrameLine,
  progressOverviewLine,
  walkPeriodicLine,
} from "../useRouteGuide";

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
/**
 * `"설명"` 또는 `["설명", action]`. 서버가 도보 스텝의 `action`을 전량 투영하므로(E16 축3)
 * 실제 경로 객체는 행동을 들고 온다 — 이 fixture도 그 모양을 따른다.
 */
type StepSpec = string | [string, GuideAction];

function routeOf(...specs: StepSpec[]): GuideRoute {
  return {
    steps: specs.map((spec, index) => {
      const [description, action] = Array.isArray(spec) ? spec : [spec, undefined];
      return { index, description, ...(action ? { action } : {}) };
    }),
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

describe("walk 주기 통지 단문 (위원장 실보행 피드백 2026-08-12)", () => {
  // 직진 구간 반복 통지는 다음 스텝 전문(행동 3개짜리 조망)이 아니라
  // "{target}까지 {distance} 직진하세요" 하나여야 한다. 조망은 40m 선행 전문 1회.
  const NEXT_STEP = "만석빌딩에서 왼쪽으로 돌아 청원파크빌 3차 아파트까지 59m 이동";

  it("직진 목표 이름이 있으면 단문 직진 안내만 낸다(다음 스텝 전문 미포함)", () => {
    const line = walkPeriodicLine(
      routeOf("출발", NEXT_STEP), 0, "오아시스마켓", "약 30m", "만석빌딩", t,
    );

    expect(line).toBe("만석빌딩까지 약 30m 직진하세요");
    expect(line).not.toContain(NEXT_STEP);
  });

  it("live target이 없으면 이름 없이 거리만 말한다(재파싱 금지)", () => {
    expect(
      walkPeriodicLine(routeOf("출발", NEXT_STEP), 0, "오아시스마켓", "30m", undefined, t),
    ).toBe("30m 직진하세요");
  });

  it("마지막 스텝이면 목적지 틀 유지(종전에도 단문이었다)", () => {
    expect(
      walkPeriodicLine(routeOf(NEXT_STEP), 0, "오아시스마켓", "약 30m", undefined, t),
    ).toBe("오아시스마켓까지 약 30m");
  });

  it("횡단 스텝에는 '직진하세요' 대신 정본 문장을 재낭독한다(오지시 금지)", () => {
    const CROSS_STEP = "길동사거리까지 횡단보도를 건너세요, 횡단보도 길이 45m";
    // ⚠ 판정은 **서버 투영 행동**만 본다(E16 축3) — 종전 `"건너"` 부분 문자열 축은 en 문장에서
    // 실패해 횡단 중에 "Walk straight"를 냈다. 그래서 fixture도 서버가 싣는 행동을 든다.
    const line = walkPeriodicLine(
      routeOf([CROSS_STEP, "crosswalk"], NEXT_STEP), 0, "오아시스마켓", "약 20m", "길동사거리", t,
    );

    expect(line).toBe(CROSS_STEP);
    expect(line).not.toContain("직진");
  });

  it("en 문장의 횡단 스텝도 같은 판정이다(언어 의존 축 제거 확인)", () => {
    const EN_CROSS = "Cross the crosswalk on your left, then walk 14m";
    expect(
      walkPeriodicLine(routeOf([EN_CROSS, "crosswalk"], NEXT_STEP), 0, "Oasis", "20m", undefined, t),
    ).toBe(EN_CROSS);
  });

  it("행동이 없으면 종전대로 단문 직진이다(횡단보도가 지명에 섞인 스텝)", () => {
    // "천호역 횡단보도 앞에서 …"처럼 문장에 낱말만 있고 건너지 않는 스텝.
    expect(
      walkPeriodicLine(routeOf("천호역 횡단보도 앞까지 40m 이동", NEXT_STEP), 0, "오아시스마켓", "약 20m", "천호역", t),
    ).toBe("천호역까지 약 20m 직진하세요");
  });
});

describe("진행 상황 조망문 (위원장 실보행 판정 2026-08-10)", () => {
  // 종전 응답은 뒷부분이 주기 통지와 문자 그대로 동일해 버튼 고유 정보가 0이었다.
  // 새 계약: 서수 위치가 맨 앞(핵심 신규 정보), 잔여(+근거 있을 때만 시간),
  // 현재 스텝 전문 재확인, 다음 스텝 전문.
  it("서수 + 잔여 + 현재 + 다음을 이 순서로 조립한다", () => {
    expect(
      progressOverviewLine(
        routeOf("출발", CAR_STEP, "도착"), 1, "수서역", "5.2km", "약 129m", 8, t,
      ),
    ).toBe(
      `안내 3개 중 2번째 구간. 남은 거리 5.2km, 약 8분. 현재 안내, ${CAR_STEP}. 다음 안내, 도착`,
    );
  });

  it("잔여 시간 근거가 없으면 시간을 생략한다(날조 금지)", () => {
    expect(progressFrameLine(routeOf("출발", "도착"), 0, "5.2km", null, t)).toBe(
      "안내 2개 중 1번째 구간. 남은 거리 5.2km",
    );
  });

  it("마지막 스텝이면 다음 파트가 목적지 틀로 갈아탄다(distance = 구간 잔여)", () => {
    expect(
      progressOverviewLine(routeOf(CAR_STEP), 0, "수서역", "129m", "약 129m", null, t),
    ).toBe(
      `안내 1개 중 1번째 구간. 남은 거리 129m. 현재 안내, ${CAR_STEP}. 수서역까지 약 129m`,
    );
  });
});
