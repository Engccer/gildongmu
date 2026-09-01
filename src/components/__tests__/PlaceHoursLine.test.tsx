// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ko from "../../../messages/ko.json";
import { PlaceHoursLine } from "../PlaceHoursLine";
import type { Place } from "@/lib/types";

/**
 * 장소 상세 영업시간 한 줄(E24 웹, iOS `PlaceHoursLine.lineText` 미러). 서버가 어떤 실패도
 * `{hours:null}`로 접으므로 소비자 축은 넷뿐이다: 구간 표시 · 다음 날 마감 · 24시간 · 휴무,
 * 그리고 null·오류·타임아웃은 줄 없음(침묵).
 */
const place = {
  id: "kakao-1",
  name: "테스트 카페",
  lat: 37.5,
  lng: 127.1,
  roadAddress: "서울 강동구 성내로 12",
} as unknown as Place;

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderLine() {
  return render(
    <NextIntlClientProvider locale="ko" messages={ko}>
      <PlaceHoursLine place={place} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("PlaceHoursLine", () => {
  it("구간이 있으면 시간표형 한 줄 + Google Maps 표기, 요청에 이름·좌표·도로명이 실린다", async () => {
    const fetchMock = mockFetch({
      hours: { ranges: [{ open: "10:00", close: "22:00", closesNextDay: false }], allDay: false },
    });
    renderLine();
    expect(await screen.findByText("오늘 영업시간 10:00~22:00 (Google Maps)")).toBeTruthy();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith("/api/places/hours?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("name")).toBe("테스트 카페");
    expect(params.get("lat")).toBe("37.5");
    expect(params.get("roadAddress")).toBe("서울 강동구 성내로 12");
  });

  it("다음 날 마감은 '다음 날' 접두, 구간 둘은 쉼표로 잇는다", async () => {
    mockFetch({
      hours: {
        ranges: [
          { open: "11:00", close: "15:00", closesNextDay: false },
          { open: "17:00", close: "02:00", closesNextDay: true },
        ],
        allDay: false,
      },
    });
    renderLine();
    expect(await screen.findByText("오늘 영업시간 11:00~15:00, 17:00~다음 날 02:00 (Google Maps)")).toBeTruthy();
  });

  it("24시간과 오늘 휴무는 각자의 문장", async () => {
    mockFetch({ hours: { ranges: [], allDay: true } });
    const { unmount } = renderLine();
    expect(await screen.findByText("오늘 영업시간 24시간 (Google Maps)")).toBeTruthy();
    unmount();
    mockFetch({ hours: { ranges: [], allDay: false } });
    renderLine();
    expect(await screen.findByText("오늘 휴무 (Google Maps)")).toBeTruthy();
  });

  it("hours null·HTTP 오류·네트워크 실패는 줄을 만들지 않는다(침묵)", async () => {
    mockFetch({ hours: null });
    const a = renderLine();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(a.container.querySelector("p")).toBeNull();
    a.unmount();

    mockFetch({ hours: { ranges: [], allDay: true } }, false);
    const b = renderLine();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(b.container.querySelector("p")).toBeNull();
    b.unmount();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const c = renderLine();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(c.container.querySelector("p")).toBeNull();
  });
});
