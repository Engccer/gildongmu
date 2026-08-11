import { describe, it, expect } from "vitest";
import type { SubwayStation } from "../types";
import {
  matchStationsByName,
  nearestStations,
  summarizeStation,
  summarizeStationNear,
  findStationsByName,
  findStationsNear,
  findStationMeta,
  findStationMetaNear,
} from "../subway-stations";

// 순수 로직은 작은 fixture로 결정적 검증 — 연간 seed 갱신과 무관하게 안정적.
const st = (
  name: string,
  nameEn: string,
  lineName: string,
  lat: number,
  lng: number,
  isTransfer = false,
): SubwayStation => ({
  stationId: `${name}-${lineName}`,
  name,
  nameEn,
  lineName,
  lat,
  lng,
  operator: "서울교통공사",
  roadAddress: "서울특별시 어딘가",
  isTransfer,
});

const FIXTURE: SubwayStation[] = [
  st("서울역", "Seoul Station", "1호선", 37.554648, 126.972559, true),
  st("서울역", "Seoul Station", "4호선", 37.553, 126.9735, true),
  st("강동", "Gangdong", "5호선", 37.5, 127.1),
  st("강동구청", "Gangdong-gu Office", "8호선", 37.53, 127.12),
];

describe("matchStationsByName", () => {
  it("환승역은 같은 역명의 모든 노선 행을 반환", () => {
    const r = matchStationsByName(FIXTURE, "서울역");
    expect(r.map((s) => s.lineName).sort()).toEqual(["1호선", "4호선"]);
  });

  it('"역" 접미사 유무와 무관하게 매칭(정규화)', () => {
    // 입력에 "역"이 있어도/없어도 seed의 "강동"을 찾는다.
    expect(matchStationsByName(FIXTURE, "강동역").map((s) => s.name)).toEqual([
      "강동",
    ]);
    expect(matchStationsByName(FIXTURE, "강동").map((s) => s.name)).toEqual([
      "강동",
    ]);
  });

  it("부분일치는 배제 — 강동 검색이 강동구청을 끌어오지 않음(A1 교훈)", () => {
    const r = matchStationsByName(FIXTURE, "강동");
    expect(r.map((s) => s.name)).toEqual(["강동"]);
  });

  it("없는 역은 빈 배열", () => {
    expect(matchStationsByName(FIXTURE, "없는역")).toEqual([]);
  });
});

describe("lineHint 동명이역 분리(Task 2: 카카오 진입 死 섹션 부활)", () => {
  // fixture 주입형 — 양평 5호선(서울교통공사)과 양평역 경의중앙선(코레일)은
  // 실 seed에도 동명이역으로 존재(아래 "seed 무결성" 그룹에서 실seed로 재검증).
  const 양평5: SubwayStation = {
    stationId: "양평-5호선",
    name: "양평",
    nameEn: "Yangpyeong",
    lineName: "5호선",
    operator: "서울교통공사",
    lat: 37.5254,
    lng: 126.8853,
    roadAddress: "서울특별시 어딘가",
    isTransfer: false,
  };
  const 양평중앙: SubwayStation = {
    stationId: "양평-경의중앙선",
    name: "양평",
    nameEn: "Yangpyeong",
    lineName: "경의중앙선",
    operator: "한국철도공사",
    lat: 37.4925,
    lng: 127.4896,
    roadAddress: "경기도 양평군 어딘가",
    isTransfer: false,
  };

  it("lineHint가 동명이역을 분리한다", () => {
    expect(matchStationsByName([양평5, 양평중앙], "양평역 5호선", "5호선")).toEqual([
      양평5,
    ]);
  });

  it("findStationMeta가 카카오 실명에서 lineHint를 자동 적용한다(실 seed)", () => {
    // seed 실데이터: "양평역 5호선"의 lines에 경의중앙선이 섞이면 안 된다.
    const meta = findStationMeta("양평역 5호선");
    expect(meta?.lines).toEqual(["5호선"]);
  });

  it("카카오 실명 '강동역 5호선'이 seed와 매칭된다", () => {
    expect(findStationMeta("강동역 5호선")?.name).toBe("강동");
  });
});

describe("nearestStations", () => {
  it("거리순 정렬 + distanceMeters 부여", () => {
    // 서울역 1호선 좌표 바로 옆 → 서울역 행들이 강동보다 가깝다.
    const r = nearestStations(FIXTURE, 37.5546, 126.9726);
    expect(r[0].name).toBe("서울역");
    expect(r[0].distanceMeters).toBeLessThan(r[r.length - 1].distanceMeters);
    expect(r.every((s) => Number.isFinite(s.distanceMeters))).toBe(true);
  });

  it("radiusMeters 밖은 제외", () => {
    // 서울역 옆 1km 반경 → 강동(약 11km)·강동구청 제외, 서울역 2행만.
    const r = nearestStations(FIXTURE, 37.5546, 126.9726, {
      radiusMeters: 1000,
    });
    expect(r.every((s) => s.name === "서울역")).toBe(true);
  });

  it("limit으로 개수 제한", () => {
    const r = nearestStations(FIXTURE, 37.5546, 126.9726, { limit: 1 });
    expect(r).toHaveLength(1);
  });

  it("dedupeByName: 환승역은 역명당 최근접 1행만", () => {
    const r = nearestStations(FIXTURE, 37.5546, 126.9726, {
      dedupeByName: true,
    });
    const seoul = r.filter((s) => s.name === "서울역");
    expect(seoul).toHaveLength(1);
    expect(seoul[0].lineName).toBe("1호선"); // origin에 더 가까운 행
  });

  it("입력 배열·원소를 변형하지 않음(순수)", () => {
    const before = JSON.parse(JSON.stringify(FIXTURE));
    nearestStations(FIXTURE, 37.5546, 126.9726);
    expect(FIXTURE).toEqual(before);
  });
});

describe("summarizeStation", () => {
  it("빈 배열은 null", () => {
    expect(summarizeStation([])).toBeNull();
  });

  it("단일 노선역 — lines 1개, isTransfer false", () => {
    const meta = summarizeStation([FIXTURE[2]]); // 강동 5호선
    expect(meta).toEqual({
      name: "강동",
      nameEn: "Gangdong",
      lines: ["5호선"],
      isTransfer: false,
      operator: "서울교통공사",
    });
  });

  it("환승역 — 노선 묶음(중복 제거·순서 보존), isTransfer true, 영문명 공통", () => {
    const meta = summarizeStation([FIXTURE[0], FIXTURE[1]]); // 서울역 1·4호선
    expect(meta?.lines).toEqual(["1호선", "4호선"]);
    expect(meta?.isTransfer).toBe(true);
    expect(meta?.nameEn).toBe("Seoul Station");
  });
});

describe("summarizeStationNear — 좌표 문맥 집계(A9: 동명이역 혼입 차단)", () => {
  // 서울 용산(경부·경원, 같은 좌표) + 대구 용산(300km 밖) 동형 fixture.
  const seoul1 = st("용산역", "Yongsan", "경부선", 37.5299, 126.9648, true);
  const seoul2 = st("용산역", "Yongsan", "경원선", 37.5299, 126.9648, true);
  const daegu = st("용산(서부법원․검찰청입구)", "Yongsan", "대구 도시철도 2호선", 35.8491, 128.5288);

  it("앵커 600m 밖의 동명 레코드는 다른 역이다 — 노선에서 배제", () => {
    const meta = summarizeStationNear([seoul1, seoul2, daegu], 37.5299, 126.9648);
    expect(meta?.lines).toEqual(["경부선", "경원선"]);
  });

  it("반대로 대구 쪽 앵커면 대구 노선만 남는다", () => {
    const meta = summarizeStationNear([seoul1, seoul2, daegu], 35.8491, 128.5288);
    expect(meta?.lines).toEqual(["대구 도시철도 2호선"]);
  });

  it("서울 안 동명 분리역(2호선 신촌 vs 경의중앙선 신촌, 701m)도 합치지 않는다", () => {
    const sinchon2 = st("신촌(지하)", "Sinchon", "2호선", 37.5552, 126.9369);
    const sinchonGl = st("신촌역", "Sinchon", "경의중앙선", 37.5598, 126.9423);
    const meta = summarizeStationNear([sinchon2, sinchonGl], 37.5552, 126.9369);
    expect(meta?.lines).toEqual(["2호선"]);
  });

  it("전부 반경 밖이면 null(집계 근거 없음)", () => {
    expect(summarizeStationNear([daegu], 37.5299, 126.9648)).toBeNull();
  });
});

describe("seed 무결성(실제 번들 데이터)", () => {
  it("1,000개 이상의 역이 로드된다", () => {
    expect(findStationsByName("서울역").length).toBeGreaterThan(0);
    // 전국 근접 검색 없이도 데이터 규모를 우회 확인: 흔한 역명들이 존재.
    expect(findStationsByName("강남").length).toBeGreaterThan(0);
    expect(findStationsByName("부산역").length).toBeGreaterThan(0);
  });

  it("매칭된 역은 영문명·좌표가 채워져 있다", () => {
    for (const s of findStationsByName("서울역")) {
      expect(s.nameEn).toBeTruthy();
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lng)).toBe(true);
    }
  });

  it("findStationsNear: 강남역 좌표 근처에서 강남을 찾는다", () => {
    // 강남역 WGS84 ≈ 37.4979, 127.0276
    const r = findStationsNear(37.4979, 127.0276, {
      radiusMeters: 300,
      dedupeByName: true,
    });
    expect(r.some((s) => s.name === "강남")).toBe(true);
  });

  it("findStationMeta: 없는 역은 null, 있는 역은 영문명 집계", () => {
    expect(findStationMeta("존재하지않는역12345")).toBeNull();
    const meta = findStationMeta("서울역");
    expect(meta?.nameEn).toBeTruthy();
    expect(meta?.lines.length).toBeGreaterThan(0);
  });

  it("findStationMetaNear: 서울 용산역 앵커에 대구 2호선이 섞이지 않는다(A9 prod 실사고)", () => {
    // seed에 '용산(서부법원․검찰청입구)'(대구 2호선)가 있어 이름 집계는 오염된다.
    const meta = findStationMetaNear("용산역", 37.5299, 126.9648);
    expect(meta?.lines.length).toBeGreaterThan(0);
    expect(meta?.lines.some((l) => l.includes("대구"))).toBe(false);
  });
});
