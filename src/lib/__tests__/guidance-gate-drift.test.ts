import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 도보 안내 정식 출시 게이트의 소스 드리프트 가드
 * (spec `docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md` §7.1).
 *
 * 도보(2026-08-15)·자동차·대중교통(2026-10-01, 2.0 — spec `2026-10-01-release-2.0-graduation-design.md`
 * §2)은 정식판으로 졸업했고 나들이(E51)만 봉인이 남았다. 졸업한 수단이 다시 플래그를 보게 되면
 * 정식판에서 그 안내가 조용히 사라지고, 나들이 진입점이 플래그 밖으로 나가면 검증이 끝나지 않은
 * 안내가 정식판에서 시작된다 — 둘 다 오류를 내지 않는다.
 *
 * ⚠ 판정 축은 **플래그 참조 목록이 아니라 세션을 시작시키는 호출 전수**다(spec §3.2).
 * 플래그가 몇 군데 있는지만 세면 "진입점인데 플래그를 안 보는 자리"를 놓친다. 그래서
 * 아래 검사 3(세션 시작 호출 수 고정 — `beacon.toggle(`·`beacon.restart(`·`session.startBeacon(`·
 * `self.startBeacon(`)이 이 파일의 중심이다. N1(2026-08-22)부터 경로 행 시작 버튼은
 * `GuideSession.startBeacon`(거부 게이트 단일 진입점)을 지나고 핸드오프는 `GuideSession`
 * 안에 산다 — 호출 형태가 늘어 정규식도 늘었다.
 */

const ROOT = join(__dirname, "../../..");
const DIRECTIONS = join(ROOT, "ios/Gildongmu/Directions/DirectionsTabView.swift");
const GUIDE_SESSION = join(ROOT, "ios/Gildongmu/Directions/GuideSessionCoordinator.swift");
const INFO_PLIST = join(ROOT, "ios/Support/Info.plist");
const EXPERIMENTAL_SH = join(ROOT, "ios/scripts/experimental-infoplist.sh");
const INFOPLIST_XCSTRINGS = join(ROOT, "ios/Gildongmu/Resources/InfoPlist.xcstrings");
const IOS_DIR = join(ROOT, "ios");

/** 2.0에서 삭제된 수단 봉인 플래그 — 식별자가 iOS 어디에도 남지 않아야 한다(항상 참 상수 금지). */
const RETIRED_FLAG = "experimentalGuidanceEnabled";
/** 나들이(E51) 봉인 — 2026-09-27 위원장 재판정으로 1차는 실험판 전용. */
const OUTING_FLAG = "AppConfig.experimentalOutingEnabled";
/** 택시로 갈아타는 여정(E70) 봉인 — 첫 판은 실험판 전용(BACKLOG E70 판정 5). */
const JOURNEY_FLAG = "AppConfig.experimentalJourneyEnabled";

/** 빌드 산출물엔 파생 Swift가 섞여 있어 스캔 대상이 아니다. */
const SKIP_DIRS = new Set(["build", ".build", "DerivedData", "node_modules", ".git"]);

function swiftFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...swiftFiles(full));
    else if (name.endsWith(".swift")) out.push(full);
  }
  return out;
}

/**
 * Swift 선언의 **구현 본문**만 뽑는다(주석·문자열 리터럴 제거).
 *
 * ⚠ 원문 검사로는 안 된다 — 졸업한 선언들의 doc 주석에 `experimentalGuidanceEnabled`가
 * "이 플래그를 보지 않는다"는 설명으로 등장한다(그 주석이 사라지는 것도 회귀 신호가
 * 아니다). 주석을 남겨 두면 검사 2가 통째로 오탐이 된다.
 */
function declarationBody(source: string, name: string): string {
  const decl = new RegExp(`(?:var|func)\\s+${name}\\b`).exec(source);
  if (!decl) throw new Error(`Swift 선언 ${name}을 찾지 못했다`);
  const open = source.indexOf("{", decl.index);
  if (open < 0) throw new Error(`Swift 선언 ${name}의 여는 중괄호를 찾지 못했다`);

  let depth = 0;
  let body = "";
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      body += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return body;
    }
    body += c;
  }
  throw new Error(`Swift 선언 ${name}의 닫는 중괄호를 찾지 못했다`);
}

/** 그 식별자를 부르는 선언(func) 이름들(§8·§8-2가 같은 술어로 센다). */
function callersOf(source: string, call: string): string[] {
  const names = [...source.matchAll(/func\s+(\w+)/g)].map((m) => m[1]);
  return names.filter((name) => declarationBody(source, name).includes(call)).sort();
}

/**
 * Swift 소스에서 주석·문자열 리터럴을 같은 길이의 공백으로 지운다(오프셋 보존).
 * 아래 `enclosingHeaders`가 중괄호를 셀 때 주석·문자열 안의 `{`·`}`와, 주석에만
 * 적힌 플래그 이름("이 플래그를 보지 않는다")이 판정에 끼지 않게 한다.
 */
function blankSwiftCommentsAndStrings(source: string): string {
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

/**
 * `marker`의 매 등장 자리마다, 그 자리를 감싸는 **모든 블록의 머리말**(각 미닫힘 `{`
 * 앞 — 직전 `{`/`}`부터 그 `{`까지의 텍스트)과 마커 자신이 든 문장을 배열로 준다.
 * 안쪽 → 바깥쪽 순. 소비 지점이 어떤 조건 아래에 있는지 **줄 수 창 없이** 본다 —
 * 조건이 여러 줄이어도, 바깥 `if`로 감싸도 그 머리말에 잡힌다(G4).
 */
function enclosingHeaders(source: string, marker: string): string[][] {
  const clean = blankSwiftCommentsAndStrings(source);
  const results: string[][] = [];
  let from = 0;
  for (;;) {
    const at = clean.indexOf(marker, from);
    if (at < 0) break;
    from = at + marker.length;
    // 마커가 든 문장: 직전 `{`/`}`부터 다음 `{`/`}` 사이(줄바꿈은 경계가 아니다 —
    // 여러 줄 조건을 한 문장으로 잡기 위함).
    let stmtStart = at;
    while (stmtStart > 0 && clean[stmtStart - 1] !== "{" && clean[stmtStart - 1] !== "}") stmtStart--;
    let stmtEnd = at;
    while (stmtEnd < clean.length && clean[stmtEnd] !== "{" && clean[stmtEnd] !== "}") stmtEnd++;
    const headers = [clean.slice(stmtStart, stmtEnd)];
    // 바깥으로 올라가며 미닫힘 `{`마다 그 머리말을 모은다.
    let depth = 0;
    for (let i = at; i >= 0; i--) {
      const c = clean[i];
      if (c === "}") depth++;
      else if (c === "{") {
        if (depth > 0) {
          depth--;
          continue;
        }
        let start = i;
        while (start > 0 && clean[start - 1] !== "{" && clean[start - 1] !== "}") start--;
        headers.push(clean.slice(start, i));
      }
    }
    results.push(headers);
  }
  if (results.length === 0) throw new Error(`마커 ${marker}를 찾지 못했다`);
  return results;
}

/** 마커가 있는 줄과 그 앞 `lines`줄. 버튼이 어느 게이트 안에 있는지 보는 데 쓴다. */
function windowBefore(source: string, marker: string, lines: number): string {
  const all = source.split("\n");
  const idx = all.findIndex((line) => line.includes(marker));
  if (idx < 0) throw new Error(`마커 ${marker}를 찾지 못했다`);
  return all.slice(Math.max(0, idx - lines), idx + 1).join("\n");
}

/** Info.plist의 `UIBackgroundModes` 배열 원소. */
function backgroundModes(plist: string): string[] {
  const block = /<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
  if (!block) throw new Error("Info.plist에서 UIBackgroundModes 배열을 찾지 못했다");
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}

/** InfoPlist.xcstrings의 위치 권한 문구를 로케일별로. */
function locationPurposeStrings(): Record<string, string> {
  const catalog = JSON.parse(readFileSync(INFOPLIST_XCSTRINGS, "utf8"));
  const entry = catalog.strings?.NSLocationWhenInUseUsageDescription;
  if (!entry) throw new Error("InfoPlist.xcstrings에 NSLocationWhenInUseUsageDescription이 없다");
  const localizations = (entry.localizations ?? {}) as Record<
    string,
    { stringUnit: { value: string } }
  >;
  return Object.fromEntries(
    Object.entries(localizations).map(([locale, v]) => [locale, v.stringUnit.value]),
  );
}

const directions = () => readFileSync(DIRECTIONS, "utf8");

describe("1. 자동차·대중교통은 2.0에서 플래그를 졸업했다", () => {
  // 졸업한 게이트가 다시 플래그를 보면 정식판에서 그 안내가 조용히 사라진다. 플래그 선언 자체를
  // 지웠으므로 식별자가 iOS 어디에도 없어야 한다(주석도 — 삭제된 심볼이 문서에서 계속 지시하면
  // 뜻이 반대로 읽힌다).
  it("experimentalGuidanceEnabled 식별자가 iOS 소스에 남아 있지 않다", () => {
    const offenders = swiftFiles(IOS_DIR).filter((file) =>
      readFileSync(file, "utf8").includes(RETIRED_FLAG),
    );
    expect(offenders).toEqual([]);
  });
  it.each(["carGuideStartable", "altTransitGuideStartable"])("%s 본문에 실험 플래그가 없다", (name) => {
    expect(declarationBody(directions(), name)).not.toContain("experimental");
  });
  it("자동차 시작 버튼이 carGuideStartable 게이트 안에 있다", () => {
    expect(windowBefore(directions(), '"beacon.guideStartCar"', 5)).toContain(
      "carGuideStartable",
    );
  });
  it("간략 단독 시작 버튼은 되살아나지 않는다(E16 축2 — 간략은 모드가 아니라 내부 강등)", () => {
    // 2.0에서 그 버튼과 라벨 키를 지웠다. 선두 섹션의 버튼은 추적 중 "안내 종료" 한 얼굴뿐이다.
    const offenders = swiftFiles(IOS_DIR).filter((file) =>
      /briefGuideStart|briefFallbackVisible/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
    for (const locale of ["ko", "en", "ja", "es", "fr", "it"]) {
      const messages = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"));
      expect(messages.beacon.briefGuideStart, locale).toBeUndefined();
    }
  });
});

describe("2. 도보 경로는 플래그를 졸업했다", () => {
  // 항상 참인 상수를 남기지 않는 것이 이 방식의 관리 포인트다(spec §3.1). 도보
  // 선언이 다시 플래그를 보게 되면 정식판에서 도보 안내가 조용히 사라진다.
  it.each(["walkGuideStartable", "announceGuideStartIfManualOrigin"])(
    "%s 구현 본문에 봉인 플래그가 없다",
    (name) => {
      expect(declarationBody(directions(), name)).not.toContain(
        "experimentalGuidanceEnabled",
      );
    },
  );

  it("사용자 시작 버튼의 세션 시작 호출은 전부 수동 위치 고지를 앞세운다(G4)", () => {
    // 고지는 안내 시작의 직접 응답이라 시작 버튼 핸들러 안에 있다. 정식판 진입점
    // (도보 추천·최단)이 고지 없이 시작하는 회귀는 선언 본문 검사로는 못 잡는다 —
    // 각 시작 호출(`beacon.toggle(`·`session.startBeacon(`) 직전 몇 줄에 호출이 있어야
    // 한다. 대중교통→도보 핸드오프(그 세션은 이미 실좌표 위에서 돌고 있었다 — 고지 대상
    // 아님)는 N1부터 `GuideSession.acceptWalkHandoff` 안에 살아 이 파일에 없고,
    // `restart()`(정밀 위치 허용 뒤 같은 세션 재시작)는 처음 시작 때 이미 말했다.
    const src = directions();
    const lines = src.split("\n");
    const starts = lines
      .map((line, i) =>
        line.includes("beacon.toggle(") || line.includes("session.startBeacon(") ? i : -1,
      )
      .filter((i) => i >= 0);
    // 자동차·도보 줄(E42 — 줄 목록 `ForEach` 안 한 호출이 모든 줄을 맡는다). 간략 폴백(toggle)은 2.0에서 삭제됐다.
    expect(starts.length).toBe(2);
    const announced = starts.filter((i) =>
      lines.slice(Math.max(0, i - 3), i).some((l) => l.includes("announceGuideStartIfManualOrigin()")),
    );
    expect(announced.length).toBe(2);
    // 핸드오프 진입점은 GuideSession 안에 둘이다 — 대중교통→도보(`acceptWalkHandoff`. 사용자
    // 활성화가 맞다 — 2026-09-11 E34부터 마지막 leg의 "남은 도보 안내 시작" 한 버튼이 leg 종료와
    // 함께 부른다. 대중교통 세션이 봉인 안이라 도달 불가이고 그 세션은 이미 실좌표 위에 있었으므로
    // 수동 위치 고지 대상이 아니다)와
    // 자동차 도착→도보(`acceptCarWalkHandoff`, 2026-08-23 K2. 자동차 세션이 봉인 안이라 도달
    // 불가이지만 도보 세션 자체는 졸업한 기능이라 별도 게이트가 없다 — spec K2 §6.4).
    // 승차 전 도보(A25, 2026-08-30 — `startTransit` 안. 대중교통 시작 버튼이 봉인 안이라 도달 불가)까지 셋,
    // 나들이 귀환(E51, 2026-09-26 — `acceptOutingReturn`. 나들이 세션은 이미 실좌표 위에 있었고, 그 세션이
    // 실험판 봉인 안이라 정식판에서 도달 불가)까지 넷. E70(2026-10-17)에서 승차 전 도보는 거부 가드 없는 본문
    // `beginTransit` 안의 `beginBeacon(`으로 옮겼다(여정 중 내부 인계가 `refuseIfActive`에 막히지 않게) — `self.startBeacon(`은 셋.
    const session = readFileSync(GUIDE_SESSION, "utf8");
    expect(session.match(/self\.startBeacon\(/g)).toHaveLength(3);
    expect(declarationBody(session, "acceptOutingReturn")).toContain("self.startBeacon(");
    expect(declarationBody(session, "acceptWalkHandoff")).toContain("self.startBeacon(");
    expect(declarationBody(session, "acceptCarWalkHandoff")).toContain("self.startBeacon(");
    expect(declarationBody(session, "startTransit")).toContain("beginTransit(");
    expect(declarationBody(session, "beginTransit")).toContain("beginBeacon(");
  });

  it("구 플래그 realtimeGuidanceEnabled가 남아 있지 않다", () => {
    const offenders = swiftFiles(IOS_DIR).filter((file) =>
      readFileSync(file, "utf8").includes("realtimeGuidanceEnabled"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("3. 안내 세션 진입점이 늘지 않았다", () => {
  /**
   * 안내 세션을 시작시키는 자리의 **전수**. spec §3.2가 6곳을 판정해 두었고(도보
   * 추천·도보 최단·정밀 위치 허용 후 재시작은 정식판 도달, 간략 단독·자동차·대중교통
   * 인계는 차단), 2026-08-23 K2가 7번째(자동차 도착→도보 인계 `acceptCarWalkHandoff`,
   * 자동차 종료 화면 안이라 봉인 뒤)를 더했고, 2026-08-30 A25가 8번째(대중교통 시작 →
   * 승차 전 도보 `GuideSession.startTransit`, 대중교통 시작 버튼이 봉인 안이라 도달 불가)를 더했다.
   * 2026-09-11 E34(마지막 leg 단일 버튼)는 진입점을 더하지 않았다 — 시트가 `acceptWalkHandoff`를
   * 클로저(`onWalkHandoff`)로 부를 뿐 `startBeacon(` 형태가 늘지 않는다(설계 리뷰 확인).
   * 2026-09-23 E42는 도보 추천·최단 두 호출을 줄 목록 `ForEach` 안 한 호출로 합쳐 **7곳**이 됐다
   * (진입점이 준 것이 아니라 호출 형태가 합쳐졌다 — 도보 줄은 여전히 정식판 도달).
   * 2026-09-26 E51이 **8곳**으로 늘렸다: 나들이 귀환 인계 `GuideSession.acceptOutingReturn`(나들이 세션 안이라
   * 실험판 봉인 뒤 — 2026-09-27 위원장 재판정). 나들이 세션 자체의 시작은 도보 세션이 아니라 아래 별도 검사가 센다.
   * 2026-10-01 2.0이 **7곳**으로 줄였다: 간략 단독 시작 버튼(`beacon.toggle(`)을 지웠다(E16 축2). 자동차·대중교통
   * 진입점은 그대로이고 플래그만 졸업했다 — 이제 7곳 중 봉인 뒤는 나들이 귀환 인계 하나다.
   *
   * ⚠ 판정 축은 "`toggle`을 부르는가"가 아니라 **세션을 시작시키는가**다. A13이
   * 정밀 위치 복구 경로를 `beacon.restart()`로 바꿨을 때 `toggle`만 세는 검사는
   * 그 진입점을 통째로 시야에서 잃었다 — 호출 형태가 늘면 여기에 함께 적는다.
   *
   * ⚠ 이 수가 늘면 실패하는 것이 **의도**다. 새 진입점이 생기면 spec §3.2 표를
   * 갱신하며 그 자리가 정식판에 도달하는지 판정한 뒤 이 수를 올린다. 플래그 참조만
   * 세는 검사로는 "진입점인데 플래그를 안 보는 자리"를 영영 못 잡는다.
   *
   * ⚠ 스캔은 앱 타깃이 아니라 **iOS 전체**다(독립 리뷰 관찰 2026-08-15). N1(2026-08-22)
   * 에서 그 우려가 실제가 됐다 — 모델이 앱 수명 `GuideSession`으로 올라가 핸드오프
   * 진입점이 `DirectionsTabView` 밖(`GuideSession.acceptWalkHandoff`)으로 갔다. 경로 행
   * 시작 버튼은 `session.startBeacon(`(거부 게이트 단일 진입점)으로 형태가 바뀌었다.
   * `beacon.requestStart(`는 `startBeacon` 내부의 한 겹이라 진입점이 아니다.
   */
  // E70(2026-10-17)이 형태 둘을 더했다: 거부 가드 없는 비콘 시작 본문 `beginBeacon(`(호출 셋 — 공개 `startBeacon`의
  // 본문, 승차 전 도보 `beginTransit`, 여정 단계 `launchJourneyBeacon`)과 여정 시작 `GuideSession.shared.startJourney(`
  // (길찾기 탭 하나, 실험판 봉인 뒤 — 아래 "7"이 잠근다). `func beginBeacon(` 선언은 세지 않는다.
  const ENTRY_CALL =
    /(?:beacon\.(?:toggle|restart)|(?:session|self)\.startBeacon|(?<!func )beginBeacon|GuideSession\.shared\.startJourney)\(/g;

  // A68(2026-10-17)이 정밀 위치 재시작 호출을 둘로 나눴다(`GuideSession.restartBeacon` 안: 승차 전 도보 연결을 다시 건
  // 재시작과 그냥 재시작). 진입점은 같은 버튼 하나이고 정식판 도달 판정도 같다 — 아래 "8"이 그 한 버튼을 잠근다.
  it("안내 세션 진입점 호출이 정확히 11곳이다", () => {
    const sites = swiftFiles(IOS_DIR).flatMap((file) => {
      const hits = readFileSync(file, "utf8").match(ENTRY_CALL) ?? [];
      return hits.map(() => file);
    });
    expect(sites).toHaveLength(11);
  });

  /**
   * 나들이(E51) 세션의 시작은 `GuideSession.startOuting` 한 곳이고(거부 게이트·다른 모델 잔여 화면 소거),
   * 그것을 부르는 진입점은 둘(제목 메뉴·길찾기 탭 도착지 없는 조회의 거절 자리 버튼)이다. `outing.requestStart(`를
   * 다른 자리에서 부르면 거부 게이트를 건너뛴다.
   *
   * 실험판 봉인(2026-09-27 위원장 재판정): 진입점 둘이 전부 `experimentalOutingEnabled` 조건 아래에 있어야
   * 정식판에서 나들이 도달 경로가 0이다(시트·띠바·종료 화면·귀환 인계는 세션이 시작돼야만 나타난다).
   */
  it("나들이 시작은 startOuting 한 경로, 진입점 둘", () => {
    const calls = swiftFiles(IOS_DIR).flatMap((file) =>
      (readFileSync(file, "utf8").match(/GuideSession\.shared\.startOuting\(\)/g) ?? []).map(() =>
        file.split("/").pop(),
      ),
    );
    expect(calls.sort()).toEqual(["DirectionsTabView.swift", "TitleMenu.swift"]);
    const starts = swiftFiles(IOS_DIR).flatMap((file) =>
      (readFileSync(file, "utf8").match(/outing\.requestStart\(/g) ?? []).map(() => file.split("/").pop()),
    );
    expect(starts).toEqual(["GuideSessionCoordinator.swift"]);
    expect(declarationBody(readFileSync(GUIDE_SESSION, "utf8"), "startOuting")).toContain("outing.requestStart(");
  });

  it.each([
    ["TitleMenu.swift", join(ROOT, "ios/Gildongmu/TitleMenu.swift")],
    ["DirectionsTabView.swift", DIRECTIONS],
  ])("%s의 나들이 진입점이 실험판 봉인 조건 안에 있다", (_name, file) => {
    const sites = enclosingHeaders(readFileSync(file, "utf8"), "GuideSession.shared.startOuting()");
    expect(sites).toHaveLength(1);
    expect(sites[0].join("\n")).toContain(OUTING_FLAG);
  });

  it("재시작 진입점은 인자를 다시 조립하지 않는다(A13)", () => {
    // `restart()`가 인자를 받게 되는 순간 호출부가 다시 시작 인자의 소유자가 되고,
    // 그 자리에서 하나를 빠뜨리는 것이 정확히 A13의 결함이었다.
    const hits = swiftFiles(IOS_DIR).flatMap(
      (file) => readFileSync(file, "utf8").match(/beacon\.restart\([^)]*\)/g) ?? [],
    );
    expect(hits).toEqual(["beacon.restart()", "beacon.restart()"]);
  });
});

describe("7. 여정(E70) — 실험판 봉인과 내부 인계", () => {
  const session = () => readFileSync(GUIDE_SESSION, "utf8");
  /** 그 식별자를 부르는 선언(func) 이름들 — 호출 자리의 주인. */
  function callersOf(source: string, call: string): string[] {
    const names = [...source.matchAll(/func\s+(\w+)/g)].map((m) => m[1]);
    return names.filter((name) => declarationBody(source, name).includes(call)).sort();
  }

  it("여정 시작은 길찾기 탭 한 곳이고 실험판 봉인 조건 안에 있다", () => {
    const calls = swiftFiles(IOS_DIR).flatMap((file) =>
      (readFileSync(file, "utf8").match(/GuideSession\.shared\.startJourney\(/g) ?? []).map(() => file.split("/").pop()),
    );
    expect(calls).toEqual(["DirectionsTabView.swift"]);
    const sites = enclosingHeaders(directions(), "GuideSession.shared.startJourney(");
    expect(sites).toHaveLength(1);
    expect(sites[0].join("\n")).toContain(JOURNEY_FLAG);
  });

  it("거부 가드 없는 시작 본문의 호출자는 공개 시작·내부 인계·여정 단계뿐이다", () => {
    expect(callersOf(session(), "beginBeacon(")).toEqual(["beginTransit", "launchJourneyBeacon", "startBeacon"]);
    expect(callersOf(session(), "beginTransit(")).toEqual(["startJourneyStage", "startTransit"]);
    expect(callersOf(session(), "launchJourneyBeacon(")).toEqual(["startJourneyStage"]);
    expect(callersOf(session(), "startJourneyStage(")).toEqual(["advanceJourney"]);
  });

  it("여정 단계 시작은 token 결박 + 단계 세션 부재를 먼저 확인한다(spec §6.3 — 점유를 풀지 않는다)", () => {
    // 본문 첫 `guard` 한 문장이 넷을 다 건다 — 본문 아래 불변식 검사에도 같은 낱말이 있어 낱말 존재만으로는 못 가른다.
    const body = declarationBody(session(), "startJourneyStage");
    const firstGuard = /guard\b([^]*?)\belse\b/.exec(body)?.[1] ?? "";
    for (const needle of ["journey?.token == token", "!beacon.isTracking", "!beacon.starting", "!transit.isTracking"]) {
      expect(firstGuard, needle).toContain(needle);
    }
  });

  it("외부 시작 거부는 여정을 포함한 점유(isOccupied)를 보고, 모델 입구의 isActive엔 여정이 없다", () => {
    expect(declarationBody(session(), "refuseIfActive")).toContain("isOccupied");
    expect(declarationBody(session(), "isActive")).not.toContain("journey");
    expect(declarationBody(session(), "isOccupied")).toContain("journey != nil");
  });

  it("길찾기 탭의 정밀 위치 재시작은 여정 중 거부된다(재시작 창구의 거부 게이트가 여정을 포함한 점유를 본다)", () => {
    expect(declarationBody(session(), "restartBeacon")).toContain("refuseIfActive()");
  });

  it("여정 택시는 늘 승객이고, 비콘 시작 요청은 전부 청취자를 밝힌다(기본값 없음, D10)", () => {
    expect(declarationBody(session(), "launchJourneyBeacon")).toContain(".passenger");
    const unstated = swiftFiles(IOS_DIR).flatMap((file) => {
      const src = blankSwiftCommentsAndStrings(readFileSync(file, "utf8"));
      return [...src.matchAll(/StartRequest\(/g)].flatMap((m) => {
        if (src.slice(Math.max(0, m.index - 7), m.index) === "struct ") return [];
        let depth = 0;
        let i = m.index + "StartRequest".length;
        for (; i < src.length; i++) {
          if (src[i] === "(") depth++;
          if (src[i] === ")" && --depth === 0) break;
        }
        return src.slice(m.index, i).includes("carListener:") ? [] : [`${file.split("/").pop()}:${m.index}`];
      });
    });
    expect(unstated).toEqual([]);
  });

  it("대중교통의 완료(.done) 갈래는 completeOrAdvance 한 곳이고 여정 완료 콜백을 부른다(spec §6.3)", () => {
    const transit = readFileSync(join(ROOT, "ios/Gildongmu/Directions/TransitGuideModel.swift"), "utf8");
    const clean = blankSwiftCommentsAndStrings(transit);
    expect(clean.match(/==\s*\.done\b/g)).toHaveLength(1);
    expect(declarationBody(transit, "completeOrAdvance")).toContain("== .done");
    expect(declarationBody(transit, "completeOrAdvance")).toContain("onJourneyRideCompleted");
  });
});

describe("8. 정밀 위치 재시작은 승차 전 도보를 대중교통까지 잇는다(A68)", () => {
  const session = () => readFileSync(GUIDE_SESSION, "utf8");
  const clean = () => blankSwiftCommentsAndStrings(session());

  it("길찾기 탭은 모델을 직접 재시작하지 않고 세션 소유자의 재시작 창구 하나를 정밀 위치 허용 뒤에 부른다", () => {
    expect(blankSwiftCommentsAndStrings(directions())).not.toMatch(/\.restart\(/);
    const sites = enclosingHeaders(directions(), "session.restartBeacon()");
    expect(sites).toHaveLength(1);
    const headers = sites[0].join("\n");
    expect(headers).toContain(".granted");
    expect(headers).toContain(".precise");
  });

  it("모델 재시작(`.restart()`)은 앱 전체에서 재시작 창구 안뿐이다(받는 이름이 `beacon`이 아니어도)", () => {
    const files = swiftFiles(IOS_DIR).filter((file) =>
      /\.restart\(/.test(blankSwiftCommentsAndStrings(readFileSync(file, "utf8"))),
    );
    expect(files).toEqual([GUIDE_SESSION]);
    expect(clean().match(/\.restart\(/g)).toHaveLength(2);
    expect(declarationBody(session(), "restartBeacon").match(/beacon\.restart\(\)/g)).toHaveLength(2);
  });

  it("재시작 창구: 거부 게이트가 먼저, 걷기는 언제나 모델이 든 인자, 승차 전 도보였으면 그 앞에 연결을 다시 건다", () => {
    const body = declarationBody(session(), "restartBeacon");
    // 진행 중인 대중교통·여정이 있으면 도보로 되돌아가지 않는다 — 어느 갈래보다 앞이어야 한다.
    expect(body).toMatch(/^\{\s*guard !refuseIfActive\(\) else \{ return \}/);
    expect(body).toMatch(/guard let context = prewalkRestart else \{\s*beacon\.restart\(\)\s*return\s*\}/);
    expect(body).toMatch(/launchPrewalk\([^]*\{\s*beacon\.restart\(\)\s*\}/);
    // 세션 중 바꾼 목적지·경유지·줄이 모델의 시작 인자에 동기화돼 있다 — 여기서 걷기 인자를 조립하거나 대중교통 시작 본문을
    // 다시 돌리면(그 안에서 새 요청을 만든다) 그것이 처음 값으로 되돌아간다(A13 동형).
    for (const banned of ["StartRequest(", "beginTransit(", "beginBeacon(", "startBeacon("]) {
      expect(body, banned).not.toContain(banned);
    }
    // A67 대기 창의 대중교통 시작을 취소한 뒤 연결을 다시 건다(순서가 거꾸로면 새 연결을 지운다).
    expect(body.indexOf("cancelPrewalk()")).toBeGreaterThan(-1);
    expect(body.indexOf("cancelPrewalk()")).toBeLessThan(body.indexOf("launchPrewalk("));
    expect(callersOf(session(), "launchPrewalk(")).toEqual(["beginTransit", "restartBeacon"]);
  });

  it("연결 한 벌: 표식·종료 훅·시작 문장은 launchPrewalk 한 곳에서 걸린다", () => {
    const body = declarationBody(session(), "launchPrewalk");
    for (const needle of ["beacon.markPrewalk(", "beacon.onSessionEnd =", "transitPrewalkStartLine(", "startWalk()"]) {
      expect(body, needle).toContain(needle);
    }
    expect(body.indexOf("beacon.markPrewalk(")).toBeLessThan(body.indexOf("startWalk()"));
    expect(clean().match(/beacon\.markPrewalk\(/g)?.length).toBe(2); // + 여정 접근 도보(startJourneyStage)
  });

  it("재시작 컨텍스트는 비콘의 직전 시작 인자와 짝이다: 세우는 자리 하나, 거두는 자리 하나", () => {
    // 세우는 자리(승차 전 도보 시작 — 여정 안이면 비운다)와 거두는 자리(`retirePrewalkRestart`, 실패 줄과 함께).
    expect(clean().match(/\bprewalkRestart\s*=/g)).toHaveLength(2);
    expect(declarationBody(session(), "launchPrewalk")).toContain("prewalkRestart = journey == nil ? context : nil");
    expect(declarationBody(session(), "retirePrewalkRestart")).toContain("prewalkRestart = nil");
    expect(declarationBody(session(), "beginBeacon")).toMatch(/if !launchingPrewalk \{ retirePrewalkRestart\(\) \}/);
    // 연결의 종료는 거두지 않는다 — 타기 전에 대중교통을 끝냈으면 남은 버튼이 걷기 → 대중교통을 다시 잇는다.
    for (const name of ["cancelPrewalk", "endPrewalk", "finishJourney", "restartBeacon"]) {
      expect(declarationBody(session(), name), name).not.toContain("prewalkRestart =");
      expect(declarationBody(session(), name), name).not.toContain("retirePrewalkRestart(");
    }
  });
});

describe("8-2. 한 번 탔거나 무관한 안내가 시작되면 승차 전 도보의 실패 줄과 버튼을 거둔다(A68 판정 2)", () => {
  const TRANSIT_MODEL = join(ROOT, "ios/Gildongmu/Directions/TransitGuideModel.swift");
  const BEACON_MODEL = join(ROOT, "ios/Gildongmu/Directions/BeaconModel.swift");
  const session = () => readFileSync(GUIDE_SESSION, "utf8");

  it("거두기는 컨텍스트와 실패 줄을 한 함수에서 함께 지우고, 승차 전 도보의 실패가 아니면 건드리지 않는다", () => {
    const body = declarationBody(session(), "retirePrewalkRestart");
    // 본문 고정은 의도다(거두는 자리 한 곳) — 여기에 줄을 더해야 하면 가드를 넓히기 전에 그 줄이 이 함수의 일인지 먼저 본다.
    expect(body).toMatch(/^\{\s*guard prewalkRestart != nil else \{ return \}\s*prewalkRestart = nil\s*beacon\.clearFailure\(\)\s*$/);
    // 실패 줄을 거두는 모델 함수는 이 한 자리에서만 불린다(앱 전체).
    const callers = swiftFiles(IOS_DIR).filter((file) =>
      /\.clearFailure\(/.test(blankSwiftCommentsAndStrings(readFileSync(file, "utf8"))),
    );
    expect(callers).toEqual([GUIDE_SESSION]);
    expect(blankSwiftCommentsAndStrings(session()).match(/\.clearFailure\(/g)).toHaveLength(1);
  });

  it("거두는 자리: 무관한 안내의 시작 넷(비콘·대중교통·나들이·여정)과 대중교통이 그 계획을 지나간 때", () => {
    const callers = callersOf(session(), "retirePrewalkRestart(").filter((name) => name !== "retirePrewalkRestart");
    expect(callers).toEqual(["beginBeacon", "beginTransit", "startJourney", "startOuting", "transitPassedPrewalk"]);
    // 대중교통 시작은 거둔 뒤에 새 연결을 세운다(거꾸로면 새 연결을 지운다).
    const transit = declarationBody(session(), "beginTransit");
    expect(transit.indexOf("retirePrewalkRestart()")).toBeLessThan(transit.indexOf("launchPrewalk("));
    expect(declarationBody(session(), "transitPassedPrewalk")).toMatch(/^\{\s*retirePrewalkRestart\(\)\s*$/);
  });

  it("대중교통 모델은 두 자리에서만 알린다: 탔다(국면 전이 하나)와 경로·목적지 교체", () => {
    const model = readFileSync(TRANSIT_MODEL, "utf8");
    expect(blankSwiftCommentsAndStrings(model).match(/transitPassedPrewalk\(/g)).toHaveLength(2);
    expect(callersOf(model, "GuideSession.shared.transitPassedPrewalk()")).toEqual(["changeRoute", "dispatch"]);
    const dispatch = declarationBody(model, "dispatch");
    // 탔다 = riding 이후 국면 ∨ 다음 leg. riding만 보면 riding을 거치지 않고 탄 길(대기에서 하차역 선언 → arrived,
    // 추적 불가 [다음 구간] → 다음 leg·done)을 놓친다. 전이(이전엔 아니었고 이제 그렇다)에서만 부른다.
    expect(dispatch).toMatch(
      /\[\.riding, \.arrived, \.done\]\.contains\(s\.phase\) \|\| s\.legIndex > 0/,
    );
    expect(dispatch).toContain("if boarded(result.state), !boarded(state) { GuideSession.shared.transitPassedPrewalk() }");
    // 경로 교체는 변환이 성공해 커밋되는 자리에서 — 실패(`return false`)한 교체는 계획을 바꾸지 않는다.
    const change = declarationBody(model, "changeRoute");
    expect(change.indexOf("else { return false }")).toBeLessThan(change.indexOf("transitPassedPrewalk()"));
    expect(change.indexOf("transitPassedPrewalk()")).toBeLessThan(change.indexOf("self.route = guideRoute"));
  });

  it("실패 줄 거두기는 추적·시작 중이 아니고 실패 상태일 때만, 상태·문장·해결 수단을 함께 지운다", () => {
    const body = declarationBody(readFileSync(BEACON_MODEL, "utf8"), "clearFailure");
    expect(body).toMatch(/guard !isTracking, !starting, status\.isFailure else \{ return \}/);
    // `declarationBody`는 문자열 리터럴 내용을 지운다 — 문장 소거는 대입 자리만 본다.
    for (const needle of ["status = .idle", "statusText = ", "failResolution = .none"]) {
      expect(body, needle).toContain(needle);
    }
    expect(body).not.toContain("lastFailure");
  });
});

describe("4. 백그라운드 위치·오디오가 선언돼 있다", () => {
  // 역할이 갈린다(spec §4.1): 앱을 깨어 있게 유지하는 것은 location이고 audio는
  // 재생만 허용한다. 하나만 있으면 잠금 화면에서 세션이 죽거나 톤이 무음이 된다.
  it("Info.plist UIBackgroundModes에 location과 audio가 있다", () => {
    const modes = backgroundModes(readFileSync(INFO_PLIST, "utf8"));
    expect(modes).toContain("location");
    expect(modes).toContain("audio");
  });
});

describe("5. 위치 권한 문구를 한 곳에서만 관리한다", () => {
  // 거리 안내 절이 정식 문구로 들어갔으므로 실험판 후처리 스크립트는 더 이상 권한
  // 문구를 만지지 않는다(spec §4.2). 두 곳이 같은 값을 관리하면 다음 개정 때 갈린다.
  it("실험판 후처리 스크립트가 권한 문구를 만지지 않는다", () => {
    expect(readFileSync(EXPERIMENTAL_SH, "utf8")).not.toContain(
      "NSLocationWhenInUseUsageDescription",
    );
  });

  it("ko 문구에 거리 안내 절이 있다", () => {
    expect(locationPurposeStrings().ko).toContain("남은 거리를 소리로");
  });

  it("비한국어 5로케일에는 거리 안내 절이 없다", () => {
    // 도보 안내는 ko 전용 게이트라 다른 로케일에서 시작될 수 없다. 없는 기능을
    // 설명하는 권한 문구는 심사 위험이다.
    const DISTANCE_CLAUSE: Record<string, RegExp> = {
      en: /remaining distance/i,
      es: /distancia restante/i,
      fr: /distance restante/i,
      it: /distanza rimanente/i,
      ja: /残り距離/,
    };
    const strings = locationPurposeStrings();
    const offenders = Object.entries(DISTANCE_CLAUSE)
      .filter(([locale, pattern]) => pattern.test(strings[locale] ?? ""))
      .map(([locale]) => locale);
    expect(offenders).toEqual([]);
    // 로케일이 통째로 빠지면 위 검사가 공허하게 통과한다.
    expect(Object.keys(strings).sort()).toEqual(["en", "es", "fr", "it", "ja", "ko"]);
  });
});

describe("6. 안내 시트의 화면 힌트가 삭제된 채다", () => {
  // 백그라운드 승격과 짝이다(spec §4.4) — 화면을 켜 두라는 안내가 남으면 거짓말이다.
  // ⚠ 스캔은 `.swift`로 한정한다: 생성물 `Localizable.xcstrings`에는 그 키가 남아
  // 있고(웹 전용 문자열), 웹 `DistanceBeacon.tsx`도 그 문장이 참이라 남아야 한다.
  it.each(["beacon.screenHint", "beaconScreenHintDismissed"])(
    "iOS Swift 소스에 %s 참조가 없다",
    (needle) => {
      const offenders = swiftFiles(IOS_DIR).filter((file) =>
        readFileSync(file, "utf8").includes(needle),
      );
      expect(offenders).toEqual([]);
    },
  );
});

describe("가드 자체가 살아 있다", () => {
  // 조용히 통과하는 가드는 가드가 아니다(format-drift.test.ts 관례).
  it("declarationBody는 선언을 못 찾으면 throw한다", () => {
    expect(() => declarationBody("struct A {}", "walkGuideStartable")).toThrow(
      /찾지 못했다/,
    );
  });

  it("declarationBody는 본문이 닫히지 않으면 throw한다", () => {
    expect(() => declarationBody("var x: Bool { guard true", "x")).toThrow(
      /닫는 중괄호/,
    );
  });

  it("declarationBody는 주석·문자열을 본문에서 걷어낸다", () => {
    const body = declarationBody(
      ['/// experimentalGuidanceEnabled를 보지 않는다', 'var x: Bool {', '  // experimentalGuidanceEnabled', '  return flag("experimentalGuidanceEnabled")', '}'].join("\n"),
      "x",
    );
    expect(body).not.toContain("experimentalGuidanceEnabled");
    expect(body).toContain("return flag(");
  });

  it("enclosingHeaders는 여러 줄 조건과 바깥 블록의 플래그를 모두 잡고 주석은 무시한다", () => {
    const src = [
      "var body: some View {",
      "  // experimentalGuidanceEnabled 주석은 무시",
      "  if AppConfig.experimentalGuidanceEnabled {",
      "    if !beacon.isTracking,",
      '       let notice = manualOriginNoticeText { Text("x") }',
      "  }",
      "  if let notice = manualOriginNoticeText,",
      "     AppConfig.experimentalGuidanceEnabled { Text(notice) }",
      "}",
    ].join("\n");
    const sites = enclosingHeaders(src, "manualOriginNoticeText");
    expect(sites).toHaveLength(2);
    // 첫 자리: 자기 문장엔 없지만 바깥 if 머리말에 플래그.
    expect(sites[0][0]).not.toContain("experimentalGuidanceEnabled");
    expect(sites[0].join("\n")).toContain("experimentalGuidanceEnabled");
    // 둘째 자리: 여러 줄 조건의 다음 줄에 플래그.
    expect(sites[1][0]).toContain("experimentalGuidanceEnabled");
    // 주석에만 있는 플래그는 어느 머리말에도 없다.
    const clean = ["var body: some View {", "  // experimentalGuidanceEnabled", "  if let n = manualOriginNoticeText { }", "}"].join("\n");
    expect(enclosingHeaders(clean, "manualOriginNoticeText")[0].join("\n")).not.toContain(
      "experimentalGuidanceEnabled",
    );
    expect(() => enclosingHeaders("a", "없는마커")).toThrow(/찾지 못했다/);
  });

  it("windowBefore는 마커를 못 찾으면 throw한다", () => {
    expect(() => windowBefore("a\nb", "없는마커", 3)).toThrow(/찾지 못했다/);
  });

  it("backgroundModes는 배열을 못 찾으면 throw한다", () => {
    expect(() => backgroundModes("<dict></dict>")).toThrow(/찾지 못했다/);
  });

  it("Swift 스캔이 빈 목록이 아니다", () => {
    // 부재 검사(2·3·6)는 스캔이 0건이면 전부 공허하게 통과한다.
    const files = swiftFiles(IOS_DIR);
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(DIRECTIONS);
    // 빌드 산출물이 섞이면 파생 Swift가 검사 대상이 된다.
    expect(files.filter((f) => f.includes("/build/"))).toEqual([]);
  });
});
