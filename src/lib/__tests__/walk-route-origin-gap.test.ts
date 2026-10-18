import { beforeEach, describe, expect, it, vi } from "vitest";

// A70 spec 2026-10-19 §1 — 출발점 재시도(카카오 첫 점이 30m 밖이면 Tmap 한 번 더)와 기하 응답 `originGapM`.
vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: vi.fn() }));
vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getKakaoWalkBriefing } from "../providers/kakao-walk";
import { getWalkRouteBriefing } from "../providers/tmap-pedestrian";
import { hasTmapKey } from "../env";
import { getWalkRoute, getWalkRouteLines, ORIGIN_GAP_RETRY_M, ORIGIN_RETRY_TIMEOUT_MS } from "../walk-route";
import type { Coord, WalkRouteBriefing } from "../types";

// 합성 좌표(공개 저장소 규율 — 실보행 좌표가 아니다).
const ORIGIN = { lat: 37.5, lng: 127.1 };
const DEST = { lat: 37.503, lng: 127.1 };
const north = (m: number): Coord => ({ lat: ORIGIN.lat + m / 111320, lng: ORIGIN.lng });

/** 첫 점이 출발점에서 북쪽 `gap` m인 한 스텝 경로. 문장은 provider별 원문 꼴. */
function startingAt(gap: number, description: string): WalkRouteBriefing {
  return {
    distanceMeters: 300,
    durationSeconds: 250,
    steps: [{ description, distanceMeters: 300, pathCoords: [north(gap), north(gap + 300)] }],
  };
}
const KAKAO = "직진 후 보행자도로를 따라 300m 이동";
const TMAP = "보행자도로를 따라 300m 이동";

const geo = (extra: Partial<Parameters<typeof getWalkRoute>[0]> = {}) =>
  getWalkRoute({ text: { wording: 1 }, lang: "ko", origin: ORIGIN, dest: DEST, includeGeometry: true, ...extra });

beforeEach(() => {
  vi.mocked(getKakaoWalkBriefing).mockReset();
  vi.mocked(getWalkRouteBriefing).mockReset();
  vi.mocked(hasTmapKey).mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("출발점 재시도(A70 §1.2)", () => {
  it("문턱은 30m — 앱 도보 채택 문턱(rerouteMaxDriftM)과 같다", () => {
    expect(ORIGIN_GAP_RETRY_M).toBe(30);
  });

  it("① 카카오 첫 점이 30m 안이면 재시도하지 않고 originGapM도 없다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(30, KAKAO));
    const r = await geo();
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
    expect(r && "originGapM" in r).toBe(false);
    expect(r?.kind).toBe("broad");
  });

  it("② 카카오가 237m, Tmap이 8m면 Tmap 경로를 쓰고 필드는 없다(줄 종류도 Tmap의 것)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(237, KAKAO));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(startingAt(8, TMAP));
    const r = await geo();
    expect(getWalkRouteBriefing).toHaveBeenCalledTimes(1);
    expect(r?.steps[0].pathCoords?.[0]).toEqual(north(8));
    expect(r && "originGapM" in r).toBe(false);
    expect(r?.kind).toBe("recommended");
  });

  it("③ 둘 다 멀면 가까운 쪽을 쓰고 originGapM에 그 거리(정수)를 싣는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(74, KAKAO));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(startingAt(120, TMAP));
    const r = await geo();
    expect(r?.steps[0].pathCoords?.[0]).toEqual(north(74));
    expect(r?.originGapM).toBe(74);
    expect(r?.kind).toBe("broad");
  });

  it("③-b 동률이면 카카오(기본 provider)다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(50, KAKAO));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(startingAt(50, TMAP));
    const r = await geo();
    expect(r?.kind).toBe("broad");
    expect(r?.originGapM).toBe(50);
  });

  it("④ Tmap 재시도가 throw·null이면 카카오 결과 그대로 + 필드(재시도는 새 실패 경로가 아니다)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(90, KAKAO));
    vi.mocked(getWalkRouteBriefing).mockRejectedValueOnce(new Error("tmap down"));
    const a = await geo();
    expect(a?.kind).toBe("broad");
    expect(a?.originGapM).toBe(90);
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce(null);
    const b = await geo();
    expect(b?.kind).toBe("broad");
    expect(b?.originGapM).toBe(90);
  });

  it("④-b 재시도는 상한(4초) 안에서만 기다린다 — hang이면 abort되어 카카오 + 필드(구현 리뷰 M2)", async () => {
    expect(ORIGIN_RETRY_TIMEOUT_MS).toBe(4_000);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(90, KAKAO));
    // 응답하지 않는 Tmap: 신호가 끊기면 그때만 실패한다.
    vi.mocked(getWalkRouteBriefing).mockImplementation(
      (p) =>
        new Promise((_, reject) => {
          if (p.signal?.aborted) reject(new Error("aborted"));
          p.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const r = await geo();
    expect(timeout).toHaveBeenCalledWith(ORIGIN_RETRY_TIMEOUT_MS);
    expect(r?.kind).toBe("broad");
    expect(r?.originGapM).toBe(90);
    timeout.mockRestore();
  });

  it("⑤ 브리핑 응답(기하 없음)은 재시도하지 않고 바이트 동일(필드 없음)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(237, KAKAO));
    const r = await getWalkRoute({ text: { wording: 1 }, lang: "ko", origin: ORIGIN, dest: DEST });
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
    expect(r && "originGapM" in r).toBe(false);
    expect(r && "kind" in r).toBe(false);
  });

  it("⑤-b 조회 화면 줄 목록도 재시도하지 않는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(237, KAKAO));
    const { lines } = await getWalkRouteLines({ origin: ORIGIN, dest: DEST, lang: "ko", version: 2, text: { wording: 1 } });
    expect(lines.length).toBeGreaterThan(0);
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
  });

  it("⑥ 계단 회피는 재시도하지 않는다(Tmap엔 동등 모드가 없다) — 거리만 싣는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(80, KAKAO));
    const r = await geo({ accessible: true });
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
    expect(r?.stepFree).toBe("applied");
    expect(r?.originGapM).toBe(80);
  });

  it("⑥-b 최단 축도 재시도한다(Tmap 최단 searchOption 10)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(100, KAKAO));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(startingAt(5, TMAP));
    const r = await geo({ variant: "shortest" });
    expect(vi.mocked(getWalkRouteBriefing).mock.calls[0][0]).toMatchObject({ searchOption: "10" });
    expect(r?.steps[0].pathCoords?.[0]).toEqual(north(5));
    expect(r?.kind).toBe("shortest");
  });

  it("⑦ en(Tmap 단독)은 재시도하지 않고 거리 규칙만", async () => {
    const en = startingAt(60, TMAP);
    en.steps[0] = { ...en.steps[0], turnType: 11 };
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(en);
    const r = await geo({ lang: "en" });
    expect(getWalkRouteBriefing).toHaveBeenCalledTimes(1);
    expect(getKakaoWalkBriefing).not.toHaveBeenCalled();
    expect(r?.originGapM).toBe(60);
  });

  it("⑦-b Tmap 키가 없으면 재시도 없이 거리만", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(70, KAKAO));
    const r = await geo();
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
    expect(r?.originGapM).toBe(70);
  });

  it("⑧ 카카오 실패 → Tmap 폴백 응답은 이미 다른 provider가 답했다 — 재시도 없이 거리만", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(startingAt(45, TMAP));
    const r = await geo();
    expect(getWalkRouteBriefing).toHaveBeenCalledTimes(1);
    expect(r?.originGapM).toBe(45);
  });

  it("재시도 로그는 좌표 없이 거리만 남긴다(출발점이 곧 사용자 위치다)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(startingAt(237, KAKAO));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(startingAt(8, TMAP));
    vi.mocked(console.warn).mockClear();
    await geo();
    const logged = vi.mocked(console.warn).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("kakao=237m tmap=8m 선택=tmap");
    expect(logged).not.toMatch(/37\.5|127\.1/);
  });
});
