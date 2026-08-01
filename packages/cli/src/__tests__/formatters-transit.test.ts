import { describe, expect, it } from "vitest";
import { FORMATTERS } from "../lib/formatters.js";

// FORMATTERS는 엔드포인트 키 → 포매터 레코드다. transit 키는 "route-transit"(슬래시 아님).
const formatTransit = (body: unknown) =>
  FORMATTERS["route-transit"](body as never).join("\n");

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
