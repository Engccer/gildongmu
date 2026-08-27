import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * W2 삭제 재발 가드(spec 2026-08-29 §8.4). 지운 도구·DOM 속성·스토어 API·브릿지가 소스에
 * 되살아나면 실패한다. 이 파일 자신은 낱말을 배열 리터럴로만 들므로 grep에서 제외한다.
 */
const FORBIDDEN = [
  "focus_item",
  "start_guidance",
  "guidance_status",
  "stop_guidance",
  "get_walk_infrastructure_nearby",
  "open_directions",
  "data-focus-target",
  "data-guide-trigger",
  "publishGuideSnapshot",
  "readGuideSnapshot",
  "listHighLevelTargets",
  "HomeEntryBridge",
  "initialToText",
  "abortNow",
];

describe("W2 삭제 재발 가드(spec §8.4)", () => {
  it("삭제된 도구·속성·API 참조가 src에 없다", () => {
    for (const word of FORBIDDEN) {
      const out = execSync(
        `grep -rl --include='*.ts' --include='*.tsx' --exclude=webmcp-removal.test.ts -F "${word}" src || true`,
        { encoding: "utf8" },
      ).trim();
      expect(out, word).toBe("");
    }
  });
});
