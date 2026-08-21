import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 실시간 길 안내 효과음의 웹↔iOS 드리프트 가드(2026-08-03 파일 전환으로
 * `beacon-tones-drift.test.ts`의 합성 데이터 대조를 대체).
 *
 * 소리 정본은 파일 자체다: 웹 `public/sounds/guide/<이름>.mp3` ↔ 앱
 * `ios/Gildongmu/Resources/Sounds/guide-<이름>.mp3`가 **바이트 동일**해야 한다.
 * 한쪽만 갈리면 "같은 소리"라는 전제가 조용히 깨진다(위원장 청취 선정이 정본).
 */
const SOUNDS = [
  "closer",
  "farther",
  "nearby",
  "tick",
  "start",
  "stop",
  "ahead",
  "warning",
  "unreliable",
  // 결정 지점 행동 톤(N2, 2026-08-22). left·right는 구분 방식 후보 2종을 함께 싣는다
  // (실기기 선택 뒤 패자를 지우고 `left`·`right`로 접는다).
  "crosswalk",
  "back",
  "left-pan",
  "right-pan",
  "left-pitch",
  "right-pitch",
] as const;

/** iOS `BeaconTone` 케이스(파일이 아니라 톤 — left·right는 scheme이 파일을 고른다). */
const TONE_CASES =
  "closer, farther, nearby, tick, start, stop, ahead, crosswalk, left, right, back, warning, unreliable";

const ROOT = path.resolve(__dirname, "../../..");

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("실시간 길 안내 사운드 파일 동조", () => {
  for (const name of SOUNDS) {
    it(`${name}: 웹과 iOS 리소스가 바이트 동일`, () => {
      const web = path.join(ROOT, "public/sounds/guide", `${name}.mp3`);
      const ios = path.join(ROOT, "ios/Gildongmu/Resources/Sounds", `guide-${name}.mp3`);
      expect(sha(web)).toBe(sha(ios));
    });
  }

  it("웹 재생기가 파일 전부를 알고 있다(누락 시 조용한 폴백 금지)", () => {
    const hook = readFileSync(path.join(ROOT, "src/hooks/useBeaconSound.ts"), "utf8");
    for (const name of SOUNDS) expect(hook).toContain(`"${name}"`);
  });

  it("iOS BeaconTone 케이스와 파일 집합이 일치한다", () => {
    const kit = readFileSync(
      path.join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift"),
      "utf8",
    );
    expect(kit).toContain(`case ${TONE_CASES}`);
  });
});
