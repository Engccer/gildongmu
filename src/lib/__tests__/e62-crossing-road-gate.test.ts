import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 건너는 길 이름의 실험판 게이트(E62 spec `2026-10-03-crosswalk-guidance-design.md` §3.5, 코디네이터 판정 3).
 * "직각 안팎으로 꺾으면 걷던 길을 건넌다"는 추론이라 실험판 실보행이 게이트다 — 서버 옵트인 `crossingRoad=1`을
 * iOS `AppConfig.experimentalCrossingRoadEnabled`(빌드 구성 `#if EXPERIMENTAL`)만 켠다. 플래그가 다른 자리로
 * 새거나 웹·안드로이드가 옵트인을 보내면 정식판에서 검증 전 문장이 나간다 — 오류는 나지 않는다.
 */

const ROOT = join(__dirname, "../../..");
const SKIP = new Set(["build", ".build", "DerivedData", "node_modules", ".git"]);

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

describe("건너는 길 이름은 iOS 실험판만 켠다", () => {
  it("플래그는 빌드 구성으로 갈리고 참조는 도보 경로 조회 두 자리뿐이다", () => {
    const config = readFileSync(join(ROOT, "ios/Gildongmu/AppConfig.swift"), "utf8");
    expect(config).toMatch(
      /#if EXPERIMENTAL\s+static let experimentalCrossingRoadEnabled = true\s+#else\s+static let experimentalCrossingRoadEnabled = false\s+#endif/,
    );
    const refs = files(join(ROOT, "ios/Gildongmu"), ".swift")
      .flatMap((f) => (readFileSync(f, "utf8").match(/AppConfig\.experimentalCrossingRoadEnabled/g) ?? []).map(() => f))
      .map((f) => f.slice(ROOT.length + 1))
      .sort();
    expect(refs).toEqual([
      "ios/Gildongmu/Directions/BeaconModel.swift",
      "ios/Gildongmu/Directions/DirectionsTabView.swift",
    ]);
  });

  it("Kit 조회 함수의 crossingRoad는 기본값 없는 인자다(빠뜨린 조회가 조용히 끄거나 켜지 않게)", () => {
    const svc = readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift"), "utf8");
    expect(svc.match(/crossingRoad: Bool,/g)?.length).toBe(2);
    expect(svc).not.toMatch(/crossingRoad: Bool = /);
  });

  it("웹·안드로이드·CLI/MCP는 옵트인을 보내지 않는다", () => {
    const sources = [
      ...files(join(ROOT, "src"), ".ts").filter((f) => !f.includes("__tests__") && !f.includes("/app/api/")),
      ...files(join(ROOT, "src"), ".tsx").filter((f) => !f.includes("__tests__")),
      ...files(join(ROOT, "android"), ".kt"),
      ...files(join(ROOT, "packages/cli/src"), ".ts").filter((f) => !f.includes("__tests__")),
      ...files(join(ROOT, "packages/mcp/src"), ".ts").filter((f) => !f.includes("__tests__")),
    ];
    // 요청에 붙이는 형태만 본다(URL 조각·쿼리 이름 문자열·쿼리 객체 값). 주석 속 "`crossingRoad=1`" 서술은 송신이 아니다.
    const sends = /[&?]crossingRoad=|name:\s*["']crossingRoad["']|crossingRoad:\s*["']1["']/;
    // 양성 대조: 유일한 송신자인 Kit 조회 코드는 이 술어에 걸려야 한다(술어가 헐거워 0건이 된 것이 아님을 증명).
    expect(sends.test(readFileSync(join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/RouteService.swift"), "utf8"))).toBe(true);
    const senders = sources.filter((f) => sends.test(readFileSync(f, "utf8")));
    expect(senders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

/**
 * E62 앱 층 배선(spec 준수 리뷰 MINOR 3). 리듀서 입력 `stopped`·스텝 기하 `crossing`, 늦은 전문 `late`, 조각 `body`·
 * `crossingClock`은 빠뜨려도 컴파일이 통과하고 그 규칙만 조용히 꺼진다(기하의 `crossing`은 기본값 false) — 소비자
 * 셋(웹 훅·iOS BeaconModel·안드로이드 WalkGuideModel)의 배선 자리를 문자열로 잠근다.
 */
describe("E62 앱 층 배선", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
  it("웹 훅", () => {
    const src = read("src/hooks/useRouteGuide.ts");
    expect(src).toContain('stopped: motion === "stopped"');
    expect(src).toContain("if (event.late) return step;");
    expect(src).toContain("rereadUnitText(route, event.indices, liveStepsRef.current, t)");
    expect(src).toContain("walkImminentLine(event.action, liveStepsRef.current[event.indices[0]]?.crossingClock, t)");
  });
  it("iOS BeaconModel", () => {
    const src = read("ios/Gildongmu/Directions/BeaconModel.swift");
    expect(src).toContain("stopped: motion == .stopped");
    expect(src).toContain("crossing: $0.crossing ?? false)");
    expect(src).toContain("body: $0.parts?.body, crossingClock: $0.crossingClock");
    expect(src).toMatch(/case let \.announceSteps\(_, late\) = event, !late/);
    expect(src).toContain("GuideText.imminentText(action, crossingClock: clock)");
    // 지난 임박 상태 문장 비움(a11y M1) · 경로 교체 시 옛 경로 표시·복구 비움 · 진행 상황 현재 안내의 body(a11y M2)
    expect(src).toContain("if let pending = imminentStatus, out.state.stepIndex >= pending.target {");
    expect(src).toMatch(/private var guideRoute: GuideRoute\? \{[\s\S]*?didSet \{[\s\S]*?liveCrossingText = nil[\s\S]*?pendingRecovery = nil[\s\S]*?pendingRecoveryEntered = nil[\s\S]*?imminentStatus = nil/);
    expect(src).toContain("currentBody: liveSteps.indices.contains(state.stepIndex) ? liveSteps[state.stepIndex].body : nil,\n                walk: sessionKind == .walk");
  });
  it("iOS GuideText 묶음 국면 진행 상황(walk는 지금 스텝부터, 웹 미러)", () => {
    const src = read("ios/Gildongmu/Directions/GuideText.swift");
    expect(src).toContain("guard walk else {");
    expect(src).toContain(".filter { $0 >= state.stepIndex }");
    expect(src).toContain("$0 == state.stepIndex ? (currentBody ?? route.steps[$0].description)");
  });
  it("안드로이드 WalkGuideModel(판본 1이어도 리듀서 입력은 넘긴다)", () => {
    const src = read("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide/WalkGuideModel.kt");
    expect(src).toContain("stopped = motion == MotionState.stopped");
    expect(src).toContain("crossing = it.crossing == true");
    expect(src).toContain("!event.late");
  });
});

