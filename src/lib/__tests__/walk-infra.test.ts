import { describe, it, expect, vi, beforeEach } from "vitest";

// 두 provider는 모두 동기 조회다(정적 seed) — walk-infra는 그 결과를 상태 계약으로
// 옮기는 층이라, 여기서는 provider 반환값(값·null·throw) 세 갈래만 주입해 검증한다.
// osm-walk-nodes는 팩토리 모킹이다: 자동 모킹은 실모듈을 한 번 적재하므로 seed JSON
// 로드가 테스트 전제가 되어 버린다(조회 로직·bbox 판정은 provider 자신의 테스트 몫).
vi.mock("../providers/audio-signals");
vi.mock("../providers/osm-walk-nodes", () => ({
  findWalkFeaturesNear: vi.fn(),
}));
vi.mock("../providers/osm-walk-junctions", () => ({ findOsmJunctionsNear: vi.fn() }));
vi.mock("../providers/seoul-walk-network", () => ({ findSeoulWalkNetworkNear: vi.fn() }));

import { getWalkInfrastructure } from "../walk-infra";
import { findAudioSignalsNear } from "../providers/audio-signals";
import type { NearbyAudioSignals } from "../providers/audio-signals";
import { findWalkFeaturesNear } from "../providers/osm-walk-nodes";
import type { RawWalkFeature } from "../providers/osm-walk-nodes";
import { findOsmJunctionsNear } from "../providers/osm-walk-junctions";
import { findSeoulWalkNetworkNear } from "../providers/seoul-walk-network";

const mockAudioSignals = vi.mocked(findAudioSignalsNear);
const mockWalkNodes = vi.mocked(findWalkFeaturesNear);
const mockJunctions = vi.mocked(findOsmJunctionsNear);
const mockSeoul = vi.mocked(findSeoulWalkNetworkNear);

const SAMPLE_AUDIO: NearbyAudioSignals = {
  deviceCount: 3,
  sites: [{ distanceMeters: 45, bearing: "se", deviceCount: 2 }],
  baseDate: "2026-05-28",
};

function rawFeature(overrides: Partial<RawWalkFeature>): RawWalkFeature {
  return {
    osmId: `node/${Math.random()}`,
    lat: 37.5001,
    lng: 127.0001,
    crossing: false,
    crossingSignal: "unknown",
    tactilePaving: false,
    ...overrides,
  };
}

describe("getWalkInfrastructure", () => {
  beforeEach(() => {
    mockAudioSignals.mockReset();
    mockWalkNodes.mockReset();
    mockWalkNodes.mockReturnValue([]);
    mockJunctions.mockReset();
    mockSeoul.mockReset();
  });

  it("両소스 정상 → 両 ok, totalCount는 원본 수·listedCount는 crossing/비-crossing tactile projection 10씩 cap 후 합집합", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    const crossingFeatures = Array.from({ length: 15 }, (_, i) =>
      rawFeature({ osmId: `node/crossing-${i}`, crossing: true, lat: 37.5 + i * 0.0001 }),
    );
    const tactileFeatures = Array.from({ length: 3 }, (_, i) =>
      rawFeature({
        osmId: `node/tactile-${i}`,
        crossing: false,
        tactilePaving: true,
        hostFeature: "busStop",
        lat: 37.5 + i * 0.0002,
      }),
    );
    mockWalkNodes.mockReturnValue([...crossingFeatures, ...tactileFeatures]);

    const result = await getWalkInfrastructure(37.5, 127.0);

    expect(result.audioSignals).toEqual({ status: "ok", data: SAMPLE_AUDIO });
    expect(result.osm.status).toBe("ok");
    if (result.osm.status !== "ok") throw new Error("unreachable");
    expect(result.osm.data.totalCount).toBe(18);
    expect(result.osm.data.listedCount).toBe(13); // crossing 10 + tactile 3
    expect(result.osm.data.truncated).toBe(true);
    expect(result.osm.data.crossingTotal).toBe(15); // cap 전 실개수(잘림)
    expect(result.osm.data.tactileTotal).toBe(3); // cap 전 실개수(안 잘림)
  });

  it("seed 범위 안 0건은 ok(빈 목록) — '이 근처에 없다'는 정상 답이다", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    mockWalkNodes.mockReturnValue([]);

    const result = await getWalkInfrastructure(37.5, 127.0);

    expect(result.osm).toEqual({
      status: "ok",
      data: {
        features: [],
        totalCount: 0,
        listedCount: 0,
        truncated: false,
        crossingTotal: 0,
        tactileTotal: 0,
      },
    });
  });

  it("한국 밖(도쿄) → osm unsupported(outsideKorea), 0건 ok로 위장하지 않는다", async () => {
    // provider는 seed bbox 밖에서 null을 준다(0건 빈 배열과 구분되는 반환값).
    // 그 null이 "0건"으로 뭉개지면 시각장애 사용자는 화면으로 확인할 수 없는 채
    // "이 근처에 횡단보도가 없다"로 듣게 된다 — 3-state 불변식의 핵심 축이다.
    mockAudioSignals.mockReturnValue(null);
    mockWalkNodes.mockReturnValue(null);

    const result = await getWalkInfrastructure(35.68, 139.77);

    expect(result.osm).toEqual({ status: "unsupported", reason: "outsideKorea" });
    expect(result.osm.status).not.toBe("ok");
    expect(result.osm.status).not.toBe("error");
  });

  it("osm provider가 동기 throw → osm error, audioSignals는 ok 유지(부분 실패 보존)", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    mockWalkNodes.mockImplementation(() => {
      throw new Error("seed boom");
    });

    const result = await getWalkInfrastructure(37.5, 127.0);

    expect(result.audioSignals).toEqual({ status: "ok", data: SAMPLE_AUDIO });
    expect(result.osm).toEqual({ status: "error" });
  });

  it("부산(서울 밖) → audioSignals unsupported", async () => {
    mockAudioSignals.mockReturnValue(null);

    const result = await getWalkInfrastructure(35.1796, 129.0756);

    expect(result.audioSignals).toEqual({ status: "unsupported", reason: "outsideSeoul" });
  });

  it("findAudioSignalsNear가 동기 throw해도 audioSignals error로 강등(동기 throw 포착)", async () => {
    mockAudioSignals.mockImplementation(() => {
      throw new Error("sync boom");
    });

    const result = await getWalkInfrastructure(37.5, 127.0);

    expect(result.audioSignals).toEqual({ status: "error" });
  });

  it("한 소스가 미제공이어도 다른 소스는 그대로 산다(강등은 소스별 독립)", async () => {
    mockAudioSignals.mockReturnValue(null); // 서울 밖
    mockWalkNodes.mockReturnValue([rawFeature({ crossing: true, lat: 35.18, lng: 129.076 })]);

    const result = await getWalkInfrastructure(35.1796, 129.0756);

    expect(result.audioSignals).toEqual({ status: "unsupported", reason: "outsideSeoul" });
    expect(result.osm.status).toBe("ok");
  });

  it("좌표 옵트인: 횡단보도 상한이 넓어지고 feature 좌표가 실리며 음향신호기는 좌표 옵션으로 조회(나들이)", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    const crossings = Array.from({ length: 15 }, (_, i) =>
      rawFeature({ osmId: `node/c-${i}`, crossing: true, lat: 37.5 + i * 0.0001, lng: 127.0 }),
    );
    mockWalkNodes.mockReturnValue(crossings);

    const plain = await getWalkInfrastructure(37.5, 127.0);
    expect(plain.osm.status === "ok" && plain.osm.data.features.length).toBe(10);
    expect(mockAudioSignals).toHaveBeenLastCalledWith(37.5, 127.0);

    const withCoords = await getWalkInfrastructure(37.5, 127.0, { coords: true, nodes: false });
    if (withCoords.osm.status !== "ok") throw new Error("osm ok 기대");
    expect(withCoords.osm.data.features.length).toBe(15);
    expect(withCoords.osm.data.truncated).toBe(false);
    expect(withCoords.osm.data.features[0]).toMatchObject({ lat: 37.5, lng: 127.0 });
    expect(mockAudioSignals).toHaveBeenLastCalledWith(37.5, 127.0, 300, { withCoords: true, maxSites: 40 });
  });

  it("노드 옵트인이 아니면 교차점·서울망 키가 없고 두 원천을 부르지 않는다(종전 응답 불변 — 채팅·CLI·스토어 앱)", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    for (const options of [undefined, { coords: true, nodes: false }, { coords: false, nodes: false }]) {
      const result = await getWalkInfrastructure(37.5, 127.0, options);
      expect(Object.keys(result).sort()).toEqual(["audioSignals", "osm"]);
    }
    expect(mockJunctions).not.toHaveBeenCalled();
    expect(mockSeoul).not.toHaveBeenCalled();
  });

  it("노드 옵트인: 원천별 3-state — 범위 밖은 unsupported, throw는 그 원천만 error", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    const junction = { lat: 37.5, lng: 127.0, branches: [{ lat: 37.5002, lng: 127.0, kind: "alley" as const }] };
    mockJunctions.mockResolvedValue([junction]);
    mockSeoul.mockResolvedValue({ crosswalks: [{ lat: 37.5001, lng: 127.0 }], junctions: [] });
    const ok = await getWalkInfrastructure(37.5, 127.0, { coords: true, nodes: true });
    expect(ok.osmJunctions).toEqual({ status: "ok", data: { junctions: [junction] } });
    expect(ok.seoulNetwork).toEqual({ status: "ok", data: { crosswalks: [{ lat: 37.5001, lng: 127.0 }], junctions: [] } });
    expect(mockJunctions).toHaveBeenCalledWith(37.5, 127.0, 300, 150);
    expect(mockSeoul).toHaveBeenCalledWith(37.5, 127.0, 300, { crosswalks: 60, junctions: 150 });

    mockJunctions.mockResolvedValue(null);
    mockSeoul.mockRejectedValue(new Error("seed 깨짐"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const partial = await getWalkInfrastructure(37.5, 127.0, { coords: true, nodes: true });
    expect(partial.osmJunctions).toEqual({ status: "unsupported", reason: "outsideSeed" });
    expect(partial.seoulNetwork).toEqual({ status: "error" });
    expect(partial.osm.status).toBe("ok");
    expect(partial.audioSignals.status).toBe("ok");
  });
});
