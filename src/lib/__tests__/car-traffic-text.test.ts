import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import { BRIEFING_JAM_MAX, carCongestionLine, carNewJamLine } from "../car-traffic-text";
import type { CarJam } from "../types";

const tb = createTranslator({ locale: "ko", messages: ko, namespace: "route.briefing" });
const tg = createTranslator({ locale: "ko", messages: ko, namespace: "guide" });
const T = (t: typeof tb | typeof tg) => (k: string, v?: Record<string, string | number>) =>
  (t as unknown as (k: string, v?: Record<string, string | number>) => string)(k, v);
const jam = (startMeters: number, lengthMeters: number, road: string | null): CarJam => ({
  road,
  startMeters,
  lengthMeters,
  start: { lat: 0, lng: 0 },
  end: { lat: 0, lng: 0 },
});

describe("carCongestionLine (E80 §4)", () => {
  it("출발 직후 정체는 「출발 지점부터」", () => {
    expect(carCongestionLine({ jams: [jam(30, 900, "통일로")] }, T(tb), false)).toBe(
      "막히는 구간 1곳: 출발 지점부터 통일로 900m.",
    );
  });
  it(`이름은 ${BRIEFING_JAM_MAX}곳까지, 나머지는 개수만`, () => {
    const jams = [1000, 3000, 5000, 7000, 9000].map((s) => jam(s, 600, "올림픽대로"));
    expect(carCongestionLine({ jams }, T(tb), false)).toBe(
      "막히는 구간 5곳: 1km 가서 올림픽대로 600m, 3km 가서 올림픽대로 600m, 5km 가서 올림픽대로 600m, 그 밖에 2곳.",
    );
  });
  it("미요청·정보 없음은 null", () => {
    expect(carCongestionLine(undefined, T(tb), false)).toBeNull();
    expect(carCongestionLine(null, T(tb), false)).toBeNull();
  });
});

describe("carNewJamLine (E80 §5)", () => {
  it("이름 있음·없음·비-ko", () => {
    expect(carNewJamLine(jam(0, 1100, "올림픽대로"), 3000, T(tg), false)).toBe(
      "3km 앞 올림픽대로에 1.1km 정체가 새로 생겼습니다.",
    );
    expect(carNewJamLine(jam(0, 700, null), 850, T(tg), false)).toBe("850m 앞에 700m 정체가 새로 생겼습니다.");
    expect(carNewJamLine(jam(0, 700, "올림픽대로"), 850, T(tg), true)).toBe("850m 앞에 700m 정체가 새로 생겼습니다.");
  });
});
