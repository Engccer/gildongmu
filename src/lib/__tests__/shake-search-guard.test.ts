import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 흔들면 장소 검색 창으로(E87, 위원장 판정 2026-11-16·17, iOS 실험판) 소스 가드. 뷰 배선은 테스트 레인이 없어 여기서 잠근다.
 * 판정: ①실험판 전용(정식판 컴파일 0) ②안내 중에도 검색으로 가고 시트는 접기만(종료 없음) ③초점만 둔다(받아쓰기·통지 없음).
 */

const IOS = join(__dirname, "../../../ios");
const read = (rel: string) => readFileSync(join(IOS, rel), "utf8");

/** 이름으로 찾은 Swift 함수 본문(여는 중괄호부터 짝이 맞는 닫는 중괄호까지). */
function functionBody(source: string, name: string): string {
  const at = source.indexOf(`func ${name}(`);
  if (at < 0) throw new Error(`func ${name}을 찾지 못했다`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`func ${name}의 끝을 찾지 못했다`);
}

/** `#if EXPERIMENTAL` … `#endif` 블록 안에 `needle`이 있는가(중첩 없는 블록 기준). */
function insideExperimental(source: string, needle: string): boolean {
  const at = source.indexOf(needle);
  if (at < 0) return false;
  const open = source.lastIndexOf("#if EXPERIMENTAL", at);
  const close = source.lastIndexOf("#endif", at);
  // `#else` 갈래(정식판이 컴파일하는 쪽)는 안이 아니다.
  const otherwise = source.lastIndexOf("#else", at);
  return open >= 0 && open > close && open > otherwise;
}

describe("E87 흔들기 → 장소 검색 창", () => {
  const shake = read("Gildongmu/ShakeToSearch.swift");
  const app = read("Gildongmu/GildongmuApp.swift");
  const search = read("Gildongmu/SearchView.swift");

  it("정식판에는 아무것도 컴파일되지 않는다 — 파일 본문 전체·앱 루트·검색 화면의 배선이 실험 게이트 안이다", () => {
    const body = shake.slice(shake.indexOf("#if EXPERIMENTAL"));
    expect(body.trimEnd().endsWith("#endif")).toBe(true);
    expect(shake.split("#if EXPERIMENTAL").length - 1).toBe(1);
    for (const needle of ["extension UIWindow", "final class ShakeToSearch", "applicationSupportsShakeToEdit = false"]) {
      expect(insideExperimental(shake, needle), needle).toBe(true);
    }
    expect(insideExperimental(app, ".onDeviceShake(perform: handleShake)")).toBe(true);
    expect(insideExperimental(app, "private func handleShake()")).toBe(true);
    expect(insideExperimental(search, ".shakeSearchFocusTarget(focused: $searchFieldFocused)")).toBe(true);
    // 산출물 검사가 정식 실행 파일에서 이 타입 이름을 센다.
    expect(read("scripts/check-release-artifact.mjs")).toMatch(/EXPERIMENTAL_ONLY_SYMBOLS = \[[^\]]*"ShakeToSearch"/);
  });

  it("창이 흔들기만 골라 앱 수명 칸에 알리고 응답 사슬을 그대로 잇는다(super)", () => {
    const override = functionBody(shake, "motionEnded");
    expect(override).toContain("motion == .motionShake");
    expect(override).toContain("super.motionEnded(motion, with: event)");
  });

  it("흔들면 안내 시트는 접기만 하고(종료·소거 없음) 검색 탭으로 가서 초점을 요청한다", () => {
    const handle = functionBody(app, "handleShake");
    expect(handle).toContain("guideSession.isMinimized = true");
    expect(handle).toContain("selectedTab = .search");
    expect(handle).toContain("ShakeToSearch.shared.requestFocus()");
    // 접은 뒤의 띠바 착지가 검색 창 초점과 다투지 않게 그 한 번은 건너뛴다.
    expect(handle).toMatch(/skipBandLanding = true\s*\n\s*guideSession\.isMinimized = true/);
    expect(app).toContain("if skipBandLanding { skipBandLanding = false; bandFocusTask = nil; return }");
    expect(app.match(/skipBandLanding = true/g)?.length).toBe(1);
    for (const banned of ["stop", "clearArrival", "resetSession", "sessionEpoch"]) {
      expect(handle, banned).not.toContain(banned);
    }
  });

  it("초점만 둔다 — 받아쓰기를 켜지 않고 통지를 겹치지 않는다", () => {
    const handle = functionBody(app, "handleShake");
    const consume = functionBody(shake, "consume");
    for (const body of [handle, consume]) {
      expect(body).not.toMatch(/speech|voiceStartRequested|Announcement|announce/);
    }
    expect(consume).toContain("focused.wrappedValue = true");
    expect(shake).toContain(".searchFocused(focused)");
  });

  it("검색 탭 안 깊은 화면은 목록 루트로 되돌린다(경로 비우기)", () => {
    expect(search).toContain("NavigationStack(path: $path)");
    const hook = search.slice(search.indexOf(".shakeSearchFocusTarget("));
    expect(hook.slice(0, hook.indexOf("#endif"))).toContain("path = NavigationPath()");
  });
});
