import { describe, it, expect } from "vitest";
import { normalizeRoute } from "../providers/kakao-navi";

describe("normalizeRoute (카카오모빌리티 자동차 경로)", () => {
  // 2026-06-13 실호출 응답(서울역→경복궁)을 축약한 픽스처
  const ROUTE = {
    result_code: 0,
    result_msg: "길찾기 성공",
    summary: {
      distance: 3613,
      duration: 563,
      fare: { taxi: 8500, toll: 0 },
    },
    sections: [
      {
        guides: [
          {
            name: "출발지",
            guidance: "출발지",
            distance: 0,
            duration: 0,
            type: 100,
          },
          {
            name: "염천교",
            guidance: "서대문역 방면으로 좌회전",
            distance: 192,
            duration: 76,
            type: 1,
          },
          {
            name: "목적지",
            guidance: "목적지",
            distance: 217,
            duration: 20,
            type: 101,
          },
        ],
      },
    ],
  };

  it("summary와 guides를 CarRouteBriefing으로 정규화한다", () => {
    const briefing = normalizeRoute(ROUTE);
    expect(briefing.distanceMeters).toBe(3613);
    expect(briefing.durationSeconds).toBe(563);
    expect(briefing.taxiFare).toBe(8500);
    expect(briefing.tollFare).toBe(0);
    expect(briefing.guides).toHaveLength(3);
    expect(briefing.guides[1]).toEqual({
      name: "염천교",
      guidance: "서대문역 방면으로 좌회전",
      distanceMeters: 192,
      durationSeconds: 76,
    });
  });

  it("여러 section의 guides를 순서대로 평탄화한다", () => {
    const briefing = normalizeRoute({
      ...ROUTE,
      sections: [
        { guides: [ROUTE.sections[0].guides[0]] },
        { guides: [ROUTE.sections[0].guides[2]] },
      ],
    });
    expect(briefing.guides.map((g) => g.name)).toEqual(["출발지", "목적지"]);
  });

  it("guides가 없는 section은 빈 배열로 처리한다", () => {
    const briefing = normalizeRoute({ ...ROUTE, sections: [{}] });
    expect(briefing.guides).toEqual([]);
  });
});

// `formatDistance`·`durationToMinutes` 계약은 `format.test.ts`가 정본이다(경계표 +
// 웹-iOS-CLI 드리프트 가드). 여기 있던 사본은 표기 규칙이 바뀔 때 혼자 낡아 red가
// 되기만 했으므로 제거했다(2026-08-02).
