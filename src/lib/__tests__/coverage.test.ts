import { describe, expect, it } from "vitest";
import {
  isInKorea,
  KOREA_COVERAGE_BBOX,
  metersOutsideSeoul,
  SEOUL_BBOX,
} from "@/lib/coverage";
import seed from "@/lib/data/osm-walk-nodes.json";
import cases from "./fixtures/korea-boundary-cases.json";

describe("isInKorea", () => {
  it("한국 좌표는 true (서울·제주·독도)", () => {
    expect(isInKorea(37.5665, 126.978)).toBe(true);
    expect(isInKorea(33.4996, 126.5312)).toBe(true);
    expect(isInKorea(37.2422, 131.8674)).toBe(true);
  });
  it("해외 좌표는 false (샌프란시스코·도쿄·파리)", () => {
    expect(isInKorea(37.7749, -122.4194)).toBe(false);
    expect(isInKorea(35.6762, 139.6503)).toBe(false);
    expect(isInKorea(48.8566, 2.3522)).toBe(false);
  });
  it("경계 상수는 deeplink 유래 값(31.43~44.35 / 122.37~132.0) — 이제 프리필터다", () => {
    expect(KOREA_COVERAGE_BBOX).toEqual({ latMin: 31.43, latMax: 44.35, lngMin: 122.37, lngMax: 132.0 });
  });
});

describe("isInKorea — 국경 폴리곤 판정 (E19)", () => {
  it("공유 golden 전수를 맞힌다", () => {
    // 앞의 여섯(후쿠오카·기타큐슈·대마도·시모노세키·개성·해주)은 위 사각형 **안**이라
    // 사각형 판정으로는 통과할 수 없는 표다.
    for (const c of cases.cases) {
      expect(isInKorea(c.lat, c.lng), c.name).toBe(c.inside);
    }
  });

  it("널 아일랜드는 밖이다", () => {
    expect(isInKorea(0, 0)).toBe(false);
  });

  it("OSM seed 노드 전수가 폴리곤 안이다", () => {
    // 빌드 스크립트의 insideRings와 coverage.ts의 ray casting은 서로 다른 코드다.
    // 이 단언이 두 구현의 합의를 8만 점으로 확인한다(spec §3 방어 2) — 링이 잘못
    // 실렸거나 두 구현이 어긋나면 "국내인데 제공 지역 밖"이라는 조용한 결함이 되는데,
    // 그 방향은 종전 사각형에는 없던 새 실패 모드다. 변이 주입 실측으로 이 단언이
    // golden 15점보다 약 4배 민감하다(균일 이동 6km vs 22km에서 반응).
    const nodes = (seed as unknown as { nodes: Array<[number, number, number, number]> }).nodes;
    expect(nodes.length).toBeGreaterThan(70_000);
    const stray = nodes.find((n) => !isInKorea(n[1], n[2]));
    expect(stray && `노드 ${stray[0]}(${stray[1]}, ${stray[2]})`).toBeUndefined();
  });
});

describe("metersOutsideSeoul", () => {
  it("서울 안은 0 (도심·강동·강서 외곽)", () => {
    expect(metersOutsideSeoul(37.5665, 126.978)).toBe(0);
    expect(metersOutsideSeoul(37.5385, 127.1234)).toBe(0);
    expect(metersOutsideSeoul(37.578, 126.8)).toBe(0);
  });

  it("서울 인접 시는 bbox 안이거나 근소하게 밖 (경계를 시도로 자르지 않는 근거)", () => {
    // 하남 미사·과천·고양 화정은 bbox 안 — 서울 대여소·행사가 반경에 들어올 수 있다.
    expect(metersOutsideSeoul(37.562, 127.193)).toBe(0);
    expect(metersOutsideSeoul(37.4292, 126.9877)).toBe(0);
    // 성남 판교는 남쪽으로 살짝 밖이지만 3km 안(문화행사 서비스권)
    expect(metersOutsideSeoul(37.395, 127.111)).toBeLessThan(3000);
  });

  it("원거리는 실측 거리에 근접 (부산 ~300km · 춘천 ~50km)", () => {
    expect(metersOutsideSeoul(35.1578, 129.0594)).toBeGreaterThan(250_000);
    const chuncheon = metersOutsideSeoul(37.88, 127.729);
    expect(chuncheon).toBeGreaterThan(40_000);
    expect(chuncheon).toBeLessThan(60_000);
  });

  it("bbox 상수는 음향신호기 seed 생성 필터와 같은 값", () => {
    expect(SEOUL_BBOX).toEqual({ latMin: 37.4, latMax: 37.72, lngMin: 126.73, lngMax: 127.2 });
  });
});
