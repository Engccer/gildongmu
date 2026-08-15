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
 * 아래 검사 3(세션 시작 호출 수 고정 — `beacon.toggle(`·`beacon.restart(`)이 이 파일의 중심이다.
 */

const ROOT = join(__dirname, "../../..");
const DIRECTIONS = join(ROOT, "ios/Gildongmu/Directions/DirectionsTabView.swift");
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
  it.each(["walkGuideStartable", "manualOriginNoticeText"])(
    "%s 구현 본문에 봉인 플래그가 없다",
    (name) => {
      expect(declarationBody(directions(), name)).not.toContain(
        "experimentalGuidanceEnabled",
      );
    },
  );

  it("구 플래그 realtimeGuidanceEnabled가 남아 있지 않다", () => {
    const offenders = swiftFiles(IOS_DIR).filter((file) =>
      readFileSync(file, "utf8").includes("realtimeGuidanceEnabled"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("3. 안내 세션 진입점이 늘지 않았다", () => {
  /**
   * 안내 세션을 시작시키는 자리의 **전수**. spec §3.2가 6곳을 판정해 두었다(도보
   * 추천·도보 최단·정밀 위치 허용 후 재시작은 정식판 도달, 간략 단독·자동차·대중교통
   * 인계는 차단).
   *
   * ⚠ 판정 축은 "`toggle`을 부르는가"가 아니라 **세션을 시작시키는가**다. A13이
   * 정밀 위치 복구 경로를 `beacon.restart()`로 바꿨을 때 `toggle`만 세는 검사는
   * 그 진입점을 통째로 시야에서 잃었다 — 호출 형태가 늘면 여기에 함께 적는다.
   *
   * ⚠ 이 수가 늘면 실패하는 것이 **의도**다. 새 진입점이 생기면 spec §3.2 표를
   * 갱신하며 그 자리가 정식판에 도달하는지 판정한 뒤 이 수를 올린다. 플래그 참조만
   * 세는 검사로는 "진입점인데 플래그를 안 보는 자리"를 영영 못 잡는다.
   *
   * ⚠ 스캔은 앱 타깃이 아니라 **iOS 전체**다(독립 리뷰 관찰 2026-08-15). 지금은
   * `beacon`이 `DirectionsTabView`의 `@State`라 밖에서 호출될 수 없지만, 모델이
   * 서브뷰나 Kit으로 전달되는 리팩터링이 오면 앱 타깃만 세는 가드는 그 새 진입점을
   * 놓친다. 스캔 범위를 좁힐 이유가 없으므로 넓은 쪽이 기본이다.
   */
  const ENTRY_CALL = /beacon\.(?:toggle|restart)\(/g;

  it("안내 세션 진입점 호출이 정확히 6곳이다", () => {
    const sites = swiftFiles(IOS_DIR).flatMap((file) => {
      const hits = readFileSync(file, "utf8").match(ENTRY_CALL) ?? [];
      return hits.map(() => file);
    });
    expect(sites).toHaveLength(6);
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
