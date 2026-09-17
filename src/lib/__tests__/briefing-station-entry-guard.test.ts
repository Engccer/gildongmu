import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 경로 브리핑 역 진입점의 소스 가드(E45, spec docs/superpowers/specs/2026-09-18-briefing-station-entry-design.md §8).
 *
 * 앱 타깃엔 뷰 테스트 레인이 없고 로터·포커스는 시뮬레이터로 검출되지 않는다. 그래서 **구조가 지켜지는가**만
 * 소스에서 잠근다 — 되돌아가면 실기기 세션 하나가 지나야 알게 되는 자리들이다(선례 `transit-landing-guard`).
 */
const ROOT = join(__dirname, "../../..");
const APP = join(ROOT, "ios/Gildongmu");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const BRIEFING = read("ios/Gildongmu/RouteBriefing.swift");
const TAB = read("ios/Gildongmu/Directions/DirectionsTabView.swift");
const SHEET = read("ios/Gildongmu/Directions/TransitTrackingSheet.swift");

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return swiftFiles(full);
    return name.endsWith(".swift") ? [full] : [];
  });
}

/** `struct <name>` 선언부터 들여쓰기 0의 닫는 중괄호까지. */
function structBody(src: string, name: string): string {
  const start = src.indexOf(`struct ${name}`);
  expect(start, `struct ${name}이 없다`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end === -1 ? undefined : end);
}

/**
 * 주석 줄을 지운 코드만. 가드가 보는 것은 **코드가 무엇을 하는가**이지 주석이 무엇을 언급하는가가
 * 아니다 — 낱말로 잡으면 설계 근거를 적은 주석을 지워야 통과하게 된다.
 */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** `var body: some View` 본문. */
function bodyOf(src: string): string {
  const head = src.indexOf("var body: some View");
  expect(head, "body가 없다").toBeGreaterThan(-1);
  const end = src.indexOf("\n    }\n", head);
  return src.slice(head, end === -1 ? undefined : end);
}

/** `var rotorItems` 본문. */
function rotorItemsBody(src: string): string {
  const head = src.indexOf("var rotorItems");
  expect(head, "rotorItems가 없다").toBeGreaterThan(-1);
  const end = src.indexOf("\n    }\n", head);
  return src.slice(head, end === -1 ? undefined : end);
}

/** `.accessibilityActions {` 블록 본문(중괄호 균형으로 자른다). */
function actionsBlock(src: string): string {
  const head = src.indexOf(".accessibilityActions {");
  expect(head, "accessibilityActions 블록이 없다").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf("{", head); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(head, i + 1);
    }
  }
  throw new Error("accessibilityActions 블록이 닫히지 않았다");
}

describe("① 소비자는 옵트인이다 (spec §3.5)", () => {
  it("TransitRouteRows 호출부 전수는 둘이고, 역 진입을 켜는 곳은 길찾기 탭 하나다", () => {
    const callers: string[] = [];
    for (const file of swiftFiles(APP)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/\bTransitRouteRows\(/.test(line) || line.trim().startsWith("//")) return;
        // 호출 인자는 여러 줄에 걸친다 — 닫는 괄호까지의 창을 본다.
        const window = lines.slice(i, i + 8).join("\n");
        const opensEntry = /stationEntry:/.test(window.slice(0, window.indexOf(")\n") + 1 || undefined));
        callers.push(`${relative(APP, file)}${opensEntry ? " +stationEntry" : ""}`);
      });
    }
    // 부착 자리 **수**만 세면 조망 쪽이 켜져도 통과한다 — 파일과 값을 함께 고정한다.
    expect(callers.sort()).toEqual([
      "Directions/DirectionsTabView.swift +stationEntry",
      "Directions/GuideOverviewSheet.swift",
    ]);
  });

  it("옵트인 기본값은 꺼짐이다 — 새 소비자가 생겨도 조용히 켜지지 않는다", () => {
    const body = structBody(BRIEFING, "TransitRouteRows");
    // ⚠ 부분 매치로 보면 `… -> Void)? = { _, _ in }` 처럼 **켜진 기본값**을 다는 되돌림을 놓친다.
    //   선언 줄을 통째로 고정한다 — 타입 변경·기본값 부착·이름 변경이 모두 빨개진다.
    const declaration = body.match(/^\s*var stationEntry:.*$/m)?.[0].trim();
    expect(declaration).toBe("var stationEntry: ((TransitLegStop, String?) -> Void)?");
  });

  it("안내 조망은 push 스택이 없다 — navigationDestination·NavigationLink 0건(무반응 액션 방지 근거)", () => {
    const overview = read("ios/Gildongmu/Directions/GuideOverviewSheet.swift");
    expect(overview).not.toContain("navigationDestination");
    expect(overview).not.toContain("NavigationLink");
  });
});

describe("② 로터는 등장 순으로 들린다 (spec §3.3)", () => {
  const row = structBody(BRIEFING, "BriefingStationRow");

  it("역 묶음을 만든 **뒤** 전체를 뒤집는다 — 쌍 순서까지 함께 뒤집혀야 등장 순으로 들린다", () => {
    const items = rotorItemsBody(row);
    // ⚠ `.reversed()`가 있기만 하면 통과하는 술어는 `actions.reversed().flatMap`으로 옮기는 되돌림을
    //   놓친다 — 그러면 역 순서는 맞는데 쌍이 "A 전화 → A 상세"로 뒤집힌다. 순서를 본다.
    const flat = items.indexOf("flatMap");
    const rev = items.indexOf(".reversed()");
    expect(flat, "rotorItems가 flatMap으로 역별 묶음을 만들지 않는다").toBeGreaterThan(-1);
    expect(rev, "역순 선언이 사라졌다").toBeGreaterThan(flat);
    // 역순이 실제로 로터에 쓰이는지: 액션 블록이 그 목록을 순회한다.
    expect(actionsBlock(row)).toContain("ForEach(rotorItems)");
  });

  it("역별 묶음은 (상세, 전화) 순이다 — 선언에서는 그 역순이라 open이 먼저 만들어진다", () => {
    const items = rotorItemsBody(row);
    const open = items.indexOf("transitGuide.openStation");
    const call = items.indexOf("callLabel(");
    expect(open).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(open);
  });

  it("줄은 Text로 남는다 — 역이 하나여도 Button으로 감싸지 않는다(spec 정정 ②)", () => {
    // ⚠ "`content()` 다음 줄이 주석인가"로 보면 주석만 지워도 빨개지고(오탐), `Button { … } label:
    //   { content() }`로 감싸는 진짜 되돌림은 놓친다(미탐). 줄 뷰가 **감싸이지 않고 그대로 나오는지**를 본다.
    const body = codeOnly(bodyOf(row));
    const actions = codeOnly(actionsBlock(row));
    expect(body.replace(actions, "")).not.toMatch(/\b(Button|NavigationLink|onTapGesture)\b/);
    expect(body).toMatch(/^\s*content\(\)\s*$/m);
    expect(row).not.toContain("contentShape(Rectangle())");
  });
});

describe("③ 전화 액션은 상태와 무관하게 항상 있다 (spec §5.1·§5.3)", () => {
  it("브리핑 액션 목록은 상태로 걸러지지 않는다 — 존재가 아니라 라벨만 갈린다", () => {
    const row = structBody(BRIEFING, "BriefingStationRow");
    const block = codeOnly(actionsBlock(row));
    expect(block).not.toMatch(/\.result\(stationName:/);
    expect(block).not.toMatch(/case \.(direct|representative|unavailable|failed)/);
    // ⚠ 액션 블록만 보면 목록을 **만드는 자리**에서 거르는 되돌림을 놓친다(`actions.filter { 번호 있음 }`).
    //   거기서 걸러도 결과는 같다 — 번호 없는 역의 액션이 사라져 3상태가 액션 부재로 뭉개진다.
    const items = codeOnly(rotorItemsBody(row));
    expect(items).not.toMatch(/\.result\(stationName:/);
    expect(items).not.toMatch(/\.filter\(|\.compactMap\(|\bguard\b|\bif\b/);
  });

  it("안내 시트 경유역 로터도 같은 계약이다 — 상태 switch로 액션을 없애지 않는다(판정 ⑤)", () => {
    const block = codeOnly(actionsBlock(structBody(SHEET, "ViaStopStationRow")));
    expect(block).not.toMatch(/\.result\(stationName:/);
    expect(block).not.toMatch(/case \.(direct|representative|unavailable|failed)/);
    expect(block).not.toContain("EmptyView()");
  });

  it("3상태 문장·진동은 Kit 판정을 지나고 두 화면이 같은 창구를 쓴다", () => {
    const store = read("ios/Gildongmu/StationPhoneStore.swift");
    expect(store).toContain("briefingPhoneAnnouncement(");
    expect(store).toContain("accessibilitySpeechAnnouncementPriority = .high");
    expect(store).toContain("ResultHaptic.fire(");
    // 모름(nil)은 킥오프해야 "찾고 있습니다"가 사후적으로 참이 된다.
    const fn = store.slice(store.indexOf("func callStationPhone("));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain("await store.resolve(");
    expect(BRIEFING).toContain("callStationPhone(");
    expect(SHEET).toContain("callStationPhone(");
  });

  it("번호가 있어도 걸지 못하면 실패로 말한다 — 조용한 반환이 없다", () => {
    // 로터 액션은 눌러도 화면이 바뀌지 않으므로 통지가 유일한 증거다(헌장 §5). 보이는 전화 줄은 같은
    // 조건에서 줄 자체가 사라져 부재가 단서가 되지만, 액션은 라벨이 남아 단서가 0이다.
    const store = read("ios/Gildongmu/StationPhoneStore.swift");
    const fn = codeOnly(store.slice(store.indexOf("func callStationPhone("), store.indexOf("\n}\n", store.indexOf("func callStationPhone("))));
    // 열기 거부(전화 앱 없음)를 본다 — completion 없는 `openURL(url)` 단독 호출이면 거부가 침묵이 된다.
    expect(fn).toMatch(/openURL\(url\)\s*\{\s*accepted in/);
    expect(fn).toContain("if !accepted { announceStationPhone(.failed) }");
    // URL 조립 실패(번호에 내부 공백·부기)도 같은 창구로.
    expect(fn).toMatch(/announceStationPhone\(\.failed\)\s*\n\s*return/);
  });
});

describe("④ 저장소를 읽는 자리는 하위 뷰뿐이다 (spec §5.1 관찰 경계)", () => {
  it("브리핑 본문은 저장소를 읽지 않는다 — 번호 도착·재확인·축출이 전체 재렌더가 되지 않게", () => {
    const rowStart = BRIEFING.indexOf("private struct BriefingStationRow");
    expect(rowStart, "하위 뷰가 사라졌다").toBeGreaterThan(0);
    const beforeRow = codeOnly(BRIEFING.slice(0, rowStart));
    expect(beforeRow).not.toMatch(/\.result\(stationName:/);
    expect(beforeRow).not.toContain("StationPhoneStore.");
  });
});

describe("⑤ push한 역 상세는 길찾기 진입을 숨긴다 (spec §7)", () => {
  it("navigationDestination이 showsDirectionsEntry: false로 연다", () => {
    expect(TAB).toContain(".navigationDestination(for: StationDestination.self)");
    const dest = TAB.slice(TAB.indexOf(".navigationDestination(for: StationDestination.self)"));
    const body = dest.slice(0, dest.indexOf("\n            }"));
    expect(body).toContain("showsDirectionsEntry: false");
    expect(body).toContain("stationLineHint:");
  });

  it("push 경로가 실제로 있다 — 로터 액션은 값 기반 링크로 열 수 없다", () => {
    expect(TAB).toMatch(/@State private var stationPath: \[StationDestination\] = \[\]/);
    expect(TAB).toContain("NavigationStack(path: $stationPath)");
    expect(TAB).toContain("stationPath.append(StationDestination(");
  });
});

describe("⑥ 브리핑은 문장을 훑지 않는다 (spec §3.2)", () => {
  it("transitStationMentions를 부르지 않는다 — 어느 이름이 들어갔는지 코드가 안다", () => {
    expect(BRIEFING).not.toContain("transitStationMentions");
  });
});

describe("⑦ 미리 조회는 줄당 최대 2건이다 (spec §5.2)", () => {
  const row = structBody(BRIEFING, "BriefingStationRow");

  it("prefetch에는 이 줄의 역만 넘긴다 — leg.stops 전체가 아니다", () => {
    expect(row).toContain("prefetch(stops: [action.stop]");
    expect(BRIEFING).not.toMatch(/prefetch\(stops:\s*[A-Za-z_][\w.]*stops/);
  });

  it("줄이 떠 있는 동안 재확인한다 — 저장소는 갱신 없는 값을 6분에 지운다", () => {
    expect(row).toContain("while !Task.isCancelled");
    expect(row).toContain("StationPhoneStore.recheckSeconds");
  });
});

describe("라벨의 역 이름은 그 줄의 언어를 따른다 (spec §6)", () => {
  it("줄 언어 술어는 구간·하차 줄과 같은 하나다", () => {
    const fn = BRIEFING.slice(BRIEFING.indexOf("func briefingStationActions("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("transitLegUsesEnglish(");
    // 앱 언어 기준으로 고르면 줄은 한국어인데 라벨만 로마자가 된다.
    expect(body).not.toContain("bilingual(");
    expect(body).not.toContain(".primary");
  });
});
