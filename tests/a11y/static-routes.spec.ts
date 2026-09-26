// 정적 라우트 a11y 검증 — 외부 요청은 끊고(지도 SDK·분석) 서버가 렌더한 첫 화면을 본다.
import { test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe-helper";
import { isolateNetwork } from "./network";

const ROUTES = ["/ko", "/en", "/ko/about", "/ko/privacy", "/ko/offline"];

for (const route of ROUTES) {
  test(`a11y: ${route}`, async ({ page }, info) => {
    await isolateNetwork(page);
    await expectNoAxeViolations(page, info, route);
  });
}
