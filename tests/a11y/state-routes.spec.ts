// 상태 화면 a11y 검증 — 검색 결과·내 주변 허브·장소 상세·길찾기 결과.
// `/api/**`는 fixture(network.ts), 외부 출처는 차단이라 실호출 0이다.
import { expect, test } from "@playwright/test";
import { expectNoAxeViolationsOnPage } from "./axe-helper";
import { GYEONGBOKGUNG, SEARCH_FIXTURES, SEOUL_STATION, WALK_FIXTURES } from "./fixtures";
import { isolateNetwork } from "./network";

test("a11y: 검색 결과 (/ko?q=)", async ({ page }, info) => {
  await isolateNetwork(page, SEARCH_FIXTURES);
  await page.goto(`/ko?q=${encodeURIComponent("경복궁")}`);
  await expect(page.getByRole("button", { name: /서울역/ }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoAxeViolationsOnPage(page, info, "search-results");
});

test("a11y: 장소 상세 (검색 결과 항목 활성화)", async ({ page }, info) => {
  await isolateNetwork(page, SEARCH_FIXTURES);
  await page.goto(`/ko?q=${encodeURIComponent("경복궁")}`);
  await page.getByRole("button", { name: /경복궁/ }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: /경복궁/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoAxeViolationsOnPage(page, info, "place-detail");
});

test("a11y: 내 주변 허브 (/ko?panel=nearby)", async ({ page }, info) => {
  await isolateNetwork(page);
  await page.goto("/ko?panel=nearby");
  await page.waitForLoadState("networkidle");
  await expectNoAxeViolationsOnPage(page, info, "nearby-hub");
});

test("a11y: 길찾기 결과 (/ko?dir=)", async ({ page }, info) => {
  await isolateNetwork(page, WALK_FIXTURES);
  const ep = (p: { name: string; lat: number; lng: number }) =>
    `${encodeURIComponent(p.name)}@${p.lat},${p.lng}`;
  // `?dir=` 복원은 폼만 채운다(자동 조회 없음 — 프리필과 다른 진입). 조회는 버튼으로.
  await page.goto(`/ko?dir=${encodeURIComponent(`${ep(GYEONGBOKGUNG)}/${ep(SEOUL_STATION)}`)}`);
  await page.getByRole("button", { name: "경로 조회" }).click();
  // 도보 줄을 펼쳐 단계 목록까지 감사 범위에 넣는다(대중교통·자동차는 fixture 없음 → 실패 문장).
  await page.getByRole("button", { name: /최단 경로/ }).click();
  await expect(page.getByText("세종대로에서 좌회전 후 2.5km 직진")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoAxeViolationsOnPage(page, info, "directions-result");
});
