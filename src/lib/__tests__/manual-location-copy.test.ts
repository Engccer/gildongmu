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

const LOCALES = { ko, en, es, fr, it: it_, ja } as Record<string, Record<string, unknown>>;
// ⚠ `clear`("지정 해제")는 2026-08-09에 사라졌다 — 표시줄의 형제 해제 버튼이
// 제거되며 소비자가 0이 됐고, 되돌리기는 지정 화면의 `useGps`가 담당한다.
// 테스트 이름에 개수를 박지 않는다: 키가 늘 때마다 이름과 배열이 따로 놀았다.
const KEYS = [
  "gps", "locating", "gpsFailed", "manual", "manualUnverifiable",
  "useGps", "autoCleared", "guideNeedsRealLocation", "pickTitle",
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
  "whereAmI.narrative.here":
    "산문은 그 좌표를 설명한다 — 사용자가 '내가 여기 있다'고 말한 곳이라 spec §4.7이 내용 불변으로 정했다(헤더·트리거만 출처를 명명한다).",
  "ios.nearby.whereAmIChat":
    "채팅 진입 버튼. 열리는 대화의 앵커는 조회된 좌표(수동 반영)이고 호칭은 산문과 같은 층이다(위 §4.7).",
  "ios.nearby.whereAmIEmpty":
    "조회 부재·실패 문구. 수동 상태에서도 도달하므로 후속 카피 정리 대상 — 리뷰 I2는 헤더·트리거를 지목했다.",
  "ios.nearby.whereAmIFailed": "위와 같음(부재·실패 문구, 후속 카피 정리 대상).",
  "ios.nearby.whereAmIServerFailed": "위와 같음(부재·실패 문구, 후속 카피 정리 대상).",
  "whereAmI.empty": "위와 같음(부재 문구, 후속 카피 정리 대상).",
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
  "whereAmI.ready": "수동 분기 뒤의 폴백이라 수동 상태에서 도달 불가.",
  "whereAmI.button": "위와 같음(수동이면 `manualButton`).",
  "ios.nearby.whereAmIAsOf": "위와 같음(수동이면 라벨 + `whereAmI.asOf`).",
  "ios.nearby.whereAmIReady": "위와 같음(수동이면 `manualReady`).",
};

interface Surface {
  file: string;
  /** 그 파일이 참조하는 키 중 GPS 문구를 가진 것. */
  gpsKeys: string[];
  branches: boolean;
}

/** 웹: `source: { kind: "current" }`를 쓰는 파일이 유효 위치 소비자다. */
function webSurfaces(): Surface[] {
  const out: Surface[] = [];
  for (const file of walk(path.join(REPO_ROOT, "src"), ".tsx").concat(
    walk(path.join(REPO_ROOT, "src"), ".ts"),
  )) {
    const src = readFileSync(file, "utf8");
    if (!src.includes('kind: "current"')) continue;
    const namespaces = [...src.matchAll(/useTranslations\("([^"]+)"\)/g)].map((m) => m[1]);
    const literals = new Set(
      [...src.matchAll(/\bt[A-Za-z]*\.?(?:rich)?\("([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]),
    );
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
      branches: src.includes("useManualLocationLabel"),
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
  it.each(Object.keys(LOCALES))("%s의 where-am-i 수동 문구가 GPS 문구를 되풀이하지 않는다", (locale) => {
    const w = LOCALES[locale].whereAmI as Record<string, string>;
    const gps = (LOCALES[locale].manualLocation as Record<string, string>).gps;
    for (const key of ["manualButton", "manualReady"]) {
      expect(typeof w[key]).toBe("string");
      expect(w[key]).not.toContain(gps);
    }
  });
});
