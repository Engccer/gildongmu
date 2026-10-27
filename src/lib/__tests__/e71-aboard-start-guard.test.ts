import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E71 「지금 탄 열차에서 여정 시작」의 안내 쪽 소스 가드
 * (spec `docs/superpowers/specs/2026-10-27-e71-riding-start-design.md` R8·R9·R10·R14).
 *
 * `aboard`는 안전 인자라 기본값이 없어야 하고(생략이 컴파일을 통과해 조용히 종전 대기 시작이 된다), 방향 잠금은
 * 후보 분류 입력과 `boardAboard` 재확인 두 자리가 함께 서야 한다(한쪽만 있으면 반대 방향 열차로 식별 잠금이 선다).
 * 둘 다 오류 없이 어긋나므로 소스로 잠근다.
 */

const DIR = join(__dirname, "../../../ios/Gildongmu/Directions");
const MODEL = readFileSync(join(DIR, "TransitGuideModel.swift"), "utf8");
const COORD = readFileSync(join(DIR, "GuideSessionCoordinator.swift"), "utf8");
const SHEET = readFileSync(join(DIR, "TransitTrackingSheet.swift"), "utf8");

/** 선언 시그니처(여는 중괄호 앞까지). */
function signature(source: string, head: string): string {
  const at = source.indexOf(head);
  if (at < 0) throw new Error(`Swift 선언 ${head}을 찾지 못했다`);
  return source.slice(at, source.indexOf("{", at));
}

/** 선언 본문(주석 제거). 중괄호를 세어 닫는 자리까지. */
function body(source: string, head: string): string {
  const at = source.indexOf(head);
  if (at < 0) throw new Error(`Swift 선언 ${head}을 찾지 못했다`);
  const open = source.indexOf("{", at);
  let depth = 0;
  let out = "";
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += c;
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return out;
  }
  throw new Error(`Swift 선언 ${head}의 닫는 중괄호를 찾지 못했다`);
}

describe("E71 aboard 시작 — 안전 인자(R10)", () => {
  it("TransitGuideModel.start·startAfterPrewalk·beginSession·beginTransit 시그니처의 aboard에 기본값이 없다", () => {
    for (const [src, head] of [
      [MODEL, "func start("],
      [MODEL, "private func beginSession("],
      [COORD, "private func beginTransit("],
    ] as const) {
      const sig = signature(src, head);
      expect(sig, `${head} 시그니처에 aboard 인자가 없다`).toContain("aboard: TransitAboardStart?");
      expect(sig, `${head}의 aboard에 기본값이 붙었다`).not.toContain("aboard: TransitAboardStart? =");
    }
  });

  it("JourneyPlan.aboard는 저장 프로퍼티다", () => {
    expect(body(COORD, "struct JourneyPlan")).toContain("let aboard: TransitAboardStart?");
  });

  it("호출 자리가 aboard를 명시한다 — startTransit·startAfterPrewalk는 nil, 여정 대중교통 단계는 plan.aboard", () => {
    expect(body(COORD, "func startTransit(")).toContain("aboard: nil");
    expect(body(MODEL, "func startAfterPrewalk(")).toContain("aboard: nil");
    expect(body(COORD, "func startJourneyStage(")).toContain("aboard: plan.aboard");
  });

  it("beginTransit은 aboard 시작이면 승차 전 도보 판정을 건너뛰고 모델에 aboard를 싣는다", () => {
    const b = body(COORD, "private func beginTransit(");
    expect(b).toMatch(/aboard == nil[\s\S]{0,80}transitPrewalkTarget\(guideRoute\)/);
    expect(b).toContain("aboard: aboard");
  });
});

describe("E71 aboard 시작 — 방향 잠금(R14)", () => {
  it("후보 풀이 journeyAboardTrainItems를 지난다", () => {
    expect(body(MODEL, "func waitingCandidatesPool(")).toContain("journeyAboardTrainItems(");
  });

  it("boardAboard가 고른 방향과 열차 방향을 다시 비교한다", () => {
    const b = body(MODEL, "func boardAboard(item:");
    expect(b).toContain("aboardDirection");
    expect(b).toContain("item.direction");
  });

  it("잠금은 riding 진입·도착 선언·경로 교체·세션 종료에서 풀린다", () => {
    for (const head of ["func stop(", "func declareArrived(", "private func changeRoute("]) {
      expect(body(MODEL, head), `${head}에 aboardDirection 해제가 없다`).toMatch(/aboardDirection = nil/);
    }
    expect(MODEL).toMatch(/if result\.state\.phase != \.waiting \{[^}]*aboardDirection = nil/);
  });
});

describe("E71 aboard 시작 — 통지와 착지(R8·R9)", () => {
  it("aboard 시작이면 시작 통지에 대기 문맥(waitContextText)을 붙이지 않는다", () => {
    const b = body(MODEL, "private func beginSession(");
    expect(b).toMatch(/if !aboardStarted \{\s*parts\.append\(waitContextText\(first, isCurrentLeg: true\)\)/);
  });

  it("시트 첫 착지는 aboard 열차 고르기면 질문 라벨, 아니면 상태 문장 한 줄이다", () => {
    const line = ".task { landControlFocus(model.aboardStep == .pickVehicle && controlExists(.waitingLabel) ? .waitingLabel : .status, proxy: proxy) }";
    expect(SHEET.includes(line), "시트 열림 착지 한 줄이 없다").toBe(true);
  });
});
