import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `BeaconModel`(앱 타깃, 테스트 레인 없음)이 세션 종료 갈림 셋을 **튜닝 데이터로 읽는지**를 소스로
 * 잠근다(spec 2026-08-31 §7 — Kit·웹 테스트는 튜닝 값만 잠그고, 배선이 상수를 직접 박거나
 * `sessionKind` switch로 되돌아가면 전부 통과한 채 실차에서만 드러난다). `guidance-gate-drift` 관례.
 */
const src = readFileSync(new URL("../../../ios/Gildongmu/Directions/BeaconModel.swift", import.meta.url), "utf8");


/**
 * 주석·문자열 리터럴을 같은 길이의 공백으로 지운다(오프셋 보존) — 주석에 적힌 옛 조건 이름이 판정에 끼지 않게.
 * ⚠ 보간 안 중첩 따옴표(`"\(x ? "a" : "b")"`)의 안쪽 낱말과 `"""` 다중행 문자열은 다루지 않는다 — 현재 단언은
 * 그 자리를 보지 않는다.
 */
function blankComments(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i++;
      continue;
    }
    if (c === '"') {
      out += " ";
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") {
          out += " ";
          i++;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}
const code = blankComments(src);

describe("BeaconModel 세션 종료 갈림은 GuideTuning 데이터를 읽는다", () => {
  it.each([
    "tuning.presumedArrival",
    "tuning.entersFinalApproachWithoutGeometry",
    "tuning.sessionIdleStationaryAxis",
  ])("%s 참조", (needle) => {
    expect(src.includes(needle)).toBe(true);
  });

  it("프로파일 리터럴(.walk/.car)을 판정 함수에 직접 넘기지 않는다", () => {
    expect(src).not.toMatch(/thresholds:\s*\.(walk|car)\b/);
    expect(src).not.toMatch(/PresumedArrivalThresholds\.(walk|car)/);
  });

  it("국면 무관 안전망을 sessionKind로 가르지 않는다(walk 전용 가드 재도입 금지)", () => {
    const idle = src.slice(src.indexOf("func maybeEndIdleSession"), src.indexOf("func maybePresumeArrival"));
    expect(idle).not.toMatch(/sessionKind\s*==\s*\.walk/);
  });
});

describe("도착 창(A31 §2, spec 2026-09-02): 간략 근처 창 배선", () => {
  const presume = code.slice(code.indexOf("func maybePresumeArrival"), code.indexOf("func loadArrivalHealth"));

  it("추정 도착 가드는 inArrivalWindow를 읽고 inFinalApproach 단독 가드로 되돌아가지 않는다", () => {
    expect(presume).toMatch(/guard isTracking, inArrivalWindow/);
    expect(presume).not.toMatch(/guard isTracking, inFinalApproach/);
  });

  it("maybePresumeArrival 호출은 세 자리(최종 접근·간략 fix·워치독)", () => {
    expect(code.match(/maybePresumeArrival\(now: now\)/g)?.length).toBe(3);
  });

  it("간략 fix 처리는 창 자격을 Kit 리듀서로 정하고 그 결과만 플래그에 싣는다(nearby 직접 판정 금지)", () => {
    const brief = code.slice(code.indexOf("let usable = isUsableFix(accuracy: fix.accuracy"), code.indexOf("func handleDetail"));
    expect(brief).toMatch(/briefArrivalWindowStep\(/);
    expect(brief).toMatch(/briefWindowActive = window\.active/);
    // 리듀서 옆에 래치 직접 대입을 덧대는 변이 차단.
    expect(brief).not.toMatch(/briefWindowActive = (true|stepped\.state\.nearby)/);
  });

  it("resetFinalApproach가 간략 창 플래그까지 지운다(경로 커밋·재획득·stop에서 옛 창이 살아남지 않게)", () => {
    const reset = code.slice(code.indexOf("func resetFinalApproach"), code.indexOf("func beginFinalApproach"));
    expect(reset).toMatch(/resetArrivalWindow\(\)/);
    const window = code.slice(code.indexOf("func resetArrivalWindow"), code.indexOf("func resetFinalApproach"));
    expect(window).toMatch(/briefWindowActive = false/);
  });
});

describe("종료 화면 수명(A31 §3, spec 2026-09-02)", () => {
  const scene = code.slice(code.indexOf("func handleScenePhaseChange"), src.indexOf("// MARK: - 톤 계층 배선"));

  it("복귀 판정은 백그라운드 경유 플래그를 .active 맨 앞에서 소비한다(제어센터 왕복·전경 체류는 판정 밖)", () => {
    expect(scene).toMatch(/let returnedFromBackground = wasBackgrounded\s*\n\s*wasBackgrounded = false/);
    expect(scene).toMatch(/isEndScreenStale\(/);
    // 소거 조건 자체가 백그라운드 경유를 본다 — 플래그 소비만 검사하면 조건에서 빼는 변이가 통과한다.
    expect(scene).toMatch(/if returnedFromBackground, !isTracking, arrivalDest != nil/);
    expect(scene).not.toMatch(/guard wasBackgrounded else/);
  });

  it("종료 시각은 잠자기 중에도 전진하는 단조 시계(ContinuousClock)", () => {
    expect(src).toMatch(/endedAt: ContinuousClock\.Instant\?/);
  });

  it("앱 루트는 유휴 리셋보다 먼저 세션에 전경 전환을 전달한다(옛 시트가 한 프레임 떴다 닫히지 않게)", () => {
    const app = readFileSync(new URL("../../../ios/Gildongmu/GildongmuApp.swift", import.meta.url), "utf8");
    const handoff = app.indexOf("guideSession.handleScenePhaseChange(to: phase)");
    expect(handoff).toBeGreaterThan(0);
    expect(handoff).toBeLessThan(app.indexOf("IdleReset.shouldReset("));
  });
});

describe("종료 문장 잔존(A31 §4, spec 2026-09-02): clearArrival 판별선", () => {
  const clear = code.slice(code.indexOf("func clearArrival"), code.indexOf("func markPrewalk"));

  it("상태 문장은 실패 상태(denied·unavailable)가 남았을 때만 유지한다", () => {
    // 문자열 리터럴은 공백으로 지워져 있으므로 대입 좌변까지만 본다.
    expect(clear).toMatch(/if !status\.isFailure \{ statusText = /);
    expect(clear).not.toMatch(/endKind != \.stopped/);
    expect(clear).not.toMatch(/status == \.idle/);
  });

  it("liveTopText는 조건 없이 지운다(실패 문장이 사는 자리가 아니다)", () => {
    expect(clear).toMatch(/^\s*liveTopText = nil\s*$/m);
  });
});
