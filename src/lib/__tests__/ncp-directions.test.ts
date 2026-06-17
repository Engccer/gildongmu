import { describe, it, expect } from "vitest";
import { normalizeNcpRoute, type NcpDrivingRoute } from "../providers/ncp-directions";
import { durationToMinutes } from "../format";

describe("normalizeNcpRoute (NCP Directions 영문 자동차 경로)", () => {
  // 2026-06-17 실호출 응답(서울역→경복궁, lang=en)을 축약한 픽스처.
  // ⚠ NCP는 duration이 밀리초 — 카카오/CarRouteBriefing은 초이므로 변환 검증이 핵심.
  const ROUTE: NcpDrivingRoute = {
    summary: {
      distance: 5670,
      duration: 1685446, // 밀리초 → 1685초(약 28분)
      taxiFare: 8700,
      tollFare: 0,
    },
    guide: [
      {
        distance: 115,
        duration: 41399, // 밀리초 → 41초
        instructions: "Turn right toward 'Cheongpa-ro'",
        pointIndex: 6,
        type: 3,
      },
      {
        distance: 1200,
        duration: 120000, // 밀리초 → 120초
        instructions: "Turn left at Yeomcheongyo toward 'Tongil-ro'",
        pointIndex: 20,
        type: 2,
      },
    ],
  };

  it("summary의 밀리초 duration을 초로 변환한다", () => {
    const briefing = normalizeNcpRoute(ROUTE);
    expect(briefing.distanceMeters).toBe(5670);
    expect(briefing.durationSeconds).toBe(1685); // 1685446ms → 반올림 1685s
    expect(briefing.taxiFare).toBe(8700);
    expect(briefing.tollFare).toBe(0);
  });

  it("guide의 instructions를 guidance로, name은 빈 문자열로 매핑하고 duration을 초로 변환한다", () => {
    const briefing = normalizeNcpRoute(ROUTE);
    expect(briefing.guides).toHaveLength(2);
    expect(briefing.guides[0]).toEqual({
      name: "", // NCP guide엔 랜드마크 name이 없고 instructions 단일 문장만 있음
      guidance: "Turn right toward 'Cheongpa-ro'",
      distanceMeters: 115,
      durationSeconds: 41, // 41399ms → 반올림 41s
    });
    expect(briefing.guides[1].guidance).toBe(
      "Turn left at Yeomcheongyo toward 'Tongil-ro'",
    );
    expect(briefing.guides[1].durationSeconds).toBe(120); // 120000ms → 120s
  });

  it("변환된 초 단위가 durationToMinutes와 정합한다(28분, 468시간 오발화 방지)", () => {
    const briefing = normalizeNcpRoute(ROUTE);
    expect(durationToMinutes(briefing.durationSeconds)).toBe(29); // ceil(1685/60)
  });

  it("guide가 비어도 빈 배열로 정규화한다", () => {
    const briefing = normalizeNcpRoute({ ...ROUTE, guide: [] });
    expect(briefing.guides).toEqual([]);
  });
});
