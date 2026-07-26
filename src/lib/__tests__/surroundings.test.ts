import { describe, it, expect, vi, afterEach } from "vitest";
import fixture from "./fixtures/kakao-around.json";

vi.mock("../env", () => ({
  env: { KAKAO_REST_API_KEY: "test-key" },
  hasKakaoKey: () => true,
}));

import {
  normalizeSurroundingDoc,
  rankSurroundings,
  findSurroundingsNear,
} from "../providers/surroundings";

const USER = { lat: 37.5378, lng: 127.1399 };

describe("normalizeSurroundingDoc", () => {
  it("CS2 → convenience, 거리·방위 산출", () => {
    const r = normalizeSurroundingDoc(fixture.convenience[0], USER.lat, USER.lng);
    expect(r).not.toBeNull();
    expect(r!.category).toBe("convenience");
    expect(r!.id).toBe("kakao-1001");
    expect(r!.distanceMeters).toBe(40);
    expect(["n", "ne", "e", "se", "s", "sw", "w", "nw"]).toContain(r!.bearing);
    expect(r!.name).toBe("GS25 길동점");
  });

  it("SW8 → subway", () => {
    const r = normalizeSurroundingDoc(fixture.subway[0], USER.lat, USER.lng);
    expect(r!.category).toBe("subway");
  });

  it("매핑 안 된 group code → null(거짓양성 차단)", () => {
    const unknown = { ...fixture.convenience[0], category_group_code: "ZZ9" };
    expect(normalizeSurroundingDoc(unknown, USER.lat, USER.lng)).toBeNull();
  });

  it("distance 누락 → haversine 폴백(>0)", () => {
    const noDist = { ...fixture.subway[0], distance: undefined };
    const r = normalizeSurroundingDoc(noDist, USER.lat, USER.lng);
    expect(r!.distanceMeters).toBeGreaterThan(0);
  });
});

describe("rankSurroundings", () => {
  it("dedupe(id)·거리순·cap", () => {
    const out = rankSurroundings(
      [fixture.convenience, fixture.subway, fixture.dupOfConvenience],
      USER.lat,
      USER.lng,
      10,
    );
    const ids = out.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // dedupe
    expect(ids).toContain("kakao-2001");
    // 거리 오름차순
    for (let i = 1; i < out.length; i++) {
      expect(out[i].distanceMeters).toBeGreaterThanOrEqual(out[i - 1].distanceMeters);
    }
  });

  it("cap 적용", () => {
    const out = rankSurroundings([fixture.convenience, fixture.subway], USER.lat, USER.lng, 1);
    expect(out).toHaveLength(1);
  });
});

describe("findSurroundingsNear (부분 실패 불변식)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("일부 카테고리 실패해도 나머지 보존", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call % 2 === 0) throw new Error("network");
        return {
          ok: true,
          json: async () => ({ documents: fixture.convenience }),
        } as Response;
      }),
    );
    const out = await findSurroundingsNear(USER.lat, USER.lng);
    expect(out.length).toBeGreaterThan(0);
  });

  it("전부 실패 → throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    await expect(findSurroundingsNear(USER.lat, USER.lng)).rejects.toThrow();
  });

  it("서버 캡 50 — 표시 절단은 클라이언트 몫(V1 동형)", async () => {
    // CS2(편의점) 화이트리스트를 통과하는 60건(고유 id) — 첫 카테고리 호출에 몰아
    // 넣고 나머지 카테고리 호출은 빈 결과.
    const bulk = Array.from({ length: 60 }, (_, i) => ({
      id: `bulk-${i}`,
      place_name: `벌크편의점${i}`,
      category_name: "음식점 > 편의점",
      category_group_code: "CS2",
      x: "127.1399",
      y: "37.5378",
      distance: String(10 + i),
    }));
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        const isFirst = call === 1; // 값 스냅샷 — json() 지연 호출 시 call이 이미 증가해 있음
        return {
          ok: true,
          json: async () => ({ documents: isFirst ? bulk : [] }),
        } as Response;
      }),
    );
    const out = await findSurroundingsNear(USER.lat, USER.lng);
    expect(out.length).toBe(50);
  });

  it("키 없으면 [] (env 재모킹)", async () => {
    vi.resetModules();
    vi.doMock("../env", () => ({
      env: { KAKAO_REST_API_KEY: "" },
      hasKakaoKey: () => false,
    }));
    const mod = await import("../providers/surroundings");
    const out = await mod.findSurroundingsNear(USER.lat, USER.lng);
    expect(out).toEqual([]);
    vi.doUnmock("../env");
  });
});
