import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 도보 안내 정식 출시 게이트의 소스 드리프트 가드
 * (spec `docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md` §7.1).
 *
 * 도보는 정식판으로 졸업했고 자동차·대중교통·간략 단독 진입은 봉인이 남았다. 그 경계는
 * 코드 여러 곳에 흩어져 있어 한 곳만 어긋나도 **검증이 끝나지 않은 안내가 정식판에서
 * 시작된다** — 오류를 내지 않고 조용히 뚫린다.
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

const FLAG = "AppConfig.experimentalGuidanceEnabled";

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

describe("1. 자동차·대중교통·간략 단독 진입의 봉인이 유지된다", () => {
  // 도보만 졸업했다(spec §2 "실험판에 남는 것"). 이 넷 중 하나라도 플래그를 놓으면
  // 실주행·실승차 판정이 끝나지 않은 안내가 정식판에서 시작된다.
  const SEALED = [
    "carGuideStartable",
    "transitGuideStartable",
    "altTransitGuideStartable",
    "briefFallbackVisible",
  ];

  it.each(SEALED)("%s 본문이 봉인 플래그를 검사한다", (name) => {
    expect(declarationBody(directions(), name)).toContain(FLAG);
  });

  it("자동차 시작 버튼이 carGuideStartable 게이트 안에 있다", () => {
    expect(windowBefore(directions(), '"beacon.guideStartCar"', 5)).toContain(
      "carGuideStartable",
    );
  });

  it("간략 단독 시작 버튼이 봉인 조건 안에 있다", () => {
    // 이 버튼은 두 얼굴이라(추적 중=중지 / 비추적=간략 단독 시작) 게이트가
    // `beacon.isTracking || 플래그`다 — 플래그만 검사하면 조건 자체가 바뀐 것을
    // 놓친다(spec §3.3).
    expect(windowBefore(directions(), '"beacon.briefGuideStart"', 6)).toContain(
      `beacon.isTracking || ${FLAG}`,
    );
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
    // 한다. 대중교통→도보 핸드오프(사용자 활성화가 아니고 그 세션은 이미 실좌표 위에
    // 있었다)는 N1부터 `GuideSession.acceptWalkHandoff` 안에 살아 이 파일에 없고,
    // `restart()`(정밀 위치 허용 뒤 같은 세션 재시작)는 처음 시작 때 이미 말했다.
    const src = directions();
    const lines = src.split("\n");
    const starts = lines
      .map((line, i) =>
        line.includes("beacon.toggle(") || line.includes("session.startBeacon(") ? i : -1,
      )
      .filter((i) => i >= 0);
    // 간략 폴백(toggle)·자동차·도보 추천·도보 최단.
    expect(starts.length).toBe(4);
    const announced = starts.filter((i) =>
      lines.slice(Math.max(0, i - 3), i).some((l) => l.includes("announceGuideStartIfManualOrigin()")),
    );
    expect(announced.length).toBe(4);
    // 핸드오프 진입점은 GuideSession 안에 둘이다 — 대중교통→도보(`acceptWalkHandoff`)와
    // 자동차 도착→도보(`acceptCarWalkHandoff`, 2026-08-23 K2. 자동차 세션이 봉인 안이라 도달
    // 불가이지만 도보 세션 자체는 졸업한 기능이라 별도 게이트가 없다 — spec K2 §6.4).
    // 승차 전 도보(A25, 2026-08-30 — `startTransit` 안. 대중교통 시작 버튼이 봉인 안이라 도달 불가)까지 셋.
    const session = readFileSync(GUIDE_SESSION, "utf8");
    expect(session.match(/self\.startBeacon\(/g)).toHaveLength(3);
    expect(declarationBody(session, "acceptWalkHandoff")).toContain("self.startBeacon(");
    expect(declarationBody(session, "acceptCarWalkHandoff")).toContain("self.startBeacon(");
    expect(declarationBody(session, "startTransit")).toContain("self.startBeacon(");
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
  const ENTRY_CALL = /(?:beacon\.(?:toggle|restart)|(?:session|self)\.startBeacon)\(/g;

  it("안내 세션 진입점 호출이 정확히 8곳이다", () => {
    const sites = swiftFiles(IOS_DIR).flatMap((file) => {
      const hits = readFileSync(file, "utf8").match(ENTRY_CALL) ?? [];
      return hits.map(() => file);
    });
    expect(sites).toHaveLength(8);
  });

  it("재시작 진입점은 인자를 다시 조립하지 않는다(A13)", () => {
    // `restart()`가 인자를 받게 되는 순간 호출부가 다시 시작 인자의 소유자가 되고,
    // 그 자리에서 하나를 빠뜨리는 것이 정확히 A13의 결함이었다.
    const hits = swiftFiles(IOS_DIR).flatMap(
      (file) => readFileSync(file, "utf8").match(/beacon\.restart\([^)]*\)/g) ?? [],
    );
    expect(hits).toEqual(["beacon.restart()"]);
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
