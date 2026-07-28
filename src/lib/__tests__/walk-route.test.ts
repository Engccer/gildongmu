import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: vi.fn() }));
vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getKakaoWalkBriefing } from "../providers/kakao-walk";
import { getWalkRouteBriefing } from "../providers/tmap-pedestrian";
import { hasKakaoKey, hasTmapKey } from "../env";
import { annotateAudioSignals, getWalkRoute } from "../walk-route";
import seed from "../data/audio-signals.json";
import type { WalkRouteBriefing } from "../types";

const signals = (seed as unknown as { signals: [number, number][] }).signals;
const [sigLat, sigLng] = signals[0];
// 서울 안·신호기 원거리 점(2026-07-28 seed 실측 최근접 143m — seed 갱신 시 재확인)
const FAR = { lat: 37.53, lng: 126.995 };

function briefing(steps: WalkRouteBriefing["steps"]): WalkRouteBriefing {
  return { distanceMeters: 800, durationSeconds: 700, steps };
}

describe("annotateAudioSignals", () => {
  it("횡단보도 단계 + 40m 내 seed → 문장 끝 쉼표 주석", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "우측 횡단보도 후 11m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("우측 횡단보도 후 11m 이동, 음향신호기 있음");
  });

  it("횡단보도 단계지만 40m 밖 → 무주석(positive-only)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "횡단보도 후 20m 이동", coord: FAR }]),
    );
    expect(out.steps[0].description).toBe("횡단보도 후 20m 이동");
  });

  it("비횡단보도 단계는 seed 인접이어도 무주석(실측 오탐 클래스)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "직진 후 양재대로를 따라 2m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("직진 후 양재대로를 따라 2m 이동");
  });

  it("coord 없는 단계는 무주석", () => {
    const out = annotateAudioSignals(briefing([{ description: "횡단보도 후 이동" }]));
    expect(out.steps[0].description).toBe("횡단보도 후 이동");
  });

  it("모든 단계에서 coord를 제거한다(주석 여부 무관 — API 응답 노출 금지)", () => {
    const out = annotateAudioSignals(
      briefing([
        { description: "횡단보도 후 이동", coord: { lat: sigLat, lng: sigLng } },
        { description: "직진", coord: FAR },
      ]),
    );
    for (const s of out.steps) expect("coord" in s).toBe(false);
  });

  it("총 거리·시간은 그대로 통과한다", () => {
    const out = annotateAudioSignals(briefing([{ description: "직진" }]));
    expect(out.distanceMeters).toBe(800);
    expect(out.durationSeconds).toBe(700);
  });
});

describe("annotateAudioSignals 카카오 스텝(pathCoords)", () => {
  it("횡단보도 스텝은 pathCoords 후보점 중 하나라도 40m 내면 주석(첫 점이 멀어도 매칭)", () => {
    const out = annotateAudioSignals(
      briefing([
        {
          description: "횡단보도 후 좌회전",
          pathCoords: [FAR, { lat: sigLat, lng: sigLng }],
        },
      ]),
    );
    expect(out.steps[0].description).toBe("횡단보도 후 좌회전, 음향신호기 있음");
  });

  it("수량 표현 병합 스텝('2개의 횡단보도 이용')은 seed가 가까워도 무주석", () => {
    const out = annotateAudioSignals(
      briefing([
        {
          description: "2개의 횡단보도 이용",
          pathCoords: [{ lat: sigLat, lng: sigLng }],
        },
      ]),
    );
    expect(out.steps[0].description).toBe("2개의 횡단보도 이용");
  });

  it("Tmap 단일 coord 스텝 기존 동작 회귀 0(coord 1원소 취급)", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "우측 횡단보도 후 11m 이동", coord: { lat: sigLat, lng: sigLng } }]),
    );
    expect(out.steps[0].description).toBe("우측 횡단보도 후 11m 이동, 음향신호기 있음");
  });

  it("주석 후 coord·pathCoords 모두 제거된다", () => {
    const out = annotateAudioSignals(
      briefing([
        { description: "횡단보도 후 이동", pathCoords: [{ lat: sigLat, lng: sigLng }] },
      ]),
    );
    expect("coord" in out.steps[0]).toBe(false);
    expect("pathCoords" in out.steps[0]).toBe(false);
  });
});

const ORIGIN = { lat: 37.5385, lng: 127.1455 };
const DEST = { lat: 37.54, lng: 127.15 };
const KAKAO_BRIEFING = {
  distanceMeters: 1000,
  durationSeconds: 900,
  steps: [{ description: "강동역 2번 출구까지 역사 내 이동" }],
};
const TMAP_BRIEFING = {
  distanceMeters: 1100,
  durationSeconds: 950,
  steps: [{ description: "보행자도로를 따라 100m 이동" }],
};

beforeEach(() => {
  vi.mocked(getKakaoWalkBriefing).mockReset().mockResolvedValue(KAKAO_BRIEFING);
  vi.mocked(getWalkRouteBriefing).mockReset().mockResolvedValue(TMAP_BRIEFING);
  vi.mocked(hasKakaoKey).mockReturnValue(true);
  vi.mocked(hasTmapKey).mockReturnValue(true);
});

describe("getWalkRoute provider 선택·폴백", () => {
  it("카카오 키가 있으면 카카오가 기본이다", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r?.steps[0].description).toContain("역사 내 이동");
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
  });

  it("카카오 throw 시에만 Tmap 폴백한다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("HTTP 500"));
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r?.steps[0].description).toContain("보행자도로");
  });

  it("카카오가 정상 판정한 경로 없음(null)은 폴백 없이 null", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(null);
    expect(await getWalkRoute({ origin: ORIGIN, dest: DEST })).toBeNull();
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
  });

  it("카카오 키 없으면 Tmap 단독(현행 동작)", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r?.steps[0].description).toContain("보행자도로");
    expect(getKakaoWalkBriefing).not.toHaveBeenCalled();
  });

  it("둘 다 throw면 throw(502 전파)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(getWalkRouteBriefing).mockRejectedValue(new Error("tmap down"));
    await expect(getWalkRoute({ origin: ORIGIN, dest: DEST })).rejects.toThrow();
  });

  it("카카오 throw + Tmap 키 없음이면 throw", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(hasTmapKey).mockReturnValue(false);
    await expect(getWalkRoute({ origin: ORIGIN, dest: DEST })).rejects.toThrow();
  });
});

describe("getWalkRoute 계단 회피(stepFree)", () => {
  it("ACCESSIBLE 성공(계단 문구 없음)은 applied — accessible 플래그가 provider에 전달된다", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(vi.mocked(getKakaoWalkBriefing).mock.calls[0][0].accessible).toBe(true);
    expect(r?.stepFree).toBe("applied");
    expect(r?.steps[0].description).toContain("역사 내 이동"); // 안내 문장 미삽입
  });

  it("ACCESSIBLE 응답에 계단 guidance가 있으면 applied 금지(fail-closed)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue({
      ...KAKAO_BRIEFING,
      steps: [{ description: "호텔마누 앞에서 계단이용" }],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.steps[0].description).toContain("계단 없는 경로를 찾지 못해");
  });

  it("ACCESSIBLE 경로 없음이면 기본 모드 재호출 + no_stepfree_route + 안내 문장 삽입", async () => {
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null) // ACCESSIBLE 호출
      .mockResolvedValueOnce(KAKAO_BRIEFING); // 기본 재호출
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.steps[0].description).toContain("계단 없는 경로를 찾지 못해");
    expect(r?.steps[1].description).toContain("역사 내 이동");
  });

  it("카카오 throw면 Tmap 폴백 + unavailable + 안내 문장", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("down"));
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("unavailable");
    expect(r?.steps[0].description).toContain("계단 회피 경로를 조회하지 못했습니다");
  });

  it("Tmap 단독 배포에 accessible 요청이면 unavailable", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("unavailable");
  });

  it("기본 모드마저 경로 없음이면 null", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(null);
    expect(await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true })).toBeNull();
  });

  it("accessible 미요청이면 stepFree 필드 자체가 없다(기존 응답 byte-호환)", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(r && "stepFree" in r).toBe(false);
  });
});
