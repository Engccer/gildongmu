import { describe, it, expect } from "vitest";
import { latLngToGrid, ultraSrtNcstBaseTime, vilageFcstBaseTime, currentKstYmd, skyLabel, precipLabel, parseNcst, parseFcst, mergeWeather } from "../providers/weather";

describe("latLngToGrid", () => {
  it("서울시청(37.5665, 126.9780) → nx 60, ny 127 (기상청 레퍼런스)", () => {
    expect(latLngToGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("동일 입력 동일 출력(결정적)", () => {
    const a = latLngToGrid(37.538, 127.139);
    const b = latLngToGrid(37.538, 127.139);
    expect(a).toEqual(b);
  });

  it("정수 격자를 반환한다", () => {
    const { nx, ny } = latLngToGrid(35.1796, 129.0756); // 부산
    expect(Number.isInteger(nx)).toBe(true);
    expect(Number.isInteger(ny)).toBe(true);
  });
});

describe("ultraSrtNcstBaseTime (KST, 40분 경계)", () => {
  it("KST 13:30(분<40) → 직전 정시 12:00", () => {
    // 2026-06-20T04:30:00Z == KST 13:30
    expect(ultraSrtNcstBaseTime(new Date("2026-06-20T04:30:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1200",
    });
  });

  it("KST 13:50(분>=40) → 당시 정시 13:00", () => {
    expect(ultraSrtNcstBaseTime(new Date("2026-06-20T04:50:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1300",
    });
  });

  it("KST 00:10 → 전날 23:00(자정 경계)", () => {
    // 2026-06-19T15:10:00Z == KST 00:10(20일)
    expect(ultraSrtNcstBaseTime(new Date("2026-06-19T15:10:00Z"))).toEqual({
      baseDate: "20260619",
      baseTime: "2300",
    });
  });
});

describe("vilageFcstBaseTime (KST, 발표시각)", () => {
  it("KST 13:30 → 11:00 발표분(가장 최근)", () => {
    expect(vilageFcstBaseTime(new Date("2026-06-20T04:30:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1100",
    });
  });

  it("KST 01:00(첫 발표 전) → 전날 23:00", () => {
    // 2026-06-19T16:00:00Z == KST 01:00(20일)
    expect(vilageFcstBaseTime(new Date("2026-06-19T16:00:00Z"))).toEqual({
      baseDate: "20260619",
      baseTime: "2300",
    });
  });

  it("KST 14:05(14시 발표+10분 미경과) → 11:00", () => {
    expect(vilageFcstBaseTime(new Date("2026-06-20T05:05:00Z"))).toEqual({
      baseDate: "20260620",
      baseTime: "1100",
    });
  });
});

describe("currentKstYmd (자정 경계 — 실황 base_date와 분리)", () => {
  it("KST 00:10도 당일(실황 baseDate가 전날로 되돌려져도 todayYmd는 오늘)", () => {
    // 2026-06-19T15:10:00Z == KST 2026-06-20 00:10
    expect(currentKstYmd(new Date("2026-06-19T15:10:00Z"))).toBe("20260620");
  });
  it("같은 시각 ultraSrtNcstBaseTime.baseDate는 전날(20260619) — 버그 재발 방지 대조", () => {
    // currentKstYmd는 당일(오늘)이지만 실황 baseDate는 00:10(분<40) → 전날 23시로 되돌려짐
    const now = new Date("2026-06-19T15:10:00Z");
    expect(ultraSrtNcstBaseTime(now).baseDate).toBe("20260619"); // 전날
    expect(currentKstYmd(now)).toBe("20260620"); // 당일 — 분리 필요성 확인
  });
  it("KST 13:30 당일", () => {
    expect(currentKstYmd(new Date("2026-06-20T04:30:00Z"))).toBe("20260620");
  });
  it("KST 연말 23:59 당일(월/연 경계)", () => {
    // 2026-12-31T14:59:00Z == KST 2026-12-31 23:59
    expect(currentKstYmd(new Date("2026-12-31T14:59:00Z"))).toBe("20261231");
  });
});

describe("skyLabel / precipLabel (미매핑 → unknown)", () => {
  it("SKY 1/3/4 → clear/partlyCloudy/cloudy", () => {
    expect(skyLabel("1")).toBe("clear");
    expect(skyLabel("3")).toBe("partlyCloudy");
    expect(skyLabel("4")).toBe("cloudy");
    expect(skyLabel("9")).toBe("unknown");
  });
  it("PTY 0~4 → none/rain/rainSnow/snow/shower, 그 외 unknown", () => {
    expect(precipLabel("0")).toBe("none");
    expect(precipLabel("1")).toBe("rain");
    expect(precipLabel("2")).toBe("rainSnow");
    expect(precipLabel("3")).toBe("snow");
    expect(precipLabel("4")).toBe("shower");
    expect(precipLabel("")).toBe("unknown");
  });
});

const NCST_RAW = {
  response: {
    header: { resultCode: "00" },
    body: {
      items: {
        item: [
          { category: "T1H", obsrValue: "21.3" },
          { category: "REH", obsrValue: "55" },
          { category: "PTY", obsrValue: "0" },
          { category: "WSD", obsrValue: "1.2" },
        ],
      },
    },
  },
};

const FCST_RAW = {
  response: {
    header: { resultCode: "00" },
    body: {
      items: {
        item: [
          { category: "SKY", fcstDate: "20260620", fcstTime: "1500", fcstValue: "3" },
          { category: "POP", fcstDate: "20260620", fcstTime: "1500", fcstValue: "20" },
          { category: "TMX", fcstDate: "20260620", fcstTime: "1500", fcstValue: "27.0" },
          { category: "TMN", fcstDate: "20260620", fcstTime: "0600", fcstValue: "18.0" },
          { category: "SKY", fcstDate: "20260621", fcstTime: "1500", fcstValue: "1" },
        ],
      },
    },
  },
};

describe("parseNcst", () => {
  it("T1H/REH/PTY 추출", () => {
    expect(parseNcst(NCST_RAW)).toEqual({
      tempC: 21.3,
      humidity: 55,
      precipitation: { code: 0, label: "none" },
    });
  });
  it("빈 응답 → null", () => {
    expect(parseNcst({ response: { body: { items: "" } } })).toBeNull();
  });
});

describe("parseFcst", () => {
  it("가장 이른 SKY/POP + 오늘 TMX/TMN", () => {
    expect(parseFcst(FCST_RAW, "20260620")).toEqual({
      sky: { code: 3, label: "partlyCloudy" },
      tempMax: 27,
      tempMin: 18,
      precipProbability: 20,
    });
  });
  it("오늘 TMX/TMN 없으면 null 값(예보가 내일치뿐)", () => {
    const r = parseFcst(FCST_RAW, "20260621");
    expect(r?.tempMax).toBeNull();
    expect(r?.tempMin).toBeNull();
  });
  it("firstFcst 정렬: 배열 순서 무관 가장 이른 fcstTime 선택", () => {
    // 같은 날짜에 늦은 시각(1800, SKY=4 cloudy)이 배열 앞, 이른 시각(0900, SKY=1 clear)이 뒤
    const raw = {
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: [
              { category: "SKY", fcstDate: "20260620", fcstTime: "1800", fcstValue: "4" },
              { category: "SKY", fcstDate: "20260620", fcstTime: "0900", fcstValue: "1" },
            ],
          },
        },
      },
    };
    // 배열 순서가 아닌 fcstTime 기준으로 0900 항목이 선택되어야 한다
    const r = parseFcst(raw, "20260620");
    expect(r?.sky.code).toBe(1);
    expect(r?.sky.label).toBe("clear");
  });
});

describe("mergeWeather (부분 성공)", () => {
  const grid = { nx: 60, ny: 127 };
  it("실황+예보 모두 → 완전 Weather", () => {
    const ncst = parseNcst(NCST_RAW)!;
    const fcst = parseFcst(FCST_RAW, "20260620")!;
    const w = mergeWeather(ncst, fcst, "13:00", grid)!;
    expect(w.tempC).toBe(21.3);
    expect(w.sky.label).toBe("partlyCloudy");
    expect(w.precipitation.label).toBe("none");
    expect(w.tempMax).toBe(27);
    expect(w.humidity).toBe(55);
    expect(w.precipProbability).toBe(20);
    expect(w.baseTime).toBe("13:00");
  });
  it("예보만(실황 null) → 기온·습도 null, 하늘상태 보존", () => {
    const fcst = parseFcst(FCST_RAW, "20260620")!;
    const w = mergeWeather(null, fcst, "13:00", grid)!;
    expect(w.tempC).toBeNull();
    expect(w.sky.label).toBe("partlyCloudy");
    expect(w.precipitation.label).toBe("unknown");
  });
  it("실황만(예보 null) → 실황 값 보존, sky unknown·tempMax null", () => {
    const ncst = parseNcst(NCST_RAW)!;
    const w = mergeWeather(ncst, null, "13:00", grid)!;
    expect(w).not.toBeNull();
    expect(w.tempC).toBe(21.3);
    expect(w.humidity).toBe(55);
    expect(w.precipitation.label).toBe("none");
    expect(w.sky.label).toBe("unknown");
    expect(w.tempMax).toBeNull();
  });
  it("둘 다 null → null", () => {
    expect(mergeWeather(null, null, "13:00", grid)).toBeNull();
  });
});
