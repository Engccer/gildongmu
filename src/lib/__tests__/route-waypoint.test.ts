import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKakaoWalkBriefing,
  normalizeKakaoWalkRoute,
  type KakaoWalkResponse,
} from "../providers/kakao-walk";
import {
  getWalkRouteBriefing,
  normalizeTmapWalkRoute,
  type TmapRouteResponse,
} from "../providers/tmap-pedestrian";
import {
  getTmapCarBriefing,
  normalizeTmapCarRoute,
  type TmapCarResponse,
} from "../providers/tmap-car";
import { getCarRouteBriefing, normalizeRoute } from "../providers/kakao-navi";

/**
 * N4 경유지(spec 2026-08-22 §1·§2.2): 4 provider의 경유지 파라미터·`waypoint` 투영.
 * fixture는 2026-08-22 실호출(천호역→강동역 경유→길동) 축약본.
 *
 * ⚠ 카카오 도보는 파라미터 이름이 틀려도 200 정상 응답이 온다(실호출로 확인) —
 * URL 문자열 단언이 유일한 가드다. 표지 부재 throw도 같은 이유다.
 */

const VIA = { lat: 37.5353, lng: 127.1323 };

// ── 카카오 도보: legs 2개 ──────────────────────────────────────────────
type KakaoLegs = NonNullable<NonNullable<KakaoWalkResponse["route"]>["legs"]>;
function kakaoWalk(legs: KakaoLegs): KakaoWalkResponse {
  return { status: "OK", route: { properties: { totalDistance: 2497, totalTime: 2310 }, legs } };
}
const KAKAO_TWO_LEGS = kakaoWalk([
  {
    steps: [
      { properties: { guidance: "천호역 6번 출구까지 역사 내 이동", distance: 100 }, path: { points: [[127.1237, 37.5386]] } },
      { properties: { guidance: "강동역까지 818m 이동", distance: 818 }, path: { points: [[127.1240, 37.5384], [127.13234, 37.53529]] } },
    ],
  },
  {
    steps: [
      { properties: { guidance: "늘푸른정신과까지 43m 이동", distance: 43 }, path: { points: [[127.13234, 37.53529], [127.1320, 37.5350]] } },
      { properties: { guidance: "길동까지 1536m 이동", distance: 1536 }, path: { points: [[127.1320, 37.5350], [127.1268, 37.5272]] } },
    ],
  },
]);

describe("카카오 도보 경유지", () => {
  it("expectWaypoint: leg 경계가 stepIndex, leg 0 끝점이 coord", () => {
    const b = normalizeKakaoWalkRoute(KAKAO_TWO_LEGS, { expectWaypoint: true });
    expect(b?.waypoint).toEqual({ stepIndex: 2, coord: { lat: 37.53529, lng: 127.13234 } });
    expect(b?.steps).toHaveLength(4);
  });

  it("미지정이면 waypoint 키 부재(byte-호환)", () => {
    const b = normalizeKakaoWalkRoute(KAKAO_TWO_LEGS);
    expect(b && "waypoint" in b).toBe(false);
  });

  it("expectWaypoint인데 leg가 1개면 throw(파라미터 무시 — 경유 안 한 경로를 경유한 경로로 낭독 금지)", () => {
    const oneLeg = kakaoWalk([KAKAO_TWO_LEGS.route!.legs![0]]);
    expect(() => normalizeKakaoWalkRoute(oneLeg, { expectWaypoint: true })).toThrow(/경유지/);
  });

  it("leg 0 끝점이 없으면 leg 1 첫 점, 둘 다 없으면 요청 via 원좌표", () => {
    const noPath = kakaoWalk([
      { steps: [{ properties: { guidance: "a" } }] },
      { steps: [{ properties: { guidance: "b" }, path: { points: [[127.2, 37.6]] } }] },
    ]);
    expect(normalizeKakaoWalkRoute(noPath, { expectWaypoint: true })?.waypoint).toEqual({
      stepIndex: 1, coord: { lat: 37.6, lng: 127.2 },
    });
    const none = kakaoWalk([
      { steps: [{ properties: { guidance: "a" } }] },
      { steps: [{ properties: { guidance: "b" } }] },
    ]);
    expect(normalizeKakaoWalkRoute(none, { expectWaypoint: true, via: VIA })?.waypoint).toEqual({
      stepIndex: 1, coord: VIA,
    });
  });
});

// ── Tmap 보행자: PP1 Point ──────────────────────────────────────────────
const TMAP_WALK: TmapRouteResponse = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [127.1237, 37.5386] }, properties: { description: "14m 이동", pointType: "SP", totalDistance: 2100, totalTime: 1900 } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[127.1237, 37.5386], [127.1323, 37.5353]] }, properties: {} },
    { type: "Feature", geometry: { type: "Point", coordinates: [127.13234, 37.53529] }, properties: { description: "경유지 후 313m 이동", pointType: "PP1" } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[127.13234, 37.53529], [127.1268, 37.5272]] }, properties: {} },
    { type: "Feature", geometry: { type: "Point", coordinates: [127.1268, 37.5272] }, properties: { description: "도착", pointType: "EP" } },
  ],
};

describe("Tmap 보행자 경유지", () => {
  it("PP1 Point가 만든 스텝 인덱스·좌표", () => {
    const b = normalizeTmapWalkRoute(TMAP_WALK, { expectWaypoint: true });
    expect(b.waypoint).toEqual({ stepIndex: 1, coord: { lat: 37.53529, lng: 127.13234 } });
  });
  it("기하 모드에서도 같은 자리", () => {
    const b = normalizeTmapWalkRoute(TMAP_WALK, { expectWaypoint: true, includeLineGeometry: true });
    expect(b.waypoint?.stepIndex).toBe(1);
    expect(b.steps).toHaveLength(2); // 도착 마커 떨굼(현행)
  });
  it("PP1 없이 expectWaypoint면 throw", () => {
    const noVia = { ...TMAP_WALK, features: TMAP_WALK.features.filter((f) => f.properties.pointType !== "PP1") };
    expect(() => normalizeTmapWalkRoute(noVia, { expectWaypoint: true })).toThrow(/경유지/);
  });
  it("미지정이면 키 부재", () => {
    expect("waypoint" in normalizeTmapWalkRoute(TMAP_WALK)).toBe(false);
  });
});

// ── Tmap 자동차: B1 Point(+말미 무설명 B1) ────────────────────────────────
const TMAP_CAR: TmapCarResponse = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [127.1237, 37.5386] }, properties: { description: "천호대로를 따라 857m 이동", pointType: "S", totalDistance: 2066, totalTime: 500, totalFare: 0, taxiFare: 5000 } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[127.1237, 37.5386], [127.13235, 37.53529]] }, properties: { name: "천호대로", distance: 857 } },
    { type: "Feature", geometry: { type: "Point", coordinates: [127.13235, 37.53529] }, properties: { description: "도착지 건너편 후 천호대로168길을 따라 315m 이동", pointType: "B1" } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[127.13235, 37.53529], [127.12685, 37.52713]] }, properties: { name: "천호대로168길", distance: 315 } },
    { type: "Feature", geometry: { type: "Point", coordinates: [127.12685, 37.52713] }, properties: { description: "도착", pointType: "E" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [127.1323, 37.5353] }, properties: { pointType: "B1" } },
  ],
};

describe("Tmap 자동차 경유지", () => {
  it("description 있는 B1 guide 인덱스·좌표, 말미 무설명 B1은 guide가 아니다", () => {
    const b = normalizeTmapCarRoute(TMAP_CAR, { expectWaypoint: true });
    expect(b.guides).toHaveLength(3);
    expect(b.waypoint).toEqual({ stepIndex: 1, coord: { lat: 37.53529, lng: 127.13235 } });
  });
  it("기하 모드: E 제외 2 guide, terminal은 E, waypoint 동일", () => {
    const b = normalizeTmapCarRoute(TMAP_CAR, { expectWaypoint: true, includeGeometry: true });
    expect(b.guides).toHaveLength(2);
    expect(b.terminalCoord).toEqual({ lat: 37.52713, lng: 127.12685 });
    expect(b.waypoint?.stepIndex).toBe(1);
  });
  it("B1 없이 expectWaypoint면 throw", () => {
    const noVia = { ...TMAP_CAR, features: TMAP_CAR.features.filter((f) => f.properties.pointType !== "B1") };
    expect(() => normalizeTmapCarRoute(noVia, { expectWaypoint: true })).toThrow(/경유지/);
  });
});

// ── 카카오 내비: type 1000 중복 접기 ──────────────────────────────────────
const KAKAO_NAVI_ROUTE = {
  result_code: 0,
  result_msg: "길찾기 성공",
  summary: { distance: 3341, duration: 700, fare: { taxi: 7000, toll: 0 } },
  sections: [
    { guides: [
      { name: "출발지", guidance: "출발지", distance: 0, duration: 0, type: 100, x: 127.1237, y: 37.5386 },
      { name: "천호사거리", guidance: "강동구청 방면으로 좌회전", distance: 100, duration: 30, type: 1, x: 127.1235, y: 37.5387 },
      { name: "경유지", guidance: "경유지", distance: 500, duration: 100, type: 1000, x: 127.13234642595538, y: 37.53527671307708 },
    ] },
    { guides: [
      { name: "경유지1", guidance: "경유지", distance: 0, duration: 0, type: 1000, x: 127.13234642595538, y: 37.53527671307708 },
      { name: "", guidance: "좌회전", distance: 50, duration: 10, type: 1, x: 127.1322, y: 37.5349 },
      { name: "목적지", guidance: "목적지", distance: 0, duration: 0, type: 101, x: 127.1268, y: 37.5271 },
    ] },
  ],
};

describe("카카오 내비 경유지", () => {
  it("type 1000이 section 경계에서 중복돼도 guide는 하나, 그 인덱스가 stepIndex", () => {
    const b = normalizeRoute(KAKAO_NAVI_ROUTE, { expectWaypoint: true });
    expect(b.guides.map((g) => g.guidance)).toEqual(["출발지", "강동구청 방면으로 좌회전", "경유지", "좌회전", "목적지"]);
    expect(b.waypoint).toEqual({ stepIndex: 2, coord: { lat: 37.53527671307708, lng: 127.13234642595538 } });
  });
  it("type 1000 없이 expectWaypoint면 throw", () => {
    const noVia = { ...KAKAO_NAVI_ROUTE, sections: [{ guides: KAKAO_NAVI_ROUTE.sections[0].guides.slice(0, 2) }] };
    expect(() => normalizeRoute(noVia, { expectWaypoint: true })).toThrow(/경유지/);
  });
  it("미지정이면 평탄화만(현행 byte-호환, 중복 접기도 하지 않는다)", () => {
    const b = normalizeRoute(KAKAO_NAVI_ROUTE);
    expect(b.guides).toHaveLength(6);
    expect("waypoint" in b).toBe(false);
  });
});

// ── 파라미터 직렬화(이름이 틀려도 200이 오는 API — 문자열 단언이 유일한 가드) ──
describe("경유지 파라미터 직렬화", () => {
  const O = { lat: 37.5386, lng: 127.1237 };
  const D = { lat: 37.5272, lng: 127.1268 };
  afterEach(() => vi.unstubAllGlobals());

  function stub(body: unknown) {
    const fetchMock = vi.fn(
      async (_url: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify(body), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const callUrl = (f: ReturnType<typeof stub>) => String(f.mock.calls[0]?.[0]);
  const callBody = (f: ReturnType<typeof stub>) => JSON.parse(String(f.mock.calls[0]?.[1]?.body));

  it("카카오 도보: via_x/via_y(경도·위도, 4자리)", async () => {
    const f = stub(KAKAO_TWO_LEGS);
    await getKakaoWalkBriefing({ origin: O, dest: D, via: VIA });
    const url = callUrl(f);
    expect(url).toContain("via_x=127.1323");
    expect(url).toContain("via_y=37.5353");
  });

  it("Tmap 보행자: passList 'lng,lat'", async () => {
    const f = stub(TMAP_WALK);
    await getWalkRouteBriefing({ origin: O, dest: D, via: VIA });
    expect(callBody(f).passList).toBe("127.1323,37.5353");
  });

  it("Tmap 자동차: passList 'lng,lat'", async () => {
    const f = stub(TMAP_CAR);
    await getTmapCarBriefing({ origin: O, dest: D, via: VIA });
    expect(callBody(f).passList).toBe("127.1323,37.5353");
  });

  it("카카오 내비: waypoints 'lng,lat'", async () => {
    const f = stub({ routes: [KAKAO_NAVI_ROUTE] });
    const b = await getCarRouteBriefing({ origin: O, dest: D, via: VIA });
    expect(callUrl(f)).toContain("waypoints=127.1323%2C37.5353");
    expect(b.waypoint?.stepIndex).toBe(2);
  });

  it("via 없으면 어느 파라미터도 붙지 않는다(현행 URL 불변)", async () => {
    const f = stub(kakaoWalk([KAKAO_TWO_LEGS.route!.legs![0]]));
    await getKakaoWalkBriefing({ origin: O, dest: D });
    expect(callUrl(f)).not.toContain("via_");
  });
});
