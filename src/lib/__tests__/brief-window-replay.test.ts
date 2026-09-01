// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/guide-diag-2026-09-01-brief-window.json";
import {
  PRESUMED_ARRIVAL_WALK,
  advanceProgressAnchor,
  briefArrivalWindowStep,
  presumedArrivalStep,
  type PresumedArrivalReason,
} from "../final-approach";

/**
 * 실사고 리플레이 게이트(spec 2026-09-02 §2.5). 2026-09-01 KST 08:45 등굣길 — 목적지 12.3m에서
 * `briefHandoff reason=tooClose`로 간략 인계된 뒤 dist 24.3m 고정·nearby=true로 20분을 살다
 * 09:05 국면 무관 안전망이 끝냈다. 이 설계(간략 근처 창)로는 인계 뒤 도착 추정 stationary(300초) 안에
 * 끝나야 하고, 그 전엔 침묵이어야 한다. 배선 순서는 `BeaconModel` 간략 fix 처리와 같다:
 * 창 리듀서 → 앵커 전진 → `presumedArrivalStep`.
 *
 * 실데이터의 굴곡: 인계 36~45초 뒤 건물 진입으로 정확도가 40→106m로 열화한 fix 10건이 있고(그동안
 * dist 20~21m·nearby 유지), 그 뒤 wifi 측위가 24.3m·정확도 5~17m로 고정된다. 설계상 그 10건은 "창 밖"이라
 * 창이 닫혔다 회복 fix에서 다시 열리고, 발동은 **마지막 진입 + 300초**다(인계 기준 약 395초). 인계 기준
 * 300초가 아닌 것이 설계대로의 동작이다 — 정확도 열화 구간을 에피소드에 넣지 않는다.
 */
interface Fix {
  t: number;
  lat: number;
  lng: number;
  acc: number;
  usable: boolean;
  dist: number;
  nearby: boolean;
}

function replay(fixes: Fix[]) {
  let active = false;
  let enteredAt: number | null = null;
  let anchor: { lat: number; lng: number } | null = null;
  let lastProgressAt: number | null = null;
  let lastFixAt: number | null = null;
  let lastDist: number | null = null;
  const silentUntil: number[] = [];
  for (const f of fixes) {
    if (!f.usable) continue;
    lastFixAt = f.t;
    const step = briefArrivalWindowStep({ active, nearby: f.nearby, accuracy: f.acc });
    if (step.entered) {
      enteredAt = f.t;
      anchor = null;
      lastProgressAt = null;
      lastDist = f.dist;
    }
    if (step.exited) {
      enteredAt = null;
      anchor = null;
      lastProgressAt = null;
      lastDist = null;
    }
    active = step.active;
    if (!active || enteredAt === null) continue;
    lastDist = f.dist;
    const a = advanceProgressAnchor(anchor, { lat: f.lat, lng: f.lng });
    anchor = a.anchor;
    if (a.progressed) lastProgressAt = f.t;
    const reason: PresumedArrivalReason | null = presumedArrivalStep(
      {
        inFinalApproach: true,
        secondsSinceUsableFix: f.t - Math.max(enteredAt, lastFixAt),
        secondsSinceProgress: f.t - Math.max(enteredAt, lastProgressAt ?? enteredAt),
        lastKnownDistanceToDestMeters: lastDist,
      },
      PRESUMED_ARRIVAL_WALK,
    );
    if (reason) return { firedAt: f.t, reason, enteredAt, lastProgressAt, silentUntil };
    silentUntil.push(f.t);
  }
  return { firedAt: null, reason: null, enteredAt, lastProgressAt, silentUntil };
}

describe("간략 창 리플레이 (2026-09-01 등굣길 실사고)", () => {
  const fixes = fixture.fixes as Fix[];
  const out = replay(fixes);
  const degraded = fixes.filter((f) => f.usable && f.acc > 30);

  it("세션이 기대 모양이다 (인계 이후 300행 이상, 안전망 종료가 인계 20분 뒤)", () => {
    expect(fixes.length).toBeGreaterThan(300);
    expect(fixture.idleEndT - fixture.handoffT).toBeGreaterThan(1150);
  });

  it("정확도 30m 초과 fix는 건물 진입 직후 10건뿐이고 전부 인계 60초 안이다(창 밖 구간)", () => {
    expect(degraded).toHaveLength(10);
    for (const f of degraded) expect(f.t - fixture.handoffT).toBeLessThan(60);
  });

  it("정확도 회복 뒤 창이 다시 열리고, 마지막 진입 + stationary 300초에 추정 도착으로 끝난다", () => {
    expect(out.reason).toBe("stationary");
    const lastDegradedT = Math.max(...degraded.map((f) => f.t));
    expect(out.enteredAt!).toBeGreaterThan(lastDegradedT);
    // 기준은 max(진입, 마지막 진행 관측) — 재진입 직후 wifi 측위가 앵커 10m를 한 번 넘겨(진행 관측)
    // 기준을 35초쯤 뒤로 민다. 그래서 진입 기준으로는 335초, 진행 기준으로는 정확히 300초 + 한 fix다.
    const progressRef = Math.max(out.enteredAt!, out.lastProgressAt ?? out.enteredAt!);
    expect(out.firedAt! - progressRef).toBeGreaterThanOrEqual(PRESUMED_ARRIVAL_WALK.stationarySeconds);
    // fix 간격 중위 3.9초 — 임계 도달 뒤 첫 fix에서 난다.
    expect(out.firedAt! - progressRef).toBeLessThan(PRESUMED_ARRIVAL_WALK.stationarySeconds + 10);
  });

  it("인계 기준으로는 5~7분 안이다(정확도 열화 구간만큼 늦는다)", () => {
    expect(out.firedAt! - fixture.handoffT).toBeGreaterThanOrEqual(PRESUMED_ARRIVAL_WALK.stationarySeconds);
    expect(out.firedAt! - fixture.handoffT).toBeLessThan(420);
  });

  it("발동 전엔 한 번도 판정이 나지 않는다(경로 중간 자동 종료 금지)", () => {
    expect(out.silentUntil.every((t) => t < out.firedAt!)).toBe(true);
    expect(out.silentUntil.length).toBeGreaterThan(50);
  });

  it("실제 안전망 종료(20분)보다 10분 이상 앞이다", () => {
    expect(fixture.idleEndT - out.firedAt!).toBeGreaterThan(600);
  });
});
