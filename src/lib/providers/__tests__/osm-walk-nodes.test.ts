import { describe, it, expect } from "vitest";
import {
  findWalkFeaturesNear,
  osmWalkSeedMeta,
  KOREA_WALK_SEED_BBOX,
} from "../osm-walk-nodes";

/**
 * 실 seed(`src/lib/data/osm-walk-nodes.json`)를 그대로 두고 조회 계약을 검증한다.
 * 빌드 타임 가드는 build-osm-walk-nodes.test.ts 몫이고, 여기는 런타임 판정만 본다.
 */

// 강남역. 빌드 가드 G7이 같은 좌표를 쓰므로 seed가 갱신돼도 함께 지켜진다.
const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const TOKYO = { lat: 35.6812, lng: 139.7671 };

describe("findWalkFeaturesNear", () => {
  it("도심 좌표는 횡단보도를 낸다", () => {
    const found = findWalkFeaturesNear(GANGNAM.lat, GANGNAM.lng, 300);
    expect(found).not.toBeNull();
    expect(found!.filter((f) => f.crossing).length).toBeGreaterThanOrEqual(5);
  });

  it("seed 범위 밖은 null이고, 0건 배열이 아니다", () => {
    // ⚠ 이 구분이 이 provider의 존재 이유다. 빈 배열을 돌려주면 상위 계층이
    // "주변에 등록된 횡단보도가 없습니다"로 낭독하는데, 시각장애 사용자는 그것이
    // "자료가 없는 지역"이라는 뜻인지 화면으로 확인할 방법이 없다.
    expect(findWalkFeaturesNear(TOKYO.lat, TOKYO.lng, 300)).toBeNull();
    expect(findWalkFeaturesNear(KOREA_WALK_SEED_BBOX.latMax + 1, 127.0, 300)).toBeNull();
    expect(findWalkFeaturesNear(37.5, KOREA_WALK_SEED_BBOX.lngMin - 1, 300)).toBeNull();
  });

  it("범위 안 반경 0은 빈 배열이다(null 아님)", () => {
    const found = findWalkFeaturesNear(GANGNAM.lat, GANGNAM.lng, 0);
    expect(found).toEqual([]);
  });

  it("반경을 넓히면 결과가 줄지 않는다", () => {
    const near = findWalkFeaturesNear(GANGNAM.lat, GANGNAM.lng, 100)!;
    const far = findWalkFeaturesNear(GANGNAM.lat, GANGNAM.lng, 300)!;
    expect(far.length).toBeGreaterThanOrEqual(near.length);
  });

  it("반환 feature는 osmId·좌표·플래그를 갖춘다", () => {
    const found = findWalkFeaturesNear(GANGNAM.lat, GANGNAM.lng, 300)!;
    for (const f of found) {
      expect(f.osmId).toMatch(/^node\/\d+$/);
      expect(typeof f.lat).toBe("number");
      expect(typeof f.lng).toBe("number");
      expect(["yes", "no", "unknown"]).toContain(f.crossingSignal);
      // crossing도 tactile도 아닌 노드는 seed에 있을 이유가 없다.
      expect(f.crossing || f.tactilePaving).toBe(true);
    }
  });

  it("seed 전체에 세 축(신호 있음·점자블록·호스트 판별)이 모두 살아 있다", () => {
    // 플래그 판독이 어긋나면 특정 축이 통째로 사라지는데, 한 좌표만 보면 그 지역에
    // 원래 없는 것과 구분되지 않는다. 서울 도심 넓은 반경으로 세 축을 함께 확인한다.
    const wide = findWalkFeaturesNear(37.5665, 126.978, 3000)!;
    expect(wide.some((f) => f.crossingSignal === "yes")).toBe(true);
    expect(wide.some((f) => f.tactilePaving)).toBe(true);
    expect(wide.some((f) => f.hostFeature !== undefined)).toBe(true);
  });
});

describe("seed 메타", () => {
  it("출처·라이선스를 파일 자체가 들고 다닌다(ODbL 이행)", () => {
    const meta = osmWalkSeedMeta();
    expect(meta.source).toContain("OpenStreetMap");
    expect(meta.license).toContain("ODbL");
    expect(meta.counts.total).toBeGreaterThan(60_000);
  });
});
