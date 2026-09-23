// A45 소스 가드: follow-up 칩 예산은 "클라이언트 > 서버"여야 한다. 같거나 짧으면 서버가 답을 만든 순간
// 클라이언트가 먼저 끊어 칩이 조용히 0이 된다(종전 6초 = 6초). 네 파일은 언어가 달라 상수를 공유할 수
// 없으므로 소스에서 값을 읽어 대조한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const num = (s: string) => Number(s.replaceAll("_", ""));

function extract(path: string, re: RegExp, toMs: (v: number) => number): number {
  const m = read(path).match(re);
  expect(m, `${path}에서 예산 상수를 찾지 못했다 — 이름을 바꿨으면 이 가드도 함께 고친다`).not.toBeNull();
  return toMs(num(m![1]));
}

describe("follow-up 칩 예산: 클라이언트 > 서버 (A45)", () => {
  const server = extract(
    "src/app/api/chat/suggestions/route.ts",
    /const SERVER_BUDGET_MS = ([\d_]+);/,
    (v) => v,
  );

  it("서버 생성 예산은 AbortSignal에 실제로 걸린다", () => {
    expect(read("src/app/api/chat/suggestions/route.ts")).toContain("AbortSignal.timeout(SERVER_BUDGET_MS)");
  });

  const clients: [string, RegExp, (v: number) => number][] = [
    ["src/hooks/useFollowUpSuggestions.ts", /const TIMEOUT_MS = ([\d_]+);/, (v) => v],
    [
      "ios/GildongmuKit/Sources/GildongmuKit/ChatSuggestionsService.swift",
      /static let timeoutSeconds: TimeInterval = ([\d_]+)/,
      (v) => v * 1000,
    ],
    [
      "android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/ChatSuggestionsService.kt",
      /const val timeoutMs = ([\d_]+)L/,
      (v) => v,
    ],
  ];

  it.each(clients)("%s", (path, re, toMs) => {
    expect(extract(path, re, toMs)).toBeGreaterThan(server);
  });
});
