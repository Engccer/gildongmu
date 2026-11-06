import { afterEach, describe, expect, it, vi } from "vitest";
import { CONGESTION_MIN_COVERAGE, JAM_MERGE_GAP_M, JAM_MIN_M, summarizeCongestion, type CongestionPiece } from "../car-traffic";
import { getTmapCarBriefing, tmapCongestionPieces, type TmapCarResponse } from "../providers/tmap-car";
import { getCarRouteBriefing, kakaoCongestionPieces, type KakaoNaviRoute } from "../providers/kakao-navi";

const P = (lat: number, lng: number) => ({ lat, lng });
function piece(fromM: number, toM: number, jam: boolean, road: string | null = "올림픽대로", known = true): CongestionPiece {
  return { fromM, toM, jam, known, road, from: P(37.5, 127 + fromM / 1e6), to: P(37.5, 127 + toM / 1e6) };
}

/** 조각 길이 합을 경로 총거리로 쓰는 요약(분모 검사는 별도 케이스). */
const sum = (ps: CongestionPiece[]) => summarizeCongestion(ps, ps.reduce((a, p) => a + (p.toM - p.fromM), 0));

describe("summarizeCongestion (E80 spec §3)", () => {
  it("알려진 조각이 하나도 없으면 null(정보 없음 — 정체 없음과 다르다)", () => {
    expect(sum([])).toBeNull();
    expect(sum([piece(0, 900, false, null, false)])).toBeNull();
  });

  it("교통 정보가 있는 길이가 경로 총거리의 80% 미만이면 null — 분모는 조각 합이 아니라 총거리다", () => {
    const ps = [piece(0, 800, false)];
    expect(summarizeCongestion(ps, 1000)).toEqual({ jams: [] });
    expect(summarizeCongestion(ps, 1001)).toBeNull();
    expect(summarizeCongestion([piece(0, 300, false), piece(300, 1000, false, null, false)], 1000)).toBeNull();
    expect(CONGESTION_MIN_COVERAGE).toBe(0.8);
    expect(summarizeCongestion(ps, 0)).toBeNull();
  });

  it("정보는 있는데 문턱을 넘는 정체가 없으면 빈 목록(정체 없음)", () => {
    expect(sum([piece(0, 2000, false), piece(2000, 2000 + JAM_MIN_M - 1, true)])).toEqual({ jams: [] });
  });

  it("합치기 간격은 200m(위원장 판정 2026-11-07 ③) — 상수 참조만으로는 값 변이를 못 잡는다", () => {
    expect(JAM_MERGE_GAP_M).toBe(200);
    expect(JAM_MIN_M).toBe(500);
  });

  it("간격이 합치기 문턱 이하인 정체는 하나로 잇고, 넘으면 가른다", () => {
    const a = sum([
      piece(1000, 1300, true),
      piece(1300, 1300 + JAM_MERGE_GAP_M, false),
      piece(1300 + JAM_MERGE_GAP_M, 1600, true),
    ]);
    expect(a?.jams).toHaveLength(1);
    expect(a?.jams[0]).toMatchObject({ startMeters: 1000, lengthMeters: 600, road: "올림픽대로" });
    const b = sum([
      piece(1000, 1300, true),
      piece(1300, 1301 + JAM_MERGE_GAP_M, false),
      piece(1301 + JAM_MERGE_GAP_M, 1600, true),
    ]);
    expect(b?.jams).toEqual([]);
  });

  it("도로 이름은 구간 안에서 가장 긴 이름 있는 도로, 이름이 없으면 null", () => {
    const s = sum([piece(0, 200, true, "잠원로"), piece(200, 800, true, "반포대로"), piece(800, 900, true, null)]);
    expect(s?.jams[0].road).toBe("반포대로");
    expect(sum([piece(0, 900, true, null)])?.jams[0].road).toBeNull();
  });

  it("시작·끝 좌표는 이어 붙인 구간의 첫 조각 시작과 마지막 조각 끝", () => {
    const s = sum([piece(100, 400, true), piece(400, 700, true)]);
    expect(s?.jams[0].start).toEqual(P(37.5, 127 + 100 / 1e6));
    expect(s?.jams[0].end).toEqual(P(37.5, 127 + 700 / 1e6));
  });
});

/** Tmap: 경도 0.001° ≈ 88m(위도 37.5). 한 LineString에 좌표 13개 → 약 1,060m. */
function tmapFixture(traffic: [number, number, number, number][] | undefined, name = "올림픽대로"): TmapCarResponse {
  const coords: [number, number][] = Array.from({ length: 13 }, (_, i) => [127 + i * 0.001, 37.5]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: coords[0] },
        properties: { totalDistance: 1060, totalTime: 120, totalFare: 0, taxiFare: 5000, description: "출발", pointType: "S" },
      },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords, ...(traffic ? { traffic } : {}) },
        properties: { name, distance: 1060 },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: coords[12] },
        properties: { description: "도착", pointType: "E" },
      },
    ],
  };
}

describe("tmapCongestionPieces — 코드표(4·3 정체, 1·2 아님, 0 정보없음)", () => {
  it("traffic은 geometry 안의 [시작index, 끝index, 혼잡도, 속도]이고 길이는 좌표 누적", () => {
    const pieces = tmapCongestionPieces(tmapFixture([[0, 3, 1, 50], [3, 12, 4, 10]]));
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ known: true, jam: false });
    expect(pieces[1]).toMatchObject({ known: true, jam: true, road: "올림픽대로" });
    expect(pieces[1].fromM).toBeCloseTo(pieces[0].toM, 6);
    expect(pieces[1].toM - pieces[1].fromM).toBeGreaterThan(780);
    expect(pieces[1].toM - pieces[1].fromM).toBeLessThan(800);
  });

  it("⚠ 카카오와 숫자 방향이 반대: Tmap 1은 원활이다", () => {
    expect(tmapCongestionPieces(tmapFixture([[0, 12, 1, 60]]))[0].jam).toBe(false);
    expect(tmapCongestionPieces(tmapFixture([[0, 12, 3, 20]]))[0].jam).toBe(true);
    expect(tmapCongestionPieces(tmapFixture([[0, 12, 2, 25]]))[0].jam).toBe(false);
  });

  it("코드 0·범위 밖·잘못된 인덱스는 정보 없음이거나 버린다 → 전부 0이면 null", () => {
    expect(summarizeCongestion(tmapCongestionPieces(tmapFixture([[0, 12, 0, 0]])), 1060)).toBeNull();
    expect(tmapCongestionPieces(tmapFixture([[5, 3, 4, 10], [0, 99, 4, 10]]))).toEqual([]);
    expect(summarizeCongestion(tmapCongestionPieces(tmapFixture(undefined)), 1060)).toBeNull();
  });

  it("\"일반도로\"는 이름이 아니다(null)", () => {
    expect(tmapCongestionPieces(tmapFixture([[0, 12, 4, 10]], "일반도로"))[0].road).toBeNull();
  });
});

function kakaoRoute(roads: { state: number; distance: number; name?: string }[]): KakaoNaviRoute {
  let x = 127;
  return {
    result_code: 0,
    result_msg: "",
    summary: { distance: 1, duration: 1, fare: { taxi: 0, toll: 0 } },
    sections: [
      {
        guides: [{ name: "", guidance: "출발", distance: 0, duration: 0, type: 100 }],
        roads: roads.map((r) => {
          const v = [x, 37.5, x + r.distance / 88000, 37.5];
          x += r.distance / 88000;
          return { name: r.name ?? "강남대로", distance: r.distance, traffic_speed: 10, traffic_state: r.state, vertexes: v };
        }),
      },
    ],
  };
}

describe("kakaoCongestionPieces — 코드표(1·2·6 정체, 3·4 아님, 0 정보 없음)", () => {
  it("⚠ Tmap과 숫자 방향이 반대: 카카오 1이 정체, 4가 원활", () => {
    const p = kakaoCongestionPieces(kakaoRoute([{ state: 1, distance: 300 }, { state: 4, distance: 300 }, { state: 2, distance: 300 }]));
    expect(p.map((x) => x.jam)).toEqual([true, false, true]);
    expect(p[1]).toMatchObject({ fromM: 300, toM: 600 });
  });

  it("6(교통사고·통행 불가)은 정체로 친다(정보 없음으로 접으면 「막히는 곳 없음」의 근거가 된다), 전부 0이면 null", () => {
    expect(kakaoCongestionPieces(kakaoRoute([{ state: 6, distance: 300 }]))[0]).toMatchObject({ known: true, jam: true });
    expect(summarizeCongestion(kakaoCongestionPieces(kakaoRoute([{ state: 0, distance: 900 }])), 900)).toBeNull();
  });

  it("빈 이름은 null", () => {
    expect(kakaoCongestionPieces(kakaoRoute([{ state: 1, distance: 300, name: "" }]))[0].road).toBeNull();
  });
});

describe("옵트인 요청 계약(E80 §2 — 미지정은 요청·응답 byte 불변)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Tmap: traffic 미지정이면 본문에 trafficInfo가 없고 응답에 congestion 키가 없다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(tmapFixture([[0, 12, 4, 10]]))));
    vi.stubGlobal("fetch", fetchMock);
    const plain = await getTmapCarBriefing({ origin: P(37.5, 127), dest: P(37.5, 127.012) });
    expect("congestion" in plain).toBe(false);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("trafficInfo");
    const withTraffic = await getTmapCarBriefing({ origin: P(37.5, 127), dest: P(37.5, 127.012), traffic: true });
    expect(JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).trafficInfo).toBe("Y");
    expect(withTraffic.congestion?.jams).toHaveLength(1);
  });

  it("카카오: traffic 미지정이면 road_details=false, 옵트인이면 true + congestion", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ routes: [kakaoRoute([{ state: 1, distance: 900 }])] })));
    vi.stubGlobal("fetch", fetchMock);
    const plain = await getCarRouteBriefing({ origin: P(37.5, 127), dest: P(37.5, 127.01) });
    expect(String((fetchMock.mock.calls[0] as unknown as [URL])[0])).toContain("road_details=false");
    expect("congestion" in plain).toBe(false);
    const withTraffic = await getCarRouteBriefing({ origin: P(37.5, 127), dest: P(37.5, 127.01), traffic: true });
    expect(String((fetchMock.mock.calls[1] as unknown as [URL])[0])).toContain("road_details=true");
    expect(withTraffic.congestion).toEqual({ jams: [expect.objectContaining({ lengthMeters: 900 })] });
  });
});
