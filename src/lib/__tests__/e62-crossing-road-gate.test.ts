import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 건너는 길 이름(E62 spec `2026-10-03-crosswalk-guidance-design.md` §3.5)은 판본 2(`wording=2`)의 일부다 — 2026-10-04
 * 위원장 판정으로 정식판에 졸업해 실험판 게이트(`AppConfig.experimentalCrossingRoadEnabled`·옵트인 `crossingRoad=1`)를
 * 걷었다. 플래그가 항상 참 상수로 되살아나거나, 클라이언트가 옵트인을 다시 보내거나, 서버가 그 값을 다시 읽어 판본 2의
 * 문장이 요청마다 갈리면 플랫폼 사이에 같은 경로가 다른 문장이 된다 — 오류는 나지 않는다.
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

describe("건너는 길 이름은 판본 2의 일부다(실험판 게이트 졸업)", () => {
  it("실험 플래그 식별자는 어디에도 없다(항상 참 상수로 남기지 않는다)", () => {
    const sources = [
      ...files(join(ROOT, "ios"), ".swift"),
      ...files(join(ROOT, "src"), ".ts").filter((f) => !f.endsWith("e62-crossing-road-gate.test.ts")),
      ...files(join(ROOT, "src"), ".tsx"),
      ...files(join(ROOT, "android"), ".kt"),
    ];
    const hits = sources.filter((f) => readFileSync(f, "utf8").includes("experimentalCrossingRoadEnabled"));
    expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("어느 클라이언트도 옵트인을 보내지 않는다(Kit·웹·안드로이드·CLI/MCP)", () => {
    const sources = [
      ...files(join(ROOT, "ios/GildongmuKit/Sources"), ".swift"),
      ...files(join(ROOT, "ios/Gildongmu"), ".swift"),
      ...files(join(ROOT, "src"), ".ts").filter((f) => !f.includes("__tests__") && !f.includes("/app/api/")),
      ...files(join(ROOT, "src"), ".tsx").filter((f) => !f.includes("__tests__")),
      ...files(join(ROOT, "android"), ".kt").filter((f) => !f.includes("/test/")),
      ...files(join(ROOT, "packages/cli/src"), ".ts").filter((f) => !f.includes("__tests__")),
      ...files(join(ROOT, "packages/mcp/src"), ".ts").filter((f) => !f.includes("__tests__")),
    ];
    // 요청에 붙이는 형태만 본다(URL 조각·쿼리 이름 문자열·쿼리 객체 값). 주석 속 "`crossingRoad=1`" 서술은 송신이 아니다.
    const sends = /[&?]crossingRoad=|name:\s*["']crossingRoad["']|crossingRoad:\s*["']1["']/;
    // 양성 대조: 종전 송신 형태(Kit `URLQueryItem(name: "crossingRoad", …)`·URL 조각)는 이 술어에 걸린다.
    expect(sends.test('URLQueryItem(name: "crossingRoad", value: "1")')).toBe(true);
    expect(sends.test('url += "&crossingRoad=1"')).toBe(true);
    const senders = sources.filter((f) => sends.test(readFileSync(f, "utf8")));
    expect(senders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("서버는 crossingRoad를 읽지 않고 판본 2 재작성에 길 이름 스위치가 없다", () => {
    const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
    expect(read("src/app/api/route/walk/route.ts")).not.toMatch(/searchParams\.get\("crossingRoad"\)/);
    expect(read("src/app/api/route/walk/route-schema.ts")).not.toContain("crossingRoad");
    expect(read("src/lib/walk-guidance.ts")).not.toContain("crossingRoad");
    expect(read("src/lib/walk-route.ts")).not.toContain("crossingRoad");
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

