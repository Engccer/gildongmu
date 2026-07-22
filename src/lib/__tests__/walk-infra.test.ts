import { describe, it, expect, vi, beforeEach } from "vitest";

// unstable_cache는 Next 런타임 밖(vitest node 환경)에서 incrementalCache 부재로
// throw한다(실측). 캐시 키·revalidate는 무시하고 즉시 호출하는 passthrough로 대체.
// single-flight·전역 카운터는 walk-infra.ts 자체 로직(모듈 스코프 Map·카운터)이라
// 이 passthrough로도 검증 가능하다.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}));

vi.mock("../providers/audio-signals");
vi.mock("../providers/overpass");

import { getWalkInfrastructure, __resetWalkInfraForTest } from "../walk-infra";
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
});
