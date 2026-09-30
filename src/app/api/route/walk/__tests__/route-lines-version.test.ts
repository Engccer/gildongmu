import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `lines` 판본의 라우트 → 서비스 배선(E52). 판본 분기의 존재 이유(배포된 iOS 1.19는 첫 줄 뒤 줄들의 펼침을
 * 한 칸 공유해 세 줄을 받으면 둘이 함께 열린다)가 `route.ts`의 전달 한 줄에 걸려 있어 따로 잠근다 — 서비스
 * 테스트는 판본을 직접 넘기고, 라우트 본 테스트는 카카오 키가 없어 판본이 결과를 바꾸지 않는다.
 */
vi.mock("@/lib/env", () => ({ hasWalkRouteKeyFor: vi.fn(() => true) }));
vi.mock("@/lib/rate-limit", () => ({
  checkWalkRateLimit: vi.fn(() => true),
  clientIpFromHeaders: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/walk-route", () => ({
  getWalkRoute: vi.fn(),
  getWalkRouteAlternatives: vi.fn(),
  getWalkRouteLines: vi.fn(async () => []),
}));

import { GET } from "../route";
import { getWalkRouteLines } from "@/lib/walk-route";

const url = (lines: string) => `http://x/api/route/walk?origin=37.5,127.0&dest=37.6,127.1&lines=${lines}`;

describe("lines 판본 전달(E52)", () => {
  it("lines=1 → 판본 1(최대 두 줄), lines=2 → 판본 2(최대 세 줄)", async () => {
    for (const [value, version] of [["1", 1], ["2", 2]] as const) {
      vi.mocked(getWalkRouteLines).mockClear();
      expect((await GET(new NextRequest(url(value)))).status).toBe(200);
      expect(vi.mocked(getWalkRouteLines).mock.calls[0][0]).toMatchObject({ version });
    }
  });
});
