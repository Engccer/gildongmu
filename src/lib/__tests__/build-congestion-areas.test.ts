import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs 빌드 스크립트에 타입 선언 없음(build-audio-signals 선례)
import { toArea, validateAreas } from "../../../scripts/build-congestion-areas.mjs";

/** 가드를 통과하는 최소 입력. 강남역 golden을 반드시 포함해야 한다. */
function okAreas() {
  const areas = Array.from({ length: 120 }, (_, i) => ({
    code: `POI${String(i + 1).padStart(3, "0")}`,
    name: `영역${i}`,
    c: [37.5, 127.0] as [number, number],
    pts: Array.from({ length: 15 }, () => [37.5, 127.0] as [number, number]),
  }));
  areas[13] = {
    code: "POI014",
    name: "강남역",
    c: [37.4988, 127.0276],
    pts: [[37.4988, 127.0276]],
  };
  return areas;
}

describe("toArea — 응답 하나를 영역으로", () => {
  const raw = {
    CITYDATA: {
      AREA_NM: "강남역",
      AREA_CD: "POI014",
      SUB_STTS: [{ SUB_STN_NM: "신논현", SUB_STN_X: "127.02506", SUB_STN_Y: "37.504598" }],
      BUS_STN_STTS: [{ BUS_STN_NM: "강남역", BUS_STN_X: "127.0285365859", BUS_STN_Y: "37.4958485587" }],
    },
  };

  it("지하철역과 버스정류장 좌표를 모두 모은다", () => {
    const a = toArea(raw);
    expect(a.code).toBe("POI014");
    expect(a.name).toBe("강남역");
    expect(a.pts).toHaveLength(2);
  });

  it("좌표는 소수 6자리로 절단한다(파일 크기)", () => {
    expect(toArea(raw).pts[1]).toEqual([37.495849, 127.028537]);
  });

  it("중심은 구성 지점의 평균이다", () => {
    const [lat, lng] = toArea(raw).c;
    expect(lat).toBeCloseTo((37.504598 + 37.4958485587) / 2, 5);
    expect(lng).toBeCloseTo((127.02506 + 127.0285365859) / 2, 5);
  });

  it("CITYDATA가 없으면 null(공백 코드)", () => {
    expect(toArea({ "RESULT.CODE": "ERROR-500" })).toBeNull();
  });

  it("구성 지점이 0개면 null(한강공원류 — 판정 대상에서 자연 탈락)", () => {
    expect(toArea({ CITYDATA: { AREA_NM: "광나루한강공원", AREA_CD: "POI050", SUB_STTS: [], BUS_STN_STTS: [] } })).toBeNull();
  });

  it("좌표가 비유한인 지점은 버리고 나머지는 살린다", () => {
    const a = toArea({
      CITYDATA: {
        AREA_NM: "x",
        AREA_CD: "POI001",
        SUB_STTS: [{ SUB_STN_X: "", SUB_STN_Y: "" }],
        BUS_STN_STTS: [{ BUS_STN_X: "127.0", BUS_STN_Y: "37.5" }],
      },
    });
    expect(a.pts).toEqual([[37.5, 127.0]]);
  });
});

describe("validateAreas — 조용한 열화 차단", () => {
  it("정상 입력은 통과하고 통계를 돌려준다", () => {
    const s = validateAreas(okAreas());
    expect(s.areas).toBe(120);
    expect(s.points).toBeGreaterThan(1500);
  });

  it("영역 수가 100 미만이면 abort(응답 구조 변경 의심)", () => {
    expect(() => validateAreas(okAreas().slice(0, 99))).toThrow(/영역 수 부족/);
  });

  it("총 지점 수가 1,500 미만이면 abort", () => {
    const thin = okAreas().map((a) => ({ ...a, pts: a.pts.slice(0, 1) }));
    expect(() => validateAreas(thin)).toThrow(/총 지점 수 부족/);
  });

  it("서울 bbox를 벗어난 지점이 있으면 abort(좌표계 회귀)", () => {
    const bad = okAreas();
    bad[0] = { ...bad[0], pts: [...bad[0].pts, [35.1796, 129.0756]] }; // 부산
    expect(() => validateAreas(bad)).toThrow(/bbox 이탈/);
  });

  it("위경도가 뒤바뀌면 bbox 가드에 걸린다", () => {
    const bad = okAreas();
    bad[0] = { ...bad[0], pts: [[127.0, 37.5]] };
    expect(() => validateAreas(bad)).toThrow(/bbox 이탈/);
  });

  it("golden 영역이 없으면 abort", () => {
    const bad = okAreas().filter((a) => a.code !== "POI014");
    expect(() => validateAreas(bad)).toThrow(/golden 영역 부재/);
  });

  it("강남역 중심이 golden에서 500m 넘게 벗어나면 abort", () => {
    const bad = okAreas();
    bad[13] = { ...bad[13], c: [37.5665, 126.978] }; // 시청
    expect(() => validateAreas(bad)).toThrow(/golden 오차/);
  });
});
