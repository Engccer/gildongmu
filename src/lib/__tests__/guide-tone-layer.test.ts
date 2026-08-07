import { describe, expect, it } from "vitest";
import {
  CAR_CLOSER_INTERVAL_S,
  decayedDeadBand,
  INITIAL_TONE_LAYER_STATE,
  MAX_NORMAL_SILENCE_S,
  toneLayerStep,
  type ToneLayerInput,
  type ToneLayerState,
  type TrendInput,
} from "../guide-tone-layer";
import scenarios from "./fixtures/tone-layer-scenarios.json";

/**
 * Kit `GuideToneLayerTests`와 같은 계약을 돈다. 아래 fixture 스위트는 **웹과 Kit이
 * 같은 입력 열로 같은 톤 열을 내는지**를 파일 하나로 강제한다(드리프트 가드).
 */
const trend = (
  distance: number,
  motion: TrendInput["motion"] = "moving",
  deadBand = 15,
  closerIntervalSeconds = 2,
): TrendInput => ({ distance, deadBand, motion, closerIntervalSeconds });

const input = (over: Partial<ToneLayerInput> = {}): ToneLayerInput => ({
  unreliable: false,
  priorityTone: null,
  eventOwned: false,
  trend: null,
  arrived: false,
  rebaseTrend: false,
  ...over,
});

const anchored = (
  distance: number,
  t: ToneLayerState["trend"] = "none",
): ToneLayerState => ({
  ...INITIAL_TONE_LAYER_STATE,
  anchorDistance: distance,
  trend: t,
  // 실제 코드에서는 앵커가 처음 설정되는 fix가 이 시각을 잡는다.
  anchorSetAt: 0,
});

describe("계층 배타성", () => {
  it("1단계: unreliable이 이긴다 — 추세가 동시에 참이어도 앵커가 갱신되지 않는다", () => {
    const state = anchored(100, "closer");
    const out = toneLayerStep(state, input({ unreliable: true, trend: trend(50) }), 10);
    expect(out.tone).toBe("unreliable");
    expect(out.state.anchorDistance).toBe(100); // trendStep 미호출
    expect(out.state.trend).toBe("closer");
    expect(out.state.lastTrendToneAt).toBeNull();
  });

  it("2단계: 우선 톤이 있으면 추세 판정을 하지 않는다", () => {
    const out = toneLayerStep(
      anchored(100), input({ priorityTone: "ahead", trend: trend(50) }), 10,
    );
    expect(out.tone).toBe("ahead");
    expect(out.state.anchorDistance).toBe(100);
    expect(out.state.lastTrendToneAt).toBeNull();
  });

  // ⚠ 이 순서가 ahead·warning의 존재 조건이다. guideStep은 .ahead를 항상
  // announceSteps와, .warning을 항상 offRoute와 함께 내므로 우선 톤을 실은 fix는
  // 예외 없이 eventOwned === true다. 두 값을 서로 다른 스텝에 나눠 두면 3단계를
  // 2단계 앞으로 옮기는 변이가 전량 green을 통과한다(코드 리뷰 실측 2026-08-08).
  it.each(["ahead", "warning"] as const)(
    "이벤트를 동반해도 우선 톤(%s)이 이긴다(실제로는 항상 동반한다)",
    (tone) => {
      const out = toneLayerStep(
        anchored(100),
        input({ priorityTone: tone, eventOwned: true, trend: trend(50) }),
        10,
      );
      expect(out.tone).toBe(tone);
    },
  );

  it("3단계: 이벤트가 톤 자리를 소유하면 침묵하고 앵커도 불변이다", () => {
    const out = toneLayerStep(
      anchored(100), input({ eventOwned: true, trend: trend(50) }), 10,
    );
    expect(out.tone).toBeNull();
    expect(out.state.anchorDistance).toBe(100);
  });

  it("4단계: 상위가 전부 비면 추세 톤이 난다", () => {
    const out = toneLayerStep(anchored(100), input({ trend: trend(80) }), 10);
    expect(out.tone).toBe("closer");
    expect(out.state.anchorDistance).toBe(80);
  });
});

describe("추세 축 내부", () => {
  it("정지가 확정되면 데드밴드와 무관하게 tick이다", () => {
    const out = toneLayerStep(
      anchored(100), input({ trend: trend(99, "stopped") }), 10,
    );
    expect(out.tone).toBe("tick");
  });

  it("속도를 모르면 tick을 내지 않는다(거짓 정지 금지)", () => {
    const out = toneLayerStep(
      anchored(100), input({ trend: trend(99, "speedUnknown") }), 10,
    );
    expect(out.tone).toBeNull();
  });

  it("speedUnknown이어도 데드밴드를 넘으면 추세 톤은 난다", () => {
    const out = toneLayerStep(
      anchored(100), input({ trend: trend(80, "speedUnknown") }), 10,
    );
    expect(out.tone).toBe("closer");
  });

  it("tick은 자기 간격을 지킨다", () => {
    let state = anchored(100);
    let out = toneLayerStep(state, input({ trend: trend(99, "stopped") }), 10);
    expect(out.tone).toBe("tick");
    state = out.state;
    out = toneLayerStep(state, input({ trend: trend(99, "stopped") }), 12);
    expect(out.tone).toBeNull();
    state = out.state;
    out = toneLayerStep(state, input({ trend: trend(99, "stopped") }), 13.5);
    expect(out.tone).toBe("tick");
  });
});

describe("정숙 구간과 회복", () => {
  it("행동 안내 후 3초는 추세 톤을 억제하고 그 사이 앵커도 불변이다", () => {
    let state = anchored(100);
    let out = toneLayerStep(state, input({ priorityTone: "ahead" }), 10);
    state = out.state;
    out = toneLayerStep(state, input({ trend: trend(80) }), 11);
    expect(out.tone).toBeNull();
    expect(out.state.anchorDistance).toBe(100);
    state = out.state;
    out = toneLayerStep(state, input({ trend: trend(80) }), 13.5);
    expect(out.tone).toBe("closer");
  });

  // ⚠ 첫 진입만으로는 "즉시 1회" 계약이 관측되지 않는다. lastUnreliableAt이 null이면
  // 간격 조건도 참이라 두 판정이 겹친다 — 회복 후 재진입이 둘을 가른다(변이 주입 M5).
  it("회복 후 재진입도 즉시 1회다(간격 창 안이어도)", () => {
    let state = anchored(500, "closer");
    state = toneLayerStep(state, input({ unreliable: true }), 0).state;
    state = toneLayerStep(state, input({ trend: trend(120) }), 3).state;
    // 직전 unreliable(now=0)로부터 5초뿐이라 간격 창(10초) 안이다.
    expect(toneLayerStep(state, input({ unreliable: true }), 5).tone).toBe("unreliable");
  });

  it("회복은 앵커 재기준화 후 현재 상태 톤 1회", () => {
    let state = anchored(500, "closer");
    state = toneLayerStep(state, input({ unreliable: true }), 0).state;
    const out = toneLayerStep(state, input({ trend: trend(120) }), 3);
    expect(out.tone).toBe("closer"); // 데드밴드 미달이어도 즉시 1회
    expect(out.state.anchorDistance).toBe(120);
    expect(out.state.needsRebase).toBe(false);
  });

  it("회복 fix에서 상위 톤이 나도 재기준화 기회를 잃지 않는다", () => {
    let state = anchored(500, "closer");
    state = toneLayerStep(state, input({ unreliable: true }), 0).state;
    // 복귀하는 fix에서 이탈 경고가 났다 — 그 fix는 추세 축에 닿지 못한다.
    state = toneLayerStep(state, input({ priorityTone: "warning" }), 3).state;
    expect(state.needsRebase).toBe(true);
    const out = toneLayerStep(state, input({ trend: trend(120) }), 7);
    expect(out.state.anchorDistance).toBe(120);
    expect(out.tone).toBe("closer");
  });

  it("추세가 none인 상태에서 회복하면 앵커만 잡고 침묵한다", () => {
    let state = INITIAL_TONE_LAYER_STATE;
    state = toneLayerStep(state, input({ unreliable: true }), 0).state;
    const out = toneLayerStep(state, input({ trend: trend(120) }), 3);
    expect(out.tone).toBeNull();
    expect(out.state.anchorDistance).toBe(120);
  });

  it("정지 중 회복이면 tick으로 알린다", () => {
    let state = anchored(500, "closer");
    state = toneLayerStep(state, input({ unreliable: true }), 0).state;
    const out = toneLayerStep(state, input({ trend: trend(120, "stopped") }), 3);
    expect(out.tone).toBe("tick");
  });
});

describe("빈도 비대칭", () => {
  it("closer 간격은 수단별이다 — 차량 10초 창에서는 억제된다", () => {
    let state = anchored(1000);
    let out = toneLayerStep(
      state, input({ trend: trend(900, "moving", 15, CAR_CLOSER_INTERVAL_S) }), 10,
    );
    expect(out.tone).toBe("closer");
    state = out.state;
    out = toneLayerStep(
      state, input({ trend: trend(800, "moving", 15, CAR_CLOSER_INTERVAL_S) }), 14,
    );
    expect(out.tone).toBeNull();
    state = out.state;
    out = toneLayerStep(
      state, input({ trend: trend(700, "moving", 15, CAR_CLOSER_INTERVAL_S) }), 21,
    );
    expect(out.tone).toBe("closer");
  });

  it("farther는 수단을 가리지 않는다(경고 축)", () => {
    let state = anchored(1000);
    let out = toneLayerStep(
      state, input({ trend: trend(1100, "moving", 15, CAR_CLOSER_INTERVAL_S) }), 10,
    );
    expect(out.tone).toBe("farther");
    state = out.state;
    out = toneLayerStep(
      state, input({ trend: trend(1200, "moving", 15, CAR_CLOSER_INTERVAL_S) }), 12.5,
    );
    expect(out.tone).toBe("farther");
  });
});

describe("도착 종단", () => {
  it("도착 후에는 tick·추세·unreliable을 전부 억제한다", () => {
    const state = anchored(30);
    expect(
      toneLayerStep(
        state, input({ trend: trend(25, "stopped"), arrived: true }), 10,
      ).tone,
    ).toBeNull();
    expect(
      toneLayerStep(state, input({ unreliable: true, arrived: true }), 10).tone,
    ).toBeNull();
  });

  it("도착 후에도 이탈 경고는 난다(억제 대상이 아니다)", () => {
    const out = toneLayerStep(
      INITIAL_TONE_LAYER_STATE, input({ priorityTone: "warning", arrived: true }), 10,
    );
    expect(out.tone).toBe("warning");
  });
});

describe("최대 침묵 계약", () => {
  it("계약값은 데드밴드 ÷ 느린 구간 속도의 반올림이다", () => {
    // 15m ÷ 0.7m/s = 21.43초. 계약값 21초는 사용자에게 하는 약속이고, 이 단언은
    // 상수와 산출식이 어긋나는 것을 막는다(둘 중 하나만 바뀌면 실패한다).
    expect(Math.abs(MAX_NORMAL_SILENCE_S - 15 / 0.7)).toBeLessThan(0.5);
  });

  it("느린 보행에서 침묵은 데드밴드 통과 시간을 넘지 않는다", () => {
    let state = anchored(300);
    let lastToneAt = 0;
    let maxGap = 0;
    let distance = 300;
    for (let i = 1; i <= 90; i++) {
      distance -= 0.7;
      const out = toneLayerStep(state, input({ trend: trend(distance) }), i);
      state = out.state;
      if (out.tone) {
        maxGap = Math.max(maxGap, i - lastToneAt);
        lastToneAt = i;
      }
    }
    expect(maxGap).toBeLessThanOrEqual(15 / 0.7 + 1);
    expect(lastToneAt).toBeGreaterThan(0);
  });

  it("평상 보행에서는 계약값 안에 들어온다", () => {
    let state = anchored(300);
    let lastToneAt = 0;
    let maxGap = 0;
    let distance = 300;
    for (let i = 1; i <= 60; i++) {
      distance -= 1.17;
      const out = toneLayerStep(state, input({ trend: trend(distance) }), i);
      state = out.state;
      if (out.tone) {
        maxGap = Math.max(maxGap, i - lastToneAt);
        lastToneAt = i;
      }
    }
    expect(maxGap).toBeLessThanOrEqual(MAX_NORMAL_SILENCE_S);
  });
});

describe("공유 fixture(웹↔Kit 동조)", () => {
  for (const scenario of scenarios.scenarios) {
    it(scenario.name, () => {
      let state: ToneLayerState = {
        ...INITIAL_TONE_LAYER_STATE,
        anchorDistance: scenario.initial.anchorDistance,
        trend: scenario.initial.trend as ToneLayerState["trend"],
      };
      scenario.steps.forEach((step, index) => {
        const stepTrend = (step as { trend?: TrendInput }).trend;
        const out = toneLayerStep(
          state,
          input({
            unreliable: (step as { unreliable?: boolean }).unreliable ?? false,
            priorityTone:
              ((step as { priorityTone?: string }).priorityTone as
                | ToneLayerInput["priorityTone"]) ?? null,
            eventOwned: (step as { eventOwned?: boolean }).eventOwned ?? false,
            trend: stepTrend ?? null,
            arrived: (step as { arrived?: boolean }).arrived ?? false,
            rebaseTrend: (step as { rebaseTrend?: boolean }).rebaseTrend ?? false,
          }),
          step.now,
        );
        state = out.state;
        expect(out.tone, `step ${index} (now=${step.now})`).toBe(step.expect ?? null);
      });
    });
  }
});

describe("데드밴드 시간 감쇠(평평한 거리 축)", () => {
  /** 목적지와 평행하게 걷는 상황 — 이동 중인데 거리가 거의 안 변한다. */
  const flat = (distance: number) => ({
    distance,
    deadBand: 15,
    deadBandFloor: 5,
    motion: "moving" as const,
    closerIntervalSeconds: 2,
  });

  it("계약값(21초) 안에서는 데드밴드가 원값 그대로다", () => {
    expect(decayedDeadBand(15, 5, 0)).toBe(15);
    expect(decayedDeadBand(15, 5, 21)).toBe(15);
  });

  it("유예 이후 선형으로 하한까지 줄어든다", () => {
    expect(decayedDeadBand(15, 5, 21 + 10.5)).toBeCloseTo(10, 5); // 절반
    expect(decayedDeadBand(15, 5, 42)).toBe(5);
    expect(decayedDeadBand(15, 5, 120)).toBe(5); // 하한 아래로는 안 내려간다
  });

  it("하한이 원값 이상이면 감쇠가 없다(기본 계약)", () => {
    expect(decayedDeadBand(15, 15, 100)).toBe(15);
  });

  // ⚠ 이 시나리오가 H1의 재현이다. 감쇠가 없으면 톤이 영영 나지 않는다.
  it("거리가 8m만 변하는 평행 이동에서도 결국 톤이 난다", () => {
    let state = anchored(300);
    let firstToneAt: number | null = null;
    for (let i = 1; i <= 90; i++) {
      // 90초 동안 목적지까지 거리가 8m만 줄어든다(데드밴드 15m 미달).
      const out = toneLayerStep(state, input({ trend: flat(300 - i * 0.09) }), i);
      state = out.state;
      if (out.tone && firstToneAt === null) firstToneAt = i;
    }
    expect(firstToneAt).not.toBeNull();
    // 계약값 안에서는 울리지 않는다(현행 동작 보존).
    expect(firstToneAt!).toBeGreaterThan(MAX_NORMAL_SILENCE_S);
  });

  it("정상 접근에서는 감쇠가 발동하지 않는다(회귀 없음)", () => {
    let state = anchored(300);
    const tones: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const out = toneLayerStep(state, input({ trend: flat(300 - i * 1.17) }), i);
      state = out.state;
      if (out.tone) tones.push(i);
    }
    // 평상 보행이면 13초 안에 첫 톤 — 유예(21초)에 닿기 전이다.
    expect(tones[0]).toBeLessThanOrEqual(MAX_NORMAL_SILENCE_S);
  });

  it("톤이 나면 감쇠 기준이 리셋된다(앵커가 움직인 시각)", () => {
    let state = anchored(300);
    state = toneLayerStep(state, input({ trend: flat(280) }), 1).state; // closer, 앵커 전진
    expect(state.anchorSetAt).toBe(1);
    // 그 직후 30초는 앵커 기준 29초라 아직 하한에 못 미친다.
    const out = toneLayerStep(state, input({ trend: flat(272) }), 30);
    expect(out.tone).toBeNull();
  });
});
