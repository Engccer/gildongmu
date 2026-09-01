import { describe, expect, it } from "vitest";
import { FORMATTERS } from "../lib/formatters.js";

/** lang을 받지 않는 호출의 포매터 컨텍스트(E29) — 요청 언어 미지정. */
const NO_LANG = { lang: undefined };

// FORMATTERS는 엔드포인트 키 → 포매터 레코드다. transit 키는 "route-transit"(슬래시 아님).
const formatTransit = (body: unknown) =>
  FORMATTERS["route-transit"](body as never, NO_LANG).join("\n");

describe("route transit 운행 시간", () => {
  const body = {
    result: {
      recommended: {
        summary: { totalMinutes: 22, fare: 1500, transfers: 0, walkMinutes: 5 },
        legs: [
          {
            mode: "bus",
            lineName: "342",
            fromName: "강동역",
            toName: "길동생태공원",
            stationCount: 14,
            minutes: 22,
            serviceStatus: "outside",
            firstServiceTime: "04:00",
            lastServiceTime: "22:30",
          },
        ],
      },
      alternatives: [],
    },
  };

  it("운행 밖 구간에 첫차·막차와 미운행을 덧붙인다", () => {
    const out = formatTransit(body);
    expect(out).toContain("첫차 04:00");
    expect(out).toContain("운행하지 않음");
  });

  it("running은 덧붙이지 않는다", () => {
    const running = structuredClone(body);
    running.result.recommended.legs[0].serviceStatus = "running";
    expect(formatTransit(running)).not.toContain("첫차");
  });

  it("unknown은 덧붙이지 않는다", () => {
    const unknown = structuredClone(body);
    unknown.result.recommended.legs[0].serviceStatus = "unknown";
    expect(formatTransit(unknown)).not.toContain("첫차");
  });
});

/** 도보 leg 하나만 담은 최소 결과(대안 없음). */
const walkOnly = (leg: Record<string, unknown>) => ({
  result: {
    recommended: {
      summary: { totalMinutes: 45, fare: 1750, transfers: 1, walkMinutes: 6 },
      legs: [leg],
    },
    alternatives: [],
    totalCandidates: 9,
  },
});

describe("route transit 도보 구간", () => {
  it("행선지와 거리를 함께 낸다", () => {
    const out = formatTransit(walkOnly({ mode: "walk", toName: "길동", minutes: 3, distanceMeters: 178 }));
    expect(out).toContain("길동까지 도보 3분, 178m");
  });

  it("행선지가 없는 마지막 도보는 목적지까지로 낸다", () => {
    const out = formatTransit(walkOnly({ mode: "walk", minutes: 3, distanceMeters: 221 }));
    expect(out).toContain("목적지까지 도보 3분, 221m");
  });

  it("거리 필드가 없으면 거리 없는 문구로 떨어진다", () => {
    // 3-state: 정보 없음을 0m로 둔갑시키지 않는다.
    const out = formatTransit(walkOnly({ mode: "walk", toName: "서울역", minutes: 4 }));
    expect(out).toContain("서울역까지 도보 4분");
    expect(out).not.toContain("0m");
  });

  it("1km 이상 거리는 dist() 표기를 따른다", () => {
    const out = formatTransit(walkOnly({ mode: "walk", minutes: 20, distanceMeters: 1187 }));
    expect(out).toContain("목적지까지 도보 20분, 1.187km");
  });
});

describe("route transit 대안 표시 이름", () => {
  const alt = (extra: Record<string, unknown>) => ({
    summary: { totalMinutes: 50, fare: 1500, transfers: 0, walkMinutes: 8 },
    legs: [{ mode: "walk", toName: "길동역", minutes: 4, distanceMeters: 300 }],
    ...extra,
  });
  const withAlternatives = (alts: unknown[]) => ({
    result: {
      recommended: {
        summary: { totalMinutes: 45, fare: 1750, transfers: 2, walkMinutes: 6 },
        legs: [{ mode: "walk", minutes: 3, distanceMeters: 221 }],
      },
      alternatives: alts,
      totalCandidates: 9,
    },
  });

  it("두 축을 다 가지면 조합 이름을 쓴다", () => {
    const out = formatTransit(withAlternatives([alt({ highlight: ["fewestTransfers", "fastest"] })]));
    expect(out).toContain("가장 빠르고 환승도 가장 적은 경로");
  });

  it("환승 축만 가지면 환승 이름을 쓴다", () => {
    const out = formatTransit(withAlternatives([alt({ highlight: ["fewestTransfers"] })]));
    expect(out).toContain("환승이 가장 적은 경로");
    expect(out).not.toContain("가장 빠른");
  });

  it("시간 축만 가지면 최단 이름을 쓴다", () => {
    const out = formatTransit(withAlternatives([alt({ highlight: ["fastest"] })]));
    expect(out).toContain("가장 빠른 경로");
    expect(out).not.toContain("환승이 가장 적은");
  });

  it("축이 없으면 배열 위치가 아니라 서버 displayIndex로 번호를 쓴다", () => {
    // 첫 대안이지만 축 경로 둘이 앞서 번호를 소비했다고 가정한다.
    const out = formatTransit(withAlternatives([alt({ displayIndex: 3 })]));
    expect(out).toContain("대안 경로 3");
    expect(out).not.toContain("대안 경로 1");
  });

  it("축도 번호도 없으면 번호를 지어내지 않는다", () => {
    const out = formatTransit(withAlternatives([alt({})]));
    expect(out).toContain("대안 경로");
    expect(out).not.toMatch(/대안 경로 \d/);
  });
});

describe("route transit 경로 수 변화", () => {
  it("추천 1 + 대안 4를 모두 낸다", () => {
    const leg = (n: number) => ({ mode: "walk", toName: `역${n}`, minutes: n, distanceMeters: n * 100 });
    const body = {
      result: {
        recommended: {
          summary: { totalMinutes: 45, fare: 1750, transfers: 2, walkMinutes: 6 },
          legs: [leg(1)],
        },
        alternatives: [
          { summary: { totalMinutes: 71, fare: 1500, transfers: 0, walkMinutes: 9 }, legs: [leg(2)], highlight: ["fewestTransfers"] },
          { summary: { totalMinutes: 41, fare: 1750, transfers: 2, walkMinutes: 5 }, legs: [leg(3)], highlight: ["fastest"] },
          { summary: { totalMinutes: 47, fare: 1750, transfers: 2, walkMinutes: 7 }, legs: [leg(4)], displayIndex: 1 },
          { summary: { totalMinutes: 49, fare: 1750, transfers: 3, walkMinutes: 8 }, legs: [leg(5)], displayIndex: 2 },
        ],
        totalCandidates: 9,
      },
    };
    const lines = FORMATTERS["route-transit"](body as never, NO_LANG);
    // 경로 5개 × (이름 1 + 요약 1 + 구간 1) = 15줄. 3경로 전제 코드는 여기서 깨진다.
    expect(lines).toHaveLength(15);
    expect(lines[0]).toBe("추천 경로");
    expect(lines.filter((l) => l.includes("경로"))).toHaveLength(5);
    expect(lines).toContain("대안 경로 2");
  });
});

describe("route transit 빠른하차", () => {
  const withQuickExit = (quickExit: unknown) => ({
    result: {
      recommended: {
        summary: { totalMinutes: 30, fare: 1550, transfers: 0, walkMinutes: 6 },
        legs: [
          {
            mode: "subway",
            lineName: "수도권 5호선",
            fromName: "천호",
            toName: "여의도",
            stationCount: 8,
            minutes: 24,
            ...(quickExit ? { quickExit } : {}),
          },
        ],
      },
      alternatives: [],
    },
  });

  it("탑승 구간 다음 줄에 나온다", () => {
    const lines = FORMATTERS["route-transit"](
      withQuickExit({
        elevator: { kind: "door", doors: ["6-4"] },
        stairs: { kind: "door", doors: ["5-4"] },
      }) as never,
      NO_LANG,
    );
    const i = lines.findIndex((l) => l.includes("천호→여의도"));
    expect(lines[i + 1]).toBe("여의도 하차, 엘리베이터 6-4 문, 계단 5-4 문");
  });

  it("문 사이는 별도 형태로 나온다", () => {
    const out = formatTransit(
      withQuickExit({ elevator: { kind: "between", doors: ["3-2", "3-3"] } }),
    );
    expect(out).toContain("여의도 하차, 엘리베이터 3-2 문과 3-3 문 사이");
  });

  it("값이 없으면 줄 자체가 없다", () => {
    expect(formatTransit(withQuickExit(null))).not.toContain("하차,");
  });
});
