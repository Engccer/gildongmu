import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "../../geo";
import { normalizeOdsayRoutes } from "../../providers/odsay";
import type { TransitRoute } from "../../types";
import { firstVehicle } from "../designated";
import { JOURNEY_SAME_STOP_M, JOURNEY_STATION_IDENTITY_M, busStopKey, busStopNamesStation, isSameBusStop, isSameStation, sameLine } from "../station-identity";

const fixtureDir = "src/lib/__tests__/fixtures";

function loadRoutes(name: string): TransitRoute[] {
  const json = JSON.parse(readFileSync(`${fixtureDir}/odsay-e70/${name}.json`, "utf8"));
  return normalizeOdsayRoutes(json, { includeStops: true }) ?? [];
}

function boardOf(route: TransitRoute) {
  const leg = firstVehicle(route)!;
  const s = leg.stops![0];
  return { name: s.name, lat: s.lat, lng: s.lng, lineName: leg.lineName };
}

describe("sameLine: 소스마다 다른 노선 표기", () => {
  const { cases } = JSON.parse(readFileSync(`${fixtureDir}/journey-line-names.json`, "utf8")) as {
    cases: Array<{ a: string; b: string; same: boolean }>;
  };

  it("fixture 전수", () => {
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) {
      expect(sameLine(c.a, c.b), `${c.a} ↔ ${c.b}`).toBe(c.same);
      // 대칭
      expect(sameLine(c.b, c.a), `${c.b} ↔ ${c.a}`).toBe(c.same);
    }
  });

  it("표에 없는 노선명은 폴백(지역 접두·구분자 제거 + lineHintMatches)으로 판정한다", () => {
    expect(sameLine("가상선", "가상 선")).toBe(true);
    expect(sameLine("가상선", "다른선")).toBe(false);
    // 숫자 코어는 완전 일치만(접두 뒤 코어가 1 대 11)
    expect(sameLine("대구 1호선", "대구 11호선")).toBe(false);
    // 표 밖(대전 2호선은 표에 없다)에서도 지역 접두가 양쪽에 있고 다르면 같은 번호여도 다른 노선
    expect(sameLine("대전 2호선", "대구 2호선")).toBe(false);
    // 한쪽에만 접두가 있고 표 밖이면 번호로 비교한다
    expect(sameLine("대전 2호선", "2호선")).toBe(true);
  });
});

describe("isSameStation", () => {
  it("상수는 500m", () => {
    expect(JOURNEY_STATION_IDENTITY_M).toBe(500);
  });

  it("아현 2호선 승차 경로는 아현역(2호선 좌표)과 같은 역이고 애오개 승차 경로는 아니다", () => {
    const routes = loadRoutes("ahyeon-gwanghwamun");
    const aeogae = routes.find((r) => firstVehicle(r)?.fromName === "애오개")!;
    const ahyeon = routes.find((r) => firstVehicle(r)?.fromName === "아현" && firstVehicle(r)?.mode === "subway")!;
    const input = { name: "아현역", coord: { lat: 37.557388, lng: 126.956132 } };
    expect(isSameStation(boardOf(ahyeon), input)).toBe(true);
    expect(isSameStation(boardOf(ahyeon), { ...input, line: "2호선" })).toBe(true);
    expect(isSameStation(boardOf(ahyeon), { ...input, line: "5호선" })).toBe(false);
    // 애오개는 이름 키가 다르다(좌표가 700m 안쪽이어도 거절)
    expect(isSameStation(boardOf(aeogae), input)).toBe(false);
  });

  it("신촌 반례: 노선 없는 경의중앙선 신촌 입력은 2호선 신촌 정류와 다른 역이다(동명 이역)", () => {
    const routes = loadRoutes("sinchon-seoulstn");
    const input = { name: "신촌역", coord: { lat: 37.5597, lng: 126.9421 } }; // 경의중앙선 신촌(카카오)
    const line2 = routes.find((r) => {
      const leg = firstVehicle(r);
      return leg?.mode === "subway" && leg.lineName === "수도권 2호선" && leg.fromName === "신촌";
    })!;
    const stop = boardOf(line2);
    const d = haversineMeters(stop.lat, stop.lng, input.coord.lat, input.coord.lng);
    // 실측 약 683m(설계 실측 680m 근처): 500m 문턱 밖이라 이름 키가 같아도 다른 역이다.
    expect(d).toBeGreaterThan(600);
    expect(d).toBeLessThan(760);
    expect(isSameStation(stop, input)).toBe(false);

    // 같은 입력이 경의중앙선 신촌 정류(순환 오차 수 m)와는 같은 역이다.
    const gj = routes.find((r) => firstVehicle(r)?.lineName === "경의중앙선")!;
    expect(isSameStation(boardOf(gj), input)).toBe(true);
    expect(isSameStation(boardOf(gj), { ...input, line: "경의중앙선" })).toBe(true);
    // 노선 힌트가 있으면 좌표가 맞아도 노선이 다르면 다른 역
    expect(isSameStation(boardOf(gj), { ...input, line: "2호선" })).toBe(false);
  });

  it("같은 복합체 안의 다른 노선 정류(서울역)는 노선 없는 입력에서 같은 역이다", () => {
    const routes = loadRoutes("sinchon-seoulstn");
    const gj = routes.find((r) => firstVehicle(r)?.lineName === "경의중앙선")!;
    const gjLeg = gj.legs.filter((l) => l.mode === "subway")[0];
    const gjAlight = gjLeg.stops![gjLeg.stops!.length - 1]; // 서울역(경의중앙선)
    const line1 = routes.find((r) => r.legs.some((l) => l.lineName === "수도권 1호선" && l.toName === "서울역"))!;
    const l1 = line1.legs.filter((l) => l.mode === "subway" && l.lineName === "수도권 1호선")[0];
    const l1Alight = l1.stops![l1.stops!.length - 1]; // 서울역(1호선)
    const input = { name: "서울역", coord: { lat: gjAlight.lat, lng: gjAlight.lng } };
    expect(isSameStation({ name: l1Alight.name, lat: l1Alight.lat, lng: l1Alight.lng, lineName: l1.lineName }, input)).toBe(true);
  });

  it("이름이 같아도 500m 밖이면 다른 역, 이름 키가 다르면 가까워도 다른 역", () => {
    const base = { lat: 37.5, lng: 127.0 };
    const stop = { name: "가상역", lat: base.lat, lng: base.lng };
    expect(isSameStation(stop, { name: "가상", coord: { lat: base.lat + 0.0044, lng: base.lng } })).toBe(true); // ≈489m
    expect(isSameStation(stop, { name: "가상", coord: { lat: base.lat + 0.0046, lng: base.lng } })).toBe(false); // ≈511m
    expect(isSameStation(stop, { name: "다른역", coord: base })).toBe(false);
  });

  it("stop에 노선이 없으면 입력 노선 힌트가 있어도 좌표·이름만으로 판정한다", () => {
    const stop = { name: "가상역", lat: 37.5, lng: 127.0 };
    expect(isSameStation(stop, { name: "가상역", coord: { lat: 37.5, lng: 127.0 }, line: "2호선" })).toBe(true);
  });
});

describe("같은 역 반경 근거 전수(spec §4.3 — 복합체 최대 < 500 ≤ 동명 이역 최소)", () => {
  const { pairs } = JSON.parse(readFileSync(`${fixtureDir}/journey-station-pairs.json`, "utf8")) as {
    pairs: Array<{
      name: string;
      a: { line: string; lat: number; lng: number };
      b: { line: string; lat: number; lng: number };
      homonym: boolean;
    }>;
  };
  const dist = (p: (typeof pairs)[number]) => haversineMeters(p.a.lat, p.a.lng, p.b.lat, p.b.lng);

  it("한 환승 복합체 안 노선 사이 거리는 전부 반경 안이고, 동명 이역은 전부 반경 밖이다", () => {
    const complexes = pairs.filter((p) => !p.homonym);
    const homonyms = pairs.filter((p) => p.homonym);
    expect(complexes.length).toBeGreaterThan(30);
    expect(homonyms.map((p) => p.name)).toEqual(["신촌"]);
    expect(Math.max(...complexes.map(dist))).toBeLessThan(JOURNEY_STATION_IDENTITY_M);
    expect(Math.min(...homonyms.map(dist))).toBeGreaterThanOrEqual(JOURNEY_STATION_IDENTITY_M);
  });

  it("노선 없는 입력은 복합체의 어느 노선 정류든 같은 역, 동명 이역은 다른 역으로 판정한다", () => {
    for (const p of pairs) {
      const verdict = isSameStation(
        { name: p.name, lat: p.a.lat, lng: p.a.lng, lineName: p.a.line },
        { name: p.name, coord: { lat: p.b.lat, lng: p.b.lng } },
      );
      expect(verdict, `${p.name} ${p.a.line} ↔ ${p.b.line}`).toBe(!p.homonym);
    }
  });
});

describe("버스 정류장 판정(E70-e)", () => {
  const { busStops } = JSON.parse(readFileSync(`${fixtureDir}/journey-station-pairs.json`, "utf8")) as {
    busStops: {
      names: Array<{ name: string; key: string }>;
      stationMatches: Array<{ station: string; stop: string; match: boolean }>;
    };
  };
  const here = { lat: 37.5, lng: 127.0 };
  /** 북쪽으로 대략 m미터 떨어진 점(위도 1도 ≈ 111,195m). */
  const north = (m: number) => ({ lat: here.lat + m / 111195, lng: here.lng });

  it("busStopKey: fixture 이름 전수", () => {
    expect(busStops.names.length).toBeGreaterThan(10);
    for (const c of busStops.names) expect(busStopKey(c.name), c.name).toBe(c.key);
  });

  it("isSameBusStop: 부속명만 다른 정류장은 같은 곳, 이름 키가 다르면 다른 곳", () => {
    const input = { name: "시청.교육청", coord: here, kind: "stop" as const };
    expect(isSameBusStop({ name: "시청.덕수궁", ...north(30) }, input)).toBe(true);
    expect(isSameBusStop({ name: "시청앞.덕수궁", ...north(80) }, input)).toBe(false);
  });

  it("isSameBusStop: 좌표 500m 경계", () => {
    const input = { name: "광화문", coord: here, kind: "stop" as const };
    expect(isSameBusStop({ name: "광화문", ...north(JOURNEY_STATION_IDENTITY_M - 10) }, input)).toBe(true);
    expect(isSameBusStop({ name: "광화문", ...north(JOURNEY_STATION_IDENTITY_M + 10) }, input)).toBe(false);
  });

  it("busStopNamesStation: fixture 역 ↔ 정류장 표본", () => {
    expect(busStops.stationMatches.length).toBeGreaterThan(6);
    for (const c of busStops.stationMatches) {
      const stop = { name: c.stop, ...north(50) };
      expect(busStopNamesStation(stop, { name: c.station, coord: here }), `${c.station} ↔ ${c.stop}`).toBe(c.match);
    }
  });

  it("키가 빈 문자열이면 이름 경로로는 맞지 않는다(50m 밖이면 500m 안이어도 다른 곳, 역 이름 정류장도 아니다)", () => {
    const input = { name: ".삼성전자", coord: here, kind: "stop" as const };
    expect(isSameBusStop({ name: "(5번승강장)", ...north(80) }, input)).toBe(false);
    expect(isSameBusStop({ name: ".삼성전자", ...north(80) }, input)).toBe(false);
    expect(busStopNamesStation({ name: ".삼성전자", ...here }, { name: "강남역", coord: here })).toBe(false);
  });

  it("isSameBusStop: 이름 키가 달라도 50m 안의 이웃 정류장은 같은 곳(근접 조항은 이름과 무관)", () => {
    const input = { name: "시청.덕수궁", coord: { lat: 37.566254, lng: 126.976921 }, kind: "stop" as const };
    const at = (m: number) => ({ lat: input.coord.lat + m / 111195, lng: input.coord.lng });
    expect(isSameBusStop({ name: "시청앞.덕수궁", ...at(37) }, input)).toBe(true);
    expect(isSameBusStop({ name: "시청앞.덕수궁", ...at(80) }, input)).toBe(false);
    expect(isSameBusStop({ name: "시청앞.덕수궁", ...at(JOURNEY_SAME_STOP_M - 1) }, input)).toBe(true);
    expect(isSameBusStop({ name: "시청앞.덕수궁", ...at(JOURNEY_SAME_STOP_M + 1) }, input)).toBe(false);
    // 빈 키여도 50m 안이면 같은 곳
    expect(isSameBusStop({ name: "(5번승강장)", ...at(10) }, { ...input, name: ".삼성전자" })).toBe(true);
  });

  it("busStopNamesStation: 영문이 섞인 이름은 대소문자를 가리지 않는다", () => {
    expect(busStopNamesStation({ name: "DMC역3번출구", ...here }, { name: "dmc역", coord: here })).toBe(true);
    expect(busStopNamesStation({ name: "dmc역3번출구", ...here }, { name: "DMC역", coord: here })).toBe(true);
  });

  it("busStopNamesStation: 이름이 맞아도 좌표 500m 밖이면 아니다", () => {
    const input = { name: "강남역", coord: here };
    expect(busStopNamesStation({ name: "강남역12번출구", ...north(JOURNEY_STATION_IDENTITY_M - 10) }, input)).toBe(true);
    expect(busStopNamesStation({ name: "강남역12번출구", ...north(JOURNEY_STATION_IDENTITY_M + 10) }, input)).toBe(false);
  });
});
