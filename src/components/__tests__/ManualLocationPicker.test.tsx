// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ko.json";
import { ManualLocationPicker } from "../ManualLocationPicker";

// 이 프로젝트는 vitest globals를 켜지 않아(vitest.config.ts) RTL 자동 정리가
// 없다 — PlaceDetail.test.tsx와 동형으로 각 테스트 후 명시 cleanup.
afterEach(cleanup);

/**
 * fix 라운드 1 Important 2: 모달 제목이 앱 기본 검색(`search.label`, "장소
 * 검색")과 문자 그대로 같으면 결과를 고르는 행동이 검색인지 위치 지정인지
 * 헤딩만으론 구분할 수 없었다. 전용 키 `manualLocation.pickTitle`로 갈랐다.
 */
describe("ManualLocationPicker", () => {
  it("제목이 앱 기본 검색과 다른 '위치 지정하기' 전용 문구다", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <ManualLocationPicker onClose={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "위치 지정하기" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "장소 검색" })).toBeNull();
  });
});
