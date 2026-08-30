import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * E24 영업시간 문자열의 TTS 격리 가드(spec 2026-08-30-place-hours-google-design.md §4).
 *
 * Google Maps Platform Terms §3.2.3(a)(iv)는 Google Maps Content의 TTS 사용을 금지한다.
 * 위원장 판정(2026-08-29): VoiceOver는 예외, 앱이 스스로 합성하는 경로(`TtsPlayer`·채팅
 * "듣기"·운전자 모드 `speakGuidance`)는 금지 대상. LLM 산문에서 "영업시간만 빼기"는 보장할
 * 수 없으므로 경계는 **심볼이 등장하는 파일의 집합** 자체다 — 채팅·CLI/MCP·안내 계층에
 * 이 심볼이 나타나면 그 자체가 위반 신호다.
 */
const ROOT = join(__dirname, "../../..");
const ALLOWED = new Set([
  "src/lib/place-hours.ts",
  "src/lib/providers/google-places.ts",
  "src/app/api/places/hours/route.ts",
  "src/lib/__tests__/place-hours.test.ts",
  "src/lib/__tests__/place-hours-tts-drift.test.ts",
  "ios/GildongmuKit/Sources/GildongmuKit/PlaceHoursService.swift",
  "ios/Gildongmu/PlaceHoursLine.swift",
  "ios/scripts/messages-to-xcstrings.mjs",
  "ios/Gildongmu/PlaceDetailView.swift",
  "ios/Gildongmu/AppConfig.swift",
  "scripts/verify-place-hours.mjs",
]);

function grepFiles(pattern: string): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "--untracked", "-l", "-E", pattern, "--", "src", "ios", "packages", "scripts", ":!*.xcstrings", ":!*.json"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return [];
    throw e;
  }
}

describe("영업시간 심볼은 allowlist 파일에만 산다", () => {
  it("PlaceHours(Today|Service|Model|Line)·/api/places/hours가 채팅·CLI/MCP·안내 계층에 없다", () => {
    // i18n 키·응답 필드명도 잡는다 — 심볼 없이 문자열만 가져다 speakGuidance에 태우는 경로가 가장 그럴듯한 유출이다
    const files = grepFiles("PlaceHours(Today|Service|Model|Line)|/api/places/hours|getPlaceHoursToday|ios\\.placeHours\\.|closesNextDay");
    const leaked = files.filter((f) => !ALLOWED.has(f));
    expect(leaked).toEqual([]);
    // allowlist가 죽은 목록이 되지 않게: 핵심 파일이 실제로 검출된다
    expect(files).toContain("src/lib/providers/google-places.ts");
  });
});
