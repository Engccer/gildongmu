import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/walk-infra", () => ({
  getWalkInfrastructure: vi.fn(),
}));

import { availableDeclarations } from "../declarations";
import { executeFunction } from "../router";
import { getWalkInfrastructure } from "@/lib/walk-infra";
import type { WalkInfrastructure } from "@/lib/walk-infra";

const mockGetWalkInfrastructure = vi.mocked(getWalkInfrastructure);

const ctxKo = { locale: "ko", dataLocale: "ko" as const, userLocation: { lat: 37.5, lng: 127.1 } };
const ctxPlace = {
  locale: "ko",
  dataLocale: "ko" as const,
  userLocation: { lat: 1, lng: 1 },
  placeAnchor: { lat: 37.58, lng: 126.97, name: "경복궁" },
};
const ctxNoLoc = { locale: "ko", dataLocale: "ko" as const };

const BOTH_OK: WalkInfrastructure = {
  audioSignals: {
    status: "ok",
    data: { deviceCount: 3, sites: [{ distanceMeters: 45, bearing: "se", deviceCount: 2 }], baseDate: "2026-05-28" },
  },
  osm: {
    status: "ok",
    data: {
      features: [
        {
          osmId: "node/1",
          lat: 37.5,
          lng: 127.1,
          crossing: true,
          crossingSignal: "yes",
          tactilePaving: false,
          distanceMeters: 30,
          bearing: "s",
        },
      ],
      totalCount: 1,
      listedCount: 1,
      truncated: false,
    },
  },
};

describe("get_walk_infrastructure 선언 노출", () => {
  it("게이트 없음, 키가 전부 없어도 항상 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined);
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    expect(availableDeclarations().some((d) => d.name === "get_walk_infrastructure")).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("executeFunction get_walk_infrastructure", () => {
  beforeEach(() => {
    mockGetWalkInfrastructure.mockReset();
  });

  it("両 소스 정상: data가 WalkInfrastructure 그대로, source는 両소스(seoulopen+osm), render 없음", async () => {
    mockGetWalkInfrastructure.mockResolvedValue(BOTH_OK);
    const result = await executeFunction("get_walk_infrastructure", {}, ctxKo);
    expect(mockGetWalkInfrastructure).toHaveBeenCalledWith(37.5, 127.1);
    expect(result.data).toEqual(BOTH_OK);
    expect(result.render).toBeUndefined();
    expect(result.source).toEqual([{ label: "source.seoulopen" }, { label: "source.osm" }]);
  });

  it("placeAnchor 있으면 장소 좌표 기준(anchorOf 규칙)", async () => {
    mockGetWalkInfrastructure.mockResolvedValue(BOTH_OK);
    await executeFunction("get_walk_infrastructure", {}, ctxPlace);
    expect(mockGetWalkInfrastructure).toHaveBeenCalledWith(37.58, 126.97);
  });

  it("음향신호기만 실패(error)해도 osm은 유지 - source는 osm만", async () => {
    mockGetWalkInfrastructure.mockResolvedValue({
      audioSignals: { status: "error" },
      osm: BOTH_OK.osm,
    });
    const result = await executeFunction("get_walk_infrastructure", {}, ctxKo);
    expect(result.source).toEqual([{ label: "source.osm" }]);
  });

  it("osm만 실패해도 음향신호기는 유지 - source는 seoulopen만", async () => {
    mockGetWalkInfrastructure.mockResolvedValue({
      audioSignals: BOTH_OK.audioSignals,
      osm: { status: "error" },
    });
    const result = await executeFunction("get_walk_infrastructure", {}, ctxKo);
    expect(result.source).toEqual([{ label: "source.seoulopen" }]);
  });

  it("両 소스 실패면 source 미포함(undefined)", async () => {
    mockGetWalkInfrastructure.mockResolvedValue({
      audioSignals: { status: "error" },
      osm: { status: "error" },
    });
    const result = await executeFunction("get_walk_infrastructure", {}, ctxKo);
    expect(result.source).toBeUndefined();
  });

  it("서울 밖(unsupported)이어도 source는 osm만(성공 소스만 인용)", async () => {
    mockGetWalkInfrastructure.mockResolvedValue({
      audioSignals: { status: "unsupported", reason: "outsideSeoul" },
      osm: BOTH_OK.osm,
    });
    const result = await executeFunction("get_walk_infrastructure", {}, ctxKo);
    expect(result.source).toEqual([{ label: "source.osm" }]);
  });

  it("위치 없으면 data.error, 서비스 미호출", async () => {
    const result = await executeFunction("get_walk_infrastructure", {}, ctxNoLoc);
    expect(result.data).toEqual({ error: "현재 위치를 알 수 없습니다." });
    expect(mockGetWalkInfrastructure).not.toHaveBeenCalled();
  });
});
