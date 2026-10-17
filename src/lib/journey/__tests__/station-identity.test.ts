import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "../../geo";
import { normalizeOdsayRoutes } from "../../providers/odsay";
import type { TransitRoute } from "../../types";
import { firstVehicle } from "../designated";
import { JOURNEY_STATION_IDENTITY_M, isSameStation, sameLine } from "../station-identity";

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
