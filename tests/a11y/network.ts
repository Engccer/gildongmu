// 상태 화면의 네트워크 격리 — 실호출 0, 키·쿼터 비의존, 결정론.
//
// - 게이트 서버 밖(지도 SDK·분석·폰트 등 외부 출처)은 전부 끊는다. SDK가 못 떠도 화면은 서야 한다.
// - `/api/**`는 pathname으로 fixture를 찾아 돌려주고, 없으면 502(라우트의 실제 실패 계약 —
//   upstream 장애 → 502)로 답한다. 실패 화면도 사용자가 만나는 화면이라 감사 대상이다.
// ⚠ 서비스 워커가 가로챈 요청은 page.route에 보이지 않는다 — playwright.config.ts의
//   `serviceWorkers: "block"`과 한 쌍이다.

import type { Page } from "@playwright/test";

export type ApiFixtures = Record<string, unknown>;

export async function isolateNetwork(page: Page, fixtures: ApiFixtures = {}) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (!isLocal) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname in fixtures) {
      return route.fulfill({ status: 200, json: fixtures[url.pathname] });
    }
    return route.fulfill({ status: 502, json: { error: "fixture 없음(a11y 게이트)" } });
  });
}
