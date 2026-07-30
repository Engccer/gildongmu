import { describe, it, expect, vi, beforeEach } from "vitest";

// walk-infra는 Next 비의존(이식성 규칙) — 캐시는 configureWalkInfraTileCache로
// 주입한다. 미구성 시 기본 경로는 캐시 없이 fetcher를 직접 호출(대부분의 테스트가
// 이 경로를 쓴다). 주입 경로는 아래 전용 테스트에서 별도 검증.
vi.mock("../providers/audio-signals");
vi.mock("../providers/overpass");

import { getWalkInfrastructure, __resetWalkInfraForTest, configureWalkInfraTileCache } from "../walk-infra";
import { findAudioSignalsNear } from "../providers/audio-signals";
import type { NearbyAudioSignals } from "../providers/audio-signals";
import { fetchWalkFeaturesTile } from "../providers/overpass";
import type { RawWalkFeature } from "../providers/overpass";

const mockAudioSignals = vi.mocked(findAudioSignalsNear);
const mockOverpass = vi.mocked(fetchWalkFeaturesTile);

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
    __resetWalkInfraForTest();
    mockAudioSignals.mockReset();
    mockOverpass.mockReset();
    mockOverpass.mockResolvedValue([]);
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
    mockOverpass.mockResolvedValue([...crossingFeatures, ...tactileFeatures]);

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

  it("overpass reject → osm error, audioSignals는 ok 유지(부분 실패 보존)", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    mockOverpass.mockRejectedValue(new Error("overpass down"));

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

  it("같은 타일 두 좌표는 overpass fetch 1회(single-flight)로 묶이고, distanceMeters는 실좌표별로 다르게 재계산된다", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    mockOverpass.mockResolvedValue([rawFeature({ crossing: true, lat: 37.501, lng: 127.001 })]);

    const [r1, r2] = await Promise.all([
      getWalkInfrastructure(37.5, 127.0),
      getWalkInfrastructure(37.5004, 127.0004), // toFixed(3)로 같은 타일("37.500:127.000")
    ]);

    expect(mockOverpass).toHaveBeenCalledTimes(1);
    if (r1.osm.status !== "ok" || r2.osm.status !== "ok") throw new Error("unreachable");
    expect(r1.osm.data.features[0].distanceMeters).not.toBe(r2.osm.data.features[0].distanceMeters);
  });

  it("전역 카운터 30 초과 시 osm error", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);

    for (let i = 0; i < 30; i++) {
      const result = await getWalkInfrastructure(37 + i * 0.01, 127.0);
      expect(result.osm.status).toBe("ok");
    }
    const overflow = await getWalkInfrastructure(37 + 30 * 0.01, 127.0);
    expect(overflow.osm.status).toBe("error");
  });

  it("configureWalkInfraTileCache로 주입된 래퍼가 타일 키와 fetcher로 호출되고 결과가 그대로 반영된다", async () => {
    mockAudioSignals.mockReturnValue(SAMPLE_AUDIO);
    mockOverpass.mockResolvedValue([rawFeature({ crossing: true })]);

    const wrapper = vi.fn((fetcher: () => Promise<unknown>) => fetcher());
    configureWalkInfraTileCache(wrapper as never);

    const result = await getWalkInfrastructure(37.5, 127.0);

    expect(wrapper).toHaveBeenCalledTimes(1);
    expect(wrapper).toHaveBeenCalledWith(expect.any(Function), "walk-tile:37.500:127.000");
    expect(result.osm.status).toBe("ok");
  });
});
