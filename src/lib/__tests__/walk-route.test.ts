import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/kakao-walk", () => ({ getKakaoWalkBriefing: vi.fn() }));
vi.mock("../providers/tmap-pedestrian", () => ({ getWalkRouteBriefing: vi.fn() }));
vi.mock("../env", () => ({ hasKakaoKey: vi.fn(() => true), hasTmapKey: vi.fn(() => true) }));

import { getKakaoWalkBriefing } from "../providers/kakao-walk";
import { getWalkRouteBriefing } from "../providers/tmap-pedestrian";
import { hasKakaoKey, hasTmapKey } from "../env";
import {
  annotateAudioSignals,
  annotateCrosswalkInfo,
  getWalkRoute,
  getWalkRouteAlternatives,
} from "../walk-route";
import { rewriteWalkBriefing } from "../walk-guidance";
import { walkStepAction } from "../walk-action";
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

  it("재작성본('횡단보도 2개 이용')도 병합 스텝이라 seed가 가까워도 무주석", () => {
    // 서비스 파이프라인은 재작성 → 주석 순서라 병합 게이트가 **재작성된 문장**을
    // 본다. 원문형("2개의")만 보던 정규식이 그대로였다면 이 게이트가 조용히
    // 열려 신호기 없는 횡단보도에 "있음"이 붙었다(침묵보다 나쁜 거짓 안전 정보).
    const out = annotateAudioSignals(
      rewriteWalkBriefing(
        briefing([
          {
            description: "길동사거리에서 2개의 횡단보도 이용",
            distanceMeters: 58,
            pathCoords: [{ lat: sigLat, lng: sigLng }],
          },
        ]),
        false,
      ),
    );
    expect(out.steps[0].description).toBe("길동사거리에서 횡단보도 2개를 건너세요, 횡단보도 길이 58m");
  });

  it("재작성된 단수 횡단보도에는 주석이 문장 끝에 붙는다", () => {
    const out = annotateAudioSignals(
      rewriteWalkBriefing(
        briefing([
          {
            description: "길동사거리앞교차로에서 횡단보도 이용",
            distanceMeters: 13,
            pathCoords: [{ lat: sigLat, lng: sigLng }],
          },
        ]),
        false,
      ),
    );
    expect(out.steps[0].description).toBe(
      "길동사거리앞교차로에서 횡단보도를 건너세요, 횡단보도 길이 13m, 음향신호기 있음",
    );
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

/**
 * 모든 스텝이 pathCoords를 갖는 브리핑(기하 소비자 fixture).
 * ⚠ 기하 없는 fixture를 쓰면 "모든 스텝이 기하를 갖는다" 단언이 자명하게 거짓이
 * 되어 테스트가 구현을 검증하지 못한다.
 */
function briefingWithGeometry(n: number): WalkRouteBriefing {
  return {
    distanceMeters: 1000,
    durationSeconds: 900,
    steps: Array.from({ length: n }, (_, i) => ({
      description: `${(i + 1) * 10}m 이동`,
      pathCoords: [
        { lat: 37.5 + i * 0.001, lng: 127.1 },
        { lat: 37.5 + i * 0.001 + 0.0005, lng: 127.1 },
      ],
    })),
  };
}

/** description에 "계단"이 남은 브리핑(ACCESSIBLE 응답의 fail-closed 강등 fixture). */
function briefingWithStairs(): WalkRouteBriefing {
  return {
    distanceMeters: 1000,
    durationSeconds: 900,
    steps: [{ description: "호텔마누 앞에서 계단이용" }],
  };
}

beforeEach(() => {
  vi.mocked(getKakaoWalkBriefing).mockReset().mockResolvedValue(KAKAO_BRIEFING);
  vi.mocked(getWalkRouteBriefing).mockReset().mockResolvedValue(TMAP_BRIEFING);
  vi.mocked(hasKakaoKey).mockReturnValue(true);
  vi.mocked(hasTmapKey).mockReturnValue(true);
});

describe("getWalkRoute 파이프라인 순서(재작성 → 주석)", () => {
  // ⚠ 이 스위트가 없으면 순서를 뒤집어도 전량 green이다(변이 주입 실측 2026-08-07).
  // 두 단계를 테스트가 직접 조합해 호출하면 순서를 테스트가 정해 버리므로,
  // 계약은 반드시 getWalkRoute를 통과해서 검증한다.
  it("재작성된 문장 끝에 신호기 주석이 붙는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 280,
      steps: [
        {
          description: "길동사거리앞교차로에서 횡단보도 이용",
          distanceMeters: 13,
          pathCoords: [{ lat: sigLat, lng: sigLng }],
        },
      ],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    // 순서가 뒤집히면 주석이 먼저 붙어 재작성 정규식의 `$` 앵커가 깨지고,
    // 그 스텝만 조용히 원문("…에서 횡단보도 이용, 음향신호기 있음")으로 남는다.
    expect(r?.steps[0].description).toBe(
      "길동사거리앞교차로에서 횡단보도를 건너세요, 횡단보도 길이 13m, 음향신호기 있음",
    );
  });

  it("계단 회피 안전 문장은 재작성을 거치지 않는다", async () => {
    // 무계단 경로 부재 → 기본 모드 재호출 경로. 안전 문장은 annotate 뒤에
    // 삽입되므로 재작성 대상이 아니고, 설령 통과해도 어미가 달라 원문 보존된다.
    vi.mocked(getKakaoWalkBriefing).mockResolvedValueOnce(null);
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.steps[0].description).toBe(
      "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.",
    );
  });
});

/** 동작구 서달로 횡단보도 실호출 폴리라인(2026-08-23) — seed 매칭 3차로 13.5m. */
const SEODAL_PATH = [
  { lat: 37.50756321, lng: 126.96171111 },
  { lat: 37.50739593, lng: 126.96159665 },
];
/** 길동(seed 없음) 구간. */
const GILDONG_PATH = [
  { lat: 37.5385, lng: 127.143 },
  { lat: 37.5387, lng: 127.143 },
];

describe("annotateCrosswalkInfo (E8 차로 수·도로 폭)", () => {
  it("단일 횡단보도 스텝 + seed 매칭 → 문장 끝에 ', N차로, 도로 폭 Mm'", () => {
    const out = annotateCrosswalkInfo(
      briefing([{ description: "횡단보도를 건너세요, 횡단보도 길이 21m", pathCoords: SEODAL_PATH }]),
      false,
      "kakao",
    );
    expect(out.steps[0].description).toBe("횡단보도를 건너세요, 횡단보도 길이 21m, 3차로, 도로 폭 14m");
  });

  it("seed가 없는 곳(길동)은 침묵 — '정보 없음'도 말하지 않는다", () => {
    const out = annotateCrosswalkInfo(
      briefing([{ description: "횡단보도를 건너세요, 횡단보도 길이 11m", pathCoords: GILDONG_PATH }]),
      false,
      "kakao",
    );
    expect(out.steps[0].description).toBe("횡단보도를 건너세요, 횡단보도 길이 11m");
  });

  it("병합 스텝(원문형·재작성형)은 seed가 매칭돼도 침묵", () => {
    for (const d of ["2개의 횡단보도 이용", "횡단보도 2개를 건너세요, 횡단보도 길이 58m"]) {
      const out = annotateCrosswalkInfo(briefing([{ description: d, pathCoords: SEODAL_PATH }]), false, "kakao");
      expect(out.steps[0].description).toBe(d);
    }
  });

  it("비횡단보도 스텝은 seed 인접이어도 침묵", () => {
    const out = annotateCrosswalkInfo(
      briefing([{ description: "서달로를 따라 21m 이동", pathCoords: SEODAL_PATH }]),
      false,
      "kakao",
    );
    expect(out.steps[0].description).toBe("서달로를 따라 21m 이동");
  });

  it("Tmap은 provider 게이트로 침묵 — 단일 coord도, 기하 요청의 2점 LineString도", () => {
    const single = annotateCrosswalkInfo(
      briefing([{ description: "우측 횡단보도 후 11m 이동", coord: SEODAL_PATH[0] }]),
      false,
      "tmap",
    );
    expect(single.steps[0].description).toBe("우측 횡단보도 후 11m 이동");
    // 같은 폴리라인이 카카오면 붙는다 — 게이트가 provider 축임을 확정.
    const line = briefing([{ description: "우측 횡단보도 진입", pathCoords: SEODAL_PATH }]);
    expect(annotateCrosswalkInfo(line, false, "tmap").steps[0].description).toBe("우측 횡단보도 진입");
    expect(annotateCrosswalkInfo(line, false, "kakao").steps[0].description).toMatch(/, 3차로, 도로 폭 14m$/);
  });

  it("음향신호기 주석 뒤에 붙는다(안전 정보 → 수식 순서)", () => {
    const out = annotateCrosswalkInfo(
      briefing([{ description: "횡단보도를 건너세요, 횡단보도 길이 21m, 음향신호기 있음", pathCoords: SEODAL_PATH }]),
      false,
      "kakao",
    );
    expect(out.steps[0].description).toBe(
      "횡단보도를 건너세요, 횡단보도 길이 21m, 음향신호기 있음, 3차로, 도로 폭 14m",
    );
  });

  it("기본 경로는 coord·pathCoords를 제거하고, keepGeometry면 pathCoords로 통일한다", () => {
    const base = briefing([
      { description: "횡단보도를 건너세요", pathCoords: SEODAL_PATH },
      { description: "직진", coord: SEODAL_PATH[0] },
    ]);
    const stripped = annotateCrosswalkInfo(base, false, "kakao");
    for (const s of stripped.steps) {
      expect("coord" in s).toBe(false);
      expect("pathCoords" in s).toBe(false);
    }
    const kept = annotateCrosswalkInfo(base, true, "kakao");
    expect(kept.steps[0].pathCoords).toEqual(SEODAL_PATH);
    expect(kept.steps[1].pathCoords).toEqual([SEODAL_PATH[0]]);
    expect("coord" in kept.steps[1]).toBe(false);
  });
});

describe("getWalkRoute 파이프라인(재작성 → 음향신호기 → 차로 수)", () => {
  it("재작성된 횡단보도 문장 끝에 차로 수·도로 폭이 붙는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 280,
      steps: [
        { description: "소망 메디컬약국 앞에서 횡단보도 이용", distanceMeters: 21, pathCoords: SEODAL_PATH },
      ],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    // 순서가 뒤집히면 ", 3차로…"가 먼저 붙어 CROSS 정규식의 `$` 앵커가 깨지고 원문이 남는다.
    expect(r?.steps[0].description).toMatch(
      /^소망 메디컬약국 앞에서 횡단보도를 건너세요, 횡단보도 길이 21m(, 음향신호기 있음)?, 3차로, 도로 폭 14m$/,
    );
    expect("pathCoords" in r!.steps[0]).toBe(false);
  });

  it("차로 수 주석은 walkStepAction의 횡단보도 마커를 바꾸지 않는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 280,
      steps: [
        { description: "소망 메디컬약국 앞에서 횡단보도 이용", distanceMeters: 21, pathCoords: SEODAL_PATH },
      ],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(walkStepAction(r!.steps[0].description)).toBe("crosswalk");
  });

  it("Tmap 폴백 경로(카카오 throw)는 같은 폴리라인이어도 침묵", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 280,
      steps: [{ description: "우측 횡단보도 진입", distanceMeters: 21, pathCoords: SEODAL_PATH }],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, includeGeometry: true });
    expect(r?.steps[0].description).not.toMatch(/차로/);
  });

  it("기하 옵트인 응답은 주석이 붙고 pathCoords가 남는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue({
      distanceMeters: 300,
      durationSeconds: 280,
      steps: [
        { description: "소망 메디컬약국 앞에서 횡단보도 이용", distanceMeters: 21, pathCoords: SEODAL_PATH },
      ],
    });
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, includeGeometry: true });
    expect(r?.steps[0].description).toMatch(/, 3차로, 도로 폭 14m$/);
    expect(r?.steps[0].pathCoords).toEqual(SEODAL_PATH);
  });
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
    expect(r?.steps[0].description).toContain("계단 없는 경로를 확정하지 못했습니다");
  });

  it("ACCESSIBLE 경로 없음이면 기본 모드 재호출 + no_stepfree_route + 안내 문장 삽입", async () => {
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null) // ACCESSIBLE 호출
      .mockResolvedValueOnce(KAKAO_BRIEFING); // 기본 재호출
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });
    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.steps[0].description).toContain("계단 없는 경로를 확정하지 못했습니다");
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

describe("계단 회피 안내 문장의 전달 채널", () => {
  it("includeGeometry=1이면 유사 스텝 없이 필드로만 전달한다", async () => {
    // 무계단 경로 부재 → 기본 모드 재호출(카카오) 분기
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({
      origin: ORIGIN,
      dest: DEST,
      accessible: true,
      includeGeometry: true,
    });

    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.stepFreeNotice).toBeTruthy();
    // ① 기하 없는 스텝이 하나도 없다 — 있으면 buildGuideRoute가 경로를 통째로 거부한다.
    expect(r!.steps.every((s) => s.pathCoords && s.pathCoords.length > 0)).toBe(true);
    // ② 스텝 수 보존 — 불변식 1만으로는 실제 스텝을 걸러낸 구현도 통과한다(spec §3-2).
    expect(r!.steps).toHaveLength(2);
  });

  it("기하 응답에서 provider 스텝을 걸러내지 않는다(스텝 수 보존)", async () => {
    // ⚠ 모든 스텝이 기하를 가진 fixture로는 이 축이 관측되지 않는다 — 기하 없는
    // 스텝을 걸러내는 변이가 항등이 되어 전량 green으로 통과했다(변이 M9 실측).
    // 기하 없는 provider 스텝이 섞여야 "걸러내는 구현"과 "그대로 두는 구현"이 갈린다.
    // 서버가 거르면 경로 구간이 조용히 사라진다 — 기하 불완전 경로를 거부할지는
    // 클라이언트 `buildGuideRoute`의 fail-closed 판정이지 서버가 숨길 일이 아니다.
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        distanceMeters: 1000,
        durationSeconds: 900,
        steps: [
          {
            description: "직진",
            pathCoords: [
              { lat: 37.5, lng: 127.1 },
              { lat: 37.5005, lng: 127.1 },
            ],
          },
          { description: "강동역 2번 출구까지 역사 내 이동" }, // 기하 없는 실제 스텝
        ],
      });

    const r = await getWalkRoute({
      origin: ORIGIN,
      dest: DEST,
      accessible: true,
      includeGeometry: true,
    });

    expect(r!.steps).toHaveLength(2);
    expect(r!.steps.filter((s) => !s.pathCoords)).toHaveLength(1);
  });

  it("includeGeometry 미지정이면 종전대로 유사 스텝을 맨 앞에 넣고 문장이 일치한다", async () => {
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r!.steps).toHaveLength(3);
    expect(r!.steps[0].description).toBe(r!.stepFreeNotice);
    expect(r!.steps[0].pathCoords).toBeUndefined();
  });

  it("applied면 문장 필드가 없다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({
      origin: ORIGIN,
      dest: DEST,
      accessible: true,
      includeGeometry: true,
    });

    expect(r?.stepFree).toBe("applied");
    expect(r?.stepFreeNotice).toBeUndefined();
  });
});

describe("계단 회피 안내 문장의 정확성과 분기 곱", () => {
  // ⚠ 부정 검사("일반 경로를 안내합니다" 미포함)로 대신하지 않는다 —
  //    빈 문자열·문구 교환이 전부 통과한다.
  it("no_stepfree_route 문장은 어느 경로를 반환하는지 단정하지 않는다", async () => {
    // ACCESSIBLE 응답에 계단 문구 잔존 → fail-closed 강등. 반환은 ACCESSIBLE 경로다.
    vi.mocked(getKakaoWalkBriefing).mockResolvedValueOnce(briefingWithStairs());

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("no_stepfree_route");
    expect(r?.stepFreeNotice).toBe(
      "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.",
    );
  });

  it("unavailable 문장은 종전 그대로다(실제로 일반 경로를 반환하므로 참)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValueOnce(new Error("카카오 장애"));
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("unavailable");
    expect(r?.stepFreeNotice).toBe(
      "계단 회피 경로를 조회하지 못했습니다. 일반 경로를 안내하며 계단이 포함될 수 있습니다.",
    );
  });

  // via==="tmap"과 계단 문구가 동시에 참인 칸. 개별 fixture로는 분기 순서 버그
  // (정답 unavailable인데 no_stepfree_route로 새는 것)를 못 잡는다.
  it("Tmap 폴백 경로에 계단 문구가 있어도 unavailable이다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValueOnce(new Error("카카오 장애"));
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce(briefingWithStairs());

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("unavailable");
  });

  // D1-a: 무계단 부재 → 기본 모드 재호출이 throw하면 전파된다(502의 근원).
  it("무계단 부재 후 기본 모드 재호출이 실패하면 throw한다", async () => {
    vi.mocked(getKakaoWalkBriefing)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("재호출 실패"));
    vi.mocked(getWalkRouteBriefing).mockRejectedValueOnce(new Error("Tmap도 실패"));

    await expect(
      getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true }),
    ).rejects.toThrow();
  });

  it("첫 ACCESSIBLE 호출이 throw하면 Tmap 폴백을 거쳐 unavailable이 된다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValueOnce(new Error("카카오 장애"));
    vi.mocked(getWalkRouteBriefing).mockResolvedValueOnce(briefingWithGeometry(2));

    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, accessible: true });

    expect(r?.stepFree).toBe("unavailable");
  });
});

describe("includeGeometry (실시간 길 안내, 2026-08-03 스펙 §7.2)", () => {
  const geomBriefing = briefing([
    {
      description: "10m 이동",
      pathCoords: [
        { lat: 37.5, lng: 127.1 },
        { lat: 37.5001, lng: 127.1 },
      ],
    },
    { description: "우회전", coord: { lat: 37.5001, lng: 127.1 } },
  ]);

  it("기본은 coord·pathCoords 전량 제거(기존 byte-호환)", () => {
    const out = annotateAudioSignals(geomBriefing, false);
    for (const s of out.steps) {
      expect("coord" in s).toBe(false);
      expect("pathCoords" in s).toBe(false);
    }
  });

  it("보존 모드는 pathCoords로 통일 노출(coord 1점은 승격, coord 키는 제거)", () => {
    const out = annotateAudioSignals(geomBriefing, true);
    expect(out.steps[0].pathCoords).toHaveLength(2);
    expect(out.steps[1].pathCoords).toEqual([{ lat: 37.5001, lng: 127.1 }]);
    expect("coord" in out.steps[1]).toBe(false);
  });

  it("보존 모드에서도 주석 판정은 동일하게 동작한다", () => {
    const out = annotateAudioSignals(
      briefing([{ description: "우측 횡단보도 후 11m 이동", pathCoords: [{ lat: sigLat, lng: sigLng }] }]),
      true,
    );
    expect(out.steps[0].description).toContain("음향신호기 있음");
    expect(out.steps[0].pathCoords).toHaveLength(1);
  });

  it("getWalkRoute가 includeGeometry를 provider noStore로 전파하고 기하를 보존한다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(geomBriefing);
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, includeGeometry: true });
    expect(r?.steps[0].pathCoords).toHaveLength(2);
    expect(vi.mocked(getKakaoWalkBriefing).mock.calls[0][0]).toMatchObject({ noStore: true });
  });

  it("includeGeometry 미지정이면 provider 호출에 noStore가 없다(기존 캐시 계약 불변)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(geomBriefing);
    await getWalkRoute({ origin: ORIGIN, dest: DEST });
    expect(vi.mocked(getKakaoWalkBriefing).mock.calls[0][0]).toMatchObject({ noStore: false });
  });
});

describe("variant=shortest (M3, Tmap searchOption=10 단독)", () => {
  it("tmap이 searchOption '10'으로 호출되고 카카오는 미호출", async () => {
    const r = await getWalkRoute({ origin: ORIGIN, dest: DEST, variant: "shortest" });
    expect(getKakaoWalkBriefing).not.toHaveBeenCalled();
    expect(vi.mocked(getWalkRouteBriefing).mock.calls[0][0]).toMatchObject({
      searchOption: "10",
    });
    expect(r?.steps[0].description).toContain("보행자도로");
  });

  it("accessible과의 곱은 unavailable + 최단 전용 경고 문장(비기하는 스텝 0번 삽입)", async () => {
    const r = await getWalkRoute({
      origin: ORIGIN,
      dest: DEST,
      variant: "shortest",
      accessible: true,
    });
    expect(r?.stepFree).toBe("unavailable");
    expect(r?.stepFreeNotice).toBe(
      "최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다.",
    );
    expect(r?.steps[0].description).toBe(
      "최단 경로에는 계단 회피가 적용되지 않습니다. 계단이 포함될 수 있습니다.",
    );
  });

  it("includeGeometry면 tmap에 기하 보존·noStore를 전파한다", async () => {
    await getWalkRoute({
      origin: ORIGIN,
      dest: DEST,
      variant: "shortest",
      includeGeometry: true,
    });
    expect(vi.mocked(getWalkRouteBriefing).mock.calls[0][0]).toMatchObject({
      searchOption: "10",
      includeLineGeometry: true,
      noStore: true,
    });
  });

  it("Tmap throw면 카카오 폴백 없이 throw(502 전파)", async () => {
    vi.mocked(getWalkRouteBriefing).mockRejectedValue(new Error("tmap down"));
    await expect(
      getWalkRoute({ origin: ORIGIN, dest: DEST, variant: "shortest" }),
    ).rejects.toThrow();
    expect(getKakaoWalkBriefing).not.toHaveBeenCalled();
  });

  it("Tmap 키 부재면 throw(최단 축 자체가 성립 안 함 — null로 위장 금지)", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    await expect(
      getWalkRoute({ origin: ORIGIN, dest: DEST, variant: "shortest" }),
    ).rejects.toThrow();
  });
});

describe("getWalkRouteAlternatives (추천+최단 병렬, 부분 성공 비대칭)", () => {
  it("両성공이면 { result, shortest } — 최단은 searchOption '10'", async () => {
    const r = await getWalkRouteAlternatives({ origin: ORIGIN, dest: DEST });
    expect(r.result?.steps[0].description).toContain("역사 내 이동");
    expect(r.shortest?.steps[0].description).toContain("보행자도로");
    expect(vi.mocked(getWalkRouteBriefing).mock.calls[0][0]).toMatchObject({
      searchOption: "10",
    });
  });

  it("기본 성공 + 최단 throw → shortest: null (최단 실패 흡수)", async () => {
    vi.mocked(getWalkRouteBriefing).mockRejectedValue(new Error("tmap down"));
    const r = await getWalkRouteAlternatives({ origin: ORIGIN, dest: DEST });
    expect(r.result?.steps[0].description).toContain("역사 내 이동");
    expect(r.shortest).toBeNull();
    expect("shortest" in r).toBe(true);
  });

  it("기본 throw → 전체 reject (기본 실패 502 계약)", async () => {
    vi.mocked(getKakaoWalkBriefing).mockRejectedValue(new Error("kakao down"));
    vi.mocked(getWalkRouteBriefing).mockRejectedValue(new Error("tmap down"));
    await expect(
      getWalkRouteAlternatives({ origin: ORIGIN, dest: DEST }),
    ).rejects.toThrow();
  });

  it("Tmap 키 부재면 shortest 키 자체 생략 + 최단 조회 미발생", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    const r = await getWalkRouteAlternatives({ origin: ORIGIN, dest: DEST });
    expect(r.result?.steps[0].description).toContain("역사 내 이동");
    expect("shortest" in r).toBe(false);
    expect(getWalkRouteBriefing).not.toHaveBeenCalled();
  });

  it("accessible은 両경로에 전달된다(추천 applied·최단 경고)", async () => {
    const r = await getWalkRouteAlternatives({
      origin: ORIGIN,
      dest: DEST,
      accessible: true,
    });
    expect(vi.mocked(getKakaoWalkBriefing).mock.calls[0][0].accessible).toBe(true);
    expect(r.result?.stepFree).toBe("applied");
    expect(r.shortest?.stepFree).toBe("unavailable");
    expect(r.shortest?.stepFreeNotice).toContain("최단 경로에는");
  });
});

describe("getWalkRoute 경유지(N4)", () => {
  const O = { lat: 37.5386, lng: 127.1237 };
  const D = { lat: 37.5272, lng: 127.1268 };
  const VIA = { lat: 37.5353, lng: 127.1323 };
  const withWaypoint = (): WalkRouteBriefing => ({
    distanceMeters: 2497,
    durationSeconds: 2310,
    steps: [{ description: "천호역 6번 출구까지 역사 내 이동" }, { description: "43m 이동" }],
    waypoint: { stepIndex: 1, coord: VIA },
  });
  beforeEach(() => {
    vi.mocked(hasKakaoKey).mockReturnValue(true);
    vi.mocked(hasTmapKey).mockReturnValue(true);
    vi.mocked(getKakaoWalkBriefing).mockReset();
    vi.mocked(getWalkRouteBriefing).mockReset();
  });

  it("via를 카카오·Tmap 폴백·최단 축 모두에 전달한다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(withWaypoint());
    await getWalkRoute({ origin: O, dest: D, via: VIA });
    expect(vi.mocked(getKakaoWalkBriefing).mock.calls[0][0].via).toEqual(VIA);

    vi.mocked(getKakaoWalkBriefing).mockRejectedValueOnce(new Error("down"));
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(withWaypoint());
    await getWalkRoute({ origin: O, dest: D, via: VIA });
    expect(vi.mocked(getWalkRouteBriefing).mock.calls[0][0].via).toEqual(VIA);

    await getWalkRoute({ origin: O, dest: D, via: VIA, variant: "shortest" });
    expect(vi.mocked(getWalkRouteBriefing).mock.calls[1][0]).toMatchObject({ via: VIA, searchOption: "10" });
  });

  it("waypoint는 재작성·주석을 지나 응답에 남는다", async () => {
    vi.mocked(getKakaoWalkBriefing).mockResolvedValue(withWaypoint());
    const r = await getWalkRoute({ origin: O, dest: D, via: VIA });
    expect(r?.waypoint).toEqual({ stepIndex: 1, coord: VIA });
  });

  it("계단 회피 안내 문장이 스텝 0에 끼어들면 stepIndex도 한 칸 민다(산문 소비자)", async () => {
    vi.mocked(hasKakaoKey).mockReturnValue(false);
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(withWaypoint());
    const r = await getWalkRoute({ origin: O, dest: D, via: VIA, accessible: true });
    expect(r?.stepFree).toBe("unavailable");
    expect(r?.steps[0].description).toMatch(/계단/);
    expect(r?.waypoint?.stepIndex).toBe(2);
    // 구조화 소비자(기하)는 유사 스텝을 받지 않으므로 인덱스 불변.
    vi.mocked(getWalkRouteBriefing).mockResolvedValue(withWaypoint());
    const g = await getWalkRoute({ origin: O, dest: D, via: VIA, accessible: true, includeGeometry: true });
    expect(g?.waypoint?.stepIndex).toBe(1);
  });
});

