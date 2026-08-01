import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLOSER_TONES,
  FARTHER_TONES,
  NEARBY_TONES,
  TICK_TONES,
} from "../beacon-tones";
import type { Tone } from "../tones";

/**
 * 웹 톤 테이블과 iOS `BeaconTones.swift`의 드리프트 가드.
 *
 * ⚠ Swift 상수를 Swift 리터럴과 비교하는 테스트는 **웹이 바뀌어도 실패하지 않는다.**
 * 정본(웹)을 읽어 Swift 파일과 교차 대조해야 드리프트가 잡힌다(CLI/MCP 카탈로그
 * byte 해시 드리프트 테스트와 같은 정신).
 *
 * 대상은 추세·도착·tick 4종뿐이다. 시작·정지는 iOS가 의도적으로 다른 값을 쓴다
 * (웹 START_TONES가 CLOSER_TONES와 주파수·방향이 같아 iOS에서는 한 기능 안에서
 * 구분되지 않는다 — 근거는 `BeaconTones.swift` 주석).
 */

const SWIFT_PATH = "ios/GildongmuKit/Sources/GildongmuKit/BeaconTones.swift";
const swift = readFileSync(SWIFT_PATH, "utf8");

/** `case .<name>:` 블록에서 ToneStep의 freq를 선언 순서대로 뽑는다. */
function swiftFreqs(caseName: string): number[] {
  const block = new RegExp(
    `case \\.${caseName}:([\\s\\S]*?)(?=\\n\\s{4}case \\.|\\n\\s{4}\\})`,
  ).exec(swift);
  if (!block) throw new Error(`${SWIFT_PATH}에서 case .${caseName} 블록을 찾지 못했다`);
  return [...block[1].matchAll(/freq:\s*([\d.]+)/g)].map((m) => Number(m[1]));
}

describe("비콘 톤 테이블 웹-iOS 드리프트", () => {
  const shared: [string, Tone[]][] = [
    ["closer", CLOSER_TONES],
    ["farther", FARTHER_TONES],
    ["nearby", NEARBY_TONES],
    ["tick", TICK_TONES],
  ];

  it.each(shared)("%s 주파수가 웹 정본과 같다", (name, web) => {
    expect(swiftFreqs(name)).toEqual(web.map((t) => t.freq));
  });

  it("시작·정지는 추세 톤과 구분되는 값이어야 한다", () => {
    // 이 기능의 전제는 "음높이 방향 = 추세"다. 시작음이 closer와 같은 주파수·방향이면
    // 그 전제가 깨진다(웹 값을 그대로 쓰면 실제로 그렇게 된다).
    expect(swiftFreqs("start")).not.toEqual(swiftFreqs("closer"));
    expect(swiftFreqs("stop")).not.toEqual(swiftFreqs("farther"));
    // 음 수로도 갈라 둔다(추세는 2음, 시작·정지는 3음).
    expect(swiftFreqs("start").length).toBeGreaterThan(swiftFreqs("closer").length);
  });

  it("가드 자체가 살아 있다 (블록을 못 찾으면 조용히 통과하지 않는다)", () => {
    expect(() => swiftFreqs("nonexistent")).toThrow(/찾지 못했다/);
  });
});
