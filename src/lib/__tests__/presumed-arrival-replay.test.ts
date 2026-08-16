// @vitest-environment node
import { describe, expect, it } from "vitest";
import sessionFixture from "./fixtures/guide-diag-2026-08-13-final-approach.json";
import { presumedArrivalStep } from "../final-approach";

/**
 * 실사고 리플레이 게이트(spec 2026-08-13 §6). 17:03 KST 귀가 세션 —
 * finalApproachEnter(08:08:31Z) 직후 usable fix 0건이 되며 세션이 잊혔다.
 * 이 타임라인에 판정을 재생해 "마지막 fix + 180초에 noFix 발동, 그 전엔 침묵"을
 * 회귀 기준으로 잠근다. 거리 입력은 진입 fix의 perp(42.6m)를 근사로 쓴다
 * (목적지 좌표는 로그에 없다 — 최종 접근 진입 직후라 직선거리와 대차 없음).
 */
interface Entry {
  t: number;
  event: string;
}

/** fixture는 원본 `guide-diag-2026-08-13.log.gz`에서 이 세션의 t·event만 뽑은 것(좌표 없음). 원본은 repo 밖 보관. */
function parseSession(): Entry[] {
  return sessionFixture.fixes;
}

describe("도착 추정 리플레이 (2026-08-13 실사고)", () => {
  const fixes = parseSession();
  const entered = fixes.find((f) => f.event === "finalApproachEnter");
  const last = fixes[fixes.length - 1];
  const ENTRY_PERP_M = 42.6;

  it("세션이 기대 모양이다 (최종 접근 진입 = 마지막 fix)", () => {
    expect(fixes.length).toBeGreaterThan(200);
    expect(entered).toBeDefined();
    expect(last.t).toBe(entered!.t);
  });

  it("fix 스트림 생존 중에는 발동하지 않는다", () => {
    for (const f of fixes) {
      expect(
        presumedArrivalStep({
          inFinalApproach: f.event === "finalApproachEnter",
          secondsSinceUsableFix: 0,
          secondsSinceProgress: 0,
          lastKnownDistanceToDestMeters: ENTRY_PERP_M,
        }),
      ).toBeNull();
    }
  });

  it("마지막 fix + 180초에 noFix 발동, 그 전엔 침묵 (2초 워치독 틱 재생)", () => {
    const lastT = last.t;
    for (let tick = lastT; tick < lastT + 179; tick += 2) {
      expect(
        presumedArrivalStep({
          inFinalApproach: true,
          secondsSinceUsableFix: tick - lastT,
          secondsSinceProgress: tick - lastT,
          lastKnownDistanceToDestMeters: ENTRY_PERP_M,
        }),
      ).toBeNull();
    }
    expect(
      presumedArrivalStep({
        inFinalApproach: true,
        secondsSinceUsableFix: 180,
        secondsSinceProgress: 180,
        lastKnownDistanceToDestMeters: ENTRY_PERP_M,
      }),
    ).toBe("noFix");
  });
});
