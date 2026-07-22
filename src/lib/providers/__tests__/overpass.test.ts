import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeOverpassElements, fetchWalkFeaturesTile } from "../overpass";

describe("normalizeOverpassElements", () => {
  it("crossing=traffic_signals → crossing:true, crossingSignal:yes", () => {
    const result = normalizeOverpassElements([
      { type: "node", id: 1, lat: 37.5, lon: 127.1, tags: { highway: "crossing", crossing: "traffic_signals" } },
    ]);
    expect(result).toEqual([
      { osmId: "node/1", lat: 37.5, lng: 127.1, crossing: true, crossingSignal: "yes", tactilePaving: false, hostFeature: undefined },
    ]);
  });

  it("crossing=uncontrolled → no, crossing=zebra(표 밖) → unknown, 태그 없음 → unknown", () => {
    const [uncontrolled, zebra, untagged] = normalizeOverpassElements([
      { type: "node", id: 2, lat: 37.5, lon: 127.1, tags: { highway: "crossing", crossing: "uncontrolled" } },
      { type: "node", id: 3, lat: 37.5, lon: 127.1, tags: { highway: "crossing", crossing: "zebra" } },
      { type: "node", id: 4, lat: 37.5, lon: 127.1, tags: { highway: "crossing" } },
    ]);
    expect(uncontrolled.crossingSignal).toBe("no");
    expect(zebra.crossingSignal).toBe("unknown");
    expect(untagged.crossingSignal).toBe("unknown");
  });

  it("crossing+tactile_paving 동시 태그 → 항목 1개, 両플래그 true", () => {
    const result = normalizeOverpassElements([
      {
        type: "node",
        id: 5,
        lat: 37.5,
        lon: 127.1,
        tags: { highway: "crossing", crossing: "traffic_signals", tactile_paving: "yes" },
      },
    ]);
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ crossing: true, crossingSignal: "yes", tactilePaving: true });
  });

  it("같은 id 중복 요소는 dedup(1건으로 병합)", () => {
    const node = { type: "node", id: 6, lat: 37.5, lon: 127.1, tags: { highway: "crossing", crossing: "traffic_signals" } };
    const result = normalizeOverpassElements([node, { ...node }]);
    expect(result.length).toBe(1);
    expect(result[0].osmId).toBe("node/6");
  });

  it("tactile 버스정류장 → hostFeature:busStop, 지하철 출입구 → subwayEntrance", () => {
    const [busStop, subwayEntrance] = normalizeOverpassElements([
      { type: "node", id: 7, lat: 37.5, lon: 127.1, tags: { highway: "bus_stop", tactile_paving: "yes" } },
      { type: "node", id: 8, lat: 37.5, lon: 127.1, tags: { railway: "subway_entrance", tactile_paving: "yes" } },
    ]);
    expect(busStop.crossing).toBe(false);
    expect(busStop.hostFeature).toBe("busStop");
    expect(subwayEntrance.hostFeature).toBe("subwayEntrance");
  });
});

describe("fetchWalkFeaturesTile", () => {
  afterEach(() => vi.unstubAllGlobals());

  function ok(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }

  it("remark 필드가 있으면 200이어도 throw(부분 응답 위장 차단)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ remark: "runtime timeout", elements: [] })));
    await expect(fetchWalkFeaturesTile(37.5, 127.1, 400)).rejects.toThrow();
  });

  it("elements가 배열이 아니면 throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ elements: "not-an-array" })));
    await expect(fetchWalkFeaturesTile(37.5, 127.1, 400)).rejects.toThrow();
  });

  it("비200 응답은 throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response),
    );
    await expect(fetchWalkFeaturesTile(37.5, 127.1, 400)).rejects.toThrow();
  });

  it("정상 응답은 정규화 결과를 반환하고 User-Agent·POST body를 포함한다", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      ok({
        elements: [
          { type: "node", id: 9, lat: 37.5, lon: 127.1, tags: { highway: "crossing", crossing: "traffic_signals" } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchWalkFeaturesTile(37.5, 127.1, 400);
    expect(result).toEqual([
      { osmId: "node/9", lat: 37.5, lng: 127.1, crossing: true, crossingSignal: "yes", tactilePaving: false, hostFeature: undefined },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://overpass-api.de/api/interpreter");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("gildongmu/1.0 (+https://gildongmu.vercel.app)");
    expect(String(init.body)).toContain("data=");
  });
});
