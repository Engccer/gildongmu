import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import it_ from "../../../messages/it.json";
import ja from "../../../messages/ja.json";
import iosExtraKo from "../../../ios/i18n/ios-extra/ko.json";
import { NEARBY_LIVE_DOMAIN_KEYS } from "../nearby-live";

const LOCALES = { ko, en, es, fr, it: it_, ja } as Record<string, Record<string, unknown>>;
// ⚠ `clear`("지정 해제")는 2026-08-09에 사라졌다 — 표시줄의 형제 해제 버튼이
// 제거되며 소비자가 0이 됐고, 되돌리기는 지정 화면의 `useGps`가 담당한다.
// 테스트 이름에 개수를 박지 않는다: 키가 늘 때마다 이름과 배열이 따로 놀았다.
const KEYS = [
  "gps", "gpsNear", "locating", "gpsFailed", "manual", "manualUnverifiable",
  "useGps", "autoCleared", "guideStartsFromCurrent", "pickTitle",
];

describe("manualLocation 문구", () => {
  it.each(Object.keys(LOCALES))(`%s에 ${KEYS.length}키가 전부 있다`, (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string> | undefined;
    expect(ns).toBeDefined();
    for (const k of KEYS) expect(typeof ns![k]).toBe("string");
  });

  it.each(Object.keys(LOCALES))("%s의 수동 문구에 '현재 위치' 계열 표현이 없다", (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string>;
    // 수동 상태 문구가 GPS 상태 문구와 같은 말을 쓰면 시각장애 사용자가
    // 위치 출처를 구분할 수 없다.
    expect(ns.manual).not.toBe(ns.gps);
    expect(ns.manualUnverifiable).not.toBe(ns.gps);
    expect(ns.manual).toContain("{label}");
    expect(ns.manualUnverifiable).toContain("{label}");
  });

  // GPS 주소 병기는 길찾기 필드 라벨(`directions.currentLocationNear`)과 **같은
  // 사실을 말한다** — 두 화면이 같은 좌표를 다르게 부르면 시각장애 사용자는 둘이
  // 같은 곳인지 알 수 없다. 별도 키인 이유는 네임스페이스 분리뿐이므로 값은 동조한다.
  it.each(Object.keys(LOCALES))("%s의 gpsNear가 길찾기 병기 문구와 같다", (locale) => {
    const ns = LOCALES[locale].manualLocation as Record<string, string>;
    const dir = LOCALES[locale].directions as Record<string, string>;
    expect(ns.gpsNear).toBe(dir.currentLocationNear);
    expect(ns.gpsNear).toContain("{address}");
    // 주소 미확보 폴백(`gps`)과 구분돼야 한다 — 안 그러면 병기가 무의미하다.
    expect(ns.gpsNear).not.toBe(ns.gps);
  });
});

// ---------------------------------------------------------------------------
// 전역 제약 가드: "수동 위치가 켜져 있을 때 '현재 위치'라는 표현을 표시 경로에 내지
// 않는다."
//
// ⚠ 위 검사들은 `manualLocation` 네임스페이스 **내부**만 본다. 그래서 다른
// 네임스페이스의 GPS 문구가 수동 상태에서 낭독되는 결함(리뷰 I2: where-am-i 화면이
// 수동일 때도 "현재 위치"로 낭독)을 **구조적으로 못 잡았다**. 여기서 축을 넓힌다.
//
// 규칙: **유효 위치(수동이 반영되는 좌표)를 소비하는 화면**이 GPS 전용 문구를
// 렌더하면, 그 화면은 수동 분기를 가져야 한다(라벨 진입점을 참조해야 한다).
// 새 소비 화면이 생겨도 같은 판정을 받으므로 다음 누수가 빌드에서 걸린다.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** ko 메시지를 dotted key로 편다(웹 정본 + iOS 전용 extra). */
function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

const KO_FLAT = { ...flatten(ko), ...flatten(iosExtraKo) };
/** GPS 상태 문구 그 자체("현재 위치"). 판정 기준을 하드코딩하지 않는다. */
const GPS_PHRASE = (ko as unknown as { manualLocation: { gps: string } }).manualLocation.gps;

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, ext, out);
    } else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

/**
 * 수동 분기가 필요 없다고 판정한 파일 — **근거를 함께 적는다.**
 *
 * 근거 없이 추가하지 말 것. "지금은 안 고친다"도 근거가 될 수 있지만 그때는 그렇게
 * 적어 다음 사람이 남은 누수를 볼 수 있게 한다(가드의 목적은 재고 목록이다).
 */
const NO_MANUAL_BRANCH_OK: Record<string, string> = {
  "ios/Gildongmu/Nearby/NearbyLoadState.swift":
    "`ios.common.outOfCoverage` 한 건뿐이고 그것은 '위치 기반 기능이 대한민국 안에서 제공된다'는 기능 커버리지 설명이라 이 조회가 어느 위치인지 선언하지 않는다(수동 좌표도 같은 판정을 받는다).",
};

/**
 * 파일별로 "수동 상태에서도 렌더되지만 이번 범위 밖"이라 남겨 둔 GPS 문구 키.
 * 위 파일 단위 예외와 달리 **그 파일은 수동 분기를 갖고 있고** 개별 키만 남았다.
 */
const KNOWN_UNBRANCHED_KEYS: Record<string, string> = {
  "ios.nearby.whereAmIChat":
    "채팅 진입 버튼. 열리는 대화의 앵커는 조회된 좌표(수동 반영)이고 호칭은 산문과 같은 층이다(위 §4.7).",
  "directions.useCurrentLocation":
    "출발지 선택 버튼. 누르면 `current` 토큰이 되고 그 해석이 수동 위치를 탄다 — 필드 라벨은 즉시 '지정한 위치'로 바뀐다. 버튼 이름 자체의 재작성은 이번 범위 밖(리뷰 미지적, 새 카피 6로케일).",
  "common.outOfCoverage": "기능 커버리지 설명(위 NearbyLoadState 근거와 같은 층).",
  "ios.common.outOfCoverage": "위와 같음.",
  "directions.geoError":
    "GPS 실패 문구. 수동 위치가 유지되는 동안은 좌표 해석이 성공해 닿지 않고, 닿았다면 그 직전 판정이 수동 위치를 해제한 뒤라 수동 상태가 아니다.",
  "directions.locating":
    "측위 **진행** 상태 문구다(조회 기준의 선언이 아니다). force 조회는 수동 위치가 있어도 이동 판정을 위해 측위하므로 잠깐 나올 수 있고, 그때도 말하는 것은 '무엇을 기다리는 중인가'다.",
  "directions.currentLocation": "수동 분기 뒤의 폴백이라 수동 상태에서 도달 불가.",
  "directions.currentLocationNear": "위와 같음.",
  "directions.refreshingCurrent": "위와 같음.",
  "manualLocation.gps": "표시줄 자신의 GPS 라벨. `manualLabel ?? …` 폴백 뒤라 수동 상태에서 도달 불가 — 이 파일이 스캔 대상이 된 것이 D20②의 요지이고, 대상이 되고 보니 분기는 이미 있었다.",
  "manualLocation.gpsNear": "위와 같음(주소 병기형).",
  "manualLocation.locating": "측위 진행 문구(조회 기준 선언 아님).",
  "manualLocation.guideStartsFromCurrent":
    "수동 위치 기준 결과에서 안내를 시작하는 순간의 고지 — 수동 상태에서 **의도적으로** GPS를 명명한다('현재 위치에서'). 이 문장의 존재 이유가 곧 그 대비라, 수동 분기가 아니라 수동 조건이 발화 조건이다.",
  // M4 둘러보기(2026-08-22): 위치 문장이 수동 분기를 갖는다(`aroundHereManual*`).
  "ios.nearby.aroundHere": "수동 분기 뒤의 GPS 측 문장(수동이면 `aroundHereManual`).",
  "ios.nearby.aroundHereNoPlace": "위와 같음(수동이면 `aroundHereManualNoPlace`).",
  "whereAmI.ready":
    "Kit `overviewAnchorPlace`·`whereAmIToPlace`의 채팅 앵커 이름 폴백(행정동·도로명·지번이 전부 빈 좌표 앵커). 앵커 좌표는 수동 위치를 타지만 이름은 위치 문장 재료의 폴백이라 조회 기준 선언이 아니다.",
  // B9 웹 둘러보기(2026-08-22): 같은 분기의 웹 키.
  "around.here": "수동 분기 뒤의 GPS 측 문장(수동이면 `hereManual`, 근거는 `status.origin` 기록).",
  "around.hereNoPlace": "위와 같음(수동이면 `hereManualNoPlace`).",
};

/**
 * `nearbyLiveMessage` 간접 키(D20①)의 공통 근거. 세 키가 축이 둘뿐이라 한 문장으로 묶는다:
 * `locating`은 **측위 진행** 문구라 조회 기준의 선언이 아니고(`directions.locating`과 같은
 * 근거), `geoDenied`/`geoUnsupported`는 GPS 실패 문구라 **수동 위치가 유지되는 동안 도달하지
 * 않는다**(`effectiveCoordinate`가 먼저 답한다 — `directions.geoError`와 같은 근거).
 *
 * ⚠ 네임스페이스를 명시하는 이유: 새 "내 주변" 도메인은 새 네임스페이스를 쓰므로 목록에
 * 없어 **가드가 실패한다**. 그때 그 도메인이 수동 위치를 어떻게 다루는지 판정하고 여기 적는다.
 * 자동 확장으로 두면 모든 신규 도메인이 조용히 면제된다.
 */
const NEARBY_LIVE_NAMESPACES = [
  "around",
  "bike",
  "bus",
  "clinicNearby",
  "eventsNearby",
  "kidsNearby",
  "subwayNearby",
  "surroundingsNearby",
  "walkInfra",
];
const NEARBY_LIVE_UNBRANCHED_SUFFIXES = ["locating", "error", "geoDenied", "geoUnsupported"];
const NEARBY_LIVE_UNBRANCHED_REASON =
  "nearbyLiveMessage 간접 키: locating·error는 진행·실패 상태 문구(조회 기준 선언 아님), geoDenied·geoUnsupported는 수동 위치가 유지되는 동안 도달 불가.";
for (const ns of NEARBY_LIVE_NAMESPACES) {
  for (const suffix of NEARBY_LIVE_UNBRANCHED_SUFFIXES) {
    const key = `${ns}.${suffix}`;
    if (KO_FLAT[key]?.includes(GPS_PHRASE)) {
      KNOWN_UNBRANCHED_KEYS[key] = NEARBY_LIVE_UNBRANCHED_REASON;
    }
  }
}

interface Surface {
  file: string;
  /** 그 파일이 참조하는 키 중 GPS 문구를 가진 것. */
  gpsKeys: string[];
  branches: boolean;
}

/**
 * 웹 소비자 판정. **세 축**이다(백로그 D20②):
 * ① `source: { kind: "current" }` — "내 주변" 계열
 * ② 수동 라벨 훅(`useManualLocationLabel`·`useManualLocationBilingual`) — 라벨을 직접 렌더하는 화면
 * ③ `useGeolocation(` — GPS 스냅샷을 직접 읽는 화면
 *
 * ①만 보던 종전 판은 **표시줄(`LocationBar.tsx`) 자신을 스캔 밖에 두었다.** 이 기능의
 * 핵심 화면이자 GPS 문구를 직접 렌더하는 유일한 상시 표면인데, 누가 수동 분기를
 * 지워도 가드가 초록이었다.
 */
/**
 * 수동 라벨 훅 계열. 이름을 하나만 검사하면 **훅이 갈라지는 날 조용히 뚫린다** —
 * `LocationBar`가 병기용 `useManualLocationBilingual`로 옮겨갔을 때가 그 자리였다
 * (표시줄이 `branches: false`로 떨어져 위반이 되거나, 스캔 밖으로 빠진다).
 */
const MANUAL_LABEL_HOOK = /useManualLocation(?:Label|Bilingual)\b/;

function isWebSurface(src: string): boolean {
  return (
    src.includes('kind: "current"') ||
    MANUAL_LABEL_HOOK.test(src) ||
    src.includes("useGeolocation(")
  );
}

function webSurfaces(): Surface[] {
  const out: Surface[] = [];
  for (const file of walk(path.join(REPO_ROOT, "src"), ".tsx").concat(
    walk(path.join(REPO_ROOT, "src"), ".ts"),
  )) {
    const src = readFileSync(file, "utf8");
    if (!isWebSurface(src)) continue;
    const namespaces = [...src.matchAll(/useTranslations\("([^"]+)"\)/g)].map((m) => m[1]);
    const literals = new Set(
      [...src.matchAll(/\bt[A-Za-z]*\.?(?:rich)?\("([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]),
    );
    // `nearbyLiveMessage(status, t, …)`는 키를 **자기 안에** 들고 있어 소비 파일에
    // 리터럴이 없다. 그 목록을 이 파일의 네임스페이스에 얹어야 스캔 커버리지가
    // 실제와 같아진다(D20① — 지금 새는 것이 없어도 넓어 보이는 것이 문제다).
    if (src.includes("nearbyLiveMessage(")) {
      for (const key of NEARBY_LIVE_DOMAIN_KEYS) literals.add(key);
    }
    const gpsKeys = new Set<string>();
    for (const lit of literals) {
      for (const ns of [...namespaces, ""]) {
        const full = ns ? `${ns}.${lit}` : lit;
        if (KO_FLAT[full]?.includes(GPS_PHRASE)) gpsKeys.add(full);
      }
    }
    out.push({
      file: path.relative(REPO_ROOT, file),
      gpsKeys: [...gpsKeys],
      // 분기의 형태는 둘이다: ①라벨을 직접 렌더하는 화면은 수동 라벨 훅으로
      // 가르고 ②"내 주변" 계열은 좌표원 자체가 수동 우선이라(`useNearbyFetch`의
      // `source: { kind: "current" }` → `awaitManualLocation`) 화면에 분기 코드가 없다.
      // ②를 미분기로 세면 **좌표는 이미 옳은데** 가드가 매번 위반을 외친다.
      branches:
        MANUAL_LABEL_HOOK.test(src) ||
        (src.includes("useNearbyFetch") && src.includes('kind: "current"')),
    });
  }
  return out;
}

/** iOS: `nearbyCoordinateSource()`/`effectiveCoordinate`를 쓰는 파일이 소비자다. */
function iosSurfaces(): Surface[] {
  const out: Surface[] = [];
  for (const file of walk(path.join(REPO_ROOT, "ios", "Gildongmu"), ".swift")) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("nearbyCoordinateSource()") && !src.includes("effectiveCoordinate")) continue;
    const gpsKeys = [...src.matchAll(/appLocalized\("([^"]+)"/g)]
      .map((m) => m[1])
      .filter((k) => KO_FLAT[k]?.includes(GPS_PHRASE));
    out.push({
      file: path.relative(REPO_ROOT, file),
      gpsKeys: [...new Set(gpsKeys)],
      branches: src.includes("manualLocationLabel(") || src.includes("ManualLocationStore.shared"),
    });
  }
  return out;
}

describe("유효 위치 소비 화면의 GPS 문구 가드", () => {
  const surfaces = [...webSurfaces(), ...iosSurfaces()];

  it("스캔이 실제로 화면을 찾는다(정규식이 비면 가드가 조용히 죽는다)", () => {
    expect(surfaces.length).toBeGreaterThanOrEqual(10);
    expect(surfaces.some((s) => s.gpsKeys.length > 0)).toBe(true);
  });

  it("표시줄 자신이 스캔 대상이다 (D20②)", () => {
    // 이 기능의 핵심 화면이자 GPS 문구를 직접 렌더하는 유일한 상시 표면인데, 종전
    // 유니버스 조건(`kind: "current"` 문자열)에 걸리지 않아 스캔 밖이었다.
    expect(surfaces.map((s) => s.file)).toContain("src/components/LocationBar.tsx");
  });

  it("t를 인자로 받는 헬퍼의 키도 스캔에 잡힌다 (D20①)", () => {
    const subway = surfaces.find((s) => s.file.endsWith("SubwayArrivalsNearby.tsx"));
    expect(subway?.gpsKeys).toContain("subwayNearby.locating");
  });

  it("GPS 전용 문구를 쓰는 화면은 수동 분기를 갖는다", () => {
    const offenders = surfaces
      .filter((s) => s.gpsKeys.length > 0 && !s.branches && !(s.file in NO_MANUAL_BRANCH_OK))
      .map((s) => `${s.file} → ${s.gpsKeys.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("남은 GPS 문구는 전부 근거가 적혀 있다", () => {
    const undocumented = surfaces
      .filter((s) => !(s.file in NO_MANUAL_BRANCH_OK))
      .flatMap((s) => s.gpsKeys)
      .filter((k) => !(k in KNOWN_UNBRANCHED_KEYS));
    expect([...new Set(undocumented)]).toEqual([]);
  });

  it("예외 목록에 죽은 항목이 없다", () => {
    // 근거만 쌓이고 실물이 사라지면 다음 사람이 그것을 현행 계약으로 읽는다.
    const live = new Set(surfaces.flatMap((s) => s.gpsKeys));
    expect(Object.keys(KNOWN_UNBRANCHED_KEYS).filter((k) => !live.has(k))).toEqual([]);
    const files = new Set(surfaces.map((s) => s.file));
    expect(Object.keys(NO_MANUAL_BRANCH_OK).filter((f) => !files.has(f))).toEqual([]);
  });
});

describe("수동 상태 전용 문구", () => {
  it.each(Object.keys(LOCALES))("%s의 둘러보기 수동 문구가 GPS 문구를 되풀이하지 않는다", (locale) => {
    const w = LOCALES[locale].around as Record<string, string>;
    const gps = (LOCALES[locale].manualLocation as Record<string, string>).gps;
    for (const key of ["hereManual", "hereManualNoPlace", "readyManual"]) {
      expect(typeof w[key]).toBe("string");
      expect(w[key]).not.toContain(gps);
    }
  });
});
