import { describe, it, expect } from "vitest";
import { normalizeRoute } from "../providers/kakao-navi";
import { durationToMinutes, formatDistance } from "../format";

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

describe("format 유틸", () => {
  it("1km 미만은 m, 이상은 km 한 자리 소수", () => {
    expect(formatDistance(850)).toBe("850m");
    expect(formatDistance(3613)).toBe("3.6km");
    expect(formatDistance(1000)).toBe("1.0km");
  });

  it("초→분은 올림, 최소 1분", () => {
    expect(durationToMinutes(563)).toBe(10);
    expect(durationToMinutes(60)).toBe(1);
    expect(durationToMinutes(5)).toBe(1);
  });
});
