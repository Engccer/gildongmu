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

  it("프리필터가 링을 잘라내지 않는다 (독도 동쪽 영해)", () => {
    // 프리필터를 `KOREA_COVERAGE_BBOX`(≤132.0)로 두었을 때 실제로 잘려 나가던 구간이다
    // — 독도 영해 링은 동경 132.12까지 뻗는다. 사각형이 폴리곤의 상위집합이 아니면
    // 프리필터가 거짓 "밖"을 내는데, 그 33개 링 좌표는 상수 값 단언으로는 보이지 않는다.
    expect(isInKorea(37.24, 132.05)).toBe(true);
    expect(132.05).toBeGreaterThan(KOREA_COVERAGE_BBOX.lngMax);
    // 링 밖 공해는 그대로 밖이다(프리필터를 넓힌 것이 판정을 느슨하게 만들지 않았다).
    expect(isInKorea(37.24, 132.2)).toBe(false);
  });

  it("OSM seed 노드 전수가 폴리곤 안이다", () => {
    // 링 데이터가 열화되면(수축·이동·소실) "국내인데 제공 지역 밖"이라는 조용한
    // 결함이 되는데, 그 방향은 종전 사각형에는 없던 새 실패 모드다(spec §3 방어 2).
    // ⚠ 이 단언은 **알고리즘의 정확성을 검증하지 않는다** — 빌드 스크립트의
    // insideRings와 여기 ray casting은 같은 코드의 사본이라 공유 결함은 원리상 못
    // 잡는다(리뷰 검출 2026-08-23). 잡는 것은 **데이터 열화**이고, 그 축에서는
    // golden 15점보다 민감하다(2% 수축을 golden은 놓치고 이 단언은 잡는다).
    // 반대로 링 하나가 통째로 사라지면 golden이 잡고 이 단언은 놓친다 — 상보적이다.
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
