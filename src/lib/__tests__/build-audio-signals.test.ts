import { describe, it, expect, beforeAll } from "vitest";
import proj4 from "proj4";
import { GOLDEN, buildSeed } from "../../../scripts/build-audio-signals.mjs";

// 스크립트 내부 정의와 동일한 EPSG:5186(중부원점 2010), 픽스처 좌표 생성용.
const EPSG5186 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";
const toXY = proj4("WGS84", EPSG5186);

const REQUIRED_FIELDS = ["MGRNU", "XCE", "YCE", "STAT_CDE"];
const BASE_FIELDS = [...REQUIRED_FIELDS, "MK_CPY"];
const NOW = "2026-07-22T00:00:00.000Z";
const OPTS = { now: NOW, baseDate: "2026-05-28", dbfSha256: "deadbeef" };

// 서울 중심부(37.5~37.6, 126.95~127.05)에 결정론적으로 흩뿌린 유효 행.
// 개별 행은 항상 bbox 내부에 있고, 평균(centroid)도 항상 목표 구간 안이다.
function makeValidRow(i: number, statCde = "1") {
  const lat = 37.55 + (((i % 50) - 25) * 0.002);
  const lng = 127.0 + (((Math.floor(i / 50) % 50) - 25) * 0.002);
  const [x, y] = toXY.forward([lng, lat]);
  return { MGRNU: String(i), XCE: String(x), YCE: String(y), STAT_CDE: statCde, MK_CPY: "테스트" };
}

function makeValidRows(count: number, statCde = "1") {
  return Array.from({ length: count }, (_, i) => makeValidRow(i, statCde));
}

describe("buildSeed 스키마·회귀 가드", () => {
  it.each(REQUIRED_FIELDS)("필수 필드 %s 누락 시 throw", (missing) => {
    const fields = REQUIRED_FIELDS.filter((f) => f !== missing);
    expect(() => buildSeed({ fields, rows: [] }, OPTS)).toThrow(/필수 필드 누락/);
  });

  it("유효 건수가 15,000 미만이면 throw", () => {
    // 총행수 가드(20,000)는 통과시키되 전부 STAT_CDE 제외로 유효 0건을 만든다.
    const rows = makeValidRows(20000, "0");
    expect(() => buildSeed({ fields: BASE_FIELDS, rows }, OPTS)).toThrow(/유효 건수 부족/);
  });

  it("좌표 유효율이 70% 미만이면 kept가 충분해도(대량 마스킹) throw", () => {
    // 유효 좌표 17,000건은 kept 가드(15,000)를 넉넉히 통과하지만, 전체 25,000건 중
    // 마스킹 8,000건이 섞이면 유효율 68%로 이 가드가 단독으로 걸린다.
    const validRows = makeValidRows(17000);
    const maskRows = Array.from({ length: 8000 }, (_, i) => ({
      MGRNU: `mask-${i}`,
      XCE: "**********",
      YCE: "**********",
      STAT_CDE: "1",
    }));
    const rows = [...validRows, ...maskRows];
    expect(() => buildSeed({ fields: BASE_FIELDS, rows }, OPTS)).toThrow(/좌표 유효율 이상/);
  });

  it("전 행이 같은 방향으로 밀려 centroid가 목표 구간을 벗어나면 throw(전체 이동 회귀 가드)", () => {
    // +0.13도 경도 오프셋: 개별 행은 여전히 서울 bbox(≤127.2) 안이지만
    // centroid(126.9~127.1)는 벗어난다. bbox 통과·centroid만 실패하는 경로를 겨냥.
    const rows = Array.from({ length: 20000 }, (_, i) => {
      const lat = 37.55 + (((i % 50) - 25) * 0.002);
      const lng = 127.0 + (((Math.floor(i / 50) % 50) - 25) * 0.002) + 0.13;
      const [x, y] = toXY.forward([lng, lat]);
      return { MGRNU: String(i), XCE: String(x), YCE: String(y), STAT_CDE: "1" };
    });
    expect(() => buildSeed({ fields: BASE_FIELDS, rows }, OPTS)).toThrow(/이탈/);
  });

  it("EPSG:5181(구 중부원점)로 오변환하면 golden 오차가 1m를 넘어 가드가 감지한다", () => {
    // buildSeed는 내부적으로 항상 올바른 5186 정의를 쓰므로 오변환을 직접 주입할 수 없다.
    // 대신 이 테스트가 golden 검사와 동일한 수식을 5181 정의로 재현해
    // "정의가 틀리면 실제로 throw할 만큼 오차가 벌어진다"는 가드의 유효성을 증명한다.
    const EPSG5181 =
      "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-146.43,507.89,681.46,0,0,0,0";
    const toWgsWrong = proj4(EPSG5181, "WGS84");
    const checkGolden = () => {
      for (const g of GOLDEN) {
        const [lng, lat] = toWgsWrong.forward([g.x, g.y]);
        const errM = Math.hypot((lat - g.lat) * 111320, (lng - g.lng) * 88000);
        if (errM > 1) throw new Error(`golden 좌표 오차 ${errM.toFixed(1)}m, 좌표계 정의 회귀 의심`);
      }
    };
    expect(checkGolden).toThrow(/golden 좌표 오차/);
  });
});

describe("buildSeed 정상 경로", () => {
  const MASK_COUNT = 37;
  let result: ReturnType<typeof buildSeed>;

  beforeAll(() => {
    const validRows = makeValidRows(20000);
    // 좌표 파싱 실패(마스킹, data.go.kr 관례상 "**********") 행.
    const maskRows = Array.from({ length: MASK_COUNT }, (_, i) => ({
      MGRNU: `mask-${i}`,
      XCE: "**********",
      YCE: "**********",
      STAT_CDE: "1",
    }));
    result = buildSeed({ fields: BASE_FIELDS, rows: [...validRows, ...maskRows] }, OPTS);
  });

  it("마스킹 행은 noCoord로 집계되고 kept·total에 반영된다", () => {
    expect(result.meta.counts.noCoord).toBe(MASK_COUNT);
    expect(result.meta.counts.statExcluded).toBe(0);
    expect(result.meta.counts.kept).toBe(20000);
    expect(result.meta.counts.total).toBe(20000 + MASK_COUNT);
  });

  it("signals는 (lat,lng) 사전순으로 정렬되어 있다(diff 안정성)", () => {
    expect(result.signals.length).toBe(20000);
    for (let i = 1; i < result.signals.length; i++) {
      const [prevLat, prevLng] = result.signals[i - 1];
      const [lat, lng] = result.signals[i];
      expect(prevLat < lat || (prevLat === lat && prevLng <= lng)).toBe(true);
    }
  });

  it("meta에 source·baseDate·fetchedAt·dbfSha256을 그대로 반영한다", () => {
    expect(result.meta.source).toBe("seoul-open-data OA-15543");
    expect(result.meta.baseDate).toBe("2026-05-28");
    expect(result.meta.fetchedAt).toBe(NOW);
    expect(result.meta.dbfSha256).toBe("deadbeef");
  });
});
