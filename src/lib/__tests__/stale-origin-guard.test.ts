import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 옛 위치(stale-origin, spec 2026-09-23-stale-origin-disclosure-design.md) iOS 배선의 소스 가드.
 *
 * iOS 앱 타깃엔 테스트 번들이 없다. 판정(`staleFixAge`)은 Kit이 공유 fixture로 잠그지만, "옛 위치를
 * 좌표 분기보다 먼저 본다"·"좌표를 쓰는 자리에서 옛 위치를 푼다"는 앱 배선이라 여기서 잠근다 —
 * 되돌아가면 옛 주소가 다시 "현재 위치"로 낭독되는데 빌드·Kit 테스트는 전부 초록이다.
 */
const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function walkKotlin(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walkKotlin(path);
    return name.endsWith(".kt") ? [path] : [];
  });
}
const BAR = read("ios/Gildongmu/LocationBarView.swift");
const SERVICE = read("ios/Gildongmu/LocationService.swift");
const DIRECTIONS = read("ios/Gildongmu/Directions/DirectionsTabView.swift");

describe("iOS 옛 위치 배선", () => {
  it("표시줄은 옛 위치를 좌표 유무보다 먼저 본다(뒤면 좌표가 남았다는 이유로 '현재 위치'가 먼저 나간다)", () => {
    const stale = BAR.indexOf("if let stale = location.staleFix");
    const coord = BAR.indexOf("guard location.lastCoordinate != nil");
    expect(stale).toBeGreaterThan(0);
    expect(coord).toBeGreaterThan(stale);
    // 권한·정밀도 분기는 그보다 앞이다(권한 축은 옛 위치로 답하지 않는다).
    expect(BAR.indexOf("case .denied, .restricted:")).toBeLessThan(stale);
    expect(BAR.indexOf("ios.common.geoReducedTitle")).toBeLessThan(stale);
  });

  it("옛 위치 문장엔 그 옛 좌표의 주소만 싣는다", () => {
    expect(BAR).toContain("addressStore.isAddress(forLat: stale.lat, lng: stale.lng) ? address : nil");
  });

  it("좌표를 스토어에 쓰는 자리가 옛 위치를 푼다(단발·스트림 공통 해제점 하나)", () => {
    const write = SERVICE.indexOf("self.stored = fix");
    expect(write).toBeGreaterThan(0);
    expect(SERVICE.slice(write, write + 200)).toContain("self.failedSinceLastStore = false");
    // 다른 곳에서 stored를 쓰면 해제가 빠진 경로가 생긴다.
    expect(SERVICE.match(/\bstored = /g) ?? []).toHaveLength(1);
  });

  it("옛 위치 전이는 뷰 태스크 키가 아니라 측위 없는 동기화로 따라간다(태스크 키면 자기 측위 실패가 자기를 취소한다, 구현 리뷰 H-1)", () => {
    expect(BAR).toContain(".task(id: store.current == nil)");
    expect(BAR).not.toMatch(/\.task\(id:[^)]*staleFix/);
    expect(BAR).toMatch(/\.onChange\(of: location\.staleFix\?\.fixedAt\)[\s\S]{0,200}addressStore\.syncFromStore\(\)/);
    // 길찾기 칸도 같은 전이를 따라간다(구현 리뷰 M-2).
    expect(DIRECTIONS).toMatch(/\.onChange\(of: locationService\.staleFix\?\.fixedAt\) \{ model\.syncCurrentFromStore\(\) \}/);
  });

  it("안드로이드도 보관 좌표를 쓰는 자리는 하나다(세터가 옛 위치를 푼다, 재리뷰 N-8)", () => {
    const store = read("android/app/src/main/kotlin/space/dodoplanet/gildongmu/location/LocationStore.kt");
    // `internal set`은 `:app` 모듈 전체에 쓰기를 연다 — 파일 하나가 아니라 모듈 소스 전체에서 센다.
    const writes = walkKotlin(join(ROOT, "android/app/src/main")).flatMap((f) =>
      // 대입만 센다(`val stored = …` 같은 지역 선언은 다른 변수다).
      readFileSync(f, "utf8").match(/(?<!(?:val|var) )\bstored = /g) ?? [],
    );
    expect(writes).toHaveLength(1);
    expect(store.match(/\bstored = /g) ?? []).toHaveLength(1);
    const at = store.indexOf("internal set(value)");
    expect(at).toBeGreaterThan(0);
    const setter = store.slice(at, at + 300);
    expect(setter).toContain("failedSinceLastStore = false");
  });

  it("길찾기 조회·재선택 실패는 같은 폴백 판정을 지난다", () => {
    const calls = DIRECTIONS.match(/staleOriginFallback\(after: error\)/g) ?? [];
    expect(calls).toHaveLength(2);
    const fallback = DIRECTIONS.slice(DIRECTIONS.indexOf("private func staleOriginFallback"));
    expect(fallback.slice(0, 600)).toContain("guard case .unavailable = error, ManualLocationStore.shared.current == nil");
  });
});
