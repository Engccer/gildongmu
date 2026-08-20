#!/usr/bin/env node
/**
 * 정식판(Release) 빌드 산출물의 최종 Info.plist를 직접 읽어 검사한다.
 * 설계 정본: docs/superpowers/specs/2026-08-15-walk-guidance-ship-design.md §7.2
 *
 * 소스 검사(`src/lib/__tests__/guidance-gate-drift.test.ts`)는 소스만 본다. 그래서
 * ①Release 대상이 다른 INFOPLIST_FILE을 참조하는 경우 ②병합 과정에서 키가 누락되는
 * 경우 ③Archive가 예상과 다른 구성을 쓰는 경우를 잡지 못한다. 이 계열은 spec이
 * "빌드는 성공하고 전경에서는 완전히 정상인데 화면을 끄면 안내가 죽는다"고 규정한
 * 실패라, 산출물을 읽는 검사가 따로 필요하다.
 *
 * ## 사용
 *
 *   node ios/scripts/check-release-artifact.mjs [<.app 또는 .xcarchive 경로>]
 *                                              [--expect-version 1.7] [--expect-build 13]
 *
 * 경로를 생략하면 `ios/build/*.xcarchive`와 `/tmp/gildongmu-archive/*.xcarchive`
 * 중 가장 최근 것을 찾는다.
 *
 * ⚠ `--expect-*`가 없으면 이 검사는 **어떤 산출물이든** 통과시킬 수 있다. "가장 최근
 * 아카이브"가 지금 제출하려는 빌드라는 보장이 없어서다 — 아카이브를 만든 뒤 소스를
 * 고치고 다른 빌드를 올리면, 검사는 낡은 아카이브를 보고 통과를 내준다. 그 통과는
 * 아무것도 보증하지 않는다. 그래서 `asc-submit.mjs`는 제출할 버전·빌드를 반드시
 * 넘긴다(사람이 손으로 돌릴 때도 넘기는 편이 낫다).
 *
 * ## 검사 항목
 *
 * 0. 번들 ID가 정식판(`space.dodoplanet.gildongmu`)인가 — 실험판(`.dev`) 산출물을
 *    정식판으로 오검사하지 않기 위한 선행 조건.
 * 1. `UIBackgroundModes`에 `location`·`audio`가 둘 다 있는가 (§4.1).
 * 2. 권한 문구 (§4.2): ko는 거리 안내 절이 있고, 비한국어 5로케일은 카탈로그
 *    (`InfoPlist.xcstrings`) 정본과 일치하는가. 기대값을 여기 적지 않는 이유는
 *    카탈로그가 바뀌면 이 검사도 함께 움직여야 하기 때문이다.
 * 3. 실험 전용 권한이 새지 않았는가 (spec 2026-08-17 §5.3): 릴리스 산출물에
 *    `NSBluetoothAlwaysUsageDescription`이 있으면 실패. 1번의 거울상이다 — 그때는
 *    실험판에만 있던 키를 정식으로 올리는 것을 잊었고, 이번엔 실험 전용 키가 정식으로
 *    새는 경우다. 둘 다 소스 검사로는 못 잡는다(어느 INFOPLIST_FILE이 병합됐는지는
 *    산출물에만 있다).
 * 4. 정식 실행 파일이 CoreBluetooth를 링크하지 않는가 (spec 2026-08-17 §5.1, 2026-08-20
 *    개정): Apple의 업로드 검사는 plist가 아니라 **바이너리의 심볼 참조**로 권한 문구를
 *    요구한다(ITMS-90683, 1.8~1.10 연속 경고). 3번이 통과해도 코드가 새면 같은 경고다 —
 *    3번과 4번은 한 쌍이고 둘 다 통과해야 "정식판은 블루투스를 모른다"가 성립한다.
 *
 * 실패는 첫 건에서 멈추지 않고 전부 모아 출력한다(한 번에 고칠 수 있게).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLE_ID = "space.dodoplanet.gildongmu";
/** ko 권한 문구가 도보 안내를 설명하는지 가르는 마커 (§4.2). */
const KO_DISTANCE_MARKER = "남은 거리를 소리로";
const OTHER_LOCALES = ["en", "es", "fr", "it", "ja"];
const LOCATION_KEY = "NSLocationWhenInUseUsageDescription";
/** 실험판(Info-Experimental.plist)에만 있어야 하는 키. 정식 산출물에 보이면 새는 것이다. */
const EXPERIMENTAL_ONLY_KEYS = ["NSBluetoothAlwaysUsageDescription"];
/** 실험 게이트 안 코드만 쓰는 프레임워크. 정식 실행 파일의 링크 목록에 보이면 코드가 샌 것이다. */
const EXPERIMENTAL_ONLY_FRAMEWORKS = ["CoreBluetooth"];
const ARCHIVE_DIRS = [join(REPO, "ios", "build"), "/tmp/gildongmu-archive"];

/** plutil을 거쳐 읽는다 — 컴파일된 InfoPlist.strings도 바이너리 plist라 같은 경로다. */
function readPlist(path) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }));
}

function latestArchive() {
  const found = [];
  for (const dir of ARCHIVE_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".xcarchive")) continue;
      const path = join(dir, name);
      found.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.path ?? null;
}

/** `.xcarchive`면 안쪽 `.app`을 꺼낸다. */
function resolveApp(path) {
  if (path.endsWith(".app")) return path;
  const apps = join(path, "Products", "Applications");
  if (!existsSync(apps)) throw new Error(`아카이브에 Products/Applications가 없다: ${path}`);
  const app = readdirSync(apps).find((n) => n.endsWith(".app"));
  if (!app) throw new Error(`아카이브에 .app이 없다: ${apps}`);
  return join(apps, app);
}

/**
 * 같은 버전인가. ASC의 `versionString`은 `1.7`인데 산출물의
 * `CFBundleShortVersionString`은 `MARKETING_VERSION` 그대로 `1.7.0`이라 표기가 다르다.
 * `asc-submit.mjs`가 ASC 표기를 그대로 넘기므로 문자열 완전 일치로 비교하면
 * **제출 경로가 항상 막힌다**(1.7 제출에서 실측). 빠진 세그먼트를 0으로 채워 비교하되
 * 자릿수는 그대로 본다 — `1.7`과 `1.7.0`은 같고 `1.7`과 `1.8.0`은 다르다.
 * 숫자가 아닌 세그먼트가 섞이면 판정을 지어내지 않고 문자열 일치로 되돌린다.
 */
export function sameVersion(a, b) {
  const seg = (v) => String(v).split(".");
  const [x, y] = [seg(a), seg(b)];
  if ([...x, ...y].some((s) => !/^\d+$/.test(s))) return String(a) === String(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    if (Number(x[i] ?? 0) !== Number(y[i] ?? 0)) return false;
  }
  return true;
}

/** `--이름 값` 형태 인자. 없으면 null. */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** 값을 갖는 플래그. 이 다음 토큰은 위치 인자가 아니다. */
const VALUE_FLAGS = new Set(["--expect-version", "--expect-build"]);

/**
 * 위치 인자(산출물 경로). 없으면 null이고 호출부가 최근 아카이브를 찾는다.
 *
 * ⚠ **값을 갖는 플래그의 값을 경로로 오인하면 안 된다.** `asc-submit.mjs`는 경로 없이
 * `--expect-version 1.7 --expect-build 13`만 넘기므로, "`--`로 시작하지 않는 첫 토큰"을
 * 고르던 종전 구현은 `1.7`을 경로로 읽어 `경로가 없다: 1.7`로 **제출을 항상 막았다**
 * (1.7 제출에서 실측 — 버전 대조 결함과 같은 뿌리다. 이 게이트가 asc-submit 경유로
 * 한 번도 실행되지 않았다는 뜻이다).
 */
export function positionalArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_FLAGS.has(argv[i])) {
      i++;
      continue;
    }
    if (!argv[i].startsWith("--")) return argv[i];
  }
  return null;
}

function main() {
  const given = positionalArg(process.argv.slice(2)) ?? latestArchive();
  if (!given) {
    throw new Error(`검사할 산출물이 없다. 경로를 인자로 주거나 아카이브를 만들어라 (탐색 위치: ${ARCHIVE_DIRS.join(", ")})`);
  }
  if (!existsSync(given)) throw new Error(`경로가 없다: ${given}`);

  const app = resolveApp(given);
  const infoPath = join(app, "Info.plist");
  if (!existsSync(infoPath)) throw new Error(`Info.plist가 없다: ${infoPath}`);
  const info = readPlist(infoPath);

  // 0) 실험판 산출물을 정식판으로 오검사하지 않게 먼저 가른다.
  if (info.CFBundleIdentifier !== BUNDLE_ID) {
    throw new Error(
      `정식판 산출물이 아니다: 번들 ID ${info.CFBundleIdentifier} (기대 ${BUNDLE_ID})\n  경로: ${app}`,
    );
  }

  const failures = [];

  // 0-2) 검사 대상이 지금 제출하는 그 빌드인가. 이것이 어긋나면 아래 검사가 전부
  // 무의미하다 — 통과한 산출물과 심사에 올라가는 산출물이 다른 것이기 때문이다.
  const expectVersion = flag("expect-version");
  const expectBuild = flag("expect-build");
  if (expectVersion && !sameVersion(info.CFBundleShortVersionString, expectVersion)) {
    failures.push(`버전이 다르다: 산출물 ${info.CFBundleShortVersionString}, 제출 대상 ${expectVersion}`);
  }
  if (expectBuild && String(info.CFBundleVersion) !== String(expectBuild)) {
    failures.push(`빌드 번호가 다르다: 산출물 ${info.CFBundleVersion}, 제출 대상 ${expectBuild}`);
  }

  // 1) 백그라운드 모드 (§4.1) — location이 앱을 깨어 있게 하고 audio가 재생을 허용한다.
  const modes = info.UIBackgroundModes ?? [];
  for (const mode of ["location", "audio"]) {
    if (!modes.includes(mode)) {
      failures.push(`UIBackgroundModes에 "${mode}"가 없다 (현재: ${JSON.stringify(modes)})`);
    }
  }

  // 2) 권한 문구 (§4.2)
  const catalog = JSON.parse(readFileSync(join(REPO, "ios/Gildongmu/Resources/InfoPlist.xcstrings"), "utf8"));
  const expected = catalog.strings?.[LOCATION_KEY]?.localizations ?? {};

  const strings = {};
  for (const locale of ["ko", ...OTHER_LOCALES]) {
    const path = join(app, `${locale}.lproj`, "InfoPlist.strings");
    if (!existsSync(path)) {
      failures.push(`${locale}.lproj/InfoPlist.strings가 산출물에 없다`);
      continue;
    }
    strings[locale] = readPlist(path);
  }

  // ko는 두 축으로 본다: ①거리 안내 절이 있는가(의미 — 이 마일스톤이 넣은 것) ②카탈로그
  // 정본과 같은가(드리프트 — 다른 로케일과 같은 축). 마커만 보면 카탈로그가 개정됐는데
  // 산출물이 낡아도 마커가 남아 있으면 통과한다(독립 리뷰 m5).
  const ko = strings.ko?.[LOCATION_KEY];
  if (strings.ko && !ko) {
    failures.push(`ko ${LOCATION_KEY}가 없다`);
  } else if (ko) {
    if (!ko.includes(KO_DISTANCE_MARKER)) {
      failures.push(`ko ${LOCATION_KEY}에 거리 안내 절("${KO_DISTANCE_MARKER}")이 없다: "${ko}"`);
    }
    const wantKo = expected.ko?.stringUnit?.value;
    if (!wantKo) {
      failures.push(`카탈로그에 ko ${LOCATION_KEY} 정본이 없다`);
    } else if (ko !== wantKo) {
      failures.push(`ko ${LOCATION_KEY}가 카탈로그 정본과 다르다\n      산출물: "${ko}"\n      카탈로그: "${wantKo}"`);
    }
  }

  for (const locale of OTHER_LOCALES) {
    if (!strings[locale]) continue;
    const want = expected[locale]?.stringUnit?.value;
    if (!want) {
      failures.push(`카탈로그에 ${locale} ${LOCATION_KEY} 정본이 없다`);
      continue;
    }
    const got = strings[locale][LOCATION_KEY];
    if (got !== want) {
      failures.push(`${locale} ${LOCATION_KEY}가 카탈로그 정본과 다르다\n      산출물: "${got ?? "(없음)"}"\n      카탈로그: "${want}"`);
    }
  }

  // 3) 실험 전용 권한 누출 (spec 2026-08-17 §5.3) — 정식판이 쓰지 않는 권한을 선언하면
  //    심사 신호이자 개인정보 3자 일치의 근거 없는 확장이다. Info.plist뿐 아니라 로케일별
  //    InfoPlist.strings도 본다(키가 나중에 카탈로그로 로컬라이즈되면 거기에만 나타난다).
  for (const key of EXPERIMENTAL_ONLY_KEYS) {
    if (key in info) {
      failures.push(`실험 전용 키 ${key}가 정식 산출물에 있다 (Info-Experimental.plist에만 있어야 한다): "${info[key]}"`);
    }
    for (const [locale, table] of Object.entries(strings)) {
      if (key in table) failures.push(`실험 전용 키 ${key}가 정식 산출물 ${locale}.lproj/InfoPlist.strings에 있다`);
    }
  }

  // 4) 실험 전용 프레임워크 링크 (§5.1 개정) — 권한 문구 검사(3)의 짝. 문구를 뺐는데
  //    코드가 남아 있으면 Apple이 심볼 참조를 보고 같은 경고를 낸다. `otool -L`이 정본이다.
  //    실행 파일이 없거나 otool이 실패해도 throw하지 않는다 — 앞선 검사의 실패를 삼키지 않고
  //    한 번에 모아 낸다는 이 파일의 계약을 지킨다.
  const executable = info.CFBundleExecutable ? join(app, info.CFBundleExecutable) : null;
  if (!executable || !existsSync(executable)) {
    failures.push(`실행 파일을 찾을 수 없다 (CFBundleExecutable=${info.CFBundleExecutable ?? "(없음)"})`);
  } else {
    let linked = null;
    try {
      linked = execFileSync("otool", ["-L", executable], { encoding: "utf8" });
    } catch (e) {
      failures.push(`otool -L 실패: ${e.message}`);
    }
    for (const framework of linked ? EXPERIMENTAL_ONLY_FRAMEWORKS : []) {
      if (linked.includes(`/${framework}.framework/`)) {
        failures.push(`정식 실행 파일이 ${framework}를 링크한다 (실험 게이트 안 코드가 정식판에 컴파일됐다)`);
      }
    }
  }

  if (failures.length) {
    console.error(`\n산출물 검사 실패 (${failures.length}건) — ${app}\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error("");
    process.exit(1);
  }

  // 무엇을 검사했는지 남긴다 — 안 보이면 통과가 통과인지 알 수 없다.
  console.log(
    `산출물 검사 통과 — ${app} (${info.CFBundleIdentifier} ${info.CFBundleShortVersionString}/${info.CFBundleVersion})`,
  );
}

// 직접 실행일 때만 검사한다 — 테스트가 `sameVersion`을 import할 때 아카이브를
// 뒤지기 시작하면 그 자리에 아카이브가 없어 테스트가 환경에 의존하게 된다.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`\n산출물 검사 실패: ${e.message}\n`);
    process.exit(1);
  }
}
